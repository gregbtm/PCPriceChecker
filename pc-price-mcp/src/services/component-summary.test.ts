import { describe, it, expect } from 'vitest';
import * as db from '../db.js';
import { bestFields } from './component-summary.js';

function snap(retailer: string, price: number, over: Partial<db.PriceSnapshot> = {}): db.PriceSnapshot {
  return { source: 't', price, currency: 'GBP', retailer, url: `https://${retailer}/x`, inStock: true, stockState: 'in_stock', ...over };
}
function fresh(profile: string | null) {
  db.getDb().exec('DELETE FROM price_records; DELETE FROM tracked_components;');
  const c = db.addTrackedComponent('64GB DDR5 SO-DIMM kit', 'ram', 'ddr5 so-dimm 64gb', 350);
  if (profile) db.setComponentProfile(c.id, profile);
  return db.getTrackedComponents()[0];
}

describe('bestFields: what the dashboard shows as the best price', () => {
  it('profiled component: a cheap NON-matching eBay row (GBP 79.99) is not shown as the best price', () => {
    const c = fresh('n5-air-ram');
    db.savePriceSnapshots(c.id, [
      snap('eBay UK', 79.99, { profileMatch: false, listingName: 'DDR5 SODIMM 8GB laptop RAM' }),
      snap('eBay UK', 893.99, { profileMatch: true, listingName: '64GB (2x32GB) DDR5 SODIMM', kitTotalGb: 64, modules: 2 }),
    ]);
    const b = bestFields(c);
    expect(b).toMatchObject({ best_price: 893.99, best_purchasable_price: 893.99 });
  });

  it('profiled component with only non-matching or stale rows shows no best price at all', () => {
    const c = fresh('n5-air-ram');
    db.savePriceSnapshots(c.id, [snap('eBay UK', 79.99, { profileMatch: false })]);
    expect(bestFields(c)).toMatchObject({ best_price: null, best_purchasable_price: null });
  });

  it('component without a profile keeps the historical meaning, and still reports the purchasable offer separately', () => {
    const c = fresh(null);
    db.savePriceSnapshots(c.id, [
      snap('cheap-oos', 20, { inStock: false, stockState: 'out_of_stock' }),
      snap('shop', 450),
    ]);
    expect(bestFields(c)).toMatchObject({ best_price: 20, best_in_stock: 0, best_purchasable_price: 450, best_purchasable_retailer: 'shop' });
  });

  it('exposes the profile flags of the purchasable offer', () => {
    const c = fresh('n5-air-ram');
    db.savePriceSnapshots(c.id, [snap('eBay UK', 300, { profileMatch: true, profileFlags: ['used_condition', 'delivery_excluded'] })]);
    expect(bestFields(c).best_purchasable_flags).toBe('used_condition,delivery_excluded');
  });
});
