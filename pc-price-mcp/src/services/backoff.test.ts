import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as db from '../db.js';
import { refreshComponent, type RefreshDeps } from './refresh.js';
import { inBackoff, sourceStatus, backsOff, BLOCKED_AFTER } from './scrape-health.js';
import type { RetailerSearchResult } from '../sources/uk-retailers.js';

const ctx = { country: 'gb', dropThresholdPct: 5, retailers: ['scan' as const, 'awdit' as const] };
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().slice(0, 19).replace('T', ' ');
function seedRuns(source: string, failures: number, msAgo: number) {
  const ins = db.getDb().prepare('INSERT INTO scrape_runs (component_id, source, started_at, ok, error, offers_found) VALUES (NULL, ?, ?, 0, ?, 0)');
  for (let i = 0; i < failures; i++) ins.run(source, iso(msAgo), 'HTTP 403');
}
const page = (r: string): RetailerSearchResult => ({ retailer: r, results: [], scrapedAt: '', durationMs: 1, error: 'HTTP 403' });

function deps(over: Partial<RefreshDeps> = {}) {
  const sleep = vi.fn().mockResolvedValue(undefined);
  const searchRetailer = vi.fn(async (id: string) => page(id));
  const d: RefreshDeps = { scrapeUrl: vi.fn(), searchRetailer, searchPricesApi: vi.fn().mockResolvedValue([]), pricesApiConfigured: () => false,
    notify: vi.fn().mockResolvedValue({}), sleep, ...over };
  return { d, sleep, searchRetailer };
}
beforeEach(() => db.getDb().exec('DELETE FROM scrape_runs; DELETE FROM price_records; DELETE FROM config; DELETE FROM tracked_components;'));

describe('back-off for sources that keep failing', () => {
  it('search, product-page and PricesAPI sources back off; eBay and watches never do', () => {
    expect(backsOff('search:scan')).toBe(true);
    expect(backsOff('pricesapi')).toBe(true);
    expect(backsOff('url:shop.co.uk')).toBe(true);
    for (const s of ['ebay', 'changedetection:x', 'search']) expect(backsOff(s)).toBe(false);
  });
  it('a product-page source backs off after 3 refusals, not 10, and is probed once a day (seen live: box.co.uk answered 403 four times an hour)', () => {
    seedRuns('url:box.co.uk', 3, 60_000);
    expect(inBackoff('url:box.co.uk')).toBe(true);
    seedRuns('url:ok-shop.co.uk', 2, 60_000);
    expect(inBackoff('url:ok-shop.co.uk')).toBe(false);                       // two failures: still tried
    expect(inBackoff('url:box.co.uk', Date.now() + 25 * 3_600_000)).toBe(false);   // a day later: one probe
    seedRuns('search:scan', 3, 60_000);
    expect(inBackoff('search:scan')).toBe(false);                             // searches still wait for 10
    expect(sourceStatus({ source: 'url:box.co.uk', last_run_at: iso(60_000), consecutive_failures: 3 }, [])).toBe('blocked');
  });
  it('after 10 failures in a row the source is skipped, with no run recorded and no politeness sleep', async () => {
    const c = db.addTrackedComponent('64GB kit', 'ram', 'ddr5 so-dimm 64gb', 350);
    seedRuns('search:scan', BLOCKED_AFTER, 60_000);
    const { d, sleep, searchRetailer } = deps();
    const before = db.getRecentScrapeRuns(500).length;
    await refreshComponent(c, ctx, d);
    expect(searchRetailer.mock.calls.map(x => x[0])).toEqual(['awdit']);          // scan skipped, awdit still searched
    expect(db.getRecentScrapeRuns(500).filter(r => r.source === 'search:scan')).toHaveLength(before);
    expect(sleep).toHaveBeenCalledTimes(1);                                         // only after awdit
    expect(inBackoff('search:scan')).toBe(true);
  });
  it('is probed again once a day, and fewer than 10 failures never back off', async () => {
    const c = db.addTrackedComponent('64GB kit', 'ram', 'ddr5 so-dimm 64gb', 350);
    seedRuns('search:scan', BLOCKED_AFTER, 25 * 3_600_000);
    const a = deps(); await refreshComponent(c, ctx, a.d);
    expect(a.searchRetailer.mock.calls.map(x => x[0])).toContain('scan');
    db.getDb().exec('DELETE FROM scrape_runs');
    seedRuns('search:scan', BLOCKED_AFTER - 1, 60_000);
    expect(inBackoff('search:scan')).toBe(false);
  });
  it('a success resets it', () => {
    seedRuns('search:scan', BLOCKED_AFTER, 60_000);
    db.recordScrapeRun({ componentId: null, source: 'search:scan', ok: true, offersFound: 3 });
    expect(inBackoff('search:scan')).toBe(false);
  });
});

describe('source status', () => {
  const h = (source: string, failures: number, msAgo: number) => ({ source, consecutive_failures: failures, last_run_at: iso(msAgo) });
  it('classifies ok, failing, blocked, idle and disabled', () => {
    const on = ['scan', 'awdit'];
    expect(sourceStatus(h('search:awdit', 0, 60_000), on)).toBe('ok');
    expect(sourceStatus(h('search:scan', 4, 60_000), on)).toBe('failing');
    expect(sourceStatus(h('search:scan', 77, 60_000), on)).toBe('blocked');
    expect(sourceStatus(h('search:scan', 77, 3 * 86_400_000), on)).toBe('idle');
    expect(sourceStatus(h('search:aria', 10, 8 * 3_600_000), on)).toBe('disabled');
    expect(sourceStatus(h('ebay', 1, 8 * 3_600_000), on)).toBe('idle');
    expect(sourceStatus(h('pricesapi', 77, 60_000), on)).toBe('blocked');
  });
});
