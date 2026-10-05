import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as db from '../db.js';
import { refreshComponent, type RefreshDeps } from './refresh.js';
import { scheduledRefreshAll } from '../scheduler.js';
import type { RetailerId, RetailerResult, RetailerSearchResult } from '../sources/uk-retailers.js';
import { SCAN } from '../test/fixtures.js';

const QUERY = 'ddr5 so-dimm 64gb';
const ctx = (retailers: RetailerId[]) => ({ country: 'gb', dropThresholdPct: 5, retailers });

function res(name: string, price: number, stockState: RetailerResult['stockState'], retailer = 'x'): RetailerResult {
  return { retailer, name, price, currency: 'GBP', inStock: stockState === 'in_stock', stockState, url: `https://${retailer}/p` };
}
function page(retailer: string, results: RetailerResult[], error?: string): RetailerSearchResult {
  return { retailer, results, scrapedAt: '', durationMs: 1, error };
}

function makeDeps(byRetailer: Partial<Record<RetailerId, () => RetailerSearchResult | Promise<RetailerSearchResult>>>, over: Partial<RefreshDeps> = {}) {
  const notify = vi.fn().mockResolvedValue({});
  const searchPricesApi = vi.fn().mockResolvedValue([]);
  const deps: RefreshDeps = {
    scrapeUrl: vi.fn(),
    searchRetailer: async (id) => { const f = byRetailer[id]; if (!f) throw new Error(`no stub for ${id}`); return f(); },
    searchPricesApi, pricesApiConfigured: () => false, notify, sleep: async () => {}, ...over,
  };
  return { deps, notify, searchPricesApi };
}

function fresh(alertPrice: number | null = 350) {
  db.getDb().exec('DELETE FROM scrape_runs; DELETE FROM price_records; DELETE FROM config; DELETE FROM tracked_components;');
  return db.addTrackedComponent('64GB DDR5 SO-DIMM kit', 'ram', QUERY, alertPrice);
}

describe('P0-9: no paid keys', () => {
  it('tracks at least three UK retailers with PricesAPI unconfigured, keeping only matching listings', async () => {
    const c = fresh(null);
    const noise = [res(SCAN.single24_5200, 279.98, 'in_stock'), res(SCAN.ddr4Samsung, 20, 'in_stock')];
    const { deps, searchPricesApi } = makeDeps({
      scan: () => page('Scan.co.uk', [res(SCAN.kit5600Backorder, 933.49, 'backorder', 'scan'), res(SCAN.kit5200InStock, 893.99, 'in_stock', 'scan'), ...noise]),
      ebuyer: () => page('Ebuyer', [res('64GB (2x32GB) Kingston Fury Impact DDR5 SO-DIMM 5600MHz', 905, 'in_stock', 'ebuyer'), ...noise]),
      currys: () => page('Currys', [res('Corsair Vengeance 64GB DDR5 SODIMM kit', 899, 'in_stock', 'currys')]),
    });
    const out = await refreshComponent(c, ctx(['scan', 'ebuyer', 'currys']), deps);
    expect(searchPricesApi).not.toHaveBeenCalled();
    const retailers = new Set(db.getLatestPricePerRetailer(c.id).map(r => r.retailer));
    expect(retailers).toEqual(new Set(['Scan.co.uk', 'Ebuyer', 'Currys']));
    expect(out.snapshots).toBe(4);   // 2 Scan kits + 1 Ebuyer + 1 Currys; no DDR4, no 24GB singles
    expect(db.getRecentScrapeRuns(10).every(r => r.ok === 1)).toBe(true);
  });

  it('calls PricesAPI only when it is configured, and a failing PricesAPI is recorded, not swallowed', async () => {
    const c = fresh(null);
    const { deps } = makeDeps({ scan: () => page('Scan.co.uk', [res(SCAN.kit5200InStock, 893.99, 'in_stock', 'scan')]) }, {
      pricesApiConfigured: () => true,
      searchPricesApi: vi.fn().mockRejectedValue(new Error('PRICES_API_KEY invalid')),
    });
    await refreshComponent(c, ctx(['scan']), deps);
    const failed = db.getRecentScrapeRuns(10).find(r => r.source === 'pricesapi');
    expect(failed).toMatchObject({ ok: 0, error: 'PRICES_API_KEY invalid' });
    expect(db.getBestInStockOffer(c.id)?.price).toBe(893.99);   // other tiers still delivered
  });
});

describe('A-01/A-02 end to end through the refresh path', () => {
  it('a cheaper backorder/out-of-stock listing does not alert; the in-stock one is named', async () => {
    const c = fresh(350);
    const { deps, notify } = makeDeps({
      scan: () => page('Scan.co.uk', [res(SCAN.kit5600Backorder, 199.99, 'backorder', 'scan')]),
      ebuyer: () => page('Ebuyer', [res('64GB DDR5 SO-DIMM kit', 340, 'in_stock', 'ebuyer')]),
    });
    await refreshComponent(c, ctx(['scan', 'ebuyer']), deps);
    const alerts = notify.mock.calls.map(x => x[0]).filter(p => p.type === 'price_alert');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ retailer: 'Ebuyer', price: 340 });
  });

  it('no alert at all when the only listing under target is not in stock', async () => {
    const c = fresh(350);
    const { deps, notify } = makeDeps({ scan: () => page('Scan.co.uk', [res(SCAN.kit5600Backorder, 300, 'backorder', 'scan')]) });
    await refreshComponent(c, ctx(['scan']), deps);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('P0-8: failures are visible', () => {
  it('records a failed run per attempt and notifies once after 3 consecutive failures', async () => {
    const c = fresh(null);
    const { deps, notify } = makeDeps({
      scan: () => page('Scan.co.uk', [res(SCAN.kit5200InStock, 893.99, 'in_stock', 'scan')]),
      ebuyer: () => { throw new Error('HTTP 403'); },
    });
    for (let i = 0; i < 2; i++) await refreshComponent(c, ctx(['scan', 'ebuyer']), deps);
    expect(notify).not.toHaveBeenCalled();                        // below threshold
    expect(db.getConsecutiveFailures(c.id, 'search:ebuyer')).toBe(2);
    await refreshComponent(c, ctx(['scan', 'ebuyer']), deps);
    const fail = notify.mock.calls.map(x => x[0]).filter(p => p.type === 'scrape_failure');
    expect(fail).toHaveLength(1);
    expect(fail[0].message).toContain('search:ebuyer');
    expect(fail[0].message).toContain('HTTP 403');
    expect(fail[0].message).not.toContain('search:scan');         // healthy source not reported
    await refreshComponent(c, ctx(['scan', 'ebuyer']), deps);
    expect(notify.mock.calls.filter(x => x[0].type === 'scrape_failure')).toHaveLength(1);   // 24h cooldown
  });

  it('a page that parses nothing is a failure; a page with products but no matches is healthy', async () => {
    const c = fresh(null);
    const { deps } = makeDeps({
      scan: () => page('Scan.co.uk', [], 'No products parsed — Scan.co.uk may require JS rendering'),
      ebuyer: () => page('Ebuyer', [res(SCAN.ddr4Corsair, 20, 'in_stock', 'ebuyer')]),
    });
    await refreshComponent(c, ctx(['scan', 'ebuyer']), deps);
    const by = Object.fromEntries(db.getRecentScrapeRuns(10).map(r => [r.source, r]));
    expect(by['search:scan']).toMatchObject({ ok: 0 });
    expect(by['search:ebuyer']).toMatchObject({ ok: 1, offers_found: 0 });
    expect(db.getTrackedComponents()[0].last_scrape_failed).toBe(1);   // nothing usable overall
  });

  it('a success resets the consecutive-failure count', async () => {
    const c = fresh(null);
    let broken = true;
    const { deps } = makeDeps({ scan: () => { if (broken) throw new Error('boom'); return page('Scan.co.uk', [res(SCAN.kit5200InStock, 893.99, 'in_stock', 'scan')]); } });
    await refreshComponent(c, ctx(['scan']), deps);
    await refreshComponent(c, ctx(['scan']), deps);
    expect(db.getConsecutiveFailures(c.id, 'search:scan')).toBe(2);
    broken = false;
    await refreshComponent(c, ctx(['scan']), deps);
    expect(db.getConsecutiveFailures(c.id, 'search:scan')).toBe(0);
  });

  it('component URL scrapes are tracked per domain, and an unparsable page fails', async () => {
    const c = fresh(null);
    db.addComponentUrl?.(c.id, 'https://www.scan.co.uk/products/kit', 'scan.co.uk');
    const { deps } = makeDeps({}, { scrapeUrl: vi.fn().mockResolvedValue({ name: 'n', price: null, currency: 'GBP', inStock: false, url: '', method: 'failed' }) });
    await refreshComponent(c, ctx([]), deps);
    expect(db.getRecentScrapeRuns(5)[0]).toMatchObject({ source: 'url:scan.co.uk', ok: 0 });
  });

  it('getSourceHealth summarises per source, including never-succeeded ones', () => {
    fresh(null);
    db.recordScrapeRun({ componentId: null, source: 'a', ok: false, error: 'x' });
    db.recordScrapeRun({ componentId: null, source: 'a', ok: false, error: 'y' });
    db.recordScrapeRun({ componentId: null, source: 'b', ok: true, offersFound: 2 });
    const h = Object.fromEntries(db.getSourceHealth().map(x => [x.source, x]));
    expect(h.a).toMatchObject({ last_success_at: null, consecutive_failures: 2, last_error: 'y', failures_24h: 2 });
    expect(h.b).toMatchObject({ consecutive_failures: 0, failures_24h: 0 });
    expect(h.b.last_success_at).not.toBeNull();
  });
});

describe('scheduler never swallows a component error (A-10)', () => {
  it('records a "scheduler" failure and flags the component when refresh throws', async () => {
    const c = fresh(350);
    const { deps } = makeDeps({ scan: () => page('Scan.co.uk', [res('64GB DDR5 SO-DIMM kit', 300, 'in_stock', 'scan')]) },
      { notify: vi.fn().mockRejectedValue(new Error('ntfy down')) });
    // scheduledRefreshAll uses configured retailers; restrict to one for the test
    db.setConfig('scheduler_retailers', 'scan');
    await scheduledRefreshAll(deps);
    expect(db.getRecentScrapeRuns(10).find(r => r.source === 'scheduler')).toMatchObject({ ok: 0, error: 'ntfy down' });
    expect(db.getTrackedComponents().find(x => x.id === c.id)?.last_scrape_failed).toBe(1);
  });
});
