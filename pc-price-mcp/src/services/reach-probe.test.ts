import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as db from '../db.js';
import { probeTarget, runProbe, loadProbe, probeRunning, verdictFor, PROBE_TARGETS, type ProbeDeps, type ProbeTarget } from './reach-probe.js';
import { HONEST_UA } from './scrape-policy.js';

const T: ProbeTarget = { id: 'shop', name: 'Shop', origin: 'https://shop.test', page: 'https://shop.test/product/kit' };
const CHALLENGE = '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>Checking your browser <script src="/cdn-cgi/challenge-platform/x"></script></body></html>';

/** A fake network keyed by exact address; anything not listed is a 404. Records every request with its headers. */
function net(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: Array<{ url: string; ua: string }> = [];
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, ua: String((init?.headers as Record<string, string>)?.['User-Agent']) });
    const r = routes[url];
    return r ? r() : new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}
const deps = (fetchFn: typeof fetch, extra: Partial<ProbeDeps> = {}): ProbeDeps =>
  ({ fetchFn, sleep: vi.fn().mockResolvedValue(undefined), now: () => new Date('2026-10-08T21:00:00Z'), targets: [T], ...extra });

beforeEach(() => db.getDb().exec('DELETE FROM config;'));

describe('probeTarget', () => {
  it('a shop that answers: robots, the sitemap robots.txt names, then the page; verdict open', async () => {
    const { fetchFn, calls } = net({
      'https://shop.test/robots.txt': () => new Response('User-agent: *\nDisallow: /search\nSitemap: https://shop.test/sm.xml\n'),
      'https://shop.test/sm.xml': () => new Response('<?xml version="1.0"?><urlset></urlset>'),
      'https://shop.test/product/kit': () => new Response('<html>ok</html>'),
    });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const r = await probeTarget(T, deps(fetchFn, { sleep }));
    expect(r.verdict).toBe('open');
    expect(r.steps.map(s => [s.step, s.status])).toEqual([['robots', 200], ['sitemap', 200], ['page', 200]]);
    expect(calls.map(c => c.url)).toEqual(['https://shop.test/robots.txt', 'https://shop.test/sm.xml', 'https://shop.test/product/kit']);
    expect(sleep).toHaveBeenCalledTimes(2);                       // a gap before the 2nd and the 3rd request
  });

  it('a 403 on everything is a refusal, recorded as such, with no retry and no change of identity', async () => {
    const { fetchFn, calls } = net({
      'https://shop.test/robots.txt': () => new Response('Forbidden', { status: 403 }),
      'https://shop.test/product/kit': () => new Response('Forbidden', { status: 403 }),
    });
    const r = await probeTarget({ ...T, sitemap: 'https://shop.test/sm.xml' }, deps(fetchFn));
    expect(r.verdict).toBe('refused');
    expect(r.advice).toMatch(/do not work around/i);
    expect(calls).toHaveLength(3);                                 // robots, sitemap, page: once each
    expect(new Set(calls.map(c => c.ua))).toEqual(new Set([HONEST_UA]));
  });

  it('a Cloudflare challenge served with HTTP 200 is a refusal, not success', async () => {
    const { fetchFn } = net({
      'https://shop.test/robots.txt': () => new Response('User-agent: *\n'),
      'https://shop.test/product/kit': () => new Response(CHALLENGE, { status: 200 }),
    });
    const r = await probeTarget(T, deps(fetchFn));
    expect(r.steps.find(s => s.step === 'page')).toMatchObject({ status: 200, ok: false, refused: true });
    expect(r.verdict).toBe('refused');
  });

  it('a page its robots.txt disallows is never requested', async () => {
    const { fetchFn, calls } = net({ 'https://shop.test/robots.txt': () => new Response('User-agent: *\nDisallow: /product/\n') });
    const r = await probeTarget(T, deps(fetchFn));
    expect(r.verdict).toBe('disallowed');
    expect(calls.some(c => c.url.includes('/product/'))).toBe(false);
    expect(r.steps.find(s => s.step === 'page')?.skipped).toMatch(/disallowed by robots\.txt \(\/product\/\)/);
  });

  it('robots.txt answering a server error means the page is not fetched; no answer at all is unreachable', async () => {
    const down = await probeTarget(T, deps(net({ 'https://shop.test/robots.txt': () => new Response('', { status: 503 }) }).fetchFn));
    expect(down.verdict).toBe('partial');
    expect(down.steps.find(s => s.step === 'page')?.skipped).toMatch(/could not be read/);
    const dead = await probeTarget(T, deps(vi.fn(async () => { throw new Error('getaddrinfo ENOTFOUND shop.test'); }) as unknown as typeof fetch));
    expect(dead.verdict).toBe('unreachable');
    expect(dead.steps[0].error).toMatch(/ENOTFOUND/);
  });

  it('reads at most 4 KB of a sitemap and 16 KB of a page, however large', async () => {
    const big = 'x'.repeat(2_000_000);
    const { fetchFn } = net({
      'https://shop.test/robots.txt': () => new Response('User-agent: *\nSitemap: https://shop.test/sm.xml\n'),
      'https://shop.test/sm.xml': () => new Response(big),
      'https://shop.test/product/kit': () => new Response(big),
    });
    const r = await probeTarget(T, deps(fetchFn));
    expect(r.steps.find(s => s.step === 'sitemap')!.bytes).toBeLessThanOrEqual(4096);
    expect(r.steps.find(s => s.step === 'page')!.bytes).toBeLessThanOrEqual(16384);
  });

  it('a 404 page with a working robots.txt is partial, not open', async () => {
    const r = await probeTarget(T, deps(net({ 'https://shop.test/robots.txt': () => new Response('User-agent: *\n') }).fetchFn));
    expect(r.verdict).toBe('partial');
  });

  it('verdictFor needs a page step', () => {
    expect(() => verdictFor([])).toThrow();
  });
});

describe('runProbe', () => {
  it('saves a result with the identity used, keeps it after the run, and uses the configured contact identity', async () => {
    db.setConfig('scraper_user_agent', 'PCPriceChecker (contact: owner@example.test)');
    const { fetchFn, calls } = net({ 'https://shop.test/robots.txt': () => new Response('User-agent: *\n'), 'https://shop.test/product/kit': () => new Response('ok') });
    expect(await runProbe(deps(fetchFn))).toBe(true);
    const saved = loadProbe()!;
    expect(saved.finishedAt).toBe('2026-10-08T21:00:00.000Z');
    expect(saved.userAgent).toBe('PCPriceChecker (contact: owner@example.test)');
    expect(saved.results.map(r => [r.id, r.verdict])).toEqual([['shop', 'open']]);
    expect(calls.every(c => c.ua === 'PCPriceChecker (contact: owner@example.test)')).toBe(true);
    expect(probeRunning()).toBe(false);
  });

  it('refuses a second run while one is going, and stores nothing but statuses (no page content)', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const { fetchFn } = net({ 'https://shop.test/robots.txt': async () => { await gate; return new Response('User-agent: *\n'); }, 'https://shop.test/product/kit': () => new Response('SECRET-PAGE-BODY-CONTENT') });
    const first = runProbe(deps(fetchFn));
    await new Promise(r => setTimeout(r, 10));
    expect(probeRunning()).toBe(true);
    expect(await runProbe(deps(fetchFn))).toBe(false);
    release(); await first;
    expect(JSON.stringify(loadProbe())).not.toContain('SECRET-PAGE-BODY-CONTENT');
  });

  it('the real target list names every shop that matters, one request set each, and no duplicates', () => {
    const ids = PROBE_TARGETS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ['scan', 'overclockers', 'ccl', 'box', 'laptopoutlet', 'currys', 'awdit', 'wired2fire', 'insidetech', 'buykingston', 'hotukdeals']) expect(ids).toContain(id);
    for (const t of PROBE_TARGETS) expect(t.page.startsWith(t.origin)).toBe(true);
  });
});
