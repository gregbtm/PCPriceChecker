import { describe, it, expect } from 'vitest';
import { checkCompatibility, detectMobileCpu } from './compatibility.js';

// RAM titles are the real Scan.co.uk / eBay listings from docs/RESEARCH_AND_VERIFICATION.md section 2.
const SODIMM_64 = '64GB (2x32GB) CORSAIR DDR5 Vengeance SODIMM, PC5-44800 (5600), Non-ECC Unbuffered, CAS 48, 1.1V., XMP 3.0';
const DDR4_SODIMM = '32GB (2x16GB) Samsung DDR4 SODIMM 3200MHz Non-ECC';
const DESKTOP_DIMM = 'Kingston Beast 64GB (2x32GB) DDR5 6000MHz CL36 DIMM Desktop Memory';
// `psu_not_specified` is the existing advisory for any list without a PSU; it is unrelated to these rules.
const types = (r: ReturnType<typeof checkCompatibility>) => [...r.issues, ...r.warnings].map(i => i.type).filter(t => t !== 'psu_not_specified');

describe('P1-4 mobile / mini-PC platforms', () => {
  it('recognises the Ryzen 7 255 class and mobile H/U parts, and not desktop chips', () => {
    expect(detectMobileCpu('AMD Ryzen 7 255')).toBe(true);
    expect(detectMobileCpu('Ryzen 5 240')).toBe(true);
    expect(detectMobileCpu('AMD Ryzen 7 7840HS')).toBe(true);
    expect(detectMobileCpu('AMD Ryzen 7 8845HS')).toBe(true);
    expect(detectMobileCpu('Intel Core Ultra 7 155H')).toBe(true);
    for (const desktop of ['AMD Ryzen 7 7700X', 'AMD Ryzen 9 9950X3D', 'AMD Ryzen 5 5600X', 'Ryzen 5 2600', 'Intel Core i7-14700K'])
      expect(detectMobileCpu(desktop)).toBe(false);
  });
  it('the Ryzen 7 255 takes DDR5 SO-DIMM without complaint', () => {
    const r = checkCompatibility({ cpu: 'AMD Ryzen 7 255', ram: SODIMM_64 });
    expect(r.isCompatible).toBe(true);
    expect(types(r)).toEqual([]);
  });
  it('rejects DDR4 SO-DIMM and a desktop DIMM for a Ryzen 7 255', () => {
    expect(types(checkCompatibility({ cpu: 'AMD Ryzen 7 255', ram: DDR4_SODIMM }))).toContain('memory_platform_mismatch');
    const d = checkCompatibility({ cpu: 'AMD Ryzen 7 255', ram: DESKTOP_DIMM });
    expect(d.isCompatible).toBe(false);
    expect(types(d)).toContain('form_factor_mismatch');
  });
});

describe('P1-4 form factor, ECC, slots, capacity', () => {
  it('SO-DIMM in a desktop motherboard is an error; desktop DIMM in it is not', () => {
    expect(types(checkCompatibility({ motherboard: 'MSI MAG B650 TOMAHAWK WIFI', ram: SODIMM_64 }))).toContain('form_factor_mismatch');
    expect(types(checkCompatibility({ motherboard: 'MSI MAG B650 TOMAHAWK WIFI', ram: DESKTOP_DIMM }))).not.toContain('form_factor_mismatch');
  });
  it('explicit ECC memory warns; non-ECC does not', () => {
    expect(types(checkCompatibility({ ram: '32GB DDR5 4800 ECC Unbuffered DIMM' }))).toContain('ecc_unsupported');
    expect(types(checkCompatibility({ ram: SODIMM_64 }))).not.toContain('ecc_unsupported');
  });
  it('slot count and maximum capacity apply only when the caller supplies them', () => {
    expect(types(checkCompatibility({ ram: SODIMM_64 }))).toEqual([]);
    expect(types(checkCompatibility({ ram: SODIMM_64, ramSlots: 1 }))).toContain('ram_slots_exceeded');
    expect(types(checkCompatibility({ ram: SODIMM_64, maxMemoryGb: 32 }))).toContain('ram_capacity_exceeded');
    expect(checkCompatibility({ ram: SODIMM_64, ramSlots: 2, maxMemoryGb: 96 }).isCompatible).toBe(true);
  });
});

describe('existing desktop rules are unchanged', () => {
  it('still flags a socket mismatch and a DDR4 board with DDR5 RAM', () => {
    expect(types(checkCompatibility({ cpu: 'AMD Ryzen 7 7700X', motherboard: 'MSI B550 Gaming' }))).toContain('socket_mismatch');
    expect(types(checkCompatibility({ motherboard: 'ASUS PRIME B550-PLUS', ram: DESKTOP_DIMM }))).toContain('memory_standard_mismatch');
  });
  it('a Ryzen 7 7840HS is no longer misread as an AM5 desktop chip', () => {
    expect(types(checkCompatibility({ cpu: 'AMD Ryzen 7 7840HS', motherboard: 'MSI B550 Gaming' }))).not.toContain('socket_mismatch');
  });
});
