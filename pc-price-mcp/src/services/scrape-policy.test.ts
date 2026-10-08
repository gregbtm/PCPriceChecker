import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as db from '../db.js';
import { bypassAllowed, scraperUserAgent, looksBlocked, HONEST_UA } from './scrape-policy.js';

const pw = vi.hoisted(() => ({ newPageWithProxy: vi.fn(async () => null), getBrowser: vi.fn(async () => null), randomUA: vi.fn(() => 'x') }));
vi.mock('../sources/playwright-scraper.js', () => pw);

import { scrapeProductUrl } from '../sources/url-scraper.js';
import { clearRobotsCache } from './robots.js';

beforeEach(() => { db.getDb().exec('DELETE FROM config;'); delete process.env.ALLOW_BOT_BYPASS; delete process.env.SCRAPER_USER_AGENT; clearRobotsCache(); pw.newPageWithProxy.mockClear(); });
afterEach(() => vi.unstubAllGlobals());

describe('scrape policy defaults', () => {
  it('bypass tooling is OFF unless the owner opts in, by config or env', () => {
    expect(bypassAllowed()).toBe(false);
    db.setConfig('allow_bot_bypass', 'yes');
    expect(bypassAllowed()).toBe(false);          // only the exact word "true" counts
    db.setConfig('allow_bot_bypass', 'true');
    expect(bypassAllowed()).toBe(true);
    db.getDb().exec('DELETE FROM config;');
    process.env.ALLOW_BOT_BYPASS = 'TRUE';
    expect(bypassAllowed()).toBe(true);
  });
  it('the identity names the project; the owner may add contact details', () => {
    expect(scraperUserAgent()).toBe(HONEST_UA);
    expect(HONEST_UA).toMatch(/PCPriceChecker/);
    expect(HONEST_UA).not.toMatch(/Mozilla|Chrome/);
    db.setConfig('scraper_user_agent', 'PCPriceChecker (greg@example.test)');
    expect(scraperUserAgent()).toBe('PCPriceChecker (greg@example.test)');
  });
  it('recognises a refusal or a challenge page, but not a normal page that merely mentions the words', () => {
    expect(looksBlocked(403, '')).toBe(true);
    expect(looksBlocked(429, '')).toBe(true);
    expect(looksBlocked(200, '<title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/h/b"></script>')).toBe(true);
    expect(looksBlocked(200, '<html><body>Product page <script type="application/ld+json">{}</script> captcha for reviews</body></html>')).toBe(false);
    expect(looksBlocked(200, '<html>fine</html>')).toBe(false);
  });
});

describe('the product-page chain treats a refusal as the answer', () => {
  const robots = 'User-agent: *\nDisallow:\n';
  const stubFetch = (status: number, body: string, seen: Array<Record<string, string>> = []) => vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/robots.txt')) return { ok: true, status: 200, headers: new Headers(), text: async () => robots };
    seen.push((init?.headers ?? {}) as Record<string, string>);
    return { ok: status >= 200 && status < 300, status, headers: new Headers(), text: async () => body };
  }));

  it('HTTP 403 is recorded as blocked and no browser is started', async () => {
    stubFetch(403, '<html>Access denied</html>');
    const r = await scrapeProductUrl('https://shop.example.test/p/1');
    expect(r.price).toBeNull();
    expect(r.failure).toMatch(/blocked by the site \(HTTP 403\)/);
    expect(pw.newPageWithProxy).not.toHaveBeenCalled();
  });
  it('a 200 challenge page is also blocked, not "no price found"', async () => {
    stubFetch(200, '<title>Just a moment...</title><div>cf-chl</div>');
    const r = await scrapeProductUrl('https://shop.example.test/p/2');
    expect(r.failure).toMatch(/challenge page/);
    expect(pw.newPageWithProxy).not.toHaveBeenCalled();
  });
  it('the request identifies the project, not a browser', async () => {
    const seen: Array<Record<string, string>> = [];
    stubFetch(200, '<html><script type="application/ld+json">{"@type":"Product","name":"x","offers":{"price":"10","priceCurrency":"GBP"}}</script></html>', seen);
    const r = await scrapeProductUrl('https://shop.example.test/p/3');
    expect(r.price).toBe(10);
    expect(seen[0]['User-Agent']).toBe(HONEST_UA);
  });
  it('only an explicit opt-in restores the old escalate-to-browser behaviour', async () => {
    db.setConfig('allow_bot_bypass', 'true');
    stubFetch(403, '<html>Access denied</html>');
    const r = await scrapeProductUrl('https://shop.example.test/p/4');
    expect(r.failure).toBeUndefined();
    expect(pw.newPageWithProxy).toHaveBeenCalled();
  });
});
