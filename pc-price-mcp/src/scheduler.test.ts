import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as db from './db.js';
import { triggerRefreshNow, getSchedulerStatus, startScheduler, stopScheduler } from './scheduler.js';
import type { RefreshDeps } from './services/refresh.js';
import { SCAN } from './test/fixtures.js';

function deps(over: Partial<RefreshDeps> = {}): RefreshDeps {
  return {
    scrapeUrl: vi.fn(),
    searchRetailer: async (id) => ({ retailer: id, scrapedAt: '', durationMs: 1,
      results: [{ retailer: id, name: SCAN.kit5200InStock, price: 893.99, currency: 'GBP', inStock: true, stockState: 'in_stock', url: 'https://x/p' }] }),
    searchPricesApi: vi.fn(), pricesApiConfigured: () => false,
    notify: vi.fn().mockResolvedValue({}), sleep: async () => {}, ...over,
  };
}

beforeEach(() => {
  db.getDb().exec('DELETE FROM scrape_runs; DELETE FROM price_records; DELETE FROM config; DELETE FROM tracked_components;');
  db.addTrackedComponent('64GB DDR5 SO-DIMM kit', 'ram', 'ddr5 so-dimm 64gb', 350);
  db.setConfig('scheduler_retailers', 'scan,ebuyer');
});

describe('manual and startup refresh', () => {
  it('triggerRefreshNow runs a pass immediately and records scrape_runs', async () => {
    const before = getSchedulerStatus().runCount;
    const { status, done } = triggerRefreshNow(deps());
    expect(status).toBe('started');
    await done;
    expect(getSchedulerStatus().runCount).toBe(before + 1);
    expect(db.getRecentScrapeRuns(10).map(r => r.source).sort()).toEqual(['search:ebuyer', 'search:scan']);
    expect(getSchedulerStatus().currentlyRunning).toBe(false);
  });

  it('a second trigger while one is running is refused and counted, not run in parallel', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const first = triggerRefreshNow(deps({ sleep: () => gate }));
    expect(first.status).toBe('started');
    const skippedBefore = getSchedulerStatus().skippedTicks;
    const second = triggerRefreshNow(deps());
    expect(second.status).toBe('busy');
    expect(getSchedulerStatus().skippedTicks).toBe(skippedBefore + 1);
    release();
    await first.done;
    expect(getSchedulerStatus().currentlyRunning).toBe(false);
  });

  it('the running flag is cleared even when the pass throws', async () => {
    const { done } = triggerRefreshNow(deps({ notify: vi.fn().mockRejectedValue(new Error('boom')) }));
    await done;
    expect(getSchedulerStatus().currentlyRunning).toBe(false);
  });
});

describe('startScheduler runSoon', () => {
  it('schedules a first pass about 30 s after start only when asked, and stopScheduler cancels it', () => {
    vi.useFakeTimers();
    try {
      db.setConfig('auto_refresh_interval_minutes', '60');
      const spy = vi.spyOn(globalThis, 'setTimeout');
      expect(startScheduler()).toBe(true);
      expect(spy.mock.calls.filter(c => c[1] === 30_000)).toHaveLength(0);   // not asked: none scheduled
      stopScheduler();
      expect(startScheduler({ runSoon: true })).toBe(true);
      expect(spy.mock.calls.filter(c => c[1] === 30_000)).toHaveLength(1);
      stopScheduler();
      expect(vi.getTimerCount()).toBe(0);                                      // both timers cancelled
    } finally { vi.useRealTimers(); vi.restoreAllMocks(); }
  });

  it('returns false and schedules nothing when no interval is configured', () => {
    expect(startScheduler({ runSoon: true })).toBe(false);
  });
});
