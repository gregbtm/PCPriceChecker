/**
 * Product discovery from a retailer's own sitemap, instead of its search page (research row 36).
 *
 * Why: AWD-IT's robots.txt disallows every query string, Novatech's disallows /search.html, Overclockers' and CCL's disallow /search.
 * A sitemap is the file a site publishes for crawlers, and ordinary product pages are allowed on all of them. So for retailers listed
 * in SITEMAPS we read the sitemap (cached 24 h), keep the product addresses whose slug looks like a candidate (the same memory
 * classifier used for listings, applied to the slug), and read those few product pages like any other tracked URL (JSON-LD, 2 s apart).
 *
 * Verified 2026-10-07: AWD-IT's sitemap index lists 5,705 addresses in two files (12.9 MB); the DDR5 SO-DIMM kits show up by slug, for
 * example `crucial-64gb-2x32gb-ddr5-5600mt-s-cl46-sodimm-memory-black.html`. Unverified: Novatech's `sitemap-products.xml` (named in its
 * robots.txt) could not be fetched from the build environment, and the product-page reads on the live NAS.
 */
import * as db from '../db.js';
import { assertAllowedByRobots, RobotsDisallowedError } from '../services/robots.js';
import { classifyMemory, matchesProfile, PROFILES } from '../services/memory-classifier.js';
import { matchesQuery } from '../services/query-match.js';
import type { RetailerId, RetailerResult, RetailerSearchResult } from './uk-retailers.js';
import type { ScrapedProduct } from './url-scraper.js';

export const SITEMAPS: Partial<Record<RetailerId, { retailer: string; urls: string[] }>> = {
  awdit: { retailer: 'AWD-IT', urls: ['https://www.awd-it.co.uk/media/sitemap/sitemap.xml'] },
  novatech: { retailer: 'Novatech', urls: ['https://www.novatech.co.uk/sitemap-products.xml'] },
};

const TTL_MS = 24 * 3_600_000;
const MAX_BYTES = 40_000_000;
const MAX_CHILD_SITEMAPS = 8;
export const MAX_CANDIDATES = 12;
const PAGE_GAP_MS = 2_000;

const cache = new Map<string, { at: number; urls: string[] }>();
export function clearSitemapCache(): void { cache.clear(); }

export function parseSitemapLocs(xml: string): { locs: string[]; isIndex: boolean } {
  const locs = [...xml.matchAll(/<loc>\s*([^<\s][^<]*?)\s*<\/loc>/g)].map(m => m[1].replace(/&amp;/g, '&'));
  return { locs, isIndex: /<sitemapindex[\s>]/.test(xml) };
}

async function fetchXml(url: string, fetchFn: typeof fetch): Promise<string> {
  await assertAllowedByRobots(url, fetchFn);
  const res = await fetchFn(url, { headers: { 'User-Agent': 'PCPriceChecker (self-hosted price tracker)', Accept: 'application/xml,text/xml' }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`sitemap HTTP ${res.status}`);
  const len = Number(res.headers?.get?.('content-length') ?? 0);
  if (len > MAX_BYTES) throw new Error(`sitemap too large (${len} bytes)`);
  return res.text();
}

export async function loadSitemapUrls(id: RetailerId, fetchFn: typeof fetch = fetch, now = Date.now()): Promise<string[]> {
  const cfg = SITEMAPS[id];
  if (!cfg) return [];
  const hit = cache.get(id);
  if (hit && now - hit.at < TTL_MS) return hit.urls;
  const out: string[] = [];
  for (const root of cfg.urls) {
    const first = parseSitemapLocs(await fetchXml(root, fetchFn));
    if (!first.isIndex) { out.push(...first.locs); continue; }
    for (const child of first.locs.slice(0, MAX_CHILD_SITEMAPS)) out.push(...parseSitemapLocs(await fetchXml(child, fetchFn)).locs);
  }
  cache.set(id, { at: now, urls: out });
  return out;
}

/**
 * The product address as words. Every path segment counts, not just the last: Novatech's descriptive slug is the SECOND to last
 * (`/products/klevv-cras-v-rgb-64gb-2x32gb-6000mhz-cl30-memory-ram-kit/kd5bgua80-60a300g.html`, last = the manufacturer code), and
 * reading only the last segment meant it never matched anything (found from the owner's first pass, 2026-10-07: `search:novatech` ok with 0 offers).
 * A leading `products` is dropped. AWD-IT's single-segment slugs are unchanged.
 */
export function slugText(url: string): string {
  try {
    const segs = new URL(url).pathname.split('/').filter(Boolean).map(x => decodeURIComponent(x).replace(/\.html?$/i, ''));
    return segs.filter((x, i) => !(i === 0 && x.toLowerCase() === 'products')).join(' ').replace(/[-_]+/g, ' ');
  } catch { return ''; }
}

/** Addresses worth reading for this component: the profile (when it has one) decides on the slug, else every query word must be in it. */
export function candidateUrls(urls: string[], component: Pick<db.TrackedComponent, 'search_query' | 'profile_id'>, limit = MAX_CANDIDATES): string[] {
  const profile = component.profile_id ? PROFILES[component.profile_id] : undefined;
  const out: string[] = [];
  for (const u of urls) {
    const text = slugText(u);
    if (!text) continue;
    const ok = profile ? matchesProfile(classifyMemory(text), profile).match : matchesQuery(text, component.search_query);
    if (ok) out.push(u);
    if (out.length >= limit) break;
  }
  return out;
}

export interface SitemapDeps {
  fetchFn?: typeof fetch;
  scrapeUrl: (url: string) => Promise<ScrapedProduct>;
  sleep: (ms: number) => Promise<void>;
}

/** null when the retailer has no sitemap entry (the caller falls back to its normal search). */
export async function searchViaSitemap(
  id: RetailerId, component: Pick<db.TrackedComponent, 'search_query' | 'profile_id'>, deps: SitemapDeps,
): Promise<RetailerSearchResult | null> {
  const cfg = SITEMAPS[id];
  if (!cfg) return null;
  const t0 = Date.now();
  const done = (results: RetailerResult[], error?: string, emptyIsOk = false): RetailerSearchResult =>
    ({ retailer: cfg.retailer, results, scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0, error, emptyIsOk });

  let urls: string[];
  try { urls = await loadSitemapUrls(id, deps.fetchFn); }
  catch (e) { return done([], `sitemap: ${e instanceof RobotsDisallowedError ? e.message : (e as Error).message}`); }

  const candidates = candidateUrls(urls, component);
  if (candidates.length === 0) return done([], undefined, true);   // healthy: nothing in the catalogue looks like this component today

  const results: RetailerResult[] = [];
  for (const [i, url] of candidates.entries()) {
    if (i > 0) await deps.sleep(PAGE_GAP_MS);
    let p: ScrapedProduct;
    try { p = await deps.scrapeUrl(url); } catch { continue; }
    if (p.price == null || !(p.price > 0) || p.currency !== 'GBP') continue;
    const name = p.name && p.name !== new URL(url).hostname.replace(/^www\./, '') ? p.name : slugText(url);
    results.push({ retailer: cfg.retailer, name, price: p.price, currency: 'GBP', inStock: p.inStock, stockState: p.stockState, url });
  }
  return results.length > 0 ? done(results) : done([], `${candidates.length} candidate page(s) found in the sitemap but none gave a price`);
}
