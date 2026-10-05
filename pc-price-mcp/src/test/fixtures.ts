/** Listing titles copied verbatim from Scan.co.uk, 2026-10-05 (docs/RESEARCH_AND_VERIFICATION.md section 2). */
export const SCAN = {
  kit5600Backorder: '64GB (2x32GB) CORSAIR DDR5 Vengeance SODIMM, PC5-44800 (5600), Non-ECC Unbuffered, CAS 48, 1.1V., XMP 3.0',
  kit5200InStock: '64GB (2x32GB) CORSAIR DDR5 Vengeance SODIMM, PC5-41600 (5200), Non-ECC Unbuffered, CAS 44, 1.1V',
  single24_5200: '24GB (1x24GB) CORSAIR DDR5 Vengeance SODIMM, PC5-41600 (5200), Non-ECC Unbuffered, CAS 44, 1.1V',
  single24_4800: '24GB (1x24GB) CORSAIR DDR5 Vengeance SODIMM, PC5-38400 (4800), Non-ECC Unbuffered, CAS 40, 1.1V',
  single24_5600: '24GB (1x24GB) CORSAIR DDR5 Vengeance SODIMM, PC5-44800 (5600), Non-ECC Unbuffered, CAS 48, 1.1V',
  ddr4Samsung: '4GB (1x4GB) Samsung DDR4 SO-DIMM M471A5244CB0, PC4-19200 (2400), Non-ECC Unbuffered, CAS 17, 1.2V',
  ddr4Corsair: '4GB (1x4GB) Corsair DDR4 SODIMM Value Select, PC4-17000 (2133), Non-ECC Unbuffered, CAS 15-15-15-36, 1.2V',
};

export function ldJson(data: unknown): string {
  return `<html><head><script type="application/ld+json">${JSON.stringify(data)}</script></head><body></body></html>`;
}

/** Titles NOT taken from a retailer page: constructed to cover cases the real fixtures lack. Labelled as such in tests. */
export const SYNTHETIC = {
  desktop64: '64GB (2x32GB) Corsair Vengeance DDR5 DIMM, PC5-44800 (5600), Non-ECC Unbuffered, CAS 40, 1.25V',
  desktopUdimm: 'Kingston FURY Beast 64GB 2x32GB 6000MT/s DDR5 CL36 UDIMM',
  eccSodimm: 'Kingston Server Premier 64GB (2x32GB) DDR5 5600MT/s ECC SODIMM',
  rdimm: '64GB DDR5 4800MHz ECC Registered RDIMM',
  camm2: 'Crucial 64GB DDR5 CAMM2 7500MT/s',
  kit48: '48GB (2x24GB) Kingston FURY Impact DDR5 5600MT/s SODIMM CL40',
  single64: 'Crucial 64GB DDR5-5600 SODIMM CL46 (1x64GB)',
  marketing: 'CORSAIR Vengeance Black 64GB 5600MHz DDR5 SODIMM Memory for 14th Gen Intel S/HX refresh CPU',
  fast64: 'G.Skill Ripjaws 64GB (2x32GB) DDR5-6400 SO-DIMM CL38 1.35V',
  noGen: '64GB (2x32GB) SODIMM memory kit',
};
