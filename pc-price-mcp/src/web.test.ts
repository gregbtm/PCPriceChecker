import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as db from './db.js';
import { startWebServer } from './web.js';
import { buildN8nWorkflow, N8N_WORKFLOWS } from './data/n8n-workflows.js';
import { deleteWatch } from './sources/changedetection.js';

const PORT = 39871;
const base = `http://127.0.0.1:${PORT}`;
const json = (path: string, init?: RequestInit) => fetch(base + path, init).then(async r => ({ status: r.status, body: await r.json().catch(() => null) as any }));
const send = (path: string, method: string, body?: unknown) => json(path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

beforeAll(async () => {
  db.getDb().exec('DELETE FROM config; DELETE FROM price_records; DELETE FROM tracked_components;');
  db.setConfig('ntfy_server', 'https://ntfy.example.lan');
  db.setConfig('ntfy_topic', 'pcpc');
  db.setConfig('ntfy_token', 'tk_SECRET_TOKEN');
  db.setConfig('webhook_secret', 'WEBHOOK_SECRET');
  startWebServer(PORT);
  await new Promise(r => setTimeout(r, 400));
});
afterAll(() => vi.unstubAllGlobals());

describe('dashboard API: integrations', () => {
  it('reports status and never returns a secret value', async () => {
    const r = await json('/api/integrations');
    expect(r.status).toBe(200);
    expect(r.body.ntfy).toMatchObject({ configured: true, topic: 'pcpc', tokenSet: true });
    expect(r.body.webhook).toMatchObject({ secretSet: true });
    expect(JSON.stringify(r.body)).not.toContain('tk_SECRET_TOKEN');
    expect(JSON.stringify(r.body)).not.toContain('WEBHOOK_SECRET');
    expect(r.body.profiles.map((p: { id: string }) => p.id)).toContain('n5-air-ram');
    expect(r.body.n8n.map((w: { id: string }) => w.id)).toEqual(N8N_WORKFLOWS.map(w => w.id));
  });
  it('serves n8n workflows filled with the app address and ntfy topic, and 404s an unknown one', async () => {
    const ok = await json('/api/n8n/workflows/health-digest');
    expect(ok.status).toBe(200);
    const urls = ok.body.nodes.map((n: { parameters: { url?: string } }) => n.parameters.url).filter(Boolean);
    expect(urls).toContain(`${base}/api/health`);
    expect(urls).toContain('https://ntfy.example.lan/pcpc');
    expect((await json('/api/n8n/workflows/nope')).status).toBe(404);
    expect(buildN8nWorkflow('webhook-to-ntfy', base, 'x')?.nodes).toHaveLength(3);
  });
  it('changedetection routes refuse politely when it is not configured', async () => {
    expect((await json('/api/changedetection/watches')).status).toBe(400);
    expect((await send('/api/changedetection/watches', 'POST', { url: 'https://a.test/p' })).status).toBe(400);
  });
});

describe('dashboard API: components', () => {
  it('profile can be set, cleared and is validated; offers use the alert rules', async () => {
    const c = db.addTrackedComponent('64GB kit', 'ram', 'ddr5 so-dimm 64gb', 350);
    expect((await send(`/api/components/${c.id}/profile`, 'PATCH', { profile_id: 'nope' })).status).toBe(400);
    expect((await send(`/api/components/${c.id}/profile`, 'PATCH', { profile_id: 'n5-air-ram' })).status).toBe(200);
    expect(db.getTrackedComponentById(c.id)?.profile_id).toBe('n5-air-ram');
    db.savePriceSnapshots(c.id, [{ source: 'ebay', price: 492, currency: 'GBP', retailer: 'eBay UK', url: 'https://www.ebay.co.uk/itm/1', inStock: true,
      stockState: 'in_stock', listingName: 'Fanxiang 64GB (2x32GB) DDR5 5600MHz SO-DIMM', kitTotalGb: 64, modules: 2, profileMatch: true, deliveryCost: 5 }]);
    const o = await json(`/api/components/${c.id}/offers`);
    expect(o.body.offers[0]).toMatchObject({ price: 492, total_price: 497 });
    expect(o.body.offers[0].line).toContain('+£5.00 delivery');
    expect((await send(`/api/components/${c.id}/profile`, 'PATCH', { profile_id: null })).status).toBe(200);
    expect(db.getTrackedComponentById(c.id)?.profile_id).toBeNull();
    expect((await json('/api/components/99999/offers')).status).toBe(404);
  });
  it('per-component refresh goes through the scheduler path and records scrape runs (no PricesAPI key needed)', async () => {
    const c = db.addTrackedComponent('x', 'ram', 'ddr5 so-dimm 64gb', null as unknown as number);
    db.addComponentUrl(c.id, 'https://127.0.0.1:1/nothing', null, null);   // unreachable: the attempt must be recorded, not swallowed
    const r = await send(`/api/components/${c.id}/refresh`, 'POST', {});
    expect(r.status).toBe(200);
    expect(r.body.runs.some((x: { source: string }) => x.source.startsWith('url:'))).toBe(true);
    expect((await send('/api/components/99999/refresh', 'POST', {})).status).toBe(404);
  });
});

describe('changedetection watch deletion guard', () => {
  it('refuses to delete a watch this app did not create', async () => {
    process.env.CHANGEDETECTION_URL = 'http://cd.test'; process.env.CHANGEDETECTION_API_KEY = 'k';
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
      calls.push(`${init.method ?? 'GET'} ${url}`);
      return { ok: true, status: 200, text: async () => JSON.stringify({ title: 'Braintree Waste Calendar' }) };
    }));
    await expect(deleteWatch('u1')).rejects.toThrow(/did not create/);
    expect(calls.some(c => c.startsWith('DELETE'))).toBe(false);
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit = {}) => {
      calls.push(`${init.method ?? 'GET'} x`);
      return { ok: true, status: 200, text: async () => JSON.stringify({ title: 'PCPC: novatech "x"' }) };
    }));
    await deleteWatch('u2');
    expect(calls).toContain('DELETE x');
    delete process.env.CHANGEDETECTION_URL; delete process.env.CHANGEDETECTION_API_KEY;
  });
});
