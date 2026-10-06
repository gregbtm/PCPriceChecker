import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as db from '../db.js';
import { parseQuietHours, inQuietHours } from './quiet-hours.js';
import { evaluateAlerts } from './alerts.js';

const at = (h: number, m = 0) => new Date(2026, 9, 6, h, m);

describe('quiet hours', () => {
  it('parses HH:MM-HH:MM and rejects junk (an invalid value never silences alerts)', () => {
    expect(parseQuietHours('22:00-07:00')).toEqual({ start: 1320, end: 420 });
    for (const bad of ['', null, undefined, 'night', '25:00-07:00', '22:00-22:00', '22-7']) expect(parseQuietHours(bad)).toBeNull();
    expect(inQuietHours(at(3), 'night')).toBe(false);
  });
  it('wraps past midnight, with the end exclusive', () => {
    expect(inQuietHours(at(23), '22:00-07:00')).toBe(true);
    expect(inQuietHours(at(2), '22:00-07:00')).toBe(true);
    expect(inQuietHours(at(7), '22:00-07:00')).toBe(false);
    expect(inQuietHours(at(12), '22:00-07:00')).toBe(false);
    expect(inQuietHours(at(13), '12:00-14:00')).toBe(true);
    expect(inQuietHours(at(14), '12:00-14:00')).toBe(false);
  });
});

describe('alerts honour quiet hours and treat a new offer or lower price as news', () => {
  const snap = (retailer: string, price: number): db.PriceSnapshot =>
    ({ source: 't', price, currency: 'GBP', retailer, url: `https://${retailer}/kit`, inStock: true, stockState: 'in_stock' });
  let c: db.TrackedComponent;
  beforeEach(() => {
    db.getDb().exec('DELETE FROM price_records; DELETE FROM config; DELETE FROM tracked_components;');
    c = db.addTrackedComponent('64GB kit', 'ram', 'ddr5 so-dimm 64gb', 350);
  });
  const run = async (notify: ReturnType<typeof vi.fn>, now = at(12).getTime()) =>
    evaluateAlerts({ component: db.getTrackedComponents()[0], prevBestPrice: null, dropThresholdPct: 5, notify, now });
  const alerts = (n: ReturnType<typeof vi.fn>) => n.mock.calls.filter(x => x[0].type === 'price_alert').length;

  it('sends nothing during quiet hours, records nothing, and sends on the first pass after', async () => {
    db.setConfig('quiet_hours', '22:00-07:00');
    db.savePriceSnapshots(c.id, [snap('a.co.uk', 300)]);
    const n = vi.fn().mockResolvedValue({});
    await run(n, at(2).getTime());
    expect(n).not.toHaveBeenCalled();
    expect(db.getTrackedComponents()[0].last_alerted_at).toBeNull();
    await run(n, at(8).getTime());
    expect(alerts(n)).toBe(1);
  });
  it('the same deal is not repeated inside the cooldown', async () => {
    db.savePriceSnapshots(c.id, [snap('a.co.uk', 300)]);
    const n = vi.fn().mockResolvedValue({});
    await run(n); await run(n);
    expect(alerts(n)).toBe(1);
  });
  it('a lower price, or a different retailer, bypasses the cooldown', async () => {
    db.savePriceSnapshots(c.id, [snap('a.co.uk', 300)]);
    const n = vi.fn().mockResolvedValue({});
    await run(n);
    db.savePriceSnapshots(c.id, [snap('a.co.uk', 280)]);
    await run(n);
    expect(alerts(n)).toBe(2);
    db.savePriceSnapshots(c.id, [snap('b.co.uk', 270)]);
    await run(n);
    expect(alerts(n)).toBe(3);
    db.savePriceSnapshots(c.id, [snap('b.co.uk', 275)]);   // not cheaper than the last alert
    await run(n);
    expect(alerts(n)).toBe(3);
  });
});
