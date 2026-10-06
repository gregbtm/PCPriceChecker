import { readFileSync } from 'fs';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as db from '../db.js';
import { orderProviders, scrapeViaChain, firecrawlProvider, type Provider } from './providers.js';
import { firecrawlFetchHtml } from './firecrawl.js';

// Real AWD-IT product block (captured 2026-10-06): Kingston Fury 64GB kit, out of stock, £919.99.
const AWD = readFileSync(new URL('../test/fixtures/awd-it-kingston-fury-64gb.html', import.meta.url), 'utf8');
const URL_ = 'https://www.awd-it.co.uk/kingston-fury-64gb-2x32gb-ddr5-5600mt-s-cl40-sodimm-memory-black.html';

const fakeOffer = (price: number) => ({ name: 'x', price, currency: 'GBP', inStock: true, stockState: 'in_stock' as const, url: URL_, method: 'dom' as const });
const provider = (id: string, result: 'ok' | 'fail'): Provider & { calls: number } => {
  const p = { id, calls: 0, configured: () => true,
    async fetchOffer() { p.calls++; return result === 'ok' ? { ok: true as const, offer: fakeOffer(100) } : { ok: false as const, reason: `${id} failed` }; } };
  return p;
};

beforeEach(() => { db.getDb().exec('DELETE FROM config;'); delete process.env.FIRECRAWL_API_URL; });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.FIRECRAWL_API_URL; });

describe('P2-3 per-domain strategy memory', () => {
  it('uses the declared order until something is remembered, then tries the winner first', async () => {
    const a = provider('a', 'fail'), b = provider('b', 'ok');
    expect(orderProviders([a, b], 'x.co.uk').map(p => p.id)).toEqual(['a', 'b']);
    expect((await scrapeViaChain(URL_, [a, b])).price).toBe(100);
    expect(orderProviders([a, b], 'awd-it.co.uk').map(p => p.id)).toEqual(['b', 'a']);
    a.calls = 0; b.calls = 0;
    await scrapeViaChain(URL_, [a, b]);
    expect(a.calls).toBe(0);   // b won last time, so a was not even tried
  });
  it('demotes a provider after three failures in a row and stops trying it first', async () => {
    const a = provider('a', 'fail'), b = provider('b', 'fail');
    for (let i = 0; i < 3; i++) await scrapeViaChain(URL_, [a, b]);
    expect(orderProviders([a, b], 'awd-it.co.uk').map(p => p.id)).toEqual(['a', 'b']);   // both demoted equally: declared order
    const c = provider('c', 'ok');
    await scrapeViaChain(URL_, [a, b, c]);
    expect(orderProviders([a, b, c], 'awd-it.co.uk').map(p => p.id)[0]).toBe('c');
  });
  it('skips unconfigured providers and returns a failed product when nothing works', async () => {
    const off = { ...provider('off', 'ok'), configured: () => false };
    const bad = provider('bad', 'fail');
    const r = await scrapeViaChain(URL_, [off, bad]);
    expect(off.calls).toBe(0);
    expect(r).toMatchObject({ price: null, method: 'failed' });
  });
});

describe('P2-2 Firecrawl provider', () => {
  const stubFirecrawl = (body: unknown, status = 200) => {
    const f = vi.fn(async () => ({ ok: status < 400, status, text: async () => JSON.stringify(body) }));
    vi.stubGlobal('fetch', f); return f;
  };
  it('is off until a URL is configured', () => {
    expect(firecrawlProvider.configured()).toBe(false);
    db.setConfig('firecrawl_url', 'http://fc:3002/');
    expect(firecrawlProvider.configured()).toBe(true);
  });
  it('asks for rawHtml only and runs our extractors on it (here the real AWD-IT block)', async () => {
    db.setConfig('firecrawl_url', 'http://fc:3002/');
    const f = stubFirecrawl({ success: true, data: { rawHtml: AWD } });
    const r = await firecrawlProvider.fetchOffer(URL_);
    expect(r).toMatchObject({ ok: true, offer: { price: 919.99, method: 'firecrawl' } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://fc:3002/v2/scrape');
    expect(JSON.parse(init.body as string)).toEqual({ url: URL_, formats: ['rawHtml'] });
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
  it('sends a Bearer key only when one is set, and reports HTTP errors and empty pages as failures', async () => {
    db.setConfig('firecrawl_url', 'http://fc:3002'); db.setConfig('firecrawl_api_key', 'k1');
    const f = stubFirecrawl({ success: true, data: { rawHtml: '<html>nothing here</html>' } });
    expect(await firecrawlProvider.fetchOffer(URL_)).toMatchObject({ ok: false, reason: expect.stringMatching(/no price/) });
    expect(((f.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>).Authorization).toBe('Bearer k1');
    stubFirecrawl({ error: 'boom' }, 500);
    expect(await firecrawlFetchHtml(URL_)).toEqual({ error: expect.stringMatching(/HTTP 500/) });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('connect ECONNREFUSED'); }));
    expect(await firecrawlFetchHtml(URL_)).toEqual({ error: expect.stringMatching(/ECONNREFUSED/) });
  });
});
