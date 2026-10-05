/**
 * Refresh one tracked component (extracted from the scheduler so it can be tested, P0-8 / P0-9).
 *
 * Tiers, first that applies:
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
import { evaluateAlerts } from './alerts.js';
import { alertOnRepeatedFailures } from './scrape-health.js';
import { matchesQuery } from './query-match.js';

export interface RefreshDeps {
  scrapeUrl: (url: string) => Promise<ScrapedProduct>;
  searchRetailer: (id: RetailerId, query: string) => Promise<RetailerSearchResult>;
  /** Returns offers, or throws. Only called when pricesApiConfigured() is true. */
  searchPricesApi: (query: string, country: string) => Promise<db.PriceSnapshot[]>;
  pricesApiConfigured: () => boolean;
  notify: typeof notifyAll;
  sleep: (ms: number) => Promise<void>;
}

export interface RefreshContext {
  country: string;
  dropThresholdPct: number;
  retailers: RetailerId[];
}

/** Mainstream general-PC retailers searched by default; brand-only shops are opt-in via config. */
export const DEFAULT_SEARCH_RETAILERS: RetailerId[] = [
  'scan', 'overclockers', 'ebuyer', 'ccl', 'box', 'novatech', 'aria', 'awdit', 'currys',
];
const RETAILER_GAP_MS = 2_000;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function refreshComponent(
  component: db.TrackedComponent, ctx: RefreshContext, deps: RefreshDeps,
): Promise<{ snapshots: number }> {
  const prevLatest = db.getLatestPricePerRetailer(component.id);
  const prevBestPrice = db.getBestInStockOffer(component.id)?.price ?? null;
  const prevStockMap = new Map(prevLatest.map(r => [r.retailer, r.in_stock === 1]));

  const snapshots: db.PriceSnapshot[] = [];
  const attempted: string[] = [];

  async function attempt(source: string, run: () => Promise<{ offers: db.PriceSnapshot[]; error?: string }>) {
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
  }

  const componentUrls = db.getComponentUrls(component.id);
  const urls = componentUrls.length > 0
    ? componentUrls.map(u => ({ url: u.url, retailer: u.retailer ?? undefined }))
    : component.source_url ? [{ url: component.source_url, retailer: undefined }] : [];

  if (urls.length > 0) {
    for (const { url, retailer } of urls) {
      const domain = retailer ?? (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'url'; } })();
      await attempt(`url:${domain}`, async () => {
        const scraped = await deps.scrapeUrl(url);
        if (scraped.price == null) return { offers: [], error: 'no price extracted from page' };
        return { offers: [{ source: scraped.method, price: scraped.price, currency: scraped.currency,
          retailer: domain, url, inStock: scraped.inStock, stockState: scraped.stockState }] };
      });
    }
  } else {
    for (const id of ctx.retailers) {
      await attempt(`search:${id}`, async () => {
        const r = await deps.searchRetailer(id, component.search_query);
        // Nothing parsed = the scraper (or the site) is broken. Parsed but nothing relevant = healthy.
        if (r.results.length === 0) return { offers: [], error: r.error ?? 'no products parsed' };
        const offers = r.results
          .filter(x => x.price != null && x.price > 0 && x.currency === 'GBP' && matchesQuery(x.name, component.search_query))
          .map(x => ({ source: `uk-retailer:${id}`, price: x.price as number, currency: x.currency,
            retailer: r.retailer, url: x.url, inStock: x.inStock, stockState: x.stockState }));
        return { offers };
      });
      await deps.sleep(RETAILER_GAP_MS);
    }
    if (deps.pricesApiConfigured()) {
      await attempt('pricesapi', async () => ({ offers: await deps.searchPricesApi(component.search_query, ctx.country) }));
    }
  }

  await alertOnRepeatedFailures(component, attempted, deps.notify);

  if (snapshots.length === 0) {
    db.markScrapeFailed(component.id);
    return { snapshots: 0 };
  }
  db.clearScrapeFailed(component.id);

  for (const snap of snapshots) {
    const wasInStock = prevStockMap.get(snap.retailer);
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
  await evaluateAlerts({ component, prevBestPrice, dropThresholdPct: ctx.dropThresholdPct, notify: deps.notify });
  return { snapshots: snapshots.length };
}

