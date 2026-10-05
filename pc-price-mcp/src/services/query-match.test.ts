import { describe, it, expect } from 'vitest';
import { matchesQuery } from './query-match.js';
import { SCAN } from '../test/fixtures.js';

const Q = 'ddr5 so-dimm 64gb';

describe('matchesQuery with real Scan titles', () => {
  it('accepts the 64GB DDR5 SO-DIMM kits', () => {
    expect(matchesQuery(SCAN.kit5600Backorder, Q)).toBe(true);
    expect(matchesQuery(SCAN.kit5200InStock, Q)).toBe(true);
  });
  it('rejects single 24GB sticks and DDR4 modules', () => {
    for (const t of [SCAN.single24_5200, SCAN.single24_4800, SCAN.single24_5600, SCAN.ddr4Samsung, SCAN.ddr4Corsair]) {
      expect(matchesQuery(t, Q)).toBe(false);
    }
  });
  it('treats SODIMM / SO-DIMM / "so dimm" alike', () => {
    expect(matchesQuery('64GB DDR5 SO DIMM kit', Q)).toBe(true);
    expect(matchesQuery('DDR5 SODIMM 64 GB', 'ddr5 so-dimm 64gb')).toBe(true);
  });
  it('does not match 164gb for 64gb', () => {
    expect(matchesQuery('164GB DDR5 SODIMM', Q)).toBe(false);
  });
  it('supports exclusion tokens and an empty query matches nothing', () => {
    expect(matchesQuery(SCAN.kit5200InStock, 'ddr5 64gb -ecc')).toBe(true);
    expect(matchesQuery('64GB DDR5 ECC SODIMM', 'ddr5 64gb -ecc')).toBe(false);
    expect(matchesQuery('64GB DDR5 Non ECC SODIMM', 'ddr5 64gb -ecc')).toBe(true);
    expect(matchesQuery(SCAN.kit5200InStock, '   ')).toBe(false);
  });
});
