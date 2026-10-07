/**
 * WooCommerce Store API source (research row 39): the JSON a WooCommerce shop's own storefront already calls,
 * `GET /wp-json/wc/store/v1/products?search=...`. Structured price and stock, no HTML parsing, and, unlike a search page,
 * allowed by the shop's robots.txt (checked before every call). Honest User-Agent; no retry; one request per search.
 *
 * Verified 2026-10-07 against wired2fire.co.uk (live response, fixture `wired2fire-store-api-so-dimm.json`): the 64GB (2 x 32GB)
 * DDR5-5600 SO-DIMM kit came back at 60000 minor units (= GBP 600.00) with `is_in_stock: true` AND `is_on_backorder: true`.
 * That pair is exactly the trap this module exists to get right: WooCommerce reports backordered goods as in stock, so a naive
 * reading would alert on something that cannot ship. Backorder is its own state here and never alerts.
 */
import { assertAllowedByRobots, RobotsDisallowedError } from '../services/robots.js';
import type { RetailerResult, RetailerSearchResult } from './uk-retailers.js';
import type { StockState } from '../services/stock-state.js';

export const WOO_STORES: Record<string, { retailer: string; base: string }> = {
  wired2fire: { retailer: 'Wired2Fire', base: 'https://wired2fire.co.uk' },
};

const UA = 'PCPriceChecker (self-hosted price tracker; github.com/gregbtm/PCPriceChecker)';

interface WooProduct {
  name?: string; permalink?: string; sku?: string;
  is_in_stock?: boolean; is_on_backorder?: boolean; is_purchasable?: boolean;
  stock_availability?: { class?: string } | null;
  prices?: { price?: string; currency_code?: string; currency_minor_unit?: number } | null;
}

/** WooCommerce says "in stock" for backordered goods; `is_on_backorder` (or the availability class) decides. */
export function wooStockState(p: Pick<WooProduct, 'is_in_stock' | 'is_on_backorder' | 'is_purchasable' | 'stock_availability'>): StockState {
  if (p.is_on_backorder || /backorder/i.test(p.stock_availability?.class ?? '')) return 'backorder';
  if (p.is_in_stock === true && p.is_purchasable !== false) return 'in_stock';
  if (p.is_in_stock === false) return 'out_of_stock';
  return 'unknown';
}

/** Price in major units from the Store API's integer string and minor-unit exponent; null when absent or not positive. */
export function wooPrice(p: WooProduct): number | null {
  const raw = p.prices?.price;
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n / Math.pow(10, p.prices?.currency_minor_unit ?? 2);
}

/** A Store API text search matches every word, so a long query finds nothing: search the one distinctive word. */
export function wooSearchTerm(query: string): string {
  const q = query.toLowerCase();
  if (/so-?\s?dimm/.test(q)) return 'so-dimm';
  const words = q.split(/\s+/).filter(w => w.length > 2);
  return words[0] ?? query;
}

export async function searchWooStore(id: string, query: string, fetchFn: typeof fetch = fetch): Promise<RetailerSearchResult> {
  const cfg = WOO_STORES[id];
  const t0 = Date.now();
  const done = (results: RetailerResult[], error?: string, emptyIsOk = false): RetailerSearchResult =>
    ({ retailer: cfg?.retailer ?? id, results, scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0, error, emptyIsOk });
  if (!cfg) return done([], `unknown WooCommerce store "${id}"`);

  const url = `${cfg.base}/wp-json/wc/store/v1/products?search=${encodeURIComponent(wooSearchTerm(query))}&per_page=40`;
  try {
    await assertAllowedByRobots(url, fetchFn);
    const res = await fetchFn(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return done([], `HTTP ${res.status}`);
    const body = await res.json() as unknown;
    // A challenge page or an error object is not a product list: a failure, never a clean empty result.
    if (!Array.isArray(body)) return done([], 'Store API did not return a product list (blocked, disabled or changed?)');
    const results: RetailerResult[] = [];
    for (const p of body as WooProduct[]) {
      const price = wooPrice(p);
      if (price == null || !p.name || !p.permalink) continue;
      if ((p.prices?.currency_code ?? 'GBP') !== 'GBP') continue;
      const state = wooStockState(p);
      results.push({ retailer: cfg.retailer, name: p.name, price, currency: 'GBP', inStock: state === 'in_stock', stockState: state, url: p.permalink, sku: p.sku });
    }
    return done(results, undefined, results.length === 0);   // a valid empty list is "nothing matching today"
  } catch (e) {
    return done([], e instanceof RobotsDisallowedError ? e.message : (e as Error).message);
  }
}
