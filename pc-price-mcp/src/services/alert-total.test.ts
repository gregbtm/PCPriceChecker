import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as db from '../db.js';
import { evaluateAlerts } from './alerts.js';
import { mpnQueries, mpnDue, markMpnRun, mpnEveryHours } from './ebay-queries.js';

beforeEach(() => db.getDb().exec('DELETE FROM price_records; DELETE FROM config; DELETE FROM tracked_components;'));

const offer = (price: number, delivery: number | null, url: string) => ({
  source: 'ebay', price, currency: 'GBP', retailer: 'eBay UK', url, inStock: true, stockState: 'in_stock' as const,
  listingName: 'Kit 64GB (2x32GB) DDR5 SO-DIMM', kitTotalGb: 64, modules: 2, profileMatch: true, deliveryCost: delivery,
});

describe('alert on total cost (price + delivery)', () => {
  it('off by default: a 340 item with 20 delivery alerts at a 350 limit, exactly as before', async () => {
    const c = db.addTrackedComponent('64GB', 'ram', 'q', 350);
    db.savePriceSnapshots(c.id, [offer(340, 20, 'https://www.ebay.co.uk/itm/1')]);
    const notify = vi.fn();
    await evaluateAlerts({ component: c, prevBestPrice: null, dropThresholdPct: 5, notify, now: Date.now() });
    expect(notify.mock.calls.some(x => x[0].type === 'price_alert')).toBe(true);
  });
  it('on: the same offer costs 360 delivered, so it does NOT alert at 350, and a 330 + 10 offer does, with the total in the message', async () => {
    db.setConfig('alert_on_total', 'true');
    const c = db.addTrackedComponent('64GB', 'ram', 'q', 350);
    db.savePriceSnapshots(c.id, [offer(340, 20, 'https://www.ebay.co.uk/itm/1')]);
    const notify = vi.fn();
    await evaluateAlerts({ component: c, prevBestPrice: null, dropThresholdPct: 5, notify, now: Date.now() });
    expect(notify.mock.calls.some(x => x[0].type === 'price_alert')).toBe(false);
    db.savePriceSnapshots(c.id, [offer(330, 10, 'https://www.ebay.co.uk/itm/2')]);
    await evaluateAlerts({ component: c, prevBestPrice: null, dropThresholdPct: 5, notify, now: Date.now() });
    const alert = notify.mock.calls.map(x => x[0]).find(p => p.type === 'price_alert');
    expect(alert.url).toContain('/itm/2');
    expect(alert.message).toContain('Total with delivery £340.00 (item £330.00 + £10.00)');
  });
  it('on: an unknown delivery counts as 0 (the "price excludes delivery" flag still travels)', async () => {
    db.setConfig('alert_on_total', 'true');
    const c = db.addTrackedComponent('64GB', 'ram', 'q', 350);
    db.savePriceSnapshots(c.id, [offer(345, null, 'https://www.ebay.co.uk/itm/3')]);
    const notify = vi.fn();
    await evaluateAlerts({ component: c, prevBestPrice: null, dropThresholdPct: 5, notify, now: Date.now() });
    expect(notify.mock.calls.some(x => x[0].type === 'price_alert')).toBe(true);
  });
});

describe('eBay part-number queries', () => {
  it('only a component with a profile gets them, limited to the capacities it accepts', () => {
    expect(mpnQueries({ profile_id: null })).toEqual([]);
    const both = mpnQueries({ profile_id: 'n5-air-ram' });
    expect(both).toContain('CT2K32G56C46S5');
    expect(both).toContain('CMSX48GX5M2A5600C48');
    const only48 = mpnQueries({ profile_id: 'n5-air-ram-48' });
    expect(only48.every(m => /48/.test(m))).toBe(true);
    expect(only48).not.toContain('CT2K32G56C46S5');
  });
  it('are rate-limited per component, can run every pass (0) or be turned off', () => {
    const t = 1_000_000_000_000;
    expect(mpnDue(1, t)).toBe(true);
    markMpnRun(1, t);
    expect(mpnDue(1, t + 3_600_000)).toBe(false);            // 1 h later, default 6 h
    expect(mpnDue(1, t + 6 * 3_600_000)).toBe(true);
    db.setConfig('ebay_mpn_every_hours', '0');
    expect(mpnDue(1, t + 1)).toBe(true);
    db.setConfig('ebay_mpn_every_hours', 'off');
    expect(mpnEveryHours()).toBeNull();
    expect(mpnDue(1, t + 99 * 3_600_000)).toBe(false);
  });
});
