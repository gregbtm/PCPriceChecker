import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { parseRestockSnapshot, readWatchForUrl, changedetectionConfigured, listWatches, createRestockWatch, priceLikeKeys, spike } from './changedetection.js';

function stub(handler: (url: string, init: RequestInit) => unknown) {
  const f = vi.fn(async (url: string, init: RequestInit) => {
    const r = handler(url, init);
    const text = typeof r === 'string' ? r : JSON.stringify(r);
    return { ok: true, status: 200, text: async () => text };
  });
  vi.stubGlobal('fetch', f);
  return f;
}
beforeEach(() => {
  process.env.CHANGEDETECTION_URL = 'http://cd.test:5000/';
  process.env.CHANGEDETECTION_API_KEY = 'secret-key';
});
afterEach(() => { vi.unstubAllGlobals(); delete process.env.CHANGEDETECTION_URL; delete process.env.CHANGEDETECTION_API_KEY; });

describe('changedetection.io client', () => {
  it('is off unless both URL and key are set', () => {
    expect(changedetectionConfigured()).toBe(true);
    delete process.env.CHANGEDETECTION_API_KEY;
    expect(changedetectionConfigured()).toBe(false);
  });
  it('sends x-api-key and lists the uuid-keyed object as an array', async () => {
    const f = stub(() => ({ 'u-1': { url: 'https://a.test/p', title: 'A' } }));
    const w = await listWatches();
    expect(w).toEqual([{ uuid: 'u-1', url: 'https://a.test/p', title: 'A' }]);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('http://cd.test:5000/api/v1/watch');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('secret-key');
  });
  it('creates a restock_diff watch, adding the browser fetcher only when asked', async () => {
    const f = stub(() => ({ uuid: 'new-1' }));
    expect(await createRestockWatch({ url: 'https://a.test/p', maxPrice: 350 })).toBe('new-1');
    const plain = JSON.parse(f.mock.calls[0][1].body as string);
    expect(plain.processor).toBe('restock_diff');
    expect(plain.processor_config_restock_diff).toMatchObject({ follow_price_changes: true, price_change_max: 350 });
    expect(plain.fetch_backend).toBeUndefined();
    await createRestockWatch({ url: 'https://a.test/p', browser: true });
    expect(JSON.parse(f.mock.calls[1][1].body as string).fetch_backend).toBe('html_webdriver');
  });
  it('surfaces HTTP errors without leaking the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, text: async () => 'Invalid access - API key invalid.' })));
    await expect(listWatches()).rejects.toThrow(/HTTP 403/);
    await expect(listWatches()).rejects.not.toThrow(/secret-key/);
  });
  it('priceLikeKeys picks only price/stock-looking fields', () => {
    expect(priceLikeKeys({ url: 'x', has_ldjson_price_data: true, restock: { price: 1 }, title: 't' }))
      .toEqual({ has_ldjson_price_data: true, restock: { price: 1 } });
  });
  it('spike reports history and a snapshot excerpt, and records per-watch errors', async () => {
    stub((url) => {
      if (url.endsWith('/history/latest')) return 'Price: £492.00 In stock';
      if (url.endsWith('/history')) return { '1700000000': '/x' };
      return { url: 'https://a.test/p', processor: 'restock_diff', has_ldjson_price_data: true };
    });
    const r = await spike('u-1') as { watches: Array<Record<string, unknown>> };
    expect(r.watches[0]).toMatchObject({ processor: 'restock_diff', history_count: 1, latest_snapshot: 'Price: £492.00 In stock' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, text: async () => 'nope' })));
    const bad = await spike('u-2') as { watches: Array<Record<string, unknown>> };
    expect(bad.watches[0].error).toMatch(/404/);
  });
});

describe('restock snapshot reading (format observed live 2026-10-06)', () => {
  it('parses the real snapshot text', () => {
    expect(parseRestockSnapshot('In Stock: False - Price: 919.99')).toEqual({ price: 919.99, inStock: false });
    expect(parseRestockSnapshot('In Stock: True - Price: 1,049.00')).toEqual({ price: 1049, inStock: true });
  });
  it('returns null for anything else, including a missing price', () => {
    expect(parseRestockSnapshot('')).toBeNull();
    expect(parseRestockSnapshot('In Stock: True')).toBeNull();
    expect(parseRestockSnapshot('Price: 10')).toBeNull();
  });
  it('finds the watch by URL ignoring case, fragment and trailing slash; null when absent', async () => {
    stub((url) => url.endsWith('/history/latest') ? 'In Stock: True - Price: 492.00'
      : { 'u-1': { url: 'https://A.test/p/#top', last_checked: 1700000000 } });
    expect(await readWatchForUrl('https://a.test/p')).toEqual({ price: 492, inStock: true, checkedAt: 1700000000 });
    expect(await readWatchForUrl('https://other.test/x')).toBeNull();
  });
});
