/**
 * Refresh one tracked component (extracted from the scheduler so it can be tested, P0-8 / P0-9).
 *
 * Tiers, first that applies (a component with `search_also` set runs 1 and then 2 and 3):
 *  1. The component's own URLs (component_urls / source_url), scraped one by one.
 *  2. Key-less: direct UK retailer searches, kept only if the title matches the component's query.
 *  3. Optional: PricesAPI, only when PRICES_API_KEY is configured. Never required.
 *
 * Every source attempt writes a scrape_runs row; a thrown error is a failed run, not a silent skip.
 */
import * as db from '../db.js';
import type { notifyAll } from '../notifications.js';
import type { ScrapedProduct } from '../sources/url-scraper.js';
import type { RetailerId, RetailerSearchResult } from '../sources/uk-retailers.js';
import type { EbayBrowseResult, EbayListing } from '../sources/ebay-browse.js';
import { evaluateAlerts } from './alerts.js';
import type { Verdict } from './verify-offer.js';
import { alertOnRepeatedFailures, inBackoff } from './scrape-health.js';
import { pricesApiPause, pausePricesApi, pricesApiDue, markPricesApiRun } from './pricesapi-guard.js';
import { PricesApiError } from '../sources/pricesapi.js';
import { matchesQuery } from './query-match.js';
import { mpnQueries, mpnDue, markMpnRun } from './ebay-queries.js';
import { classifyMemory, matchesProfile, PROFILES } from './memory-classifier.js';

export interface RefreshDeps {
  scrapeUrl: (url: string) => Promise<ScrapedProduct>;
  searchRetailer: (id: RetailerId, query: string) => Promise<RetailerSearchResult>;
  /** Returns offers, or throws. Only called when pricesApiConfigured() is true. */
  searchPricesApi: (query: string, country: string) => Promise<db.PriceSnapshot[]>;
  pricesApiConfigured: () => boolean;
  /** Optional eBay tier (official Browse API, needs free developer keys). Absent/unconfigured = skipped. */
  searchEbay?: (query: string) => Promise<EbayBrowseResult>;
  ebayConfigured?: () => boolean;
  /** Optional changedetection.io tier: the latest reading of a watch on this URL, or null. Absent = skipped. */
  readWatch?: (url: string) => Promise<{ price: number; inStock: boolean; checkedAt: number | null } | null>;
  changedetectionConfigured?: () => boolean;
  /** Search pages read through a changedetection.io watch; null = not handled, use searchRetailer. */
  searchViaWatch?: (id: RetailerId, query: string) => Promise<RetailerSearchResult | null>;
  /** Retailer catalogue read through its sitemap and product pages (robots.txt-compliant replacement for a search page); null = not handled. */
  searchViaSitemap?: (id: RetailerId, component: db.TrackedComponent) => Promise<RetailerSearchResult | null>;
  /** Re-reads an offer at its source just before an alert is sent; absent = no check. */
  verifyOffer?: (offer: db.PriceRecord) => Promise<Verdict>;
  notify: typeof notifyAll;
  sleep: (ms: number) => Promise<void>;
}

export interface RefreshContext {
  country: string;
  dropThresholdPct: number;
  retailers: RetailerId[];
}

/**
 * Mainstream general-PC retailers searched by default; brand-only shops are opt-in via config.
 * Aria is not here: it closed its online shop in August 2022 (its homepage says so, checked 2026-10-06).
 */
export const DEFAULT_SEARCH_RETAILERS: RetailerId[] = [
  'scan', 'overclockers', 'ebuyer', 'ccl', 'box', 'novatech', 'awdit', 'wired2fire',
];   // Currys left out 2026-10-07: Cloudflare challenge, and its scraper calls a private JSON endpoint with a spoofed Referer
const RETAILER_GAP_MS = 2_000;
const EBAY_MPN_GAP_MS = 1_000;

/**
 * Listing attributes for a component with a hardware profile (P1-3, P1-5). Returns {} when the
 * component has no (known) profile, in which case callers fall back to the interim query filter.
 */
function profileAttrs(component: db.TrackedComponent, name: string | undefined, price: number): Partial<db.PriceSnapshot> {
  const profile = component.profile_id ? PROFILES[component.profile_id] : undefined;
  if (!profile || !name) return {};
  const listing = classifyMemory(name);
  const m = matchesProfile(listing, profile);
  const flags = [...m.flags];
  // A price far below what this capacity has ever sold for is more likely a scam or a wrong listing
  // than a bargain. Never hidden: flagged so the alert says so.
  const floor = Number(db.getConfig('suspicious_price_per_gb') ?? 2);
  if (m.match && listing.totalGb && price / listing.totalGb < floor) flags.push('suspiciously_cheap');
  return {
    listingName: name, kitTotalGb: listing.totalGb, modules: listing.modules,
    profileMatch: m.match, profileFlags: flags,
  };
}

/**
 * eBay listings that can be a purchase price: fixed price (not an auction bid), priced in GBP,
 * not "for parts or not working" (conditionId 7000), and not known to ship from outside the UK.
 */
export function eligibleEbayListing(l: EbayListing): boolean {
  return l.price != null && l.price > 0 && l.currency === 'GBP' && l.buyItNow
    && l.conditionId !== '7000' && (!l.location || l.location === 'GB');
}

/** Caveats the buyer must see: eBay prices exclude delivery, and most conditions are not "new". */
export function ebayFlags(l: EbayListing): string[] {
  // Delivery is only a caveat when eBay did not state it; a stated charge travels as `deliveryCost` instead (P5-3).
  const flags: string[] = l.shippingCost == null ? ['delivery_excluded'] : [];
  if (l.conditionId !== '1000' && l.conditionId !== '1500') flags.push('used_condition');
  if (l.feedbackPct != null && l.feedbackPct < 98) flags.push('seller_feedback_low');
  return flags;
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function refreshComponent(
  component: db.TrackedComponent, ctx: RefreshContext, deps: RefreshDeps,
): Promise<{ snapshots: number }> {
  // Non-matching listings (profile_match 0) must not drive restock/stock-change events.
  const prevLatest = db.getLatestPricePerRetailer(component.id).filter(r => r.profile_match !== 0);
  const prevBestPrice = db.getBestInStockOffer(component.id)?.price ?? null;
  const stockKey = (retailer: string, url: string | null | undefined) => `${retailer}|${url ?? ''}`;
  const prevStockMap = new Map(prevLatest.map(r => [stockKey(r.retailer, r.url), r.in_stock === 1]));

  const snapshots: db.PriceSnapshot[] = [];
  const attempted: string[] = [];

  /** Returns false when the source was skipped because it is backing off (see scrape-health.ts), true when it ran. */
  async function attempt(source: string, run: () => Promise<{ offers: db.PriceSnapshot[]; error?: string }>): Promise<boolean> {
    if (inBackoff(source)) return false;
    attempted.push(source);
    const t0 = Date.now();
    try {
      const { offers, error } = await run();
      snapshots.push(...offers);
      db.recordScrapeRun({ componentId: component.id, source, durationMs: Date.now() - t0,
        ok: !error, error, offersFound: offers.length });
    } catch (e) {
      db.recordScrapeRun({ componentId: component.id, source, durationMs: Date.now() - t0,
        ok: false, error: msg(e), offersFound: 0 });
    }
    return true;
  }

  const componentUrls = db.getComponentUrls(component.id);
  const urls = componentUrls.length > 0
    ? componentUrls.map(u => ({ url: u.url, retailer: u.retailer ?? undefined }))
    : component.source_url ? [{ url: component.source_url, retailer: undefined }] : [];

  if (urls.length > 0) {
    for (const { url, retailer } of urls) {
      const domain = retailer ?? (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'url'; } })();
      // A changedetection.io watch on this exact URL (it can render JS pages) is read first when configured.
      if (deps.readWatch && deps.changedetectionConfigured?.() && /\.uk$/i.test(domain.split('/')[0])) {
        let reading: Awaited<ReturnType<NonNullable<typeof deps.readWatch>>> = null;
        await attempt(`changedetection:${domain}`, async () => {
          reading = await deps.readWatch!(url);
          if (!reading) return { offers: [] };   // no watch on this URL (yet): not a failure, fall through to direct scraping
          const state = reading.inStock ? 'in_stock' as const : 'out_of_stock' as const;
          return { offers: [{ source: 'changedetection', price: reading.price, currency: 'GBP',
            retailer: domain, url, inStock: reading.inStock, stockState: state }] };
        });
        if (reading) continue;
      }
      await attempt(`url:${domain}`, async () => {
        const scraped = await deps.scrapeUrl(url);
        if (scraped.price == null) return { offers: [], error: scraped.failure ?? 'no price extracted from page' };
        return { offers: [{ source: scraped.method, price: scraped.price, currency: scraped.currency,
          retailer: domain, url, inStock: scraped.inStock, stockState: scraped.stockState,
          ...profileAttrs(component, scraped.name, scraped.price) }] };
      });
    }
  }
  // Own URLs replace the searches unless the component opts in to both (`search_also`): pinning known product pages must not
  // silently switch eBay and the retailer searches off.
  if (urls.length === 0 || component.search_also === 1) {
    for (const id of ctx.retailers) {
      const ran = await attempt(`search:${id}`, async () => {
        const viaWatch = deps.searchViaWatch && deps.changedetectionConfigured?.() ? await deps.searchViaWatch(id, component.search_query) : null;
        const viaSitemap = !viaWatch && deps.searchViaSitemap ? await deps.searchViaSitemap(id, component) : null;
        const r = viaWatch ?? viaSitemap ?? await deps.searchRetailer(id, component.search_query);
        // Nothing parsed = the scraper (or the site) is broken. Parsed but nothing relevant = healthy.
        if (r.results.length === 0) return r.emptyIsOk && !r.error ? { offers: [] } : { offers: [], error: r.error ?? 'no products parsed' };
        const hasProfile = !!(component.profile_id && PROFILES[component.profile_id]);
        // With a profile the classifier decides (non-matching rows are stored but never alert);
        // without one, the interim query-word filter keeps unrelated products out entirely.
        const offers = r.results
          .filter(x => x.price != null && x.price > 0 && x.currency === 'GBP' && (hasProfile || matchesQuery(x.name, component.search_query)))
          .map(x => ({ source: `uk-retailer:${id}`, price: x.price as number, currency: x.currency,
            retailer: r.retailer, url: x.url, inStock: x.inStock, stockState: x.stockState,
            ...(x.vatIncluded != null ? { vatIncluded: x.vatIncluded } : {}),
            ...profileAttrs(component, x.name, x.price as number) }));
        return { offers };
      });
      if (ran) await deps.sleep(RETAILER_GAP_MS);
    }
    if (deps.searchEbay && deps.ebayConfigured?.()) {
      await attempt('ebay', async () => {
        const r = await deps.searchEbay!(component.search_query);
        if (r.error) return { offers: [], error: r.error };
        // Part-number queries (ebay-queries.ts): find listings whose titles do not say "SO-DIMM". A failed extra query never fails the run.
        const extra = mpnQueries(component);
        if (extra.length > 0 && mpnDue(component.id)) {
          markMpnRun(component.id);
          const seen = new Set(r.listings.map(l => l.itemId));
          for (const mpn of extra) {
            await deps.sleep(EBAY_MPN_GAP_MS);
            try {
              const more = await deps.searchEbay!(mpn);
              if (more.error) continue;
              for (const l of more.listings) if (!seen.has(l.itemId)) { seen.add(l.itemId); r.listings.push(l); }
            } catch { /* keep what the main query found */ }
          }
        }
        const hasProfile = !!(component.profile_id && PROFILES[component.profile_id]);
        const offers = r.listings.filter(eligibleEbayListing)
          .filter(l => hasProfile || matchesQuery(l.title, component.search_query))
          .map(l => {
            const attrs = profileAttrs(component, l.title, l.price as number);
            return {
              source: 'ebay', price: l.price as number, currency: 'GBP', retailer: 'eBay UK', url: l.url,
              inStock: true, stockState: 'in_stock' as const, listingName: l.title, ...attrs,
              deliveryCost: l.shippingCost ?? null,
              profileFlags: [...(attrs.profileFlags ?? []), ...ebayFlags(l)],
            };
          });
        return { offers };
      });
      await deps.sleep(RETAILER_GAP_MS);
    }
    // Optional and metered (10 credits per search with offers): skipped while paused for exhausted credits, and at most once a day per component.
    if (deps.pricesApiConfigured() && !pricesApiPause() && pricesApiDue(component.id)) {
      markPricesApiRun(component.id);
      await attempt('pricesapi', async () => {
        try {
          return { offers: await deps.searchPricesApi(component.search_query, ctx.country) };
        } catch (e) {
          if (e instanceof PricesApiError && e.kind === 'quota') {
            pausePricesApi(e);
            await deps.notify({ type: 'scrape_failure', componentName: 'PricesAPI', message: e.message });
          }
          throw e;
        }
      });
    }
  }

  await alertOnRepeatedFailures(component, attempted, deps.notify);

  if (snapshots.length === 0) {
    db.markScrapeFailed(component.id);
    return { snapshots: 0 };
  }
  db.clearScrapeFailed(component.id);

  for (const snap of snapshots) {
    if (snap.profileMatch === false) continue;
    const wasInStock = prevStockMap.get(stockKey(snap.retailer, snap.url));
    if (wasInStock === true && !snap.inStock) {
      db.recordStockChange(component.id, snap.retailer, true, false, snap.price);
    } else if (wasInStock === false && snap.inStock) {
      db.recordStockChange(component.id, snap.retailer, false, true, snap.price);
      if (db.isOnWaitlist(component.id, snap.retailer, snap.price)) {
        await deps.notify({ type: 'restock', componentName: component.name,
          price: snap.price, currency: snap.currency, retailer: snap.retailer, url: snap.url });
      }
    }
  }

  db.savePriceSnapshots(component.id, snapshots);
  db.markLastChecked(component.id);
  await evaluateAlerts({ component, prevBestPrice, dropThresholdPct: ctx.dropThresholdPct, notify: deps.notify, verify: deps.verifyOffer });
  return { snapshots: snapshots.length };
}

