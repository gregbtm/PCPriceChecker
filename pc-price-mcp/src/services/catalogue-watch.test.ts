import { readFileSync } from 'fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as db from '../db.js';
import { observeCatalogue, loadCensus, takeCensus, isDdr5Sodimm, catalogueSummary } from './catalogue-watch.js';
import { parseSitemapLocs, slugText } from '../sources/sitemap-discovery.js';

// Real AWD-IT sitemap addresses (captured 2026-10-07).
const URLS = parseSitemapLocs(readFileSync(new URL('../test/fixtures/awdit-sitemap-excerpt.xml', import.meta.url), 'utf8')).locs;
const NEW_64 = 'https://www.awd-it.co.uk/corsair-vengeance-64gb-2x32gb-ddr5-5600mt-s-cl40-sodimm-memory-black.html';   // constructed on the real pattern
const NEW_16 = 'https://www.awd-it.co.uk/corsair-vengeance-16gb-1x16gb-ddr5-5600mt-s-cl40-sodimm-memory-black.html';   // constructed
// Real Novatech address (2026-10-07): the only SO-DIMM product in its 4,673-address sitemap, and it is DDR4.
const NOVATECH_DDR4 = 'https://www.novatech.co.uk/products/klevv-8gb-1x8gb-ddr4-3200mhz-cl22-sodimm-memory-ram-module/kd48gs880-32n220a.html';

beforeEach(() => db.getDb().exec('DELETE FROM config;'));

describe('catalogue census', () => {
  it('counts DDR5 SO-DIMM products and ignores DDR4 SO-DIMM and desktop DIMM', () => {
    expect(isDdr5Sodimm(slugText(NOVATECH_DDR4))).toBe(false);
    const c = takeCensus(URLS, slugText);
    expect(c.total).toBe(URLS.length);
    expect(c.sodimm.length).toBeGreaterThanOrEqual(2);
    expect(c.sodimm.every(u => isDdr5Sodimm(slugText(u)))).toBe(true);
  });

  it('the first observation is a baseline and never notifies', async () => {
    const notify = vi.fn();
    expect(await observeCatalogue('awdit', 'AWD-IT', URLS, slugText, notify as never)).toEqual({ added: [], baseline: true });
    expect(notify).not.toHaveBeenCalled();
    expect(loadCensus('awdit')?.total).toBe(URLS.length);
  });

  it('notifies once when a 64GB DDR5 SO-DIMM product first appears, and not again on the next read', async () => {
    const notify = vi.fn();
    await observeCatalogue('awdit', 'AWD-IT', URLS, slugText, notify as never);
    const r = await observeCatalogue('awdit', 'AWD-IT', [...URLS, NEW_64], slugText, notify as never);
    expect(r.added).toEqual([NEW_64]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ type: 'new_product', retailer: 'AWD-IT', url: NEW_64 });
    await observeCatalogue('awdit', 'AWD-IT', [...URLS, NEW_64], slugText, notify as never);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('a new small kit is recorded but not worth a notification', async () => {
    const notify = vi.fn();
    await observeCatalogue('awdit', 'AWD-IT', URLS, slugText, notify as never);
    const r = await observeCatalogue('awdit', 'AWD-IT', [...URLS, NEW_16], slugText, notify as never);
    expect(r.added).toEqual([NEW_16]);
    expect(notify).not.toHaveBeenCalled();
  });

  it('a sitemap that suddenly shrinks to a fraction is a broken read: the old census is kept and nothing is announced', async () => {
    const notify = vi.fn();
    const big = Array.from({ length: 500 }, (_, i) => `https://x.test/p${i}.html`).concat(URLS);
    await observeCatalogue('awdit', 'AWD-IT', big, slugText, notify as never);
    const before = loadCensus('awdit');
    await observeCatalogue('awdit', 'AWD-IT', [NEW_64], slugText, notify as never);
    expect(loadCensus('awdit')).toEqual(before);
    expect(notify).not.toHaveBeenCalled();
  });

  it('summarises per retailer for /api/health', async () => {
    await observeCatalogue('awdit', 'AWD-IT', [...URLS, NEW_64], slugText, vi.fn() as never);
    const [s] = catalogueSummary(['awdit', 'novatech'], slugText);
    expect(s).toMatchObject({ source: 'awdit', products: URLS.length + 1 });
    expect(s.kits_48gb_plus).toBeGreaterThanOrEqual(1);
    expect(catalogueSummary(['novatech'], slugText)).toEqual([]);   // never read: no line rather than a made-up zero
  });
});

describe('Buy Kingston census: a catalogue that sells laptops (real addresses captured 2026-10-08)', () => {
  const BK = parseSitemapLocs(readFileSync(new URL('../test/fixtures/buykingston-sitemap-excerpt.xml', import.meta.url), 'utf8')).locs;
  const ALIENWARE_64 = BK.find(u => /alienware.*64-gb-ddr5/.test(u))!;
  const THINKPAD_64 = BK.find(u => /thinkpad-p14s.*64-gb-ddr5/.test(u))!;
  const KIT_64 = BK.find(u => /kf556s40ibk2-64-64gb/.test(u))!;

  it('counts the SO-DIMM memory products and none of the laptops that merely state their RAM', () => {
    // Before the fix the live census said 144 for the full sitemap: 128 of them laptops whose address says "laptop" and "ddr5".
    expect(ALIENWARE_64 && THINKPAD_64 && KIT_64).toBeTruthy();
    const c = takeCensus(BK, slugText);
    expect(c.sodimm).toContain(KIT_64);
    expect(c.sodimm).not.toContain(ALIENWARE_64);
    expect(c.sodimm).not.toContain(THINKPAD_64);
    expect(c.sodimm.every(u => /so-?dimm/i.test(u))).toBe(true);
  });

  it('a laptop with 64GB appearing later does not send a "new DDR5 SO-DIMM product" notification', async () => {
    const notify = vi.fn();
    const without = BK.filter(u => u !== ALIENWARE_64 && u !== THINKPAD_64);
    await observeCatalogue('buykingston', 'Buy Kingston', without, slugText, notify as never);
    await observeCatalogue('buykingston', 'Buy Kingston', BK, slugText, notify as never);
    expect(notify).not.toHaveBeenCalled();
  });

  it('while a genuinely new 64GB SO-DIMM kit still does', async () => {
    const notify = vi.fn();
    await observeCatalogue('buykingston', 'Buy Kingston', BK.filter(u => u !== KIT_64), slugText, notify as never);
    await observeCatalogue('buykingston', 'Buy Kingston', BK, slugText, notify as never);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ type: 'new_product', url: KIT_64 });
  });
});
