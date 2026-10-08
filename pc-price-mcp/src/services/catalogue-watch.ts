/**
 * Catalogue watch: what a retailer's own sitemap says it sells, kept as a census and diffed day to day.
 *
 * Why (the reliability gap this closes): "searched, found 0" cannot tell "the shop has none" from "we could not see". The census makes the
 * first answer a number you can read ("4,673 products, 1 DDR5 SO-DIMM listing") and turns the rare event we actually care about, a shop adding
 * a 64GB or 48GB DDR5 SO-DIMM product, into a notification that costs one cached sitemap read per day and no product-page requests.
 *
 * Stored per retailer in the config table (key `catalogue:<id>`), so no migration. The first observation is a baseline and never notifies.
 */
import * as db from '../db.js';
import type { notifyAll } from '../notifications.js';
import { classifyMemory } from './memory-classifier.js';

type Notify = typeof notifyAll;

export interface CatalogueCensus {
  at: string;                 // ISO time of the sitemap read this was counted from
  total: number;              // every product address in the sitemap
  sodimm: string[];           // addresses whose slug reads as a DDR5 SO-DIMM product (any capacity)
}

/** Kits of at least this many GB are the ones worth a notification when they first appear. */
export const NOTABLE_MIN_GB = 48;

const key = (id: string) => `catalogue:${id}`;

/** Slug text -> is it a DDR5 SO-DIMM product? The same classifier as for listings, so the two cannot disagree. */
const SODIMM_WORDING = /so[\s-]?dimm|(?:laptop|notebook)\s+(?:memory|ram)/i;
export function isDdr5Sodimm(slug: string): boolean {
  const m = classifyMemory(slug);
  // The census counts memory products, so the address must SAY so-dimm (or laptop memory): the classifier also reads the bare word
  // "laptop" as SO-DIMM, which made a 15,727-address catalogue that sells laptops report 144 products where 16 are memory.
  return m.ddr === 5 && m.formFactor === 'SODIMM' && !m.bundle && SODIMM_WORDING.test(slug);
}

export function takeCensus(urls: string[], slug: (u: string) => string, now = new Date()): CatalogueCensus {
  return { at: now.toISOString(), total: urls.length, sodimm: urls.filter(u => { const s = slug(u); return !!s && isDdr5Sodimm(s); }) };
}

export function loadCensus(id: string): CatalogueCensus | null {
  const raw = db.getConfig(key(id));
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as CatalogueCensus;
    return Array.isArray(c.sodimm) && typeof c.total === 'number' ? c : null;
  } catch { return null; }
}

/** Kit size in GB read from the slug, or null when it does not state one. */
export function kitGb(slug: string): number | null { return classifyMemory(slug).totalGb; }

/**
 * Record today's census and notify about notable products not in the previous one.
 * Returns the new addresses (all capacities) so callers and tests can see what changed.
 */
export async function observeCatalogue(
  id: string, retailer: string, urls: string[], slug: (u: string) => string, notify: Notify, now = new Date(),
): Promise<{ added: string[]; baseline: boolean }> {
  // A sitemap that suddenly lists almost nothing is a broken read, not a retailer deleting its catalogue: keep the old census.
  const prev = loadCensus(id);
  if (prev && prev.total > 100 && urls.length < prev.total * 0.2) return { added: [], baseline: false };

  const next = takeCensus(urls, slug, now);
  db.setConfig(key(id), JSON.stringify(next));
  if (!prev) return { added: [], baseline: true };

  const seen = new Set(prev.sodimm);
  const added = next.sodimm.filter(u => !seen.has(u));
  const notable = added.filter(u => (kitGb(slug(u)) ?? 0) >= NOTABLE_MIN_GB);
  if (notable.length > 0) {
    await notify({
      type: 'new_product', componentName: `${retailer}: new DDR5 SO-DIMM product${notable.length > 1 ? 's' : ''}`,
      retailer, url: notable[0],
      message: notable.slice(0, 5).map(u => `- ${slug(u)} (${u})`).join('\n') +
        '\nFound in the shop\'s sitemap, not yet checked for price or stock; the next refresh reads the page.',
    });
  }
  return { added, baseline: false };
}

/** One line per retailer for /api/health and the dashboard. */
export function catalogueSummary(ids: string[], slug: (u: string) => string): Array<{ source: string; checked_at: string; products: number; ddr5_sodimm: number; kits_48gb_plus: number }> {
  const out = [];
  for (const id of ids) {
    const c = loadCensus(id);
    if (!c) continue;
    out.push({
      source: id, checked_at: c.at, products: c.total, ddr5_sodimm: c.sodimm.length,
      kits_48gb_plus: c.sodimm.filter(u => (kitGb(slug(u)) ?? 0) >= NOTABLE_MIN_GB).length,
    });
  }
  return out;
}
