import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as db from '../db.js';
import { evaluateAlerts } from './alerts.js';
import { offerKey, topOffers, formatOffer } from './offers.js';
import { maybeSendDailySummary, sendDailySummary, buildSummary } from './daily-summary.js';
import { classifyMemory, matchesProfile, PROFILES } from './memory-classifier.js';
import { SCAN } from '../test/fixtures.js';

// Listings copied from the owner's real eBay UK results, 2026-10-06 (docs/RESEARCH_AND_VERIFICATION.md row 27).
const FANXIANG = 'Fanxiang 64GB (2x32GB) DDR5 5600MHz SO-DIMM Laptop RAM Memory Kit';
const CORSAIR = 'Corsair Vengeance 64GB (2x32GB) DDR5-5600 SO-DIMM 262-Pin CMSX64GX5M2A5600C48';
const SKHYNIX = 'SK Hynix 2x 32GB (64GB) DDR5-5600MHZ SODIMM HMCG88AGBSA095N';
const KINGSTON = 'Kingston FURY Impact 64GB (2x32GB) 5600MHz CL40 DDR5 SODIMM - KF556S40IBK2-64';

function offer(name: string, price: number, itemId: string, over: Partial<db.PriceSnapshot> = {}): db.PriceSnapshot {
  return { source: 'ebay', price, currency: 'GBP', retailer: 'eBay UK', url: `https://www.ebay.co.uk/itm/${itemId}?_skw=x&hash=abc`,
    inStock: true, stockState: 'in_stock', listingName: name, kitTotalGb: 64, modules: 2, profileMatch: true,
    profileFlags: ['delivery_excluded'], ...over };
}
function fresh(alert: number | null = 350, consider: number | null = 500) {
  db.getDb().exec('DELETE FROM price_records; DELETE FROM tracked_components; DELETE FROM config;');
  const c = db.addTrackedComponent('64GB DDR5 SO-DIMM kit', 'ram', 'ddr5 so-dimm 64gb', alert);
  db.setComponentProfile(c.id, 'n5-air-ram');
  db.updateConsiderPrice(c.id, consider);
  return db.getTrackedComponents()[0];
}
const H = 3_600_000;
const run = (c: db.TrackedComponent, notify: ReturnType<typeof vi.fn>, now = Date.now()) =>
  evaluateAlerts({ component: c, prevBestPrice: null, dropThresholdPct: 50, notify, now });
const types = (n: ReturnType<typeof vi.fn>) => n.mock.calls.map(x => x[0].type);

describe('two-tier alerts: 350 = alert, 500 = options worth a look', () => {
  let c: db.TrackedComponent;
  beforeEach(() => { c = fresh(); });

  it('an offer between 350 and 500 sends ONE options notice listing only offers up to 500, cheapest first', async () => {
    db.savePriceSnapshots(c.id, [offer(FANXIANG, 492, '111'), offer(CORSAIR, 511.6, '222'), offer(KINGSTON, 899.2, '333')]);
    const notify = vi.fn().mockResolvedValue({});
    await run(c, notify);
    expect(types(notify)).toEqual(['options']);
    const msg = notify.mock.calls[0][0].message as string;
    expect(msg).toContain('Cheapest in stock: £492.00');
    expect(msg).toContain('Fanxiang 64GB');
    expect(msg).not.toContain('511.60');       // above the 500 ceiling
    expect(msg).not.toContain('899.20');
    expect(notify.mock.calls[0][0]).toMatchObject({ price: 492, retailer: 'eBay UK', alertThreshold: 500 });
  });

  it('nothing is sent while every offer is above 500', async () => {
    db.savePriceSnapshots(c.id, [offer(CORSAIR, 511.6, '222'), offer(KINGSTON, 899.2, '333')]);
    const notify = vi.fn().mockResolvedValue({});
    await run(c, notify);
    expect(notify).not.toHaveBeenCalled();
  });

  it('at or below 350 it is a price alert (not an options notice) and lists the other options', async () => {
    db.savePriceSnapshots(c.id, [offer(FANXIANG, 340, '111'), offer(SKHYNIX, 480, '444'), offer(CORSAIR, 639.09, '555')]);
    const notify = vi.fn().mockResolvedValue({});
    await run(c, notify);
    expect(types(notify)).toEqual(['price_alert']);
    const msg = notify.mock.calls[0][0].message as string;
    expect(msg).toContain('Other options:');
    expect(msg).toContain('SK Hynix');
    expect(msg).toContain('Corsair Vengeance');
    expect(msg.match(/Fanxiang/g)?.length).toBe(1);   // the alert's own offer is not repeated in the list
  });

  it('does not repeat the same options on the next pass, even though eBay changes its tracking parameters', async () => {
    db.savePriceSnapshots(c.id, [offer(FANXIANG, 492, '111')]);
    const notify = vi.fn().mockResolvedValue({});
    const t0 = Date.now();
    await run(c, notify, t0);
    db.savePriceSnapshots(c.id, [{ ...offer(FANXIANG, 492, '111'), url: 'https://www.ebay.co.uk/itm/111?_skw=x&hash=DIFFERENT&amdata=zzz' }]);
    await run(c, notify, t0 + 7 * H);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('a new or cheaper offer sends again, but not within the 6 hour cooldown', async () => {
    db.savePriceSnapshots(c.id, [offer(FANXIANG, 492, '111')]);
    const notify = vi.fn().mockResolvedValue({});
    const t0 = Date.now();
    await run(c, notify, t0);
    db.savePriceSnapshots(c.id, [offer(FANXIANG, 492, '111'), offer(SKHYNIX, 450, '444')]);
    await run(c, notify, t0 + 1 * H);                 // new + cheaper, but inside the cooldown
    expect(notify).toHaveBeenCalledTimes(1);
    await run(c, notify, t0 + 7 * H);                 // after the cooldown
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[1][0].message).toContain('£450.00');
  });

  it('no consider price means no options notices', async () => {
    c = fresh(350, null);
    db.savePriceSnapshots(c.id, [offer(FANXIANG, 492, '111')]);
    const notify = vi.fn().mockResolvedValue({});
    await run(c, notify);
    expect(notify).not.toHaveBeenCalled();
  });

  it('only purchasable offers are ever listed: a non-matching or out-of-stock cheap row is not an option', async () => {
    db.savePriceSnapshots(c.id, [
      offer('Minisforum Ar900i with Kingston Fury Impact 64gb (2x32) 5600Mt/s DDR5 SODIMM Mem', 300, '999', { profileMatch: false }),
      offer(CORSAIR, 400, '222', { inStock: false, stockState: 'out_of_stock' }),
      offer(FANXIANG, 492, '111'),
    ]);
    expect(topOffers(c.id, 5).map(o => o.price)).toEqual([492]);
  });
});

describe('offerKey and formatting', () => {
  it('eBay items are identified by item id, other URLs without their query string', () => {
    expect(offerKey('https://www.ebay.co.uk/itm/115903184340?_skw=ddr5&hash=item1:g:abc&amdata=enc%3A')).toBe('ebay:115903184340');
    expect(offerKey('https://www.awd-it.co.uk/x.html?utm=1#top')).toBe('https://www.awd-it.co.uk/x.html');
    expect(offerKey(null)).toBe('unknown');
  });
  it('one line per offer: price, title, retailer, price per GB and short caveats', () => {
    const c = fresh();
    db.savePriceSnapshots(c.id, [offer(SKHYNIX, 516.7, '444', { profileFlags: ['used_condition', 'delivery_excluded', 'ecc_unstated'], kitTotalGb: 64 })]);
    const line = formatOffer(topOffers(c.id, 1)[0]);
    expect(line).toBe('£516.70 · SK Hynix 2x 32GB (64GB) DDR5-5600MHZ SODIMM HMCG88AGBSA095N · eBay UK · £8.07/GB · used, +delivery');
  });
});

describe('48GB fallback profile', () => {
  it('accepts only 48GB (flagged unverified); the 64GB profile still accepts 64GB', () => {
    const p48 = PROFILES['n5-air-ram-48'];
    const kit48 = classifyMemory('48GB (2x24GB) Kingston FURY Impact DDR5 5600MT/s SODIMM CL40');
    expect(matchesProfile(kit48, p48)).toMatchObject({ match: true });
    expect(matchesProfile(kit48, p48).flags).toContain('non_binary_unverified');
    expect(matchesProfile(classifyMemory(SCAN.kit5200InStock), p48).match).toBe(false);
    expect(matchesProfile(classifyMemory(SCAN.kit5200InStock), PROFILES['n5-air-ram']).match).toBe(true);
  });
});

describe('daily summary', () => {
  const at = (h: number, day = 6) => new Date(2026, 9, day, h, 0, 0);
  let c: db.TrackedComponent;
  beforeEach(() => {
    c = fresh();
    db.savePriceSnapshots(c.id, [offer(FANXIANG, 492, '111'), offer(SKHYNIX, 516.7, '444', { profileFlags: ['used_condition'] }), offer(CORSAIR, 639.09, '555')]);
  });

  it('lists the cheapest, how far it is from the alert price, the options and 7-day context', () => {
    const text = buildSummary([c]);
    expect(text).toContain('64GB DDR5 SO-DIMM kit (alert at £350.00, options up to £500.00)');
    expect(text).toContain('Cheapest now: £492.00 · Fanxiang');
    expect(text).toContain('£142.00 above your alert price.');
    expect(text).toMatch(/Options \(3\):\n1\. £492\.00/);
    expect(text).toMatch(/Last 7 days: low £492\.00, median £516\.70 \(3 observations\)\./);
  });

  it('is sent once per local day, only after the configured hour', async () => {
    const notify = vi.fn().mockResolvedValue({});
    expect(await maybeSendDailySummary(notify, at(7))).toBe(false);        // before 08:00
    expect(await maybeSendDailySummary(notify, at(9))).toBe(true);
    expect(await maybeSendDailySummary(notify, at(15))).toBe(false);       // already sent today
    expect(await maybeSendDailySummary(notify, at(9, 7))).toBe(true);      // next day
    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify.mock.calls[0][0]).toMatchObject({ type: 'daily_summary', price: 492, retailer: 'eBay UK' });
  });

  it('can be disabled, and the hour is configurable', async () => {
    const notify = vi.fn().mockResolvedValue({});
    db.setConfig('daily_summary_hour', 'off');
    expect(await maybeSendDailySummary(notify, at(12))).toBe(false);
    db.setConfig('daily_summary_hour', '18');
    expect(await maybeSendDailySummary(notify, at(12))).toBe(false);
    expect(await maybeSendDailySummary(notify, at(18))).toBe(true);
  });

  it('if no channel delivered it, it is not marked as sent and is retried on the next pass', async () => {
    const notify = vi.fn().mockResolvedValue({ ntfy: false, discord: false });
    expect(await maybeSendDailySummary(notify, at(9))).toBe(false);
    expect(db.getConfig('last_daily_summary')).toBeNull();
    notify.mockResolvedValue({ ntfy: true });
    expect(await maybeSendDailySummary(notify, at(10))).toBe(true);
  });

  it('only components with a profile or a consider price are included, and paused ones are not', async () => {
    db.addTrackedComponent('Asus TUF GAMING', 'other', 'asus tuf gaming', null);
    const notify = vi.fn().mockResolvedValue({});
    await sendDailySummary(notify);
    expect(notify.mock.calls[0][0].message).not.toContain('Asus TUF');
    db.pauseComponent(c.id);
    expect(await sendDailySummary(notify)).toBe(false);
  });

  it('says so plainly when nothing purchasable was seen', async () => {
    db.getDb().exec('DELETE FROM price_records;');
    expect(buildSummary([c])).toContain('No matching in-stock listing seen in the last 48 hours.');
  });
});
