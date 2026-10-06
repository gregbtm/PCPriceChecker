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
