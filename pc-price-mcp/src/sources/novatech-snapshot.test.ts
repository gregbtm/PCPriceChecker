import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';
import { parseNovatechSnapshot, novatechStock } from './novatech-snapshot.js';
import { classifyMemory, matchesProfile, PROFILES } from '../services/memory-classifier.js';

const SNAP = readFileSync(new URL('../test/fixtures/novatech-search-snapshot.txt', import.meta.url), 'utf8');

describe('Novatech snapshot parser (real captured text)', () => {
  const rows = parseNovatechSnapshot(SNAP);
  it('reads each product once, with the inc-VAT price', () => {
    expect(rows.map(r => [r.name, r.price])).toEqual([
      ['KLEVV CRAS V RGB 64GB (2x32GB) 6000Mhz CL30 Memory (RAM) Kit', 839.99],
      ['G.Skill Trident Z5 RGB 64GB (2x32GB) DDR5 6000Mhz CL36 Dual Channel Memory (RAM) Kit', 999.98],
      ['MSI A520M-A PRO AMD A520 Chipset (Socket AM4) Micro-ATX Motherboard', 49.98],
    ]);
  });
  it('"Ordered Upon Request" is not in stock; "Only 5 left" is; "Dispatches within" is unknown', () => {
    expect(rows.map(r => r.stockState)).toEqual(['backorder', 'in_stock', 'unknown']);
    expect(novatechStock('Dispatches within 1 - 3 Days £7.99 Next Day Delivery')).toBe('unknown');
    expect(novatechStock('Out of stock £7.99 Next Day Delivery')).toBe('out_of_stock');
  });
  it('the desktop DIMM kits are rejected by the SO-DIMM profile, so none of this could alert', () => {
    for (const r of rows) expect(matchesProfile(classifyMemory(r.name), PROFILES['n5-air-ram']).match).toBe(false);
  });
  it('returns nothing for a page with no products', () => {
    expect(parseNovatechSnapshot('Login or sign up\nNo results')).toEqual([]);
  });
});
