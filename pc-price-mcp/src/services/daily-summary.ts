/**
 * Daily price summary (owner request 2026-10-06): the cheapest purchasable offer and a short list of options
 * for every tracked component that has a hardware profile or a "consider" price, plus a little context.
 * Sent once per local day after `daily_summary_hour` (config or DAILY_SUMMARY_HOUR, default 8; "off" disables).
 */
import * as db from '../db.js';
import type { notifyAll } from '../notifications.js';
import { inQuietHours } from './quiet-hours.js';
import { topOffers, formatOffer, formatOfferList, marketView, marketLine } from './offers.js';

type Notify = typeof notifyAll;

const money = (n: number) => `£${n.toFixed(2)}`;

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function summaryHour(): number | null {
  const raw = db.getConfig('daily_summary_hour') ?? process.env.DAILY_SUMMARY_HOUR ?? '8';
  const n = Number(raw);
  return raw.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 23 ? n : null;
}

export function summaryComponents(): db.TrackedComponent[] {
  return db.getTrackedComponents().filter(c => !c.paused && (c.profile_id || c.consider_price != null));
}

export function buildSummary(components: db.TrackedComponent[]): string {
  const blocks = components.map(c => {
    const limits = [c.alert_price != null ? `alert at ${money(c.alert_price)}` : null,
      c.consider_price != null ? `options up to ${money(c.consider_price)}` : null].filter(Boolean).join(', ');
    const lines = [`${c.name}${limits ? ` (${limits})` : ''}`];
    const offers = topOffers(c.id, 5);
    if (offers.length === 0) {
      lines.push('No matching in-stock listing seen in the last 48 hours.');
    } else {
      lines.push(`Cheapest now: ${formatOffer(offers[0])}`);
      if (c.alert_price != null) {
        const gap = offers[0].price - c.alert_price;
        lines.push(gap <= 0 ? 'Below your alert price.' : `${money(gap)} above your alert price.`);
      }
      lines.push(`Options (${offers.length}):\n${formatOfferList(offers)}`);
      const week = db.getPurchasablePriceSummary(c.id, 7);
      if (week.count > 1) lines.push(`Last 7 days: low ${money(week.low!)}, median ${money(week.median!)} (${week.count} observations).`);
    }
    const market = marketLine(marketView(c.id, c.alert_price));
    if (market) lines.push(market);
    return lines.join('\n');
  });
  return blocks.join('\n\n');
}

/** Send now, ignoring the once-a-day guard (also used by POST /api/daily-summary/send). Returns whether anything was sent. */
export async function sendDailySummary(notify: Notify): Promise<boolean> {
  const components = summaryComponents();
  if (components.length === 0) return false;
  const top = components.map(c => topOffers(c.id, 1)[0]).find(Boolean);
  const result = await notify({
    type: 'daily_summary', componentName: 'Daily price summary',
    message: buildSummary(components),
    ...(top ? { price: top.price, currency: top.currency, retailer: top.retailer, url: top.url } : {}),
  });
  const keys = Object.values(result ?? {});
  return keys.length === 0 || keys.some(Boolean);   // an empty result (test double) counts as delivered
}

/** Called after every refresh pass; sends at most once per local day, after the configured hour. */
export async function maybeSendDailySummary(notify: Notify, now = new Date()): Promise<boolean> {
  const hour = summaryHour();
  if (hour == null || now.getHours() < hour || inQuietHours(now)) return false;
  const today = localDate(now);
  if (db.getConfig('last_daily_summary') === today) return false;
  const sent = await sendDailySummary(notify);
  if (sent) db.setConfig('last_daily_summary', today);   // not delivered anywhere: try again on the next pass
  return sent;
}
