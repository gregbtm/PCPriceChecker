import { readFileSync } from 'fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { clearRobotsCache } from '../services/robots.js';
import { searchHukd, getHukdHotDeals, fetchHukdFeeds, matchesQuery, parseHukdFeed } from './hotukdeals.js';

const fx = (n: string) => readFileSync(new URL(`../test/fixtures/${n}`, import.meta.url), 'utf8');
const ROBOTS = fx('robots/hotukdeals.txt');      // real, captured 2026-10-08
const RAM_XML = fx('hotukdeals-rss-tag-ram.xml');           // real, trimmed
const COMPUTERS_XML = fx('hotukdeals-rss-tag-computers.xml');   // real, trimmed

/** A fake network: serves the real robots.txt and the real feeds, and records every address asked for. */
function net(overrides: Record<string, () => Response> = {}) {
  const seen: string[] = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input); seen.push(url);
    const o = Object.entries(overrides).find(([k]) => url.endsWith(k));
    if (o) return o[1]();
    if (url.endsWith('/robots.txt')) return new Response(ROBOTS, { status: 200 });
    if (url.endsWith('/rss/tag/ram')) return new Response(RAM_XML, { status: 200 });
    if (url.endsWith('/rss/tag/computers')) return new Response(COMPUTERS_XML, { status: 200 });
    if (url.endsWith('/rss/tag/electronics')) return new Response(COMPUTERS_XML, { status: 200 });   // a duplicate feed: tests dedupe
    if (url.endsWith('/rss/trending')) return new Response(COMPUTERS_XML, { status: 200 });
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchFn, seen };
}

beforeEach(() => clearRobotsCache());

describe('HotUKDeals reads only addresses its robots.txt allows', () => {
  it('searching never requests the disallowed /search address', async () => {
    const { fetchFn, seen } = net();
    const r = await searchHukd('ddr5', 20, fetchFn);
    expect(r.error).toBeUndefined();
    expect(seen.some(u => /\/search\b/.test(u))).toBe(false);
    expect(seen.filter(u => !u.endsWith('/robots.txt')).sort()).toEqual([
      'https://www.hotukdeals.com/rss/tag/computers', 'https://www.hotukdeals.com/rss/tag/electronics', 'https://www.hotukdeals.com/rss/tag/ram',
    ]);
  });

  it('the real robots.txt really does disallow the old search address (so the guard has something to catch)', async () => {
    const { fetchFn } = net();
    const { fetchHukdFeed } = await import('./hotukdeals.js');
    await expect(fetchHukdFeed('https://www.hotukdeals.com/search?q=ddr5&view=rss', fetchFn)).rejects.toThrow(/disallowed/);
  });
});

describe('searchHukd', () => {
  it('filters the feeds locally and dedupes items that appear in several feeds', async () => {
    const { fetchFn } = net();
    const r = await searchHukd('crucial', 20, fetchFn);
    expect(r.deals.length).toBeGreaterThan(0);
    expect(r.deals.every(d => /crucial/i.test(d.title + d.description))).toBe(true);
    const all = await fetchHukdFeeds(['ram', 'computers', 'electronics'], fetchFn);
    expect(new Set(all.deals.map(d => d.guid)).size).toBe(all.deals.length);   // computers and electronics served the same XML
  });

  it('says so when every feed fails, instead of reporting "no deals"', async () => {
    const { fetchFn } = net({ '/rss/tag/ram': () => new Response('', { status: 403 }), '/rss/tag/computers': () => new Response('', { status: 403 }), '/rss/tag/electronics': () => new Response('', { status: 403 }) });
    const r = await searchHukd('ddr5', 20, fetchFn);
    expect(r.error).toMatch(/HTTP 403/);
  });

  it('a challenge page that returns 200 is a failure, not an empty feed', async () => {
    const html = () => new Response('<html><title>Just a moment...</title></html>', { status: 200 });
    const { fetchFn } = net({ '/rss/tag/ram': html, '/rss/tag/computers': html, '/rss/tag/electronics': html });
    const r = await searchHukd('ddr5', 20, fetchFn);
    expect(r.error).toMatch(/not an RSS feed/);
  });

  it('keeps results from feeds that answered and notes the one that did not', async () => {
    const { fetchFn } = net({ '/rss/tag/electronics': () => new Response('', { status: 500 }) });
    const r = await searchHukd('crucial', 20, fetchFn);
    expect(r.error).toBeUndefined();
    expect(r.note).toMatch(/electronics: HTTP 500/);
    expect(r.deals.length).toBeGreaterThan(0);
  });
});

describe('getHukdHotDeals', () => {
  it('uses the live feeds, not the dead /deals/feed.rss address that answers HTTP 410', async () => {
    const { fetchFn, seen } = net();
    const c = await getHukdHotDeals('computing', 3, fetchFn);
    const a = await getHukdHotDeals('all', 3, fetchFn);
    expect(c.deals).toHaveLength(3);
    expect(a.deals.length).toBeGreaterThan(0);
    expect(seen.some(u => u.includes('/deals/feed.rss'))).toBe(false);
    expect(seen).toContain('https://www.hotukdeals.com/rss/tag/computers');
    expect(seen).toContain('https://www.hotukdeals.com/rss/trending');
  });
});

describe('matchesQuery and parsing', () => {
  it('requires every word', () => {
    expect(matchesQuery({ title: 'Crucial Pro DDR5 RAM 32GB Kit', description: '' }, 'crucial ddr5')).toBe(true);
    expect(matchesQuery({ title: 'Crucial Pro DDR5 RAM 32GB Kit', description: '' }, 'crucial ddr4')).toBe(false);
    expect(matchesQuery({ title: 'x', description: '' }, '  ')).toBe(false);
  });
  it('a feed item without pepper:merchant falls back to the title pattern', () => {
    const xml = '<rss><channel><item><title><![CDATA[Kingston 64GB DDR5 SODIMM kit £589 @ Scan]]></title><link>https://x/1</link><guid>https://x/1</guid><pubDate>Thu, 08 Oct 2026 10:00:00 +0100</pubDate></item></channel></rss>';
    const [d] = parseHukdFeed(xml);
    expect(d).toMatchObject({ merchant: 'Scan', price: 589, guid: 'https://x/1' });
  });
});
