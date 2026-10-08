/**
 * Memory listing classifier and hardware profile matching (tasks P1-1, P1-2).
 *
 * `classifyMemory` turns a product title into structured attributes; every field is null when the
 * title does not state it, never guessed. `matchesProfile` then decides whether a listing fits a
 * machine and returns the reasons and flags, so a rejection is explainable.
 */
import { findKnownMpn } from '../data/memory-mpns.js';

export interface MemoryListing {
  ddr: 4 | 5 | null;
  formFactor: 'SODIMM' | 'DIMM' | 'CAMM2' | null;
  /** true = ECC stated, false = "Non-ECC" stated, null = not stated. On-die ECC is ignored (all DDR5 has it). */
  ecc: boolean | null;
  registered: boolean | null;
  modules: number | null;
  moduleGb: number | null;
  totalGb: number | null;
  speedMts: number | null;
  cl: number | null;
  voltage: number | null;
  /**
   * The title sells another product WITH memory ("Minisforum Ar900i with Kingston Fury Impact 64gb ...").
   * True when "with / incl / including / plus" appears and nothing memory-related precedes it.
   */
  bundle: boolean;
}

const SIZES = new Set([2, 4, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256]);

function parseSpeed(t: string, ddr: 4 | 5 | null): number | null {
  const [lo, hi] = ddr === 4 ? [1600, 5000] : [3200, 9600];
  const inRange = (n: number) => n >= lo && n <= hi;
  // Explicit rating: "5600MHz", "5600 MT/s", "5600MTs"
  const explicit = t.match(/\b(\d{4})\s*(?:mt\/?s|mhz)\b/i);
  if (explicit && inRange(+explicit[1])) return +explicit[1];
  // JEDEC module name: PC5-44800 (MB/s, /8 gives MT/s), optionally followed by "(5600)"
  const pc = t.match(/\bPC[45]-?(\d{4,5})\b(?:\s*\(\s*(\d{4})\s*\))?/i);
  if (pc) {
    if (pc[2] && inRange(+pc[2])) return +pc[2];
    const derived = Math.round(+pc[1] / 8);
    if (inRange(derived)) return derived;
  }
  const ddrNum = t.match(/\bDDR[45][-\s](\d{4})\b/i);
  if (ddrNum && inRange(+ddrNum[1])) return +ddrNum[1];
  return null;
}

/**
 * A listing that is a whole computer states its RAM too ("... Laptop ... 64 GB DDR5-SDRAM 1 TB SSD ... Wi-Fi 6E"), and the word
 * "laptop" would otherwise make the classifier read it as SO-DIMM memory. Found 2026-10-08 on the owner's NAS: Buy Kingston's
 * sitemap census counted 128 laptops as DDR5 SO-DIMM products (two with 64GB), and one would have been read as a 64GB kit at GBP 2,056.63.
 * Two or more distinct computer-spec markers (storage, wireless, operating system, CPU model, graphics, screen) make it a bundle,
 * unless the title also has a memory kit's own wording (SO-DIMM, "kit", "2x32GB"): one marker alone is not enough either, because a kit can say
 * "for Intel Core" or "Windows".
 */
const COMPUTER_SPEC_MARKERS = [
  /\b(?:ssd|nvme|emmc|hdd)\b/i, /\bwi-?fi\b/i, /\bwindows\s?\d+\b|\bchrome\s?os\b|\bmacos\b/i,
  /\bcore\s+(?:ultra|i[3579])\b|\bryzen\s+[3579]\b|\bsnapdragon\b|\bceleron\b|\bpentium\b/i,
  /\b(?:rtx|gtx)\s?\d{3,4}|\bgeforce\b|\bradeon\s+(?:rx|graphics)\b/i,
  /\b(?:wuxga|wqxga|wqhd|qhd|fhd|full\s?hd|touch\s?screen|oled)\b|\d+(?:\.\d)?\s?(?:cm|inch|in)\s*\(/i,
];
/** Wording a memory kit has and a computer's title does not: it names SO-DIMM, says "kit", or gives a module count ("2x32GB"). */
const KIT_SHAPE = /so[\s-]?dimm|\bkit\b|\b\d\s*x\s*\d{1,3}\s*GB\b/i;
export function describesWholeComputer(text: string): boolean {
  if (KIT_SHAPE.test(text)) return false;   // a false "computer" verdict would hide a real kit from alerts, the worse mistake
  return COMPUTER_SPEC_MARKERS.filter(re => re.test(text)).length >= 2;
}

export function classifyMemory(title: string): MemoryListing {
  // Normalise separators and the multiplication sign; drop on-die ECC, which is not module ECC.
  const t = title.replace(/×/g, 'x').replace(/on[\s-]?die\s+ecc/gi, ' ');

  let ddr: 4 | 5 | null = null;
  const d = t.match(/\b(?:LP)?DDR\s?([45])\b/i) ?? t.match(/\bPC([45])-?\d{4,5}\b/i);
  if (d) ddr = d[1] === '5' ? 5 : 4;

  let formFactor: MemoryListing['formFactor'] = null;
  if (/\bcamm2?\b/i.test(t)) formFactor = 'CAMM2';
  else if (/so[\s-]?dimm/i.test(t)) formFactor = 'SODIMM';
  else if (/\b(?:u[\s-]?dimm|r[\s-]?dimm|dimm)\b/i.test(t)) formFactor = 'DIMM';
  else if (/\b(?:laptop|notebook)\b/i.test(t)) formFactor = 'SODIMM';
  else if (/\bdesktop\b/i.test(t)) formFactor = 'DIMM';

  const registered = /\b(?:registered|r[\s-]?dimm|rdimm)\b/i.test(t) ? true
    : /\b(?:unbuffered|u[\s-]?dimm)\b/i.test(t) ? false : null;
  let ecc: boolean | null = null;
  if (/non[\s-]?ecc/i.test(t)) ecc = false;
  else if (/\becc\b/i.test(t) || registered === true) ecc = true;

  let modules: number | null = null;
  let moduleGb: number | null = null;
  let totalGb: number | null = null;
  const kit = t.match(/(\d{1,3})\s*GB\s*\(?\s*(\d)\s*x\s*(\d{1,3})\s*GB\s*\)?/i);   // 64GB (2x32GB)
  const bare = t.match(/\b(\d)\s*x\s*(\d{1,3})\s*GB\b/i);                           // 2x32GB
  if (kit && +kit[2] * +kit[3] === +kit[1]) {
    totalGb = +kit[1]; modules = +kit[2]; moduleGb = +kit[3];
  } else if (bare && SIZES.has(+bare[2])) {
    modules = +bare[1]; moduleGb = +bare[2]; totalGb = modules * moduleGb;
  } else {
    const kitOf = t.match(/\bkit\s+of\s+(\d)\b/i);
    const gb = [...t.matchAll(/\b(\d{1,3})\s*GB\b(?!\s*\/\s*s)/gi)].map(m => +m[1]).find(n => SIZES.has(n));
    if (gb != null) {
      totalGb = gb;
      if (kitOf) { modules = +kitOf[1]; moduleGb = gb / modules; }
    }
  }

  // Bundle: "<device> with <memory>" (a mini PC or laptop sold with RAM is not a RAM kit).
  const joiner = t.match(/\b(?:with|incl\.?|including|plus)\b/i);
  const bundle = (!!joiner && joiner.index !== undefined
    && !/\b(?:ddr\s?\d?|so[\s-]?dimm|dimm|ram|memory|kit|modules?|\d+\s*gb)\b/i.test(t.slice(0, joiner.index)))
    || describesWholeComputer(t);

  const cl = t.match(/\bC(?:AS|L)\s?-?(\d{2})\b/i);
  const v = t.match(/\b(1\.\d{1,2})\s?V\b/i);

  const parsed: MemoryListing = {
    ddr, formFactor, ecc, registered, modules, moduleGb, totalGb,
    speedMts: parseSpeed(t, ddr),
    cl: cl ? +cl[1] : null,
    voltage: v ? +v[1] : null,
    bundle,
  };

  // A manufacturer part number named in the text is exact where the words are not (Box's address for a DDR5 kit says "ddr4").
  // The catalogue states generation, form factor and capacity only; ECC, CL and voltage stay as parsed, never guessed.
  const known = findKnownMpn(title);
  if (known && !bundle) {
    return { ...parsed, ddr: 5, formFactor: 'SODIMM', modules: known.modules, moduleGb: known.kitGb / known.modules,
      totalGb: known.kitGb, speedMts: parsed.speedMts ?? known.speedMts };
  }
  return parsed;
}

// ── Hardware profiles ──────────────────────────────────────────────────────

export interface MemoryProfile {
  id: string;
  label: string;
  ddr: 4 | 5;
  formFactor: 'SODIMM' | 'DIMM';
  allowEcc: boolean;
  slots: number;
  requireKit: boolean;
  maxTotalGb: number;
  maxSpeedMts: number;
  /** Accepted total capacities; `flag` is added to the result for capacities that are not verified. */
  acceptedTotalsGb: { gb: number; flag?: string }[];
}

/** Minisforum N5 Air: 2x DDR5 SO-DIMM, non-ECC, up to 96GB at 5600 MT/s (docs/RESEARCH_AND_VERIFICATION.md section 1). */
export const N5_AIR_RAM: MemoryProfile = {
  id: 'n5-air-ram',
  label: 'Minisforum N5 Air (DDR5 SO-DIMM, non-ECC, 2 slots)',
  ddr: 5, formFactor: 'SODIMM', allowEcc: false, slots: 2, requireKit: true,
  maxTotalGb: 96, maxSpeedMts: 5600,
  acceptedTotalsGb: [
    { gb: 64 },
    // Owner accepts 2x24GB as a fallback, but N5 Air compatibility with 24GB modules is Unverified.
    { gb: 48, flag: 'non_binary_unverified' },
  ],
};

/**
 * The 48GB (2x24GB) fallback the owner accepted (2026-10-06): a separate profile so the 48GB component only
 * ever reports 48GB kits and the 64GB one is not duplicated. Compatibility of 24GB modules is still Unverified.
 */
export const N5_AIR_RAM_48: MemoryProfile = {
  ...N5_AIR_RAM,
  id: 'n5-air-ram-48',
  label: 'Minisforum N5 Air, 48GB fallback (2x24GB DDR5 SO-DIMM, non-ECC)',
  acceptedTotalsGb: [{ gb: 48, flag: 'non_binary_unverified' }],
};

export const PROFILES: Record<string, MemoryProfile> = { [N5_AIR_RAM.id]: N5_AIR_RAM, [N5_AIR_RAM_48.id]: N5_AIR_RAM_48 };

export interface ProfileMatch { match: boolean; reasons: string[]; flags: string[]; }

export function matchesProfile(listing: MemoryListing, profile: MemoryProfile): ProfileMatch {
  const reasons: string[] = [];
  const flags: string[] = [];

  if (listing.ddr == null) reasons.push('memory generation (DDR4/DDR5) not stated');
  else if (listing.ddr !== profile.ddr) reasons.push(`DDR${listing.ddr}, need DDR${profile.ddr}`);

  if (listing.formFactor == null) reasons.push('form factor (SO-DIMM/DIMM) not stated');
  else if (listing.formFactor !== profile.formFactor) reasons.push(`${listing.formFactor}, need ${profile.formFactor}`);

  if (listing.bundle) reasons.push('bundle: memory sold with another product, not a memory kit');
  if (listing.registered === true) reasons.push('registered memory');
  if (listing.ecc === true && !profile.allowEcc) reasons.push('ECC memory, platform is non-ECC');
  if (listing.ecc === null && !profile.allowEcc) flags.push('ecc_unstated');

  if (listing.totalGb == null) reasons.push('capacity not stated');
  else {
    const accepted = profile.acceptedTotalsGb.find(a => a.gb === listing.totalGb);
    if (!accepted) reasons.push(`${listing.totalGb}GB total, accepted: ${profile.acceptedTotalsGb.map(a => a.gb + 'GB').join(' or ')}`);
    else if (accepted.flag) flags.push(accepted.flag);
    if (listing.totalGb > profile.maxTotalGb) reasons.push(`${listing.totalGb}GB exceeds the ${profile.maxTotalGb}GB maximum`);
  }

  if (listing.modules != null) {
    if (listing.modules > profile.slots) reasons.push(`${listing.modules} modules, only ${profile.slots} slots`);
    else if (profile.requireKit && listing.modules !== profile.slots) reasons.push(`${listing.modules} module(s), need a ${profile.slots}-module kit`);
  } else if (profile.requireKit) flags.push('kit_unconfirmed');

  if (listing.speedMts == null) flags.push('speed_unstated');
  else if (listing.speedMts > profile.maxSpeedMts) flags.push('will_downclock');

  return { match: reasons.length === 0, reasons, flags };
}
