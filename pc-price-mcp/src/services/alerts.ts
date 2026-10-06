/**
 * Alert decision logic extracted from the scheduler so it can be tested
 * against a seeded database without any network access.
 */
import * as db from '../db.js';
import { inQuietHours } from './quiet-hours.js';
import { notifyAll } from '../notifications.js';
import { topOffers, offerKey, formatOffer, formatOfferList } from './offers.js';

type Notify = typeof notifyAll;

const FLAG_TEXT: Record<string, string> = {
  non_binary_unverified: 'WARNING: 24GB/48GB (non-binary) modules are not confirmed to work in the N5 Air',
  will_downclock: 'faster than the 5600 MT/s the platform supports; will run slower',
  kit_unconfirmed: 'title does not say it is a 2-module kit; check before buying',
  ecc_unstated: 'title does not say Non-ECC; check before buying',
  speed_unstated: 'speed not stated',
  suspiciously_cheap: 'WARNING: unusually cheap for this capacity; verify the seller and the listing before paying',
  used_condition: 'used / refurbished / open-box item; check the stated condition',
  seller_feedback_low: 'seller feedback is below 98%',
  delivery_excluded: 'price excludes delivery',
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
  now?: number;
}

const OPTIONS_COOLDOWN_MS = 6 * 3_600_000;

/** Minutes from config (P4-2); a missing, non-numeric or negative value falls back to the old literal. */
export function cooldownMinutes(key: 'alert_cooldown_minutes' | 'drop_cooldown_minutes'): number {
  const n = Number(db.getConfig(key));
  return db.getConfig(key) != null && Number.isFinite(n) && n >= 0 ? n : key === 'alert_cooldown_minutes' ? 1440 : 360;
}

/**
 * "Worth a look" tier (owner request 2026-10-06): above the alert price but within `consider_price`,
 * send the cheapest offers as a list, but only when something NEW appeared (an offer not in the last list,
 * or a cheaper best price) and not more than once every 6 hours.
 */
async function evaluateOptions(component: db.TrackedComponent, notify: Notify, now: number): Promise<void> {
  if (component.consider_price == null) return;
  const offers = topOffers(component.id, 5, component.consider_price);
  if (offers.length === 0) return;
  const best = offers[0];
  if (component.alert_price != null && best.price <= component.alert_price) return;   // the price alert covers it

  const sigKey = `options_sig:${component.id}`;
  const last = (() => { try { return JSON.parse(db.getConfig(sigKey) ?? 'null') as { keys: string[]; best: number; at: number } | null; } catch { return null; } })();
  const keys = offers.map(o => `${offerKey(o.url)}@${o.price}`);
  const somethingNew = !last || keys.some(k => !last.keys.includes(k)) || best.price < last.best;
  if (!somethingNew || (last && now - last.at < OPTIONS_COOLDOWN_MS)) return;

  await notify({
    type: 'options', componentName: component.name,
    price: best.price, currency: best.currency, retailer: best.retailer, url: best.url,
    alertThreshold: component.consider_price,
    message: `Cheapest in stock: ${formatOffer(best)}\n\nOptions up to £${component.consider_price.toFixed(2)}:\n${formatOfferList(offers)}`,
  });
  db.setConfig(sigKey, JSON.stringify({ keys, best: best.price, at: now }));
}

/** Evaluate target-price, "worth a look" and price-drop alerts after fresh snapshots were saved. */
export async function evaluateAlerts(ctx: AlertContext): Promise<void> {
  const { component, prevBestPrice, dropThresholdPct } = ctx;
  const notify = ctx.notify ?? notifyAll;
  const now = ctx.now ?? Date.now();

  if (inQuietHours(now)) return;   // nothing is recorded, so it is sent on the first pass after quiet hours

  const newBest = db.getBestInStockOffer(component.id);
  if (!newBest) return;

  // The cooldown stops repeats of the same deal; a different offer or a lower price is news and bypasses it (P4-2).
  const sigKey = `alert_sig:${component.id}`;
  const lastSig = (() => { try { return JSON.parse(db.getConfig(sigKey) ?? 'null') as { key: string; price: number } | null; } catch { return null; } })();
  const newKey = offerKey(newBest.url);
  const isNews = !lastSig || lastSig.key !== newKey || newBest.price < lastSig.price * 0.99;   // at least 1% cheaper, so pennies of noise are not news

  if (component.alert_price != null && newBest.price <= component.alert_price
      && (isNews || db.shouldSendAlert(component.id, cooldownMinutes('alert_cooldown_minutes')))) {
    const others = topOffers(component.id, 6).filter(o => offerKey(o.url) !== offerKey(newBest.url)).slice(0, 5);
    await notify({ type: 'price_alert', componentName: component.name,
      price: newBest.price, currency: newBest.currency, retailer: newBest.retailer,
      alertThreshold: component.alert_price, url: newBest.url,
      message: [describeOffer(newBest), others.length > 0 ? `Other options:\n${formatOfferList(others)}` : null].filter(Boolean).join('\n\n') });
    db.markLastAlerted(component.id);
    db.setConfig(sigKey, JSON.stringify({ key: newKey, price: newBest.price }));
  }

  await evaluateOptions(component, notify, now);

  if (prevBestPrice != null && newBest.price < prevBestPrice) {
    const dropPct = ((prevBestPrice - newBest.price) / prevBestPrice) * 100;
    if (dropPct >= dropThresholdPct && db.shouldSendAlert(component.id, cooldownMinutes('drop_cooldown_minutes'))) {
      await notify({ type: 'price_drop', componentName: component.name,
        price: newBest.price, currency: newBest.currency, retailer: newBest.retailer,
        dropAmount: prevBestPrice - newBest.price, dropPercent: dropPct, url: newBest.url, message: describeOffer(newBest) });
      db.markLastAlerted(component.id);
    }
  }
}
