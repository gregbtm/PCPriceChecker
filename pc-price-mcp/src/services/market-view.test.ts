import { describe, it, expect, beforeEach } from 'vitest';
import * as db from '../db.js';
import { marketView, marketLine } from './offers.js';
import { buildSummary } from './daily-summary.js';

beforeEach(() => db.getDb().exec('DELETE FROM price_records; DELETE FROM config; DELETE FROM tracked_components;'));

// Prices and states are the ones observed on 2026-10-07 (Box and LaptopOutlet pages, Wired2Fire Store API, eBay offers output).
const snap = (retailer: string, price: number, stockState: 'in_stock' | 'out_of_stock' | 'backorder', url: string, profileMatch = true) => ({
  source: 'test', price, currency: 'GBP', retailer, url, inStock: stockState === 'in_stock', stockState,
  listingName: `${retailer} 64GB (2 x 32GB) DDR5 SO-DIMM`, kitTotalGb: 64, modules: 2, profileMatch,
});

describe('market view', () => {
  it('the floor is the cheapest compatible listing in ANY stock state, so a target below the market is visible', () => {
    const c = db.addTrackedComponent('64GB', 'ram', 'q', 350);
    db.savePriceSnapshots(c.id, [
      snap('Box', 885.71, 'out_of_stock', 'https://box.co.uk/a'),
      snap('Wired2Fire', 600, 'backorder', 'https://wired2fire.co.uk/p'),
      snap('eBay UK', 498.84, 'in_stock', 'https://www.ebay.co.uk/itm/1'),
      snap('Cheap wrong kit', 40, 'in_stock', 'https://x.test/wrong', false),   // does not fit the profile: never the floor
    ]);
    const v = marketView(c.id, 350);
    expect(v.floor).toMatchObject({ retailer: 'eBay UK', price: 498.84, stock_state: 'in_stock' });
    expect(v.rows.map(r => r.retailer)).toEqual(['eBay UK', 'Wired2Fire', 'Box']);
    expect(v.target_below_floor_pct).toBe(30);   // (498.84 - 350) / 498.84
    expect(marketLine(v)).toContain('Your alert price is 30% below it.');
  });

  it('a backordered or out-of-stock floor is labelled as such, and old observations fall out of the window', () => {
    const c = db.addTrackedComponent('64GB', 'ram', 'q', 350);
    db.savePriceSnapshots(c.id, [snap('Wired2Fire', 600, 'backorder', 'https://wired2fire.co.uk/p')]);
    expect(marketLine(marketView(c.id, 350))).toContain('600.00 at Wired2Fire (backorder)');
    expect(marketView(c.id, 350, 7, Date.now() + 10 * 86_400_000).floor).toBeNull();   // seen 10 days "ago": outside 7 days
  });

  it('says nothing when no compatible listing has been seen, and nothing about a gap when the target is at or above the floor', () => {
    const c = db.addTrackedComponent('64GB', 'ram', 'q', 350);
    expect(marketLine(marketView(c.id, 350))).toBeNull();
    db.savePriceSnapshots(c.id, [snap('eBay UK', 300, 'in_stock', 'https://www.ebay.co.uk/itm/2')]);
    expect(marketLine(marketView(c.id, 350))).not.toContain('below it');
  });

  it('appears in the daily summary', () => {
    const c = db.addTrackedComponent('64GB', 'ram', 'q', 350);
    db.setComponentProfile(c.id, 'n5-air-ram');
    db.savePriceSnapshots(c.id, [snap('Box', 885.71, 'out_of_stock', 'https://box.co.uk/a')]);
    expect(buildSummary([db.getTrackedComponentById(c.id)!])).toContain('Market floor (any stock, last 7 days): £885.71 at Box (out of stock).');
  });
});
