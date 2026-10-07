/**
 * Manufacturer part numbers (MPNs) of DDR5 SO-DIMM kits, and what each one IS.
 *
 * Why: a part number identifies a product exactly, a title or a URL slug only describes it. Box's own address for Crucial's DDR5 kit is
 * `/ct2k32g56c46s5-crucial-64gb-5600-ddr4-laptop-memory` (says "ddr4"; the product page says DDR5, checked 2026-10-07), so a classifier that
 * trusts the slug rejects the one kit we want. When a known MPN appears in a title or address, this table is authoritative for the fields it
 * states (generation, form factor, capacity, modules). Anything it does not state stays null, as the classifier never guesses.
 *
 * `evidence`: 'page' = a retailer product page showing this MPN was opened (url given); 'listing' = seen on a PriceSpy listing of this
 * part number (2026-10-07), not opened on a retailer page. Nothing here comes from memory. Add entries only with evidence.
 * The N5 Air takes DDR5 SO-DIMM non-ECC up to 96GB total at 5600 MT/s (https://www.minisforum.uk/products/minisforum-n5-air, read 2026-10-07).
 */
export interface KnownMpn {
  mpn: string;
  brand: string;
  kitGb: number;
  modules: number;
  speedMts: number;
  evidence: 'page' | 'listing';
  source: string;
}

const PS = 'https://pricespy.co.uk/s/ddr5-so-dimm-64gb/';

export const KNOWN_MPNS: KnownMpn[] = [
  // 64GB (2 x 32GB)
  { mpn: 'CT2K32G56C46S5', brand: 'Crucial', kitGb: 64, modules: 2, speedMts: 5600, evidence: 'page', source: 'https://box.co.uk/ct2k32g56c46s5-crucial-64gb-5600-ddr4-laptop-memory' },
  { mpn: 'CT2K32G52C42S5', brand: 'Crucial', kitGb: 64, modules: 2, speedMts: 5200, evidence: 'listing', source: PS },
  { mpn: 'CT2K32G48C40S5', brand: 'Crucial', kitGb: 64, modules: 2, speedMts: 4800, evidence: 'listing', source: PS },
  { mpn: 'KF556S40IBK2-64', brand: 'Kingston', kitGb: 64, modules: 2, speedMts: 5600, evidence: 'page', source: 'https://box.co.uk/kf556s40ibk2-64-kingston-technology-fury-impact' },
  { mpn: 'KVR56S46BD8K2-64', brand: 'Kingston', kitGb: 64, modules: 2, speedMts: 5600, evidence: 'listing', source: 'https://pricespy.co.uk/product.php?p=12983529' },
  { mpn: 'CMSX64GX5M2A5600C48', brand: 'Corsair', kitGb: 64, modules: 2, speedMts: 5600, evidence: 'listing', source: PS },
  { mpn: 'CMSX64GX5M2A5200C44', brand: 'Corsair', kitGb: 64, modules: 2, speedMts: 5200, evidence: 'listing', source: PS },
  { mpn: 'F5-5600S4645A32GX2-RS', brand: 'G.Skill', kitGb: 64, modules: 2, speedMts: 5600, evidence: 'page', source: 'https://arvutitark.ee/en/pc-components/memory-ram/soram-gskill-d5-5600-64gb-c46-ripjaws-1272660' },
  { mpn: 'F5-4800S4039A32GX2-RS', brand: 'G.Skill', kitGb: 64, modules: 2, speedMts: 4800, evidence: 'listing', source: PS },
  { mpn: 'TED564G5600C46DC-S01', brand: 'TeamGroup', kitGb: 64, modules: 2, speedMts: 5600, evidence: 'page', source: 'https://www.teamgroupinc.com/en/product-detail/memory/TEAMGROUP/elite-so-dimm-ddr5/elite-so-dimm-ddr5-TED564G5600C46DC-S01/' },
  { mpn: 'TED564G5600C46ADC-S01', brand: 'TeamGroup', kitGb: 64, modules: 2, speedMts: 5600, evidence: 'page', source: 'https://www.teamgroupinc.com/en/product-detail/memory/TEAMGROUP/elite-so-dimm-ddr5/elite-so-dimm-ddr5-TED564G5600C46DC-S01/' },
  { mpn: 'TED564G5200C42DC-S01', brand: 'TeamGroup', kitGb: 64, modules: 2, speedMts: 5200, evidence: 'page', source: 'https://www.teamgroupinc.com/en/product-detail/memory/TEAMGROUP/elite-so-dimm-ddr5/elite-so-dimm-ddr5-TED564G5600C46DC-S01/' },
  { mpn: 'TED564G4800C40DC-S01', brand: 'TeamGroup', kitGb: 64, modules: 2, speedMts: 4800, evidence: 'page', source: 'https://www.teamgroupinc.com/en/product-detail/memory/TEAMGROUP/elite-so-dimm-ddr5/elite-so-dimm-ddr5-TED564G5600C46DC-S01/' },
  { mpn: 'IN5V32GNJRDXK2', brand: 'Integral', kitGb: 64, modules: 2, speedMts: 5600, evidence: 'page', source: 'https://www.integralmemory.com/where-to-buy/' },
  // 48GB (2 x 24GB)
  { mpn: 'CMSX48GX5M2A5600C48', brand: 'Corsair', kitGb: 48, modules: 2, speedMts: 5600, evidence: 'listing', source: PS },
  { mpn: 'CMSX48GX5M2A5200C44', brand: 'Corsair', kitGb: 48, modules: 2, speedMts: 5200, evidence: 'listing', source: PS },
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const INDEX = KNOWN_MPNS.map(k => ({ k, key: norm(k.mpn) }));

/** The known kit named anywhere in `text` (title, URL slug, JSON-LD mpn), ignoring case, hyphens and spaces; null when none. */
export function findKnownMpn(text: string): KnownMpn | null {
  const t = norm(text);
  if (t.length < 8) return null;
  return INDEX.find(x => t.includes(x.key))?.k ?? null;
}
