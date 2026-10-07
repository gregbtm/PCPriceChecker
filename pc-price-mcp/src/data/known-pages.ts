/**
 * Retailer product pages for known DDR5 SO-DIMM kits, each opened and read on `checkedOn`. Retailer sitemaps do NOT list them all
 * (Box's sitemap has 6,803 addresses and none of these; the pages themselves answer HTTP 200 with JSON-LD price and availability),
 * so "absent from the sitemap" never proves "not sold". Tracking the page directly is the reliable path.
 *
 * Prices seen on `checkedOn` are in the note for context only; they are never used by the code.
 */
export interface KnownPage {
  mpn: string; retailer: string; url: string; kitGb: number; checkedOn: string; note: string;
}

export const KNOWN_PAGES: KnownPage[] = [
  { mpn: 'CT2K32G56C46S5', retailer: 'box.co.uk', kitGb: 64, checkedOn: '2026-10-07', url: 'https://box.co.uk/ct2k32g56c46s5-crucial-64gb-5600-ddr4-laptop-memory', note: '885.71 GBP, out of stock (JSON-LD)' },
  { mpn: 'KF556S40IBK2-64', retailer: 'box.co.uk', kitGb: 64, checkedOn: '2026-10-07', url: 'https://box.co.uk/kf556s40ibk2-64-kingston-technology-fury-impact', note: '1149.87 GBP, out of stock (JSON-LD)' },
  { mpn: 'CT2K32G56C46S5', retailer: 'laptopoutlet.co.uk', kitGb: 64, checkedOn: '2026-10-07', url: 'https://www.laptopoutlet.co.uk/crucial-64gb-ct2k32g56c46s5.html', note: '885.71 GBP, out of stock (JSON-LD)' },
  { mpn: 'KF556S40IBK2-64', retailer: 'laptopoutlet.co.uk', kitGb: 64, checkedOn: '2026-10-07', url: 'https://www.laptopoutlet.co.uk/kingston-impact-kf556s40ibk2-64.html', note: '919.98 GBP, out of stock (JSON-LD)' },
  { mpn: 'CT2K32G56C46S5', retailer: 'awd-it.co.uk', kitGb: 64, checkedOn: '2026-10-07', url: 'https://www.awd-it.co.uk/crucial-64gb-2x32gb-ddr5-5600mt-s-cl46-sodimm-memory-black.html', note: 'page showed "Coming Soon", no price, no JSON-LD' },
];

export function knownPagesFor(sizesGb: number[]): KnownPage[] {
  return KNOWN_PAGES.filter(p => sizesGb.includes(p.kitGb));
}
