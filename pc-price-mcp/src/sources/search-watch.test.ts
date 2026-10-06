import { readFileSync } from 'fs';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as db from '../db.js';
import { searchViaWatch } from './search-watch.js';

const SNAP = readFileSync(new URL('../test/fixtures/novatech-search-snapshot.txt', import.meta.url), 'utf8');
const URL_ = 'https://www.novatech.co.uk/search.html?search=ddr5%20so-dimm%2064gb';
const NOW = 1_800_000_000_000;

/** Fake changedetection.io: one optional watch; records the calls made. */
function fake(watch: Record<string, unknown> | null) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace('http://cd.test/api/v1', '');
    calls.push(`${init.method ?? 'GET'} ${path}`);
    const json = (o: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
    if (path === '/watch' && (init.method ?? 'GET') === 'GET') return json(watch ? { w1: watch } : {});
    if (path === '/watch' && init.method === 'POST') return json({ uuid: 'new' });
    if (path.endsWith('/history/latest')) return { ok: true, status: 200, text: async () => SNAP };
    return json('OK');
  }));
  return calls;
}
beforeEach(() => {
  process.env.CHANGEDETECTION_URL = 'http://cd.test'; process.env.CHANGEDETECTION_API_KEY = 'k';
  db.getDb().exec('DELETE FROM config;');
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.CHANGEDETECTION_URL; delete process.env.CHANGEDETECTION_API_KEY; });

describe('searchViaWatch', () => {
  it('does not handle retailers other than Novatech', async () => {
    expect(await searchViaWatch('scan', 'x')).toBeNull();
  });
  it('creates a browser watch the first time, and reports that the snapshot is pending', async () => {
    const calls = fake(null);
    const r = await searchViaWatch('novatech', 'ddr5 so-dimm 64gb', NOW);
    expect(calls).toContain('POST /watch');
    expect(r?.results).toEqual([]);
    expect(r?.error).toMatch(/pending/);
  });
  it('does not create a watch when autocreate is off', async () => {
    db.setConfig('changedetection_autocreate', 'false');
    const calls = fake(null);
    const r = await searchViaWatch('novatech', 'ddr5 so-dimm 64gb', NOW);
    expect(calls).not.toContain('POST /watch');
    expect(r?.error).toMatch(/autocreate is off/);
  });
  it('reads a fresh snapshot into listings with stock states, using the search URL', async () => {
    fake({ url: URL_, last_checked: NOW / 1000 - 600, last_error: false });
    const r = await searchViaWatch('novatech', 'ddr5 so-dimm 64gb', NOW);
    expect(r?.error).toBeUndefined();
    expect(r?.results.map(x => [x.price, x.stockState])).toEqual([[839.99, 'backorder'], [999.98, 'in_stock'], [49.98, 'unknown']]);
    expect(r?.results.every(x => x.url === URL_)).toBe(true);
  });
  it('refuses a stale snapshot rather than presenting it as fresh', async () => {
    fake({ url: URL_, last_checked: NOW / 1000 - 3 * 86_400, last_error: false });
    const r = await searchViaWatch('novatech', 'ddr5 so-dimm 64gb', NOW);
    expect(r?.results).toEqual([]);
    expect(r?.error).toMatch(/older than 48h/);
  });
  it('reports a watch fetch error instead of reading old text', async () => {
    fake({ url: URL_, last_checked: NOW / 1000 - 60, last_error: 'Page.goto: net::ERR_HTTP2_PROTOCOL_ERROR' });
    const r = await searchViaWatch('novatech', 'ddr5 so-dimm 64gb', NOW);
    expect(r?.results).toEqual([]);
    expect(r?.error).toMatch(/could not fetch/);
  });
});
