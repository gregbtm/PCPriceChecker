import { readFileSync } from 'fs';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseSitemapLocs, slugText, candidateUrls, searchViaSitemap, loadSitemapUrls, clearSitemapCache } from './sitemap-discovery.js';
import { clearRobotsCache } from '../services/robots.js';
import type { ScrapedProduct } from './url-scraper.js';

// Real AWD-IT sitemap addresses (captured 2026-10-07) and the real robots.txt that forbids its search page.
const SITEMAP = readFileSync(new URL('../test/fixtures/awdit-sitemap-excerpt.xml', import.meta.url), 'utf8');
const ROBOTS = readFileSync(new URL('../test/fixtures/robots/awdit.txt', import.meta.url), 'utf8');
const KINGSTON = 'https://www.awd-it.co.uk/kingston-fury-64gb-2x32gb-ddr5-5600mt-s-cl40-sodimm-memory-black.html';
const CRUCIAL = 'https://www.awd-it.co.uk/crucial-64gb-2x32gb-ddr5-5600mt-s-cl46-sodimm-memory-black.html';

beforeEach(() => { clearSitemapCache(); clearRobotsCache(); });

function fakeFetch(files: Record<string, string>) {
  return vi.fn(async (url: string) => {
    const body = files[url] ?? (url.endsWith('/robots.txt') ? ROBOTS : null);
    return body == null ? { ok: false, status: 404, headers: new Headers(), text: async () => '' } : { ok: true, status: 200, headers: new Headers(), text: async () => body };
  }) as unknown as typeof fetch;
}
const scraped = (price: number, name: string, inStock = true): ScrapedProduct =>
  ({ name, price, currency: 'GBP', inStock, stockState: inStock ? 'in_stock' : 'out_of_stock', url: '', method: 'json-ld' });

describe('sitemap parsing and candidate selection', () => {
  it('reads <loc> addresses and recognises a sitemap index', () => {
    expect(parseSitemapLocs(SITEMAP).locs.length).toBeGreaterThan(5);
    const idx = parseSitemapLocs('<sitemapindex><sitemap><loc>https://x.test/a.xml</loc></sitemap></sitemapindex>');
    expect(idx).toEqual({ locs: ['https://x.test/a.xml'], isIndex: true });
  });
  it('turns a slug into words', () => {
    expect(slugText(KINGSTON)).toBe('kingston fury 64gb 2x32gb ddr5 5600mt s cl40 sodimm memory black');
  });
  it('the 64GB profile picks the two DDR5 SO-DIMM kits and rejects DDR4 SO-DIMM, desktop DIMM, a single stick and a PC', () => {
    const urls = parseSitemapLocs(SITEMAP).locs;
    expect(candidateUrls(urls, { search_query: 'ddr5 so-dimm 64gb', profile_id: 'n5-air-ram' }).sort()).toEqual([CRUCIAL, KINGSTON].sort());
  });
  it('without a profile every query word must be in the slug', () => {
    const urls = parseSitemapLocs(SITEMAP).locs;
    expect(candidateUrls(urls, { search_query: 'ddr5 sodimm 64gb', profile_id: null }).sort()).toEqual([CRUCIAL, KINGSTON].sort());
    expect(candidateUrls(urls, { search_query: 'rtx 5090', profile_id: null })).toEqual([]);
  });
});

describe('Novatech-style addresses (name in the second-to-last segment)', () => {
  // The first is a real Novatech product address (supplied by the owner, 2026-10-06); the SO-DIMM one is built on the same pattern.
  const REAL = 'https://www.novatech.co.uk/products/klevv-cras-v-rgb-64gb-2x32gb-6000mhz-cl30-memory-ram-kit/kd5bgua80-60a300g.html';
  const SODIMM = 'https://www.novatech.co.uk/products/crucial-64gb-2x32gb-ddr5-5600mhz-sodimm-laptop-memory-kit/ct2k32g56c46s5.html';
  it('reads the descriptive segment as well as the manufacturer code', () => {
    expect(slugText(REAL)).toBe('klevv cras v rgb 64gb 2x32gb 6000mhz cl30 memory ram kit kd5bgua80 60a300g');
    expect(slugText('https://www.novatech.co.uk/products/memory/laptop-memory.html')).toBe('memory laptop memory');
  });
  it('a query matches the real KLEVV address; the SO-DIMM profile picks the SO-DIMM one and rejects the desktop kit', () => {
    expect(candidateUrls([REAL], { search_query: 'ddr5 64gb kit', profile_id: null })).toEqual([]);          // no "ddr5" in that slug
    expect(candidateUrls([REAL], { search_query: '64gb 2x32gb 6000mhz kit', profile_id: null })).toEqual([REAL]);
    expect(candidateUrls([REAL, SODIMM], { search_query: 'ddr5 so-dimm 64gb', profile_id: 'n5-air-ram' })).toEqual([SODIMM]);
  });
});

describe('searchViaSitemap', () => {
  const component = { search_query: 'ddr5 so-dimm 64gb', profile_id: 'n5-air-ram' };
  it('reads the sitemap, then only the candidate product pages, with a gap between them', async () => {
    const fetchFn = fakeFetch({ 'https://www.awd-it.co.uk/media/sitemap/sitemap.xml': SITEMAP });
    const scrapeUrl = vi.fn(async (u: string) => u === KINGSTON ? scraped(919.99, 'Kingston FURY 64GB (2x32GB) DDR5 SODIMM', false) : scraped(449, 'Crucial 64GB (2x32GB) DDR5-5600 SODIMM'));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const r = await searchViaSitemap('awdit', component, { fetchFn, scrapeUrl, sleep });
    expect(scrapeUrl.mock.calls.map(c => c[0]).sort()).toEqual([CRUCIAL, KINGSTON].sort());
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(r?.results.map(x => [x.price, x.stockState]).sort()).toEqual([[449, 'in_stock'], [919.99, 'out_of_stock']].sort());
    // none of the requests was the search page that robots.txt forbids
    expect((fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls.map(c => String(c[0])).some(u => u.includes('catalogsearch'))).toBe(false);
  });
  it('an empty catalogue match is healthy, not a failure', async () => {
    const fetchFn = fakeFetch({ 'https://www.awd-it.co.uk/media/sitemap/sitemap.xml': SITEMAP });
    const r = await searchViaSitemap('awdit', { search_query: 'ddr5 so-dimm 96gb', profile_id: null }, { fetchFn, scrapeUrl: vi.fn(), sleep: vi.fn() });
    expect(r).toMatchObject({ results: [], emptyIsOk: true });
    expect(r?.error).toBeUndefined();
  });
  it('reports a sitemap that cannot be fetched, and candidate pages that give no price', async () => {
    const down = await searchViaSitemap('awdit', component, { fetchFn: fakeFetch({}), scrapeUrl: vi.fn(), sleep: vi.fn() });
    expect(down?.error).toMatch(/sitemap: sitemap HTTP 404/);
    clearSitemapCache();
    const fetchFn = fakeFetch({ 'https://www.awd-it.co.uk/media/sitemap/sitemap.xml': SITEMAP });
    const none = await searchViaSitemap('awdit', component, { fetchFn, scrapeUrl: vi.fn(async () => ({ ...scraped(0, 'x'), price: null })), sleep: vi.fn() });
    expect(none?.error).toMatch(/none gave a price/);
  });
  it('ignores a non-GBP price and returns null for a retailer with no sitemap entry', async () => {
    const fetchFn = fakeFetch({ 'https://www.awd-it.co.uk/media/sitemap/sitemap.xml': SITEMAP });
    const usd = await searchViaSitemap('awdit', component, { fetchFn, scrapeUrl: vi.fn(async () => ({ ...scraped(500, 'x'), currency: 'USD' })), sleep: vi.fn() });
    expect(usd?.results).toEqual([]);
    expect(await searchViaSitemap('scan', component, { scrapeUrl: vi.fn(), sleep: vi.fn() })).toBeNull();
  });
  it('follows a sitemap index and caches the list for a day', async () => {
    const idx = '<sitemapindex><sitemap><loc>https://www.awd-it.co.uk/media/sitemap/a.xml</loc></sitemap></sitemapindex>';
    const fetchFn = fakeFetch({ 'https://www.awd-it.co.uk/media/sitemap/sitemap.xml': idx, 'https://www.awd-it.co.uk/media/sitemap/a.xml': SITEMAP });
    const a = await loadSitemapUrls('awdit', fetchFn);
    const before = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    const b = await loadSitemapUrls('awdit', fetchFn);
    expect(b).toBe(a);
    expect((fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before);
  });
});

describe('a block page is a failure, not an empty catalogue', () => {
  it('HTTP 200 HTML (a Cloudflare challenge) raises instead of parsing to zero addresses', async () => {
    const html = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>';
    const f = fakeFetch({ 'https://www.novatech.co.uk/sitemap-products.xml': html, 'https://www.novatech.co.uk/robots.txt': 'User-agent: *\nDisallow: /search.html\n' });
    await expect(loadSitemapUrls('novatech', f)).rejects.toThrow(/did not return XML/);
    const r = await searchViaSitemap('novatech', { search_query: 'ddr5 so-dimm 64gb', profile_id: 'n5-air-ram' }, { fetchFn: f, scrapeUrl: vi.fn(), sleep: vi.fn() });
    expect(r?.error).toMatch(/did not return XML/);
    expect(r?.emptyIsOk).toBeFalsy();
  });
});
