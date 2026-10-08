/**
 * Alert decision logic extracted from the scheduler so it can be tested
 * against a seeded database without any network access.
 */
import * as db from '../db.js';
import { inQuietHours } from './quiet-hours.js';
import { notifyAll } from '../notifications.js';
import { topOffers, offerKey, formatOffer, formatOfferList } from './offers.js';
import type { Verdict } from './verify-offer.js';

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
  ecc_listed: 'WARNING: the seller\'s item specifics list "ECC Memory". DDR5 has on-die ECC, so this may not mean ECC modules, but the N5 Air needs non-ECC: ask the seller to confirm before buying',
};

/** Human-readable detail for an alert: listing, price per GB and any caveats (P4-3 part). */
export function describeOffer(o: db.PriceRecord): string | undefined {
  const parts: string[] = [];
  if (o.listing_name) parts.push(o.listing_name);
  if (o.price_per_gb != null) parts.push(`£${o.price_per_gb.toFixed(2)}/GB`);
  for (const f of (o.profile_flags ?? '').split(',').filter(Boolean)) parts.push(FLAG_TEXT[f] ?? f);
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/**
 * `alert_on_total=true` compares price plus delivery with the alert and options limits (NEXT.md #3). Default off: the item price alone,
 * as before. A delivery charge that is not known counts as 0 here, which is why the message still says "price excludes delivery" for such offers.
 */
export function alertOnTotal(): boolean { return db.getConfig('alert_on_total') === 'true'; }
export function effectivePrice(o: Pick<db.PriceRecord, 'price' | 'delivery_cost'>): number {
  return o.price + (alertOnTotal() ? (o.delivery_cost ?? 0) : 0);
}
function bestOffer(componentId: number): db.PriceRecord | null {
  if (!alertOnTotal()) return db.getBestInStockOffer(componentId);
  return topOffers(componentId, 50).sort((a, b) => effectivePrice(a) - effectivePrice(b))[0] ?? null;
}

export interface AlertContext {
  /** Re-reads an offer at its source just before alerting (services/verify-offer.ts). Absent = no check, as before. */
  verify?: (offer: db.PriceRecord) => Promise<Verdict>;
  component: db.TrackedComponent;
  prevBestPrice: number | null;
  dropThresholdPct: number;
  notify?: Notify;
  now?: number;
}

/** Minimum gap between two options notices (config `options_cooldown_minutes`, default 360). A rare kit can sell within hours, so the owner may lower it. */
function optionsCooldownMs(): number {
  const raw = db.getConfig('options_cooldown_minutes');
  const n = Number(raw);
  return raw != null && raw.trim() !== '' && Number.isFinite(n) && n >= 0 ? n * 60_000 : 6 * 3_600_000;
}

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
async function evaluateOptions(component: db.TrackedComponent, notify: Notify, now: number, excluded: Set<number> = new Set()): Promise<void> {
  if (component.consider_price == null) return;
  const offers = topOffers(component.id, 50).filter(o => !excluded.has(o.id) && effectivePrice(o) <= component.consider_price!)
    .sort((a, b) => effectivePrice(a) - effectivePrice(b)).slice(0, 5);
  if (offers.length === 0) return;
  const best = offers[0];
  if (component.alert_price != null && effectivePrice(best) <= component.alert_price) return;   // the price alert covers it

  const sigKey = `options_sig:${component.id}`;
  const last = (() => { try { return JSON.parse(db.getConfig(sigKey) ?? 'null') as { keys: string[]; best: number; at: number } | null; } catch { return null; } })();
  const keys = offers.map(o => `${offerKey(o.url)}@${o.price}`);
  const somethingNew = !last || keys.some(k => !last.keys.includes(k)) || best.price < last.best;
  if (!somethingNew || (last && now - last.at < optionsCooldownMs())) return;

  await notify({
    type: 'options', componentName: component.name,
    price: best.price, currency: best.currency, retailer: best.retailer, url: best.url,
    alertThreshold: component.consider_price,
    message: `Cheapest in stock: ${formatOffer(best)}\n\nOptions up to £${component.consider_price.toFixed(2)}:\n${formatOfferList(offers)}`,
  });
  db.setConfig(sigKey, JSON.stringify({ keys, best: best.price, at: now }));
  db.recordEvidence({ componentId: component.id, kind: 'options', retailer: best.retailer, url: best.url, price: best.price, evidence: evidenceOf(best) });
}

/** What was true about an offer when it was announced; stored so the alert can be audited later. */
function evidenceOf(o: db.PriceRecord, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { title: o.listing_name, source: o.source, stock_state: o.stock_state, recorded_at: o.recorded_at, delivery_cost: o.delivery_cost,
    vat_included: o.vat_included, flags: o.profile_flags, kit_gb: o.kit_total_gb, modules: o.modules, ...extra };
}

const MAX_VERIFICATIONS = 3;

/**
 * The cheapest offer that is still real. With a verifier, the best candidates are re-read in turn (at most three per pass); one that has
 * gone is marked unavailable, logged as suppressed in the evidence ledger, and the next is tried. An inconclusive re-read passes.
 */
async function pickVerifiedBest(ctx: AlertContext): Promise<{ best: db.PriceRecord | null; note?: string; verdict?: Verdict; excluded: Set<number> }> {
  const { component } = ctx;
  const excluded = new Set<number>();
  if (!ctx.verify || db.getConfig('verify_before_alert') === 'false') return { best: bestOffer(component.id), excluded };
  const candidates = topOffers(component.id, 50).sort((a, b) => effectivePrice(a) - effectivePrice(b)).slice(0, MAX_VERIFICATIONS);
  for (const c of candidates) {
    let v: Verdict;
    try { v = await ctx.verify(c); } catch { v = { ok: true, note: 'could not re-check the listing just now' }; }
    if (v.ok) {
      const flags = [...(c.profile_flags ?? '').split(',').filter(f => f && !(v.flagsRemoved ?? []).includes(f)), ...(v.flagsAdded ?? [])].join(',');
      if (flags !== (c.profile_flags ?? '')) db.setRecordFlags(c.id, flags);   // so the dashboard and the daily summary carry what the re-check learned
      return { best: { ...c, price: v.price ?? c.price, profile_flags: flags || null }, note: v.note, verdict: v, excluded };
    }
    excluded.add(c.id);
    db.markOfferUnavailable(c.id);
    db.recordEvidence({ componentId: component.id, kind: 'suppressed', retailer: c.retailer, url: c.url, price: c.price,
      evidence: evidenceOf(c, { reason: v.reason, aspects: v.aspects ?? null }) });
  }
  return { best: null, excluded };
}

/** Evaluate target-price, "worth a look" and price-drop alerts after fresh snapshots were saved. */
export async function evaluateAlerts(ctx: AlertContext): Promise<void> {
  const { component, prevBestPrice, dropThresholdPct } = ctx;
  const notify = ctx.notify ?? notifyAll;
  const now = ctx.now ?? Date.now();

  if (inQuietHours(now)) return;   // nothing is recorded, so it is sent on the first pass after quiet hours

  // Re-read listings only when something could actually be sent for the cheapest one (a price limit met, or a drop big enough).
  const peek = bestOffer(component.id);
  if (!peek) return;
  const limit = Math.max(component.alert_price ?? -1, component.consider_price ?? -1);
  const couldNotify = effectivePrice(peek) <= limit
    || (prevBestPrice != null && peek.price < prevBestPrice && ((prevBestPrice - peek.price) / prevBestPrice) * 100 >= dropThresholdPct);
  const picked = couldNotify ? await pickVerifiedBest(ctx) : { best: peek, excluded: new Set<number>() } as Awaited<ReturnType<typeof pickVerifiedBest>>;
  const newBest = picked.best;
  if (!newBest) return;

  // The cooldown stops repeats of the same deal; a different offer or a lower price is news and bypasses it (P4-2).
  const sigKey = `alert_sig:${component.id}`;
  const lastSig = (() => { try { return JSON.parse(db.getConfig(sigKey) ?? 'null') as { key: string; price: number } | null; } catch { return null; } })();
  const newKey = offerKey(newBest.url);
  const isNews = !lastSig || lastSig.key !== newKey || newBest.price < lastSig.price * 0.99;   // at least 1% cheaper, so pennies of noise are not news

  if (component.alert_price != null && effectivePrice(newBest) <= component.alert_price
      && (isNews || db.shouldSendAlert(component.id, cooldownMinutes('alert_cooldown_minutes')))) {
    const others = topOffers(component.id, 6).filter(o => offerKey(o.url) !== offerKey(newBest.url)).slice(0, 5);
    await notify({ type: 'price_alert', componentName: component.name,
      price: newBest.price, currency: newBest.currency, retailer: newBest.retailer,
      alertThreshold: component.alert_price, url: newBest.url,
      message: [picked.note ? `Re-checked just now: ${picked.note}` : null, alertOnTotal() && newBest.delivery_cost ? `Total with delivery £${effectivePrice(newBest).toFixed(2)} (item £${newBest.price.toFixed(2)} + £${newBest.delivery_cost.toFixed(2)})` : null, describeOffer(newBest), others.length > 0 ? `Other options:\n${formatOfferList(others)}` : null].filter(Boolean).join('\n\n') });
    db.markLastAlerted(component.id);
    db.setConfig(sigKey, JSON.stringify({ key: newKey, price: newBest.price }));
    db.recordEvidence({ componentId: component.id, kind: 'price_alert', retailer: newBest.retailer, url: newBest.url, price: newBest.price,
      evidence: evidenceOf(newBest, { verified: !!ctx.verify, note: picked.note ?? null, aspects: picked.verdict && picked.verdict.ok ? picked.verdict.aspects ?? null : null }) });
  }

  await evaluateOptions(component, notify, now, picked.excluded);

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
