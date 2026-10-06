/**
 * Retailer search pages read through changedetection.io (research rows 28-31).
 *
 * Only Novatech so far: its search page needs a browser, which changedetection.io has and this app does not.
 * The app creates one watch per search URL (title prefixed "PCPC:", disable with config changedetection_autocreate=false),
 * asks it to recheck on every pass, and reads the previous snapshot. A snapshot older than max_offer_age_hours is an error,
 * never silently reused as if it were fresh.
 */
import * as db from '../db.js';
import { listWatches, createTextWatch, recheckWatch, getLatestSnapshot, norm } from './changedetection.js';
import { parseNovatechSnapshot } from './novatech-snapshot.js';
import { SEARCH_URLS, type RetailerId, type RetailerSearchResult } from './uk-retailers.js';

export const WATCHED_RETAILERS: RetailerId[] = ['novatech'];

/** null = this retailer is not read through a watch; the caller falls back to direct scraping. */
export async function searchViaWatch(id: RetailerId, query: string, now = Date.now()): Promise<RetailerSearchResult | null> {
  if (!WATCHED_RETAILERS.includes(id)) return null;
  const t0 = Date.now();
  const url = SEARCH_URLS[id]!(query);
  const done = (results: RetailerSearchResult['results'], error?: string): RetailerSearchResult =>
    ({ retailer: 'Novatech', results, scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0, error });

  const watch = (await listWatches()).find(w => norm(w.url) === norm(url));
  if (!watch) {
    if (db.getConfig('changedetection_autocreate') === 'false') return done([], 'no changedetection.io watch for this search and autocreate is off');
    await createTextWatch({ url, title: `PCPC: ${id} "${query}"`, browser: true });
    return done([], 'changedetection.io watch created; its first snapshot is pending');
  }
  await recheckWatch(watch.uuid).catch(() => {});   // the next pass reads the fresh snapshot
  const maxAgeMs = db.maxOfferAgeHours() * 3_600_000;
  const checkedMs = typeof watch.last_checked === 'number' ? watch.last_checked * 1000 : 0;
  if (!checkedMs) return done([], 'changedetection.io has not fetched this page yet');
  if (now - checkedMs > maxAgeMs) return done([], `changedetection.io snapshot is older than ${db.maxOfferAgeHours()}h (last checked ${new Date(checkedMs).toISOString()})`);
  if (watch.last_error) return done([], `changedetection.io could not fetch the page: ${String(watch.last_error).slice(0, 160)}`);
  const rows = parseNovatechSnapshot(await getLatestSnapshot(watch.uuid));
  return done(rows.map(r => ({
    retailer: 'Novatech', name: r.name, price: r.price, currency: 'GBP', inStock: r.stockState === 'in_stock',
    stockState: r.stockState, url, sku: r.stockCode, vatIncluded: true,
  })), rows.length === 0 ? 'snapshot contained no products' : undefined);
}
