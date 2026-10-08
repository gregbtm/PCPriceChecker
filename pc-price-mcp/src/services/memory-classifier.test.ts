import { describe, it, expect } from 'vitest';
import { describesWholeComputer, classifyMemory, matchesProfile, N5_AIR_RAM } from './memory-classifier.js';
import { SCAN, SYNTHETIC } from '../test/fixtures.js';

describe('classifyMemory on real Scan titles (docs/RESEARCH_AND_VERIFICATION.md section 2)', () => {
  it('64GB (2x32GB) Corsair 5600', () => {
    expect(classifyMemory(SCAN.kit5600Backorder)).toEqual({
      ddr: 5, formFactor: 'SODIMM', ecc: false, registered: false,
      modules: 2, moduleGb: 32, totalGb: 64, speedMts: 5600, cl: 48, voltage: 1.1, bundle: false,
    });
  });
  it('64GB (2x32GB) Corsair 5200 (PC5-41600)', () => {
    expect(classifyMemory(SCAN.kit5200InStock)).toMatchObject({ ddr: 5, formFactor: 'SODIMM', modules: 2, totalGb: 64, speedMts: 5200, cl: 44, voltage: 1.1 });
  });
  it('24GB singles are 1 module', () => {
    for (const [t, mts] of [[SCAN.single24_5200, 5200], [SCAN.single24_4800, 4800], [SCAN.single24_5600, 5600]] as const) {
      expect(classifyMemory(t)).toMatchObject({ ddr: 5, modules: 1, moduleGb: 24, totalGb: 24, speedMts: mts });
    }
  });
  it('DDR4 SO-DIMMs', () => {
    expect(classifyMemory(SCAN.ddr4Samsung)).toMatchObject({ ddr: 4, formFactor: 'SODIMM', totalGb: 4, speedMts: 2400, cl: 17, voltage: 1.2 });
    expect(classifyMemory(SCAN.ddr4Corsair)).toMatchObject({ ddr: 4, formFactor: 'SODIMM', totalGb: 4, speedMts: 2133, cl: 15 });
  });
  it('the marketing title states 5600MHz and no kit layout', () => {
    expect(classifyMemory(SYNTHETIC.marketing)).toMatchObject({ ddr: 5, formFactor: 'SODIMM', totalGb: 64, modules: null, speedMts: 5600 });
  });
});

describe('classifyMemory edge cases (synthetic titles)', () => {
  it('desktop DIMM, UDIMM, RDIMM, CAMM2, ECC', () => {
    expect(classifyMemory(SYNTHETIC.desktop64).formFactor).toBe('DIMM');
    expect(classifyMemory(SYNTHETIC.desktopUdimm)).toMatchObject({ formFactor: 'DIMM', speedMts: 6000, totalGb: 64 });
    expect(classifyMemory(SYNTHETIC.rdimm)).toMatchObject({ formFactor: 'DIMM', registered: true, ecc: true });
    expect(classifyMemory(SYNTHETIC.camm2).formFactor).toBe('CAMM2');
    expect(classifyMemory(SYNTHETIC.eccSodimm)).toMatchObject({ formFactor: 'SODIMM', ecc: true });
  });
  it('does not mistake on-die ECC for module ECC', () => {
    expect(classifyMemory('32GB DDR5 SODIMM 5600MHz with on-die ECC').ecc).toBeNull();
  });
  it('accepts SO-DIMM spellings, the × sign and spaces in 2 x 32GB', () => {
    expect(classifyMemory('64GB 2 × 32GB DDR5 SO DIMM').formFactor).toBe('SODIMM');
    expect(classifyMemory('64GB 2 × 32GB DDR5 SO DIMM')).toMatchObject({ modules: 2, moduleGb: 32 });
    expect(classifyMemory('DDR5 SODIMM 2x32GB')).toMatchObject({ totalGb: 64, modules: 2 });
  });
  it('ignores GB/s and storage-sized numbers, never invents fields', () => {
    expect(classifyMemory('DDR5 SODIMM 44.8GB/s').totalGb).toBeNull();
    expect(classifyMemory('some memory')).toEqual({ ddr: null, formFactor: null, ecc: null, registered: null,
      modules: null, moduleGb: null, totalGb: null, speedMts: null, cl: null, voltage: null, bundle: false });
  });
  it('a kit whose arithmetic does not add up is not trusted as a kit', () => {
    expect(classifyMemory('64GB (2x16GB) DDR5 SODIMM')).toMatchObject({ totalGb: 32, modules: 2 });
  });
});

describe('matchesProfile: n5-air-ram', () => {
  const m = (t: string) => matchesProfile(classifyMemory(t), N5_AIR_RAM);

  it('accepts "64GB (2x32GB) DDR5 SODIMM ... Non-ECC" (both real Scan kits)', () => {
    expect(m(SCAN.kit5200InStock)).toEqual({ match: true, reasons: [], flags: [] });
    expect(m(SCAN.kit5600Backorder)).toEqual({ match: true, reasons: [], flags: [] });
  });
  it('rejects DDR4 SO-DIMM titles', () => {
    for (const t of [SCAN.ddr4Samsung, SCAN.ddr4Corsair]) {
      const r = m(t);
      expect(r.match).toBe(false);
      expect(r.reasons.join(' ')).toMatch(/DDR4, need DDR5/);
    }
  });
  it('rejects desktop DIMM, UDIMM, RDIMM, CAMM2 and ECC', () => {
    expect(m(SYNTHETIC.desktop64).reasons.join()).toMatch(/DIMM, need SODIMM/);
    expect(m(SYNTHETIC.desktopUdimm).match).toBe(false);
    expect(m(SYNTHETIC.rdimm).match).toBe(false);
    expect(m(SYNTHETIC.camm2).reasons.join()).toMatch(/CAMM2, need SODIMM/);
    expect(m(SYNTHETIC.eccSodimm).reasons.join()).toMatch(/ECC/);
  });
  it('rejects wrong capacities: 24GB singles, 1x64GB (kit required)', () => {
    expect(m(SCAN.single24_5200).match).toBe(false);
    expect(m(SYNTHETIC.single64).reasons.join()).toMatch(/1 module/);
  });
  it('accepts 2x24GB (48GB) only with the unverified-compatibility flag', () => {
    const r = m(SYNTHETIC.kit48);
    expect(r).toMatchObject({ match: true, reasons: [] });
    expect(r.flags).toContain('non_binary_unverified');
  });
  it('flags rather than rejects: faster than 5600, unconfirmed kit layout', () => {
    expect(m(SYNTHETIC.fast64)).toMatchObject({ match: true, flags: expect.arrayContaining(['will_downclock']) });
    expect(m(SCAN.kit5200InStock).flags).not.toContain('will_downclock');
    expect(m(SYNTHETIC.marketing)).toMatchObject({ match: true, flags: expect.arrayContaining(['kit_unconfirmed', 'ecc_unstated']) });
  });
  it('rejects a title that does not say DDR generation (never guess)', () => {
    expect(m(SYNTHETIC.noGen).reasons.join()).toMatch(/generation .* not stated/);
  });
});

describe('bundles: a device sold WITH memory is not a memory kit (real eBay UK listing seen on the owner NAS, 2026-10-06)', () => {
  const MINI_PC = 'Minisforum Ar900i with Kingston Fury Impact 64gb (2x32) 5600Mt/s DDR5 SODIMM Mem';

  it('the Minisforum mini PC bundle (GBP 800) was wrongly accepted as a 64GB kit and is now rejected', () => {
    const l = classifyMemory(MINI_PC);
    expect(l).toMatchObject({ bundle: true, ddr: 5, formFactor: 'SODIMM', totalGb: 64 });   // the memory words are all there...
    const m = matchesProfile(l, N5_AIR_RAM);
    expect(m.match).toBe(false);                                                            // ...but it is not a kit
    expect(m.reasons.join()).toMatch(/bundle/);
  });

  it('"with" after memory words is an accessory, not a bundle', () => {
    expect(classifyMemory('Kingston FURY Impact 64GB (2x32GB) DDR5 5600 SODIMM with heatsink').bundle).toBe(false);
    expect(classifyMemory('64GB DDR5 SODIMM kit including free delivery').bundle).toBe(false);
  });

  it('a laptop or mini PC "with 64GB" is a bundle; titles without a joiner are not', () => {
    expect(classifyMemory('Dell Latitude laptop with 64GB DDR5 RAM').bundle).toBe(true);
    expect(classifyMemory(SCAN.kit5200InStock).bundle).toBe(false);
    expect(classifyMemory(SYNTHETIC.marketing).bundle).toBe(false);
  });

  it('real eBay kits from the same result set still match', () => {
    for (const t of [
      'Fanxiang 64GB (2x32GB) DDR5 5600MHz SO-DIMM Laptop RAM Memory Kit',
      'SK Hynix 2x 32GB (64GB) DDR5-5600MHZ SODIMM HMCG88AGBSA095N',
      'Origin Storage 64GB 2x32GB DDR5 5600MHz SODIMM 1Rx8 Non-ECC 1.1V',
    ]) expect(matchesProfile(classifyMemory(t), N5_AIR_RAM).match).toBe(true);
  });
});

describe('a whole computer is not a memory kit, even when it says "laptop" and states its RAM (found on the owner NAS, 2026-10-08)', () => {
  // Real JSON-LD name from buykingston.co.uk, captured 2026-10-08 (the page truncates it itself): GBP 2,056.63, out of stock.
  const THINKPAD = 'Lenovo ThinkPad P14s Gen 5 (Intel) Intel Core Ultra 7 155H Laptop 36.8 cm (14.5inch) WQXGA 64 GB DDR5-SDRAM 1 TB SSD NVIDIA RTX 500 Ada Wi-Fi 6E (802.';
  it('the ThinkPad read as "DDR5 SO-DIMM 64GB" before, and is now a bundle the N5 Air profile rejects', () => {
    const l = classifyMemory(THINKPAD);
    expect(l).toMatchObject({ ddr: 5, totalGb: 64, bundle: true });          // the memory words are all there; it is still a computer
    const m = matchesProfile(l, N5_AIR_RAM);
    expect(m.match).toBe(false);
    expect(m.reasons.join()).toMatch(/bundle/);
  });

  it('real laptop addresses from the same sitemap are bundles too (an Alienware with 64GB, a Lenovo V15 with 8GB)', () => {
    for (const slug of [
      'alienware aa18250 intel core ultra 9 275hx laptop 457 cm 18 wqxga 64 gb ddr5 sdram 2 tb ssd nvidia geforce rtx 5090 wi fi 7 80211be windows 11 home uk english black',
      'lenovo v v15 laptop 396 cm 156 full hd amd ryzen 5 7520u 8 gb lpddr5 sdram 512 gb ssd wi fi 5 80211ac windows 11 home black',
    ]) expect(classifyMemory(slug).bundle, slug).toBe(true);
  });

  it('a memory kit stays a memory kit however many spec words its marketing carries (constructed titles, labelled as such)', () => {
    // two markers (Core i7, Windows 11) but a kit's own wording: must NOT be hidden from alerts
    expect(classifyMemory('Crucial 64GB (2x32GB) DDR5-5600 Laptop Memory, for Intel Core i7 and Windows 11').bundle).toBe(false);
    expect(classifyMemory('Kingston FURY Impact 64GB DDR5 SODIMM kit, Windows 11 and Wi-Fi 6 laptops').bundle).toBe(false);
    expect(describesWholeComputer('Kingston FURY Impact 64GB (2x32GB) DDR5 SODIMM Wi-Fi')).toBe(false);
    expect(describesWholeComputer('Crucial 64GB DDR5 Laptop Memory for Windows 11')).toBe(false);   // one marker alone
    expect(describesWholeComputer('x ssd wi-fi')).toBe(true);
  });
});
