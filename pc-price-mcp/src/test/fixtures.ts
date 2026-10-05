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
