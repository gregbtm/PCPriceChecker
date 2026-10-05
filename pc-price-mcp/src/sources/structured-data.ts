/**
 * One JSON-LD / schema.org implementation for every scraper (audit A-05, task P0-5).
 *
 * Handles @graph, @type arrays, ProductGroup/hasVariant, Offer arrays, AggregateOffer
 * (lowPrice and nested offers), priceSpecification (ignoring list/strikethrough prices),
 * comma-formatted price strings and schema.org availability URLs.
 */
import { stockStateFromAvailability, type StockState } from '../services/stock-state.js';
import { isAcceptableCurrency } from '../services/price-text.js';

export interface StructuredOffer {
  price: number;
  /** Currency as stated by the page; null when absent. */
  currency: string | null;
  stockState: StockState;
  url?: string;
}

export interface StructuredProduct {
  name?: string;
  url?: string;
  sku?: string;
  image?: string;
  offers: StructuredOffer[];
}

type Json = Record<string, unknown>;

const MAX_DEPTH = 8;
const REFERENCE_PRICE_TYPES = /list|strikethrough|msrp|srp|rrp|was|original/i;

function typesOf(node: Json): string[] {
  const t = node['@type'];
  const arr = Array.isArray(t) ? t : t != null ? [t] : [];
  return arr.map(x => String(x).replace(/^https?:\/\/schema\.org\//i, ''));
}

function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/[^0-9.]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

function str(v: unknown): string | undefined {
  return v == null || typeof v === 'object' ? undefined : String(v);
}

function offerPrice(offer: Json): { price: number | null; currency: string | null } {
  let currency = str(offer.priceCurrency) ?? null;
  let price = toNumber(offer.price);
  if (price == null) {
    for (const spec of asArray(offer.priceSpecification as Json | Json[] | undefined)) {
      if (!spec || typeof spec !== 'object') continue;
      if (REFERENCE_PRICE_TYPES.test(String(spec.priceType ?? ''))) continue;
      const p = toNumber(spec.price);
      if (p != null) { price = p; currency = currency ?? str(spec.priceCurrency) ?? null; break; }
    }
  }
  if (price == null) price = toNumber(offer.lowPrice);
  return { price, currency };
}

function collectOffers(rawOffers: unknown): StructuredOffer[] {
  const out: StructuredOffer[] = [];
  for (const o of asArray(rawOffers as Json | Json[])) {
    if (!o || typeof o !== 'object') continue;
    const nested = collectOffers(o.offers);
    if (nested.length > 0) { out.push(...nested); continue; }   // AggregateOffer with real offers
    const { price, currency } = offerPrice(o);
    if (price == null) continue;
    out.push({ price, currency, stockState: stockStateFromAvailability(o.availability), url: str(o.url) });
  }
  return out;
}

function firstImage(v: unknown): string | undefined {
  const f = asArray(v as unknown)[0];
  if (typeof f === 'string') return f;
  if (f && typeof f === 'object') return str((f as Json).url);
  return undefined;
}

function walk(node: unknown, found: StructuredProduct[], depth: number): void {
  if (depth > MAX_DEPTH || node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, found, depth + 1); return; }
  const obj = node as Json;
  const types = typesOf(obj);
  if (types.includes('Product') || types.includes('ProductGroup')) {
    const offers = collectOffers(obj.offers);
    if (offers.length > 0) {
      found.push({
        name: str(obj.name), url: str(obj.url), sku: str(obj.sku) ?? str(obj.mpn),
        image: firstImage(obj.image), offers,
      });
    }
    for (const variant of asArray(obj.hasVariant as unknown)) walk(variant, found, depth + 1);
  }
  for (const key of ['@graph', 'mainEntity', 'itemListElement', 'item']) {
    if (obj[key] != null) walk(obj[key], found, depth + 1);
  }
}

export function extractStructuredProducts(html: string): StructuredProduct[] {
  const found: StructuredProduct[] = [];
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi;
  for (const [, raw] of html.matchAll(re)) {
    try { walk(JSON.parse(raw.trim()), found, 0); } catch { /* malformed block: skip it */ }
  }
  return found;
}

/**
 * The offer to report for a product: GBP/unstated currency only, preferring the cheapest
 * in-stock offer, otherwise the cheapest overall. Non-GBP offers are never returned.
 */
export function bestOffer(product: StructuredProduct): StructuredOffer | null {
  const gbp = product.offers.filter(o => isAcceptableCurrency(o.currency));
  if (gbp.length === 0) return null;
  const cheapest = (list: StructuredOffer[]) => list.reduce((a, b) => (b.price < a.price ? b : a));
  const inStock = gbp.filter(o => o.stockState === 'in_stock');
  return cheapest(inStock.length > 0 ? inStock : gbp);
}
