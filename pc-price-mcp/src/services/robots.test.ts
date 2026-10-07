import { readFileSync } from 'fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { parseRobots, disallowingRule, loadRobots, assertAllowedByRobots, clearRobotsCache, RobotsDisallowedError } from './robots.js';

// Real robots.txt files, captured 2026-10-07 (see the header line of each fixture).
const fx = (n: string) => parseRobots(readFileSync(new URL(`../test/fixtures/robots/${n}.txt`, import.meta.url), 'utf8'));
const blocked = (n: string, path: string) => disallowingRule(fx(n), path) != null;

describe('real robots.txt files', () => {
  it('Novatech: the search page and filter parameters are disallowed; product and category pages are not', () => {
    expect(blocked('novatech', '/search.html?search=ddr5%20so-dimm%2064gb')).toBe(true);
    expect(blocked('novatech', '/products/memory/laptop-memory.html?o=2')).toBe(true);       // sort/filter parameter
    expect(blocked('novatech', '/products/memory/laptop-memory.html?x=1&m=3')).toBe(true);
    expect(blocked('novatech', '/products/klevv-cras-v-rgb-64gb-2x32gb-6000mhz-cl30-memory-ram-kit/kd5bgua80-60a300g.html')).toBe(false);
    expect(blocked('novatech', '/products/memory/laptop-memory.html')).toBe(false);
  });
  it('AWD-IT: any query string is disallowed except ?p=; product pages are allowed', () => {
    expect(blocked('awdit', '/catalogsearch/result/?q=ddr5+sodimm+64gb')).toBe(true);
    expect(blocked('awdit', '/some-category.html?p=2')).toBe(false);
    expect(blocked('awdit', '/kingston-fury-64gb-2x32gb-ddr5-5600mt-s-cl40-sodimm-memory-black.html')).toBe(false);
  });
  it('Overclockers and CCL disallow /search; Box disallows /catalogsearch/ but not product pages', () => {
    expect(blocked('overclockers', '/search?q=ddr5')).toBe(true);
    expect(blocked('ccl', '/search?query=ddr5')).toBe(true);
    expect(blocked('box', '/catalogsearch/result/?q=ddr5')).toBe(true);
    expect(blocked('box', '/some-product.html')).toBe(false);
  });
  it('merges two User-agent: * groups (Box has two)', () => {
    expect(blocked('box', '/wysiwyg/box-app/header/2025/x.png')).toBe(true);   // second group
    expect(blocked('box', '/customer/account')).toBe(true);                    // first group
  });
});

describe('matching rules', () => {
  it('longest pattern wins, Allow beats Disallow on a tie, * and $ work', () => {
    const r = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a/b\nDisallow: /*.pdf$\nDisallow: /t\nAllow: /t');
    expect(disallowingRule(r, '/a/x')).toBe('/a');
    expect(disallowingRule(r, '/a/b/c')).toBeNull();
    expect(disallowingRule(r, '/doc.pdf')).toBe('/*.pdf$');
    expect(disallowingRule(r, '/doc.pdf?x=1')).toBeNull();
    expect(disallowingRule(r, '/t')).toBeNull();
  });
  it('an empty Disallow allows everything; a specific group beats *', () => {
    expect(disallowingRule(parseRobots('User-agent: *\nDisallow:'), '/anything')).toBeNull();
    expect(disallowingRule(parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: PCPriceChecker\nDisallow: /private'), '/ok')).toBeNull();
  });
});

describe('fetching robots.txt', () => {
  beforeEach(() => clearRobotsCache());
  const res = (status: number, body = '') => vi.fn(async () => ({ ok: status < 400, status, text: async () => body })) as unknown as typeof fetch;
  it('refuses a disallowed address without any request to it, and explains why', async () => {
    const f = res(200, 'User-agent: *\nDisallow: /search');
    await expect(assertAllowedByRobots('https://shop.test/search?q=x', f)).rejects.toThrow(/disallowed by shop.test\/robots.txt \(\/search\)/);
    await expect(assertAllowedByRobots('https://shop.test/product/1', f)).resolves.toBeUndefined();
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(1);   // robots.txt fetched once, then cached
  });
  it('a 4xx (for example a bot-challenge 403) means no rules; a 5xx or network error means do not fetch, and is retried soon', async () => {
    await expect(assertAllowedByRobots('https://a.test/search', res(403))).resolves.toBeUndefined();
    await expect(assertAllowedByRobots('https://b.test/x', res(503))).rejects.toBeInstanceOf(RobotsDisallowedError);
    const boom = vi.fn(async () => { throw new Error('ECONNRESET'); }) as unknown as typeof fetch;
    await expect(assertAllowedByRobots('https://c.test/x', boom)).rejects.toThrow(/could not be read/);
    const later = Date.now() + 11 * 60_000;
    expect((await loadRobots('https://b.test', res(200, 'User-agent: *\nDisallow:'), later)).status).toBe('ok');   // not cached for a day
  });
});
