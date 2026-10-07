/**
 * Lists of purchasable offers for notifications and summaries: "the cheapest, and the other options".
 * Everything here uses getLatestPricePerRetailer(..., inStockOnly), so only offers that would also be
 * alert-eligible (in stock, fit the profile, seen recently) are ever listed.
 */
import * as db from '../db.js';

const SHORT_FLAG: Record<string, string> = {
  used_condition: 'used', delivery_excluded: '+delivery', kit_unconfirmed: 'kit?', ecc_unstated: '',
  speed_unstated: '', will_downclock: 'runs slower', seller_feedback_low: 'low feedback',
  suspiciously_cheap: 'CHECK SELLER', non_binary_unverified: '24GB UNVERIFIED',
};

/** Stable identity of a listing across scrapes (eBay URLs carry changing tracking parameters). */
export function offerKey(url: string | null): string {
  if (!url) return 'unknown';
  const ebay = url.match(/\/itm\/(\d+)/);
  if (ebay) return `ebay:${ebay[1]}`;
  return url.replace(/[?#].*$/, '');
}

/** Cheapest first. `maxPrice` keeps only offers at or below it. */
export function topOffers(componentId: number, limit = 5, maxPrice?: number | null): db.PriceRecord[] {
  const all = db.getLatestPricePerRetailer(componentId, true, true);
  const seen = new Set<string>();
  const out: db.PriceRecord[] = [];
  for (const o of all) {
    if (maxPrice != null && o.price > maxPrice) continue;
    const k = offerKey(o.url);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(o);
    if (out.length >= limit) break;
  }
  return out;
}

const money = (n: number) => `£${n.toFixed(2)}`;

export function formatOffer(o: db.PriceRecord): string {
  const name = (o.listing_name ?? 'listing').replace(/\s+/g, ' ').slice(0, 70);
  const flags = (o.profile_flags ?? '').split(',').map(f => SHORT_FLAG[f] ?? '').filter(Boolean);
  const parts = [money(o.price), name, o.retailer];
  if (o.price_per_gb != null) parts.push(`${money(o.price_per_gb)}/GB`);
  if (o.delivery_cost != null) parts.push(o.delivery_cost === 0 ? 'free delivery' : `+${money(o.delivery_cost)} delivery = ${money(o.price + o.delivery_cost)}`);
  if (o.vat_included === 0) parts.push('ex VAT');
  if (flags.length > 0) parts.push(flags.join(', '));
  return parts.join(' · ');
}

export function formatOfferList(offers: db.PriceRecord[]): string {
  return offers.map((o, i) => `${i + 1}. ${formatOffer(o)}`).join('\n');
}

// ── Market context ─────────────────────────────────────────────────────────

export interface MarketRow {
  retailer: string; price: number; stock_state: string; listing_name: string | null; url: string | null; age_hours: number;
}

export interface MarketView {
  /** Cheapest compatible listing seen in the window in ANY stock state; null when nothing compatible was seen. */
  floor: MarketRow | null;
  /** Compatible listings, one per listing, cheapest first (any stock state). */
  rows: MarketRow[];
  /** How far below the floor the alert price is, in percent (positive = the target is below the market); null without both numbers. */
  target_below_floor_pct: number | null;
}

/**
 * What the market actually charges for a compatible kit, whether or not it can be bought today. An alert threshold below this floor will not
 * fire until the market moves, and the owner should be able to see that gap without reading the offers table.
 */
export function marketView(componentId: number, alertPrice: number | null, windowDays = 7, now = Date.now()): MarketView {
  const seen = new Set<string>();
  const rows: MarketRow[] = [];
  for (const r of db.getLatestPricePerRetailer(componentId, true, false)) {
    if (r.profile_match === 0) continue;
    const at = new Date(r.recorded_at.replace(' ', 'T') + 'Z').getTime();
    if (!Number.isFinite(at) || now - at > windowDays * 86_400_000) continue;
    const k = offerKey(r.url);
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push({ retailer: r.retailer, price: r.price, stock_state: r.stock_state, listing_name: r.listing_name, url: r.url,
      age_hours: Math.round((now - at) / 3_600_000) });
  }
  rows.sort((a, b) => a.price - b.price);
  const floor = rows[0] ?? null;
  const pct = floor && alertPrice != null && floor.price > 0 ? Math.round(((floor.price - alertPrice) / floor.price) * 100) : null;
  return { floor, rows: rows.slice(0, 8), target_below_floor_pct: pct };
}

const STATE_WORDS: Record<string, string> = { in_stock: 'in stock', out_of_stock: 'out of stock', backorder: 'backorder', unknown: 'stock unknown' };

/** One line for the daily summary, or null when nothing compatible has been seen. */
export function marketLine(v: MarketView): string | null {
  if (!v.floor) return null;
  const base = `Market floor (any stock, last 7 days): ${money(v.floor.price)} at ${v.floor.retailer} (${STATE_WORDS[v.floor.stock_state] ?? v.floor.stock_state}).`;
  return v.target_below_floor_pct != null && v.target_below_floor_pct > 0
    ? `${base} Your alert price is ${v.target_below_floor_pct}% below it.` : base;
}
