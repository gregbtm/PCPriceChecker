import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as db from '../db.js';
import { refreshComponent, type RefreshDeps } from './refresh.js';
import { pricesApiPause, pausePricesApi, pricesApiDue, markPricesApiRun, minIntervalMs } from './pricesapi-guard.js';
import { PricesApiError } from '../sources/pricesapi.js';
import { sourceStatus } from './scrape-health.js';

const quota = (resetsAt: string | null = null) => new PricesApiError('credits used up', 'quota', 403, 'CREDITS_EXCEEDED', { creditsUsed: 10000, creditsIncluded: 3000, resetsAt });
const ctx = { country: 'gb', dropThresholdPct: 5, retailers: [] as never[] };

function deps(search: () => Promise<db.PriceSnapshot[]>) {
  const searchPricesApi = vi.fn(search);
  const notify = vi.fn().mockResolvedValue({});
  const d: RefreshDeps = { scrapeUrl: vi.fn(), searchRetailer: vi.fn(), searchPricesApi, pricesApiConfigured: () => true, notify, sleep: async () => {} };
  return { d, searchPricesApi, notify };
}
beforeEach(() => { db.getDb().exec('DELETE FROM scrape_runs; DELETE FROM config; DELETE FROM tracked_components;'); process.env.PRICES_API_KEY = 'pricesapi_key_one'; });
afterEach(() => { delete process.env.PRICES_API_KEY; });

describe('PricesAPI credit guard', () => {
  it('exhausted credits pause the tier after ONE failure, notify once, and later passes make no call', async () => {
    const c = db.addTrackedComponent('64GB', 'ram', 'ddr5 so-dimm 64gb', 350);
    const { d, searchPricesApi, notify } = deps(async () => { throw quota(); });
    await refreshComponent(c, ctx, d);
    expect(searchPricesApi).toHaveBeenCalledTimes(1);
    expect(db.getRecentScrapeRuns(5).find(r => r.source === 'pricesapi')).toMatchObject({ ok: 0, error: expect.stringContaining('credits used up') });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'scrape_failure', componentName: 'PricesAPI' }));
    expect(pricesApiPause()).not.toBeNull();
    db.setConfig('pricesapi_min_interval_hours', '0');              // even with no minimum interval
    await refreshComponent(c, ctx, d); await refreshComponent(c, ctx, d);
    expect(searchPricesApi).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });
  it('the pause lifts when the key is replaced, or when resets_at passes', () => {
    pausePricesApi(quota());
    expect(pricesApiPause()).not.toBeNull();
    process.env.PRICES_API_KEY = 'pricesapi_key_two';
    expect(pricesApiPause()).toBeNull();
    pausePricesApi(quota('2026-11-01T00:00:00Z'));
    expect(pricesApiPause(Date.parse('2026-10-31T00:00:00Z'))).not.toBeNull();
    expect(pricesApiPause(Date.parse('2026-11-01T00:00:01Z'))).toBeNull();
  });
  it('searches at most once per component per interval (default 24h) and 0 means every pass', async () => {
    const c = db.addTrackedComponent('64GB', 'ram', 'ddr5 so-dimm 64gb', 350);
    const { d, searchPricesApi } = deps(async () => []);
    await refreshComponent(c, ctx, d); await refreshComponent(c, ctx, d);
    expect(searchPricesApi).toHaveBeenCalledTimes(1);
    expect(minIntervalMs()).toBe(24 * 3_600_000);
    expect(pricesApiDue(c.id, Date.now() + 25 * 3_600_000)).toBe(true);
    db.setConfig('pricesapi_min_interval_hours', '0');
    await refreshComponent(c, ctx, d);
    expect(searchPricesApi).toHaveBeenCalledTimes(2);
    markPricesApiRun(c.id);
  });
  it('a non-quota failure (bad key, rate limit) does not pause', async () => {
    const c = db.addTrackedComponent('64GB', 'ram', 'ddr5 so-dimm 64gb', 350);
    const { d } = deps(async () => { throw new PricesApiError('bad key', 'auth', 401, 'INVALID_API_KEY'); });
    await refreshComponent(c, ctx, d);
    expect(pricesApiPause()).toBeNull();
  });
  it('health shows paused instead of failing or blocked', () => {
    const h = { source: 'pricesapi', consecutive_failures: 77, last_run_at: new Date().toISOString().slice(0, 19).replace('T', ' ') };
    expect(sourceStatus(h, [], Date.now(), ['pricesapi'])).toBe('paused');
    expect(sourceStatus(h, [], Date.now(), [])).toBe('blocked');
  });
});
