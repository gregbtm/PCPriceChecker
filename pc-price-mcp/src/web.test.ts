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

describe('optional access token and secret masking', () => {
  const get = (path: string, headers: Record<string, string> = {}) => fetch(base + path, { headers }).then(async r => ({ status: r.status, body: await r.json().catch(() => null) as any, headers: r.headers }));
  it('with no token set nothing changes, but stored secrets are never returned in clear', async () => {
    db.setConfig('discord_webhook_url', 'https://discord.com/api/webhooks/123456/SECRETWEBHOOKTOKEN');
    db.setConfig('ntfy_topic', 'pcpc-topic');
    const r = await get('/api/config');
    expect(r.status).toBe(200);
    expect(r.body.discord_webhook_url).toBe('••••••••OKEN');
    expect(JSON.stringify(r.body)).not.toContain('SECRETWEBHOOKTOKEN');
    expect(r.body.ntfy_topic).toBe('pcpc-topic');                         // not a secret: shown
    expect((await get('/api/components')).status).toBe(200);
  });
  it('writing the masked stub back (what the Settings tabs do) leaves the real secret alone', async () => {
    const r = await send('/api/config', 'POST', { key: 'discord_webhook_url', value: '••••••••OKEN' });
    expect(r.body).toMatchObject({ ok: true, unchanged: true });
    expect(db.getConfig('discord_webhook_url')).toContain('SECRETWEBHOOKTOKEN');
  });
  it('with a token set: 401 without it, 200 with Bearer, X-API-Key or the cookie from login; /api/health stays open', async () => {
    db.setConfig('app_token', 'sekrit-token-123');
    try {
      expect((await get('/api/components')).status).toBe(401);
      expect((await get('/api/components')).body.error).toBe('unauthorised');
      expect((await get('/api/health')).status).toBe(200);
      expect((await get('/api/auth/status')).body).toEqual({ required: true, authorised: false });
      expect((await get('/api/components', { Authorization: 'Bearer wrong' })).status).toBe(401);
      expect((await get('/api/components', { Authorization: 'Bearer sekrit-token-123' })).status).toBe(200);
      expect((await get('/api/components', { 'X-API-Key': 'sekrit-token-123' })).status).toBe(200);
      expect((await send('/api/auth/login', 'POST', { token: 'nope' })).status).toBe(401);
      const login = await fetch(base + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'sekrit-token-123' }) });
      expect(login.status).toBe(200);
      const cookie = login.headers.get('set-cookie') ?? '';
      expect(cookie).toMatch(/pcpc_token=.*HttpOnly.*SameSite=Strict/);
      expect((await get('/api/components', { Cookie: cookie.split(';')[0] })).status).toBe(200);
      expect((await get('/api/auth/status', { Cookie: cookie.split(';')[0] })).body).toEqual({ required: true, authorised: true });
      // the token itself is masked like any other secret
      expect((await get('/api/config', { Authorization: 'Bearer sekrit-token-123' })).body.app_token).toBe('••••••••-123');
    } finally { db.deleteConfig('app_token'); }
    expect((await get('/api/components')).status).toBe(200);              // switching it off restores open access
  });
});

describe('settings: limits, pausing and the PricesAPI switch', () => {
  it('alert and options limits are editable per component, and clearing one stores no limit', async () => {
    const c = db.addTrackedComponent('64GB limits', 'ram', 'q', 350);
    expect((await send(`/api/components/${c.id}/alert`, 'PATCH', { alert_price: 600, consider_price: 800 })).status).toBe(200);
    expect(db.getTrackedComponentById(c.id)).toMatchObject({ alert_price: 600, consider_price: 800 });
    await send(`/api/components/${c.id}/alert`, 'PATCH', { consider_price: null });
    expect(db.getTrackedComponentById(c.id)).toMatchObject({ alert_price: 600, consider_price: null });
  });
  it('pause and resume round-trip', async () => {
    const c = db.addTrackedComponent('old one', 'ram', 'q', null as unknown as number);
    await send(`/api/components/${c.id}/pause`, 'POST', {});
    expect(db.getTrackedComponentById(c.id)?.paused).toBe(1);
    await send(`/api/components/${c.id}/resume`, 'POST', {});
    expect(db.getTrackedComponentById(c.id)?.paused).toBe(0);
  });
  it('switching PricesAPI off keeps the key, shows as paused in /api/health, and /api/integrations says so without leaking the key', async () => {
    db.setConfig('prices_api_key', 'SECRET-PRICES-KEY');
    process.env.PRICES_API_KEY = 'SECRET-PRICES-KEY';
    await send('/api/config', 'POST', { key: 'pricesapi_enabled', value: 'false' });
    const i = await json('/api/integrations');
    expect(i.body.prices).toMatchObject({ keySet: true, enabled: false });
    expect(JSON.stringify(i.body)).not.toContain('SECRET-PRICES-KEY');
    db.recordScrapeRun({ componentId: null, source: 'pricesapi', ok: true, offersFound: 1 });   // so the source is listed at all: the check below must not pass by absence
    const h = await json('/api/health');
    expect(h.body.scrapers.sources.find((s: { source: string }) => s.source === 'pricesapi')?.status).toBe('paused');
    // and with the switch on and no pause, the same source is NOT reported as paused (the check can fail)
    await send('/api/config', 'POST', { key: 'pricesapi_enabled', value: 'true' });
    expect((await json('/api/health')).body.scrapers.sources.find((s: { source: string }) => s.source === 'pricesapi')?.status).not.toBe('paused');
    await send('/api/config', 'POST', { key: 'pricesapi_enabled', value: 'false' });
    expect(db.getConfig('prices_api_key')).toBe('SECRET-PRICES-KEY');   // the key is still stored
    await send('/api/config', 'POST', { key: 'pricesapi_enabled', value: 'true' });
    expect((await json('/api/integrations')).body.prices.enabled).toBe(true);
    delete process.env.PRICES_API_KEY; db.deleteConfig('prices_api_key');
  });
});

describe('alert evidence ledger', () => {
  it('lists what was true when an alert was sent or held back, newest first, with the JSON parsed', async () => {
    db.recordEvidence({ componentId: null, kind: 'suppressed', retailer: 'eBay UK', url: 'https://www.ebay.co.uk/itm/1', price: 300, evidence: { reason: 'the listing is gone' } });
    db.recordEvidence({ componentId: null, kind: 'price_alert', retailer: 'eBay UK', url: 'https://www.ebay.co.uk/itm/2', price: 320, evidence: { title: 'Kit', verified: true } });
    const r = await json('/api/alerts/evidence?limit=2');
    expect(r.status).toBe(200);
    expect(r.body.map((e: { kind: string }) => e.kind)).toEqual(['price_alert', 'suppressed']);
    expect(r.body[0].evidence).toEqual({ title: 'Kit', verified: true });
  });
});

describe('known product pages', () => {
  it('lists the pages for the capacities the profile accepts, adds them once, and turns search_also on', async () => {
    const c = db.addTrackedComponent('64GB known pages', 'ram', 'ddr5 so-dimm 64gb', 350);
    expect((await json(`/api/components/${c.id}/known-pages`)).body.pages).toEqual([]);   // no profile: nothing to match against
    await send(`/api/components/${c.id}/profile`, 'PATCH', { profile_id: 'n5-air-ram' });
    const before = await json(`/api/components/${c.id}/known-pages`);
    expect(before.body.pages.length).toBeGreaterThanOrEqual(5);
    expect(before.body.pages.every((p: { added: boolean; kitGb: number }) => !p.added && [48, 64].includes(p.kitGb))).toBe(true);
    const add = await send(`/api/components/${c.id}/known-pages`, 'POST', {});
    expect(add.body.added.length).toBe(before.body.pages.length);
    expect(db.getComponentUrls(c.id)).toHaveLength(before.body.pages.length);
    expect(db.getTrackedComponentById(c.id)?.search_also).toBe(1);
    const again = await send(`/api/components/${c.id}/known-pages`, 'POST', {});
    expect(again.body.added).toEqual([]);
    expect(db.getComponentUrls(c.id)).toHaveLength(before.body.pages.length);   // idempotent
    expect((await json('/api/components/99999/known-pages')).status).toBe(404);
  });
  it('search_also can be switched and is validated', async () => {
    const c = db.addTrackedComponent('x2', 'ram', 'q', null as unknown as number);
    expect((await send(`/api/components/${c.id}/search-also`, 'PATCH', { search_also: 'yes' })).status).toBe(400);
    expect((await send(`/api/components/${c.id}/search-also`, 'PATCH', { search_also: true })).status).toBe(200);
    expect(db.getTrackedComponentById(c.id)?.search_also).toBe(1);
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
