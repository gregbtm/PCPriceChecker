import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as db from './db.js';
import { evaluateAlerts } from './services/alerts.js';

// Real Scan.co.uk titles, 2026-10-05 (docs/RESEARCH_AND_VERIFICATION.md section 2).
const KIT_5600 = '64GB (2x32GB) CORSAIR DDR5 Vengeance SODIMM, PC5-44800 (5600), Non-ECC Unbuffered, CAS 48, 1.1V., XMP 3.0';

function snap(retailer: string, price: number, stockState: db.StockState): db.PriceSnapshot {
  return { source: 'test', price, currency: 'GBP', retailer, url: `https://${retailer}/kit`,
    inStock: stockState === 'in_stock', stockState };
}

function fresh(alertPrice: number | null = 900) {
  db.getDb().exec('DELETE FROM price_records; DELETE FROM tracked_components; DELETE FROM build_items; DELETE FROM builds;');
  return db.addTrackedComponent(KIT_5600, 'ram', 'ddr5 so-dimm 64gb', alertPrice);
}

describe('P0-2 stock tri-state storage', () => {
  it('stores the state and keeps in_stock=1 only for in_stock', () => {
    const c = fresh();
    db.savePriceSnapshots(c.id, [
      snap('a', 1, 'in_stock'), snap('b', 2, 'backorder'), snap('c', 3, 'unknown'), snap('d', 4, 'out_of_stock'),
    ]);
    const rows = db.getLatestPricePerRetailer(c.id);
    const by = Object.fromEntries(rows.map(r => [r.retailer, r]));
    expect(by.a).toMatchObject({ stock_state: 'in_stock', in_stock: 1 });
    expect(by.b).toMatchObject({ stock_state: 'backorder', in_stock: 0 });
    expect(by.c).toMatchObject({ stock_state: 'unknown', in_stock: 0 });
    expect(by.d).toMatchObject({ stock_state: 'out_of_stock', in_stock: 0 });
  });

  it('derives the state from the legacy boolean when stockState is omitted', () => {
    const c = fresh();
    db.savePriceSnapshots(c.id, [
      { source: 't', price: 10, currency: 'GBP', retailer: 'x', url: null, inStock: true },
      { source: 't', price: 11, currency: 'GBP', retailer: 'y', url: null, inStock: false },
    ]);
    const by = Object.fromEntries(db.getLatestPricePerRetailer(c.id).map(r => [r.retailer, r.stock_state]));
    expect(by).toEqual({ x: 'in_stock', y: 'out_of_stock' });
  });
});

describe('P0-1 in-stock-aware queries', () => {
  beforeEach(() => { fresh(); });

  it('getBestInStockOffer ignores backorder (Scan "Due 8th Oct"), unknown and out-of-stock', () => {
    const c = db.getTrackedComponents()[0];
    db.savePriceSnapshots(c.id, [
      snap('scan-backorder', 933.49, 'backorder'),
      snap('mystery', 100, 'unknown'),
      snap('oos', 50, 'out_of_stock'),
    ]);
    expect(db.getBestInStockOffer(c.id)).toBeNull();
    db.savePriceSnapshots(c.id, [snap('scan', 893.99, 'in_stock')]);
    expect(db.getBestInStockOffer(c.id)).toMatchObject({ retailer: 'scan', price: 893.99 });
  });

  it('uses each retailer\'s LATEST observation: a retailer that went out of stock no longer counts', () => {
    const c = db.getTrackedComponents()[0];
    const raw = db.getDb();
    const ins = raw.prepare(`INSERT INTO price_records (component_id, source, price, retailer, in_stock, stock_state, recorded_at) VALUES (?, 't', ?, 'scan', ?, ?, ?)`);
    ins.run(c.id, 800, 1, 'in_stock', '2026-10-05 09:00:00');
    ins.run(c.id, 800, 0, 'out_of_stock', '2026-10-05 10:00:00');
    expect(db.getBestInStockOffer(c.id)).toBeNull();
    // ...but the unfiltered view (dashboards/history) still sees the latest row
    expect(db.getLatestPricePerRetailer(c.id)).toHaveLength(1);
  });

  it('getComponentsBelowAlertPrice ignores out-of-stock bargains', () => {
    const c = db.getTrackedComponents()[0];
    db.savePriceSnapshots(c.id, [snap('oos', 150, 'out_of_stock')]);
    expect(db.getComponentsBelowAlertPrice()).toEqual([]);
    db.savePriceSnapshots(c.id, [snap('scan', 850, 'in_stock')]);
    expect(db.getComponentsBelowAlertPrice()[0]).toMatchObject({ retailer: 'scan', currentBestPrice: 850 });
  });

  it('getPriceStats.current_best is in-stock by default, all-stock on request', () => {
    const c = db.getTrackedComponents()[0];
    db.savePriceSnapshots(c.id, [snap('oos', 150, 'out_of_stock'), snap('scan', 893.99, 'in_stock')]);
    expect(db.getPriceStats(c.id).current_best).toBe(893.99);
    expect(db.getPriceStats(c.id, false).current_best).toBe(150);
  });

  it('getBatchDealRatios uses the in-stock current best', () => {
    const c = db.getTrackedComponents()[0];
    db.savePriceSnapshots(c.id, [snap('oos', 150, 'out_of_stock'), snap('scan', 300, 'in_stock')]);
    expect(db.getBatchDealRatios([c.id]).get(c.id)?.current_best).toBe(300);
  });

  it('getBuildSummary prices a build from in-stock offers only', () => {
    const c = db.getTrackedComponents()[0];
    db.savePriceSnapshots(c.id, [snap('oos', 150, 'out_of_stock'), snap('scan', 893.99, 'in_stock')]);
    const raw = db.getDb();
    const b = raw.prepare(`INSERT INTO builds (name) VALUES ('t') RETURNING id`).get() as { id: number };
    raw.prepare('INSERT INTO build_items (build_id, component_id) VALUES (?, ?)').run(b.id, c.id);
    expect(db.getBuildSummary(b.id)?.totalCost).toBe(893.99);
  });
});

describe('scheduler drop alerts use in-stock previous/new best', () => {
  it('no drop alert when the "drop" is an out-of-stock listing appearing', async () => {
    const c = fresh(null);
    db.savePriceSnapshots(c.id, [snap('scan', 900, 'in_stock')]);
    const prev = db.getBestInStockOffer(c.id)!.price;
    db.savePriceSnapshots(c.id, [snap('scan', 900, 'in_stock'), snap('oos', 300, 'out_of_stock')]);
    const notify = vi.fn().mockResolvedValue({});
    await evaluateAlerts({ component: c, prevBestPrice: prev, dropThresholdPct: 5, notify });
    expect(notify).not.toHaveBeenCalled();
  });

  it('drop alert fires for a real in-stock drop', async () => {
    const c = fresh(null);
    db.getDb().prepare(`UPDATE tracked_components SET last_alerted_at = NULL WHERE id = ?`).run(c.id);
    db.savePriceSnapshots(c.id, [snap('scan', 700, 'in_stock')]);
    const notify = vi.fn().mockResolvedValue({});
    await evaluateAlerts({ component: c, prevBestPrice: 900, dropThresholdPct: 5, notify });
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ type: 'price_drop', retailer: 'scan', price: 700 }));
  });
});

describe('stale observations are not purchasable offers', () => {
  function seedOld(componentId: number, price: number, retailer: string, ageHours: number) {
    db.getDb().prepare(`INSERT INTO price_records (component_id, source, price, retailer, in_stock, stock_state, recorded_at)
      VALUES (?, 't', ?, ?, 1, 'in_stock', datetime('now', ?))`).run(componentId, price, retailer, `-${ageHours} hours`);
  }

  it('a 3-month-old in-stock row is not the best offer, but still shows in the unfiltered history view', () => {
    const c = fresh(800);
    seedOld(c.id, 22.34, 'eBay - gingerinka', 24 * 90);   // real example from the owner's RTX 5080 component
    expect(db.getBestInStockOffer(c.id)).toBeNull();
    expect(db.getComponentsBelowAlertPrice()).toEqual([]);
    expect(db.getLatestPricePerRetailer(c.id)).toHaveLength(1);
  });

  it('fresh rows still count, and the age limit is configurable', () => {
    const c = fresh(800);
    seedOld(c.id, 700, 'shop', 40);
    expect(db.getBestInStockOffer(c.id)?.price).toBe(700);       // inside 48 h
    db.setConfig('max_offer_age_hours', '24');
    expect(db.getBestInStockOffer(c.id)).toBeNull();             // 40 h old is now stale
    db.deleteConfig('max_offer_age_hours');
  });

  it('no alert fires from a stale cheap row when a fresh, dearer offer is the only current one', async () => {
    const c = fresh(800);
    seedOld(c.id, 22.34, 'eBay - gingerinka', 24 * 90);
    db.savePriceSnapshots(c.id, [snap('Overclockers', 999, 'in_stock')]);
    const notify = vi.fn().mockResolvedValue({});
    await evaluateAlerts({ component: c, prevBestPrice: null, dropThresholdPct: 5, notify });
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('P5-2 retention', () => {
  const old = (c: number, retailer: string, price: number, at: string) => db.getDb().prepare(
    `INSERT INTO price_records (component_id, source, price, currency, retailer, url, in_stock, recorded_at) VALUES (?, 't', ?, 'GBP', ?, 'u', 1, ?)`)
    .run(c, price, retailer, at);
  it('keeps the cheapest row per component, retailer and day beyond the window, and all recent rows', () => {
    const c = fresh();
    old(c.id, 'a', 500, "2020-01-01 08:00:00"); old(c.id, 'a', 450, "2020-01-01 12:00:00"); old(c.id, 'a', 480, "2020-01-01 18:00:00");
    old(c.id, 'b', 700, "2020-01-01 09:00:00");
    old(c.id, 'a', 520, "2020-01-02 09:00:00");
    db.savePriceSnapshots(c.id, [snap('a', 400, 'in_stock'), snap('a', 410, 'in_stock')]);   // now
    const removed = db.pruneOldPriceRecords(30);
    const left = db.getDb().prepare('SELECT retailer, price FROM price_records WHERE component_id = ? ORDER BY recorded_at, price').all(c.id);
    expect(removed).toBe(2);
    expect(left).toEqual([{ retailer: 'b', price: 700 }, { retailer: 'a', price: 450 }, { retailer: 'a', price: 520 },
      { retailer: 'a', price: 400 }, { retailer: 'a', price: 410 }]);
  });
  it('is off at 0 and defaults to 365 days', () => {
    db.getDb().exec('DELETE FROM config;');
    expect(db.priceRetentionDays()).toBe(365);
    db.setConfig('price_retention_days', '0');
    expect(db.pruneOldPriceRecords(db.priceRetentionDays())).toBe(0);
    db.setConfig('price_retention_days', 'junk');
    expect(db.priceRetentionDays()).toBe(365);
  });
});
