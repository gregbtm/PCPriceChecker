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

describe('P1-3 / P1-5: hardware profile wiring (n5-air-ram)', () => {
  function profiled(alertPrice: number | null) {
    const c = fresh(alertPrice);
    db.setComponentProfile(c.id, 'n5-air-ram');
    return db.getTrackedComponents().find(x => x.id === c.id)!;
  }
  // Real Scan listings, 2026-10-05 prices and stock text (docs/RESEARCH_AND_VERIFICATION.md section 2).
  const scanPage = () => page('Scan.co.uk', [
    res(SCAN.kit5600Backorder, 933.49, 'backorder', 'scan'),
    res(SCAN.kit5200InStock, 893.99, 'in_stock', 'scan'),
    res(SCAN.single24_5200, 279.98, 'in_stock', 'scan'),
    res(SCAN.single24_4800, 320.48, 'in_stock', 'scan'),
    res(SCAN.single24_5600, 322.49, 'in_stock', 'scan'),
    res(SCAN.ddr4Samsung, 18, 'in_stock', 'scan'),
  ]);

  it('stores every parsed listing with its attributes, flags non-matches, and derives price per GB', async () => {
    const c = profiled(null);
    const { deps } = makeDeps({ scan: scanPage });
    await refreshComponent(c, ctx(['scan']), deps);
    const rows = db.getLatestPricePerRetailer(c.id);
    expect(rows).toHaveLength(6);
    const kit = rows.find(r => r.price === 893.99)!;
    expect(kit).toMatchObject({ profile_match: 1, kit_total_gb: 64, modules: 2, price_per_gb: 13.97, listing_name: SCAN.kit5200InStock });
    expect(rows.find(r => r.price === 279.98)).toMatchObject({ profile_match: 0, kit_total_gb: 24, modules: 1 });
    expect(rows.find(r => r.price === 18)).toMatchObject({ profile_match: 0 });
  });

  it('the cheaper in-stock 24GB single is NOT the best offer and never alerts a 64GB target', async () => {
    const c = profiled(300);   // 24GB singles at 279.98 are under target, but are not the thing being bought
    const { deps, notify } = makeDeps({ scan: scanPage });
    await refreshComponent(c, ctx(['scan']), deps);
    expect(db.getBestInStockOffer(c.id)).toMatchObject({ price: 893.99 });
    expect(notify).not.toHaveBeenCalled();
    expect(db.getComponentsBelowAlertPrice()).toEqual([]);
    expect(db.getPriceStats(c.id).current_best).toBe(893.99);
  });

  it('without a profile the old behaviour applies (interim query filter), so 24GB singles are not stored', async () => {
    const c = fresh(null);
    const { deps } = makeDeps({ scan: scanPage });
    await refreshComponent(c, ctx(['scan']), deps);
    expect(db.getLatestPricePerRetailer(c.id).map(r => r.price).sort()).toEqual([893.99, 933.49]);
  });

  it('alert text carries price per GB, and the non-binary warning for 2x24GB', async () => {
    const c = profiled(900);
    const { deps, notify } = makeDeps({ ebuyer: () => page('Ebuyer', [
      res('48GB (2x24GB) Kingston FURY Impact DDR5 5600MT/s SODIMM CL40', 600, 'in_stock', 'ebuyer'),
    ]) });
    await refreshComponent(c, ctx(['ebuyer']), deps);
    const alert = notify.mock.calls.map(x => x[0]).find(p => p.type === 'price_alert');
    expect(alert.price).toBe(600);
    expect(alert.message).toContain('£12.50/GB');
    expect(alert.message).toContain('not confirmed to work');
  });

  it('a non-matching listing coming back in stock does not trigger a restock notification', async () => {
    const c = profiled(null);
    db.addToWaitlist?.(c.id, null, null);
    let inStock = false;
    const { deps, notify } = makeDeps({ scan: () => page('Scan.co.uk', [
      res(SCAN.single24_5200, 279.98, inStock ? 'in_stock' : 'out_of_stock', 'scan'),
    ]) });
    await refreshComponent(c, ctx(['scan']), deps);
    inStock = true;
    await refreshComponent(c, ctx(['scan']), deps);
    expect(notify.mock.calls.filter(x => x[0].type === 'restock')).toHaveLength(0);
    expect(db.getRecentStockChanges(24)).toHaveLength(0);
  });

  it('unknown profile ids fall back to the no-profile path instead of crashing', async () => {
    const c = fresh(null);
    db.setComponentProfile(c.id, 'does-not-exist');
    const { deps } = makeDeps({ scan: scanPage });
    await expect(refreshComponent(db.getTrackedComponents()[0], ctx(['scan']), deps)).resolves.toBeDefined();
  });
});

describe('eBay tier (official Browse API; optional)', () => {
  const L = (over: Partial<import('../sources/ebay-browse.js').EbayListing>): import('../sources/ebay-browse.js').EbayListing => ({
    itemId: '1', title: SCAN.kit5200InStock, price: 340, currency: 'GBP', condition: 'New', conditionId: '1000',
    url: 'https://www.ebay.co.uk/itm/1', seller: 'shop', feedbackPct: 99.5, location: 'GB', freeShipping: false, buyItNow: true, ...over,
  });
  const ebayResult = (listings: ReturnType<typeof L>[], error?: string) =>
    ({ query: QUERY, condition: 'any' as const, listings, scrapedAt: '', durationMs: 1, error });
  function withEbay(listings: ReturnType<typeof L>[], error?: string) {
    const searchEbay = vi.fn().mockResolvedValue(ebayResult(listings, error));
    return { searchEbay, ...makeDeps({}, { searchEbay, ebayConfigured: () => true }) };
  }
  const profiled = (alertPrice: number | null) => {
    const c = fresh(alertPrice);
    db.setComponentProfile(c.id, 'n5-air-ram');
    return db.getTrackedComponents().find(x => x.id === c.id)!;
  };

  it('is skipped entirely when eBay is not configured', async () => {
    const c = profiled(null);
    const searchEbay = vi.fn();
    const { deps } = makeDeps({}, { searchEbay, ebayConfigured: () => false });
    await refreshComponent(c, ctx([]), deps);
    expect(searchEbay).not.toHaveBeenCalled();
    expect(db.getRecentScrapeRuns(5).find(r => r.source === 'ebay')).toBeUndefined();
  });

  it('keeps only purchasable fixed-price UK GBP listings: no auctions, no for-parts, no overseas, no USD', async () => {
    const c = profiled(null);
    const { deps } = withEbay([
      L({ itemId: 'ok', price: 340 }),
      L({ itemId: 'auction', price: 120, buyItNow: false }),
      L({ itemId: 'parts', price: 100, conditionId: '7000', condition: 'For parts or not working' }),
      L({ itemId: 'abroad', price: 200, location: 'CN' }),
      L({ itemId: 'usd', price: 150, currency: 'USD' }),
    ]);
    await refreshComponent(c, ctx([]), deps);
    const rows = db.getLatestPricePerRetailer(c.id);
    expect(rows.map(r => r.price)).toEqual([340]);
    expect(rows[0]).toMatchObject({ source: 'ebay', retailer: 'eBay UK', stock_state: 'in_stock', profile_match: 1 });
  });

  it('flags used condition, low seller feedback and excluded delivery; alert text says so', async () => {
    const c = profiled(350);
    const { deps, notify } = withEbay([L({ price: 300, conditionId: '3000', condition: 'Used', feedbackPct: 91 })]);
    await refreshComponent(c, ctx([]), deps);
    const alert = notify.mock.calls.map(x => x[0]).find(p => p.type === 'price_alert');
    expect(alert).toMatchObject({ price: 300, retailer: 'eBay UK' });
    expect(alert.message).toContain('used / refurbished');
    expect(alert.message).toContain('below 98%');
    expect(alert.message).toContain('excludes delivery');
  });

  it('a suspiciously cheap 64GB listing is flagged with a warning, not hidden', async () => {
    const c = profiled(350);
    const { deps, notify } = withEbay([L({ price: 90 })]);   // GBP 1.41/GB, under the GBP 2/GB floor
    await refreshComponent(c, ctx([]), deps);
    expect(db.getLatestPricePerRetailer(c.id)[0].profile_flags).toContain('suspiciously_cheap');
    const alert = notify.mock.calls.map(x => x[0]).find(p => p.type === 'price_alert');
    expect(alert.message).toContain('verify the seller');
  });

  it('wrong products on eBay (DDR4, 24GB single, accessories) are stored but never alert', async () => {
    const c = profiled(350);
    const { deps, notify } = withEbay([
      L({ itemId: 'a', title: SCAN.ddr4Samsung, price: 15 }),
      L({ itemId: 'b', title: SCAN.single24_5200, price: 140 }),
    ]);
    await refreshComponent(c, ctx([]), deps);
    expect(db.getBestInStockOffer(c.id)).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });

  it('an API error is a visible failed run, other tiers still deliver', async () => {
    const c = profiled(null);
    const { deps } = makeDeps({ scan: () => page('Scan.co.uk', [res(SCAN.kit5200InStock, 893.99, 'in_stock', 'scan')]) },
      { searchEbay: vi.fn().mockResolvedValue(ebayResult([], 'eBay OAuth failed HTTP 401')), ebayConfigured: () => true });
    await refreshComponent(c, ctx(['scan']), deps);
    expect(db.getRecentScrapeRuns(10).find(r => r.source === 'ebay')).toMatchObject({ ok: 0, error: 'eBay OAuth failed HTTP 401' });
    expect(db.getBestInStockOffer(c.id)?.price).toBe(893.99);
  });

  it('an empty result set is healthy (nothing for sale), not a failure', async () => {
    const c = profiled(null);
    const { deps } = withEbay([]);
    await refreshComponent(c, ctx([]), deps);
    expect(db.getRecentScrapeRuns(5).find(r => r.source === 'ebay')).toMatchObject({ ok: 1, offers_found: 0 });
  });
});

describe('failure notices are deduplicated per source across components', () => {
  it('a retailer that fails for every component produces one notice, not one per component', async () => {
    fresh(null);
    const a = db.getTrackedComponents()[0];
    const b = db.addTrackedComponent('Second part', 'cpu', 'ryzen 9 9950x3d', null);
    const { deps, notify } = makeDeps({ scan: () => { throw new Error('HTTP 403'); } });
    for (let i = 0; i < 3; i++) {
      await refreshComponent(a, ctx(['scan']), deps);
      await refreshComponent(b, ctx(['scan']), deps);
    }
    const notices = notify.mock.calls.map(x => x[0]).filter(p => p.type === 'scrape_failure');
    expect(notices).toHaveLength(1);
    expect(notices[0].message).toContain('search:scan');
  });
});

describe('changedetection.io tier (P3-3)', () => {
  const URL_ = 'https://www.shop.co.uk/kit';
  function withUrl() {
    const c = fresh(350);
    db.addComponentUrl(c.id, URL_, null, null);
    return c;
  }
  it('uses a watch reading instead of scraping, and an out-of-stock reading never alerts', async () => {
    const c = withUrl();
    const scrapeUrl = vi.fn();
    const { deps, notify } = makeDeps({}, { scrapeUrl, changedetectionConfigured: () => true,
      readWatch: async () => ({ price: 300, inStock: false, checkedAt: 1 }) });
    await refreshComponent(c, ctx([]), deps);
    expect(scrapeUrl).not.toHaveBeenCalled();
    expect(db.getBestInStockOffer(c.id) ?? null).toBeNull();
    expect(notify).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'price_alert' }));
    expect(db.getRecentScrapeRuns(5)[0]).toMatchObject({ source: 'changedetection:shop.co.uk', ok: 1 });
  });
  it('falls back to direct scraping, without recording a failure, when no watch exists', async () => {
    const c = withUrl();
    const scrapeUrl = vi.fn().mockResolvedValue({ price: 400, currency: 'GBP', inStock: true, stockState: 'in_stock', method: 'json-ld' });
    const { deps } = makeDeps({}, { scrapeUrl, changedetectionConfigured: () => true, readWatch: async () => null });
    await refreshComponent(c, ctx([]), deps);
    expect(scrapeUrl).toHaveBeenCalledOnce();
    expect(db.getRecentScrapeRuns(10).filter(r => r.source.startsWith('changedetection')).every(r => r.ok === 1)).toBe(true);
  });
  it('is skipped entirely when not configured', async () => {
    const c = withUrl();
    const readWatch = vi.fn();
    const scrapeUrl = vi.fn().mockResolvedValue({ price: 400, currency: 'GBP', inStock: true, stockState: 'in_stock', method: 'json-ld' });
    const { deps } = makeDeps({}, { scrapeUrl, readWatch, changedetectionConfigured: () => false });
    await refreshComponent(c, ctx([]), deps);
    expect(readWatch).not.toHaveBeenCalled();
  });
});

describe('search pages through a changedetection.io watch', () => {
  it('uses the watch result for the watched retailer instead of scraping it, and falls back when it returns null', async () => {
    const c = fresh(350);
    const watched = page('Novatech', [res('Corsair Vengeance 64GB (2x32GB) DDR5 5600MHz SODIMM kit', 340, 'in_stock', 'novatech')]);
    const searchRetailer = vi.fn(async () => page('x', [res('Kingston Fury 64GB (2x32GB) DDR5 SO-DIMM 5600MHz', 400, 'in_stock', 'scan')]));
    const { deps } = makeDeps({}, { searchRetailer, changedetectionConfigured: () => true,
      searchViaWatch: async (id) => id === 'novatech' ? watched : null });
    await refreshComponent(c, ctx(['novatech', 'scan']), deps);
    expect(searchRetailer).toHaveBeenCalledTimes(1);   // only scan was scraped directly
    expect(db.getBestInStockOffer(c.id)?.price).toBe(340);
  });
  it('a pending watch is a recorded failure, not a silent skip', async () => {
    const c = fresh(350);
    const { deps } = makeDeps({}, { changedetectionConfigured: () => true,
      searchViaWatch: async () => ({ retailer: 'Novatech', results: [], scrapedAt: '', durationMs: 1, error: 'watch created; its first snapshot is pending' }) });
    await refreshComponent(c, ctx(['novatech']), deps);
    expect(db.getRecentScrapeRuns(5).find(r => r.source === 'search:novatech')).toMatchObject({ ok: 0, error: expect.stringMatching(/pending/) });
  });
});

describe('sitemap tier (robots.txt-compliant replacement for a disallowed search page)', () => {
  it('uses the sitemap result instead of the retailer search, and an empty-but-healthy answer is not a failure', async () => {
    const c = fresh(350);
    const viaSitemap = page('AWD-IT', [res('Crucial 64GB (2x32GB) DDR5-5600 SODIMM kit', 449, 'in_stock', 'awdit')]);
    const searchRetailer = vi.fn();
    const { deps } = makeDeps({}, { searchRetailer, searchViaSitemap: async (id) => id === 'awdit' ? viaSitemap : { retailer: 'Novatech', results: [], scrapedAt: '', durationMs: 1, emptyIsOk: true } });
    await refreshComponent(c, ctx(['awdit', 'novatech']), deps);
    expect(searchRetailer).not.toHaveBeenCalled();
    expect(db.getBestInStockOffer(c.id)?.price).toBe(449);
    expect(db.getRecentScrapeRuns(10).find(r => r.source === 'search:novatech')).toMatchObject({ ok: 1, offers_found: 0 });
  });
  it('a sitemap error is a recorded failure with its reason', async () => {
    const c = fresh(350);
    const { deps } = makeDeps({}, { searchViaSitemap: async () => ({ retailer: 'AWD-IT', results: [], scrapedAt: '', durationMs: 1, error: 'sitemap: sitemap HTTP 404' }) });
    await refreshComponent(c, ctx(['awdit']), deps);
    expect(db.getRecentScrapeRuns(5).find(r => r.source === 'search:awdit')).toMatchObject({ ok: 0, error: 'sitemap: sitemap HTTP 404' });
  });
});
