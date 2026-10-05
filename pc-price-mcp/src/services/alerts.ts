/**
 * Alert decision logic extracted from the scheduler so it can be tested
 * against a seeded database without any network access.
 */
import * as db from '../db.js';
import { notifyAll } from '../notifications.js';

type Notify = typeof notifyAll;

const FLAG_TEXT: Record<string, string> = {
  non_binary_unverified: 'WARNING: 24GB/48GB (non-binary) modules are not confirmed to work in the N5 Air',
  will_downclock: 'faster than the 5600 MT/s the platform supports; will run slower',
  kit_unconfirmed: 'title does not say it is a 2-module kit; check before buying',
  ecc_unstated: 'title does not say Non-ECC; check before buying',
  speed_unstated: 'speed not stated',
};

/** Human-readable detail for an alert: listing, price per GB and any caveats (P4-3 part). */
export function describeOffer(o: db.PriceRecord): string | undefined {
  const parts: string[] = [];
  if (o.listing_name) parts.push(o.listing_name);
  if (o.price_per_gb != null) parts.push(`£${o.price_per_gb.toFixed(2)}/GB`);
  for (const f of (o.profile_flags ?? '').split(',').filter(Boolean)) parts.push(FLAG_TEXT[f] ?? f);
  return parts.length > 0 ? parts.join('\n') : undefined;
}

export interface AlertContext {
  component: db.TrackedComponent;
  prevBestPrice: number | null;
  dropThresholdPct: number;
  notify?: Notify;
}

/** Evaluate target-price and price-drop alerts after fresh snapshots were saved. */
export async function evaluateAlerts(ctx: AlertContext): Promise<void> {
  const { component, prevBestPrice, dropThresholdPct } = ctx;
  const notify = ctx.notify ?? notifyAll;

  const newBest = db.getBestInStockOffer(component.id);
  if (!newBest) return;

  if (component.alert_price != null && newBest.price <= component.alert_price
      && db.shouldSendAlert(component.id, 1440)) {
    await notify({ type: 'price_alert', componentName: component.name,
      price: newBest.price, currency: newBest.currency, retailer: newBest.retailer,
      alertThreshold: component.alert_price, url: newBest.url, message: describeOffer(newBest) });
    db.markLastAlerted(component.id);
  }

  if (prevBestPrice != null && newBest.price < prevBestPrice) {
    const dropPct = ((prevBestPrice - newBest.price) / prevBestPrice) * 100;
    if (dropPct >= dropThresholdPct && db.shouldSendAlert(component.id, 360)) {
      await notify({ type: 'price_drop', componentName: component.name,
        price: newBest.price, currency: newBest.currency, retailer: newBest.retailer,
        dropAmount: prevBestPrice - newBest.price, dropPercent: dropPct, url: newBest.url, message: describeOffer(newBest) });
      db.markLastAlerted(component.id);
    }
  }
}
