/**
 * Best-price fields for a tracked component, shared by the REST list so the dashboard and the alerts agree.
 *
 * `best_*` keeps its historical meaning (cheapest latest row of any kind) for components WITHOUT a hardware
 * profile. For a component with a known profile it is the best PURCHASABLE offer instead: in stock, fits the
 * profile and seen recently, exactly what an alert would use. A profiled component whose only cheap rows are
 * 24GB singles, DDR4 or scams therefore shows no best price rather than a misleading one.
 * `best_purchasable_*` is always the alert-eligible offer, for any component.
 */
import * as db from '../db.js';
import { PROFILES } from './memory-classifier.js';

export interface BestFields {
  best_price: number | null; best_retailer: string | null; best_in_stock: number | null;
  best_currency: string; best_url: string | null;
  best_purchasable_price: number | null; best_purchasable_retailer: string | null; best_purchasable_url: string | null;
  best_purchasable_flags: string | null;
  /** P1-6/P5-3: shown for the same offer as best_price. */
  best_price_per_gb: number | null; best_delivery_cost: number | null; best_flags: string | null;
}

export function bestFields(c: db.TrackedComponent): BestFields {
  const purchasable = db.getBestInStockOffer(c.id);
  const hasProfile = !!(c.profile_id && PROFILES[c.profile_id]);
  const any = db.getLatestPricePerRetailer(c.id)[0] ?? null;
  const shown = hasProfile ? purchasable : any;
  return {
    best_price: shown?.price ?? null,
    best_retailer: shown?.retailer ?? null,
    best_in_stock: shown?.in_stock ?? null,
    best_currency: shown?.currency ?? 'GBP',
    best_url: shown?.url ?? null,
    best_purchasable_price: purchasable?.price ?? null,
    best_purchasable_retailer: purchasable?.retailer ?? null,
    best_purchasable_url: purchasable?.url ?? null,
    best_purchasable_flags: purchasable?.profile_flags ?? null,
    best_price_per_gb: shown?.price_per_gb ?? null,
    best_delivery_cost: shown?.delivery_cost ?? null,
    best_flags: shown?.profile_flags ?? null,
  };
}
