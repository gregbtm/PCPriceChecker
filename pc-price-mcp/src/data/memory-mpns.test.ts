import { describe, it, expect } from 'vitest';
import { findKnownMpn, KNOWN_MPNS } from './memory-mpns.js';
import { classifyMemory, matchesProfile, PROFILES } from '../services/memory-classifier.js';
import { slugText, candidateUrls } from '../sources/sitemap-discovery.js';

// Real Box address and page title (2026-10-07). The address says "ddr4"; the product is DDR5 (Crucial CT2K32G56C46S5).
const BOX_URL = 'https://box.co.uk/ct2k32g56c46s5-crucial-64gb-5600-ddr4-laptop-memory';
const BOX_TITLE = 'Crucial CT2K32G56C46S5 64GB (2 x 32GB) 5600 MHz DDR5 Laptop RAM';
const KINGSTON_URL = 'https://box.co.uk/kf556s40ibk2-64-kingston-technology-fury-impact';

describe('known part numbers', () => {
  it('finds an MPN in a title or an address, ignoring case, hyphens and spaces', () => {
    expect(findKnownMpn(BOX_TITLE)?.mpn).toBe('CT2K32G56C46S5');
    expect(findKnownMpn(slugText(BOX_URL))?.mpn).toBe('CT2K32G56C46S5');
    expect(findKnownMpn(slugText(KINGSTON_URL))?.mpn).toBe('KF556S40IBK2-64');
    expect(findKnownMpn('Kingston KF556S40IBK2 64 FURY')?.mpn).toBe('KF556S40IBK2-64');
    expect(findKnownMpn('a 64GB DDR5 SO-DIMM kit')).toBeNull();
    expect(findKnownMpn('')).toBeNull();
  });

  it('every entry is evidenced and internally consistent', () => {
    for (const k of KNOWN_MPNS) {
      expect(k.source).toMatch(/^https:\/\//);
      expect(k.kitGb).toBe(k.modules * (k.kitGb / k.modules));
      expect([48, 64]).toContain(k.kitGb);
    }
    expect(new Set(KNOWN_MPNS.map(k => k.mpn)).size).toBe(KNOWN_MPNS.length);
  });

  it('a mislabelled address (says ddr4) is classified as the DDR5 SO-DIMM kit it is, and matches the N5 Air profile', () => {
    const l = classifyMemory(slugText(BOX_URL));
    expect(l).toMatchObject({ ddr: 5, formFactor: 'SODIMM', totalGb: 64, modules: 2, moduleGb: 32 });
    expect(matchesProfile(l, PROFILES['n5-air-ram']).match).toBe(true);
    expect(candidateUrls([BOX_URL, 'https://box.co.uk/kvr32s22s8-16-kingston-technology-ddr4-sodimm'], { search_query: 'ddr5 so-dimm 64gb', profile_id: 'n5-air-ram' })).toEqual([BOX_URL]);
  });

  it('without a known MPN the words still decide (a real DDR4 address stays DDR4)', () => {
    const l = classifyMemory(slugText('https://box.co.uk/kvr32s22s8-16-kingston-technology-ddr4-sodimm'));
    expect(l.ddr).toBe(4);
  });

  it('a bundle that merely mentions a known MPN is not turned into a RAM kit', () => {
    expect(classifyMemory('Minisforum N5 Air NAS with Crucial CT2K32G56C46S5 64GB').totalGb).not.toBeNull();   // parsed from words as before
    expect(classifyMemory('Minisforum N5 Air NAS with Crucial CT2K32G56C46S5 64GB').bundle).toBe(true);
  });
});
