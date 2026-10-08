import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as db from '../db.js';
import { evaluateAlerts } from './alerts.js';
import { verifyOffer, readItem, aspectsVerdict, legacyIdOf, type Reader } from './verify-offer.js';

// CONSTRUCTED response: field names follow the Browse API item documentation (localizedAspects, estimatedAvailabilities, price, itemEndDate);
// the values are invented. Not captured from the live API (Unverified until the first run with the owner's eBay keys).
const item = (over: Record<string, unknown> = {}) => ({
  price: { value: '340.00', currency: 'GBP' },
  estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'IN_STOCK', estimatedAvailableQuantity: 3 }],
  localizedAspects: [{ type: 'STRING', name: 'Type', value: 'SODIMM' }, { type: 'STRING', name: 'ECC', value: 'Non-ECC' }, { type: 'STRING', name: 'Brand', value: 'Fanxiang' }],
  ...over,
});
const reader = (status: number, body: Record<string, unknown> | null): Reader => vi.fn(async () => ({ status, body }));
const rec = (over: Partial<db.PriceRecord> = {}) => ({ url: 'https://www.ebay.co.uk/itm/237099708741?_skw=x', price: 340, profile_flags: 'ecc_unstated', source: 'ebay', ...over });

describe('reading an item', () => {
  it('finds the number in an eBay address and ignores other shops', () => {
    expect(legacyIdOf('https://www.ebay.co.uk/itm/237099708741?_skw=ddr5')).toBe('237099708741');
    expect(legacyIdOf('https://www.ebay.co.uk/itm/some-title/237099708741')).toBe('237099708741');
    expect(legacyIdOf('https://box.co.uk/ct2k32g56c46s5')).toBeNull();
  });
  it('parses availability, price and lower-cased aspect names, and treats an ended item as unavailable', () => {
    const r = readItem(item());
    expect(r).toMatchObject({ available: true, price: 340 });
    expect(r.aspects).toMatchObject({ type: 'SODIMM', ecc: 'Non-ECC' });
    expect(readItem(item({ estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'OUT_OF_STOCK' }] })).available).toBe(false);
    expect(readItem(item({ itemEndDate: '2020-01-01T00:00:00.000Z' })).available).toBe(false);
    expect(readItem({}).available).toBeNull();            // nothing stated: unknown, never "available"
  });
  it('item specifics: a clear ECC, desktop or DDR4 statement is a conflict; silence is not', () => {
    expect(aspectsVerdict({ ecc: 'ECC' }).conflict).toMatch(/ECC/);
    expect(aspectsVerdict({ type: 'DIMM' }).conflict).toMatch(/not SO-DIMM/);
    expect(aspectsVerdict({ type: 'DDR4 SDRAM' }).conflict).toMatch(/not DDR5/);
    expect(aspectsVerdict({ type: 'SODIMM', ecc: 'Non-ECC' })).toEqual({ ecc: false, conflict: null, eccListed: false });
    expect(aspectsVerdict({})).toEqual({ ecc: null, conflict: null, eccListed: false });
  });
});

describe('verifyOffer', () => {
  it('passes a live listing, and an explicit Non-ECC removes the "title does not say Non-ECC" caveat', async () => {
    const v = await verifyOffer(rec(), reader(200, item()));
    expect(v).toMatchObject({ ok: true, flagsRemoved: ['ecc_unstated'] });
  });
  it('blocks a listing that is gone (404), ended, or contradicts the profile', async () => {
    expect(await verifyOffer(rec(), reader(404, null))).toMatchObject({ ok: false, reason: expect.stringMatching(/gone/) });
    expect(await verifyOffer(rec(), reader(200, item({ estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'OUT_OF_STOCK' }] })))).toMatchObject({ ok: false });
    expect(await verifyOffer(rec(), reader(200, item({ localizedAspects: [{ name: 'ECC', value: 'ECC' }] })))).toMatchObject({ ok: false, reason: expect.stringMatching(/ECC/) });
  });
  it('an inconclusive re-read (network error, HTTP 500) NEVER blocks an alert', async () => {
    expect(await verifyOffer(rec(), reader(500, null))).toMatchObject({ ok: true, note: expect.stringMatching(/could not re-check/) });
    expect(await verifyOffer(rec(), reader(0, null))).toMatchObject({ ok: true });
  });
  it('reports a price that moved by more than 1%, and never reads a non-eBay offer', async () => {
    const v = await verifyOffer(rec(), reader(200, item({ price: { value: '399.99', currency: 'GBP' } })));
    expect(v).toMatchObject({ ok: true, price: 399.99, note: expect.stringContaining('399.99') });
    const r = reader(200, item());
    expect(await verifyOffer(rec({ url: 'https://box.co.uk/x' }), r)).toEqual({ ok: true });
    expect(r).not.toHaveBeenCalled();
  });
});

describe('verify before alert, inside evaluateAlerts', () => {
  beforeEach(() => db.getDb().exec('DELETE FROM price_records; DELETE FROM alert_evidence; DELETE FROM config; DELETE FROM tracked_components;'));
  const snap = (price: number, id: string) => ({ source: 'ebay', price, currency: 'GBP', retailer: 'eBay UK', url: `https://www.ebay.co.uk/itm/${id}`, inStock: true,
    stockState: 'in_stock' as const, listingName: `Kit ${id} 64GB (2x32GB) DDR5 SO-DIMM`, kitTotalGb: 64, modules: 2, profileMatch: true, deliveryCost: 0 });

  it('a listing that has gone is not announced, is marked unavailable, is logged as suppressed, and the next real one is', async () => {
    const c = db.addTrackedComponent('64GB', 'ram', 'q', 350);
    db.savePriceSnapshots(c.id, [snap(300, '111111111111'), snap(320, '222222222222')]);
    const notify = vi.fn();
    const verify = vi.fn(async (o: db.PriceRecord) => o.url!.includes('111111111111') ? { ok: false as const, reason: 'the listing is gone (eBay answered not found)' } : { ok: true as const });
    await evaluateAlerts({ component: c, prevBestPrice: null, dropThresholdPct: 5, notify, now: Date.now(), verify });
    const alert = notify.mock.calls.map(x => x[0]).find(p => p.type === 'price_alert');
    expect(alert.url).toContain('222222222222');
    expect(alert.price).toBe(320);
    const rows = db.getLatestPricePerRetailer(c.id, true, true);
    expect(rows.map(r => r.url)).toEqual(['https://www.ebay.co.uk/itm/222222222222']);    // the gone one left the purchasable list
    const ev = db.getRecentEvidence(10);
    expect(ev.map(e => e.kind).sort()).toEqual(['price_alert', 'suppressed']);
    expect(JSON.parse(ev.find(e => e.kind === 'suppressed')!.evidence).reason).toMatch(/gone/);
  });
  it('when every candidate fails nothing is sent', async () => {
    const c = db.addTrackedComponent('64GB', 'ram', 'q', 350);
    db.savePriceSnapshots(c.id, [snap(300, '111111111111')]);
    const notify = vi.fn();
    await evaluateAlerts({ component: c, prevBestPrice: null, dropThresholdPct: 5, notify, now: Date.now(), verify: async () => ({ ok: false, reason: 'ended' }) });
    expect(notify).not.toHaveBeenCalled();
  });
  it('a re-read price above the limit stops the alert; a throwing verifier never blocks one', async () => {
    const c = db.addTrackedComponent('64GB', 'ram', 'q', 350);
    db.savePriceSnapshots(c.id, [snap(300, '111111111111')]);
    const n1 = vi.fn();
    await evaluateAlerts({ component: c, prevBestPrice: null, dropThresholdPct: 5, notify: n1, now: Date.now(), verify: async () => ({ ok: true, price: 400, note: 'price is now £400.00 (was £300.00)' }) });
    expect(n1.mock.calls.some(x => x[0].type === 'price_alert')).toBe(false);
    const n2 = vi.fn();
    await evaluateAlerts({ component: c, prevBestPrice: null, dropThresholdPct: 5, notify: n2, now: Date.now(), verify: async () => { throw new Error('boom'); } });
    expect(n2.mock.calls.some(x => x[0].type === 'price_alert')).toBe(true);
  });
  it('no verification at all when nothing could be sent, and it can be switched off', async () => {
    const c = db.addTrackedComponent('64GB', 'ram', 'q', 350);
    db.savePriceSnapshots(c.id, [snap(900, '111111111111')]);
    const verify = vi.fn(async () => ({ ok: true as const }));
    await evaluateAlerts({ component: c, prevBestPrice: null, dropThresholdPct: 5, notify: vi.fn(), now: Date.now(), verify });
    expect(verify).not.toHaveBeenCalled();
    db.savePriceSnapshots(c.id, [snap(300, '222222222222')]);
    db.setConfig('verify_before_alert', 'false');
    await evaluateAlerts({ component: c, prevBestPrice: null, dropThresholdPct: 5, notify: vi.fn(), now: Date.now(), verify });
    expect(verify).not.toHaveBeenCalled();
  });
});

// REAL item specifics from the owner's NAS, 2026-10-08 (alert evidence row for the Fanxiang 64GB (2x32GB) DDR5-5600 SO-DIMM kit, eBay UK),
// keys already lower-cased by readItem. Note "memory features": "ECC Memory" on a kit sold as plain DDR5 SO-DIMM.
const REAL_ASPECTS = {
  brand: 'Fanxiang', 'form factor': 'SO-DIMM', type: 'DDR5 SODIMM', 'total capacity': '64 GB', 'number of modules': '2',
  'capacity per module': '32 GB', model: 'Fanxiang', 'bus speed': '5600', 'memory features': 'ECC Memory',
};
const realItem = () => item({ price: { value: '492.00', currency: 'GBP' }, localizedAspects: Object.entries(REAL_ASPECTS).map(([name, value]) => ({ type: 'STRING', name, value })) });

describe('a real listing whose specifics say "ECC Memory"', () => {
  it('is not blocked (DDR5 has on-die ECC and sellers tick it), but carries a warning flag', async () => {
    expect(aspectsVerdict(REAL_ASPECTS)).toEqual({ ecc: null, conflict: null, eccListed: true });
    const v = await verifyOffer(rec(), reader(200, realItem()));
    expect(v).toMatchObject({ ok: true, flagsAdded: ['ecc_listed'] });
    expect((v as { aspects: Record<string, string> }).aspects['type']).toBe('DDR5 SODIMM');
  });
  it('an explicit Non-ECC statement wins and adds no warning; an explicit ECC key still blocks', () => {
    expect(aspectsVerdict({ ...REAL_ASPECTS, ecc: 'Non-ECC' })).toMatchObject({ ecc: false, eccListed: false, conflict: null });
    expect(aspectsVerdict({ ...REAL_ASPECTS, ecc: 'ECC' })).toMatchObject({ ecc: true, conflict: expect.stringMatching(/ECC/) });
    expect(aspectsVerdict({ 'memory features': 'Non-ECC, Unbuffered' }).eccListed).toBe(false);
  });
  it('the alert carries the warning, and the stored offer keeps the flag for the dashboard and summary', async () => {
    db.getDb().exec('DELETE FROM price_records; DELETE FROM alert_evidence; DELETE FROM config; DELETE FROM tracked_components;');
    const c = db.addTrackedComponent('64GB', 'ram', 'q', 600);
    db.savePriceSnapshots(c.id, [{ source: 'ebay', price: 492, currency: 'GBP', retailer: 'eBay UK', url: 'https://www.ebay.co.uk/itm/237099708741', inStock: true,
      stockState: 'in_stock', listingName: 'Fanxiang 64GB (2x32GB) DDR5 5600MHz SO-DIMM', kitTotalGb: 64, modules: 2, profileMatch: true, profileFlags: ['ecc_unstated'], deliveryCost: 6.84 }]);
    const notify = vi.fn();
    const verify = (o: db.PriceRecord) => verifyOffer(o, reader(200, realItem()));
    await evaluateAlerts({ component: c, prevBestPrice: null, dropThresholdPct: 5, notify, now: Date.now(), verify });
    const alert = notify.mock.calls.map(x => x[0]).find(p => p.type === 'price_alert');
    expect(alert.price).toBe(492);
    expect(alert.message).toContain('item specifics list "ECC Memory"');
    expect(alert.message).toContain('ask the seller to confirm');
    expect(db.getLatestPricePerRetailer(c.id, true, true)[0].profile_flags).toContain('ecc_listed');
    const ev = JSON.parse(db.getRecentEvidence(1)[0].evidence);
    expect(ev.aspects['memory features']).toBe('ECC Memory');
  });
});
