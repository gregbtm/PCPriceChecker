// Merges results from the five independent search sources (direct retailer
// scrapes, PricesAPI, CeX, PCPartPicker UK, AWIN affiliate feed) into one
// list, using multiple signals to tell "the same listing" from "the same
// product at a different retailer" from "actually different products with
// similar names."
//
// Two stages, because those are two different questions:
//
//  1. Listing dedup — collapse offers that are really one physical listing
//     seen by more than one source, so it never shows up twice:
//       - exact-url:      normalized URL is identical
//       - retailer-price: same retailer name + price within 1%
//     Both use complete-link merging (see `mergePass`) so a match can't
//     transitively chain unrelated offers together through a third one.
//
//  2. Product clustering — group the now-deduped offers that are the same
//     product at genuinely different retailers, so comparison shopping still
//     works, using two signals in confidence order:
//       - ean:   identical EAN/barcode — a deterministic product identity,
//                so unlike the other signals it isn't gated on price at all
//                (only AWIN supplies EAN today; forward-compatible if any
//                other source starts returning one)
//       - fuzzy: name similarity >= 0.6 AND price within a 15% band
//     Complete-link again, and fuzzy is gated on both name *and* price so two
//     differently-priced variants (a 4070 vs a 4070 Ti) don't collapse just
//     because their names are nearly identical.
import type { RetailerSearchResult } from '../sources/uk-retailers.js';
import type { SearchProduct } from '../sources/pricesapi.js';
import type { CexProduct } from '../sources/cex.js';
import type { PcppProduct } from '../sources/pcpartpicker-live.js';
import type { AwinProduct } from '../sources/awin.js';

export type SearchSourceId = 'retailers' | 'pricesapi' | 'cex' | 'pcpartpicker' | 'awin';

export const SOURCE_LABELS: Record<SearchSourceId, string> = {
  retailers: 'Retailer scrape',
  pricesapi: 'PricesAPI',
  cex: 'CeX',
  pcpartpicker: 'PCPartPicker UK',
  awin: 'AWIN',
};

export interface UnifiedOffer {
  offerId: string;
  source: SearchSourceId;
  sourceLabel: string;
  retailer: string;
  name: string;
  price: number | null;
  currency: string;
  inStock: boolean;
  url: string | null;
  condition?: string;
  scrapedAt: string;
  /** Present only when listing dedup collapsed 2+ sources into this one offer. */
  confirmedBySources?: SearchSourceId[];
  /** EAN/barcode, when the source supplies one (currently AWIN only). */
  ean?: string;
  /** Product photo, when the source supplies one (currently AWIN only). */
  imageUrl?: string;
  /** Recommended retail price, when the source supplies one (currently AWIN only) — powers a "% off RRP" badge. */
  rrp?: number;
}

// 'ean' = grouped by a matching barcode — a deterministic identity, no
// "possibly the same" uncertainty. 'fuzzy' = grouped by name+price
// similarity, genuinely uncertain. 'single' = no match found. Listing-level
// dedup (exact-url / retailer-price) happens before clustering and never
// produces its own cluster — it shows up as `UnifiedOffer.confirmedBySources`
// instead.
export type ClusterConfidence = 'ean' | 'fuzzy' | 'single';

export interface OfferCluster {
  clusterId: string;
  displayName: string;
  offers: UnifiedOffer[];
  bestPrice: number | null;
  confidence: ClusterConfidence;
}

// ── Normalizers: raw source response → UnifiedOffer[] ───────────────────────

export function normalizeRetailerResults(results: RetailerSearchResult[], scrapedAt: string): UnifiedOffer[] {
  const offers: UnifiedOffer[] = [];
  for (const sr of results) {
    for (const r of sr.results) {
      offers.push({
        offerId: `retailers:${r.retailer}:${r.url ?? r.name}`,
        source: 'retailers',
        sourceLabel: SOURCE_LABELS.retailers,
        retailer: r.retailer,
        name: r.name,
        price: r.price,
        currency: r.currency,
        inStock: r.inStock,
        url: r.url ?? null,
        scrapedAt: sr.scrapedAt ?? scrapedAt,
      });
    }
  }
  return offers;
}

export function normalizePricesApiProducts(products: SearchProduct[], scrapedAt: string): UnifiedOffer[] {
  const offers: UnifiedOffer[] = [];
  for (const p of products) {
    for (const o of p.offers) {
      offers.push({
        offerId: `pricesapi:${o.merchant}:${o.url || p.url}`,
        source: 'pricesapi',
        sourceLabel: SOURCE_LABELS.pricesapi,
        retailer: o.merchant,
        name: p.name,
        price: o.price,
        currency: o.currency,
        inStock: o.inStock,
        url: o.url || p.url || null,
        condition: o.condition,
        scrapedAt,
      });
    }
  }
  return offers;
}

export function normalizeCexProducts(products: CexProduct[], scrapedAt: string): UnifiedOffer[] {
  return products.map(p => ({
    offerId: `cex:${p.boxId}`,
    source: 'cex',
    sourceLabel: SOURCE_LABELS.cex,
    retailer: 'CeX',
    name: p.boxName,
    price: p.sellPrice,
    currency: 'GBP',
    inStock: !p.outOfStock,
    url: p.url,
    condition: 'Used',
    scrapedAt,
  }));
}

export function normalizePcppProducts(products: PcppProduct[], scrapedAt: string): UnifiedOffer[] {
  const offers: UnifiedOffer[] = [];
  for (const p of products) {
    for (const price of p.prices) {
      offers.push({
        offerId: `pcpartpicker:${price.retailer}:${price.url ?? p.name}`,
        source: 'pcpartpicker',
        sourceLabel: SOURCE_LABELS.pcpartpicker,
        retailer: price.retailer,
        name: p.name,
        price: price.price,
        currency: price.currency,
        inStock: price.inStock,
        url: price.url,
        scrapedAt,
      });
    }
  }
  return offers;
}

export function normalizeAwinProducts(products: AwinProduct[], scrapedAt: string): UnifiedOffer[] {
  return products.map(p => ({
    offerId: `awin:${p.merchant}:${p.id || p.url}`,
    source: 'awin',
    sourceLabel: SOURCE_LABELS.awin,
    retailer: p.merchant,
    name: p.name,
    price: p.price,
    currency: p.currency,
    inStock: p.inStock,
    url: p.url || null,
    scrapedAt,
    ean: p.ean,
    imageUrl: p.imageUrl,
    rrp: p.rrp ?? undefined,
  }));
}

// ── Matching signals ─────────────────────────────────────────────────────────

function normalizeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, '');
    return `${u.hostname.replace(/^www\./, '')}${path}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function normalizeRetailerName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeProductName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    // Retailers glue model numbers together inconsistently ("RTX4070S" vs
    // "RTX 4070 SUPER") — split at letter/digit boundaries so both tokenize
    // to a comparable {rtx, 4070, s} set instead of one opaque blob.
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Jaccard similarity over word tokens — robust to word order and retailer boilerplate. */
function tokenSetSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeProductName(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeProductName(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = ta.size + tb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function priceWithin(a: number | null, b: number | null, tolerance: number): boolean {
  if (a == null || b == null) return false;
  if (a === 0 && b === 0) return true;
  const base = Math.max(a, b);
  return base > 0 && Math.abs(a - b) / base <= tolerance;
}

interface Group { members: number[] }

/**
 * Merge two groups only if EVERY item in A matches EVERY item in B under
 * `test` (complete-link). Plain single-link union-find would let a strong
 * match on one pair drag in everything transitively reachable through it —
 * e.g. A~B on price, B~C on name, so A and C end up together despite never
 * actually matching each other. Complete-link keeps a group's members
 * mutually consistent with the signal that formed it.
 */
function allPairsMatch<T>(a: number[], b: number[], items: T[], test: (x: T, y: T) => boolean): boolean {
  for (const i of a) for (const j of b) if (!test(items[i], items[j])) return false;
  return true;
}

function mergeGroups<T>(groups: Group[], items: T[], test: (x: T, y: T) => boolean): Group[] {
  let current = groups;
  let mergedAny = true;
  while (mergedAny) {
    mergedAny = false;
    outer: for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        if (allPairsMatch(current[i].members, current[j].members, items, test)) {
          current = [
            ...current.slice(0, i), ...current.slice(i + 1, j), ...current.slice(j + 1),
            { members: [...current[i].members, ...current[j].members] },
          ];
          mergedAny = true;
          break outer;
        }
      }
    }
  }
  return current;
}

const sameNormalizedUrl = (x: UnifiedOffer, y: UnifiedOffer) => {
  const ux = normalizeUrl(x.url);
  return ux !== null && ux === normalizeUrl(y.url);
};

const sameRetailerClosePrice = (x: UnifiedOffer, y: UnifiedOffer) => {
  const rx = normalizeRetailerName(x.retailer);
  return rx !== '' && rx === normalizeRetailerName(y.retailer) && priceWithin(x.price, y.price, 0.01);
};

const sameProductFuzzy = (x: UnifiedOffer, y: UnifiedOffer) => (
  tokenSetSimilarity(x.name, y.name) >= 0.6 && priceWithin(x.price, y.price, 0.15)
);

// EAN equality is a true equivalence relation (transitive), same as URL
// equality in the listing-dedup stage — safe to merge without a price gate,
// since a barcode match means "the same product" regardless of price drift
// between retailers.
const sameEan = (x: UnifiedOffer, y: UnifiedOffer) => !!x.ean && x.ean === y.ean;

function hasEanPair(offers: UnifiedOffer[]): boolean {
  for (let i = 0; i < offers.length; i++) {
    for (let j = i + 1; j < offers.length; j++) {
      if (sameEan(offers[i], offers[j])) return true;
    }
  }
  return false;
}

/** Stage 1: collapse offers that are really one physical listing seen by more than one source. */
function dedupeListings(offers: UnifiedOffer[]): UnifiedOffer[] {
  let groups: Group[] = offers.map((_, i) => ({ members: [i] }));
  groups = mergeGroups(groups, offers, sameNormalizedUrl);
  groups = mergeGroups(groups, offers, sameRetailerClosePrice);

  return groups.map(g => {
    const members = g.members.map(i => offers[i]);
    if (members.length === 1) return members[0];
    // Freshest scrape wins as the representative copy (name/price/stock).
    const representative = members.reduce((latest, o) => (o.scrapedAt > latest.scrapedAt ? o : latest), members[0]);
    const sources = [...new Set(members.map(o => o.source))];
    return { ...representative, offerId: members.map(o => o.offerId).sort().join('+'), confirmedBySources: sources };
  });
}

// ── Clustering ───────────────────────────────────────────────────────────────

export function clusterOffers(rawOffers: UnifiedOffer[]): OfferCluster[] {
  const offers = dedupeListings(rawOffers);

  // Stage 2: group the now-deduped offers into products across retailers.
  // EAN match first — it's a deterministic identity, not gated on price —
  // then fuzzy name+price for offers that didn't share a barcode.
  let groups: Group[] = offers.map((_, i) => ({ members: [i] }));
  groups = mergeGroups(groups, offers, sameEan);
  groups = mergeGroups(groups, offers, sameProductFuzzy);

  const result: OfferCluster[] = groups.map((g, idx) => {
    const clusterOffersList = g.members.map(i => offers[i]).sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
    const confidence: ClusterConfidence = clusterOffersList.length === 1 ? 'single' : (hasEanPair(clusterOffersList) ? 'ean' : 'fuzzy');
    const priced = clusterOffersList.filter(o => o.inStock && o.price != null).map(o => o.price as number);
    const bestPrice = priced.length > 0 ? Math.min(...priced) : null;
    const displayName = clusterOffersList.reduce((longest, o) => (o.name.length > longest.length ? o.name : longest), clusterOffersList[0].name);
    return {
      clusterId: `cluster-${idx}`,
      displayName,
      offers: clusterOffersList,
      bestPrice,
      confidence,
    };
  });

  result.sort((a, b) => {
    if (a.bestPrice == null && b.bestPrice == null) return b.offers.length - a.offers.length;
    if (a.bestPrice == null) return 1;
    if (b.bestPrice == null) return -1;
    return a.bestPrice - b.bestPrice;
  });

  return result;
}
