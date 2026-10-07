/**
 * Keeps the optional PricesAPI tier from burning credits (docs/RESEARCH_AND_VERIFICATION.md row 35).
 *
 * - **Pause on exhausted credits.** On `CREDITS_EXCEEDED` the tier stops being called. The pause lifts when the credit allowance's
 *   `resets_at` passes, or when the API key is replaced (a different key fingerprint), and survives restarts (config row
 *   `pricesapi_pause`). Without it every pass re-sent a request that could only fail.
 * - **Minimum interval per component** (config `pricesapi_min_interval_hours`, default 24, 0 = every pass). A search that finds
 *   offers costs 10 credits, so hourly searches for 2 components are about 480 credits a day, and the free 3,000-credit trial
 *   is gone in about six days (about 2.5 days with five components, which is what happened).
 */
import { createHash } from 'crypto';
import * as db from '../db.js';
import type { PricesApiError } from '../sources/pricesapi.js';

export const CREDITS_PER_SEARCH = 10;
const HOUR = 3_600_000;

export interface PricesApiPause { reason: 'quota'; at: number; untilMs: number | null; keyFp: string; message: string }

const keyFp = () => createHash('sha256').update(process.env.PRICES_API_KEY?.trim() ?? '').digest('hex').slice(0, 12);

export function pricesApiPause(now = Date.now()): PricesApiPause | null {
  let p: PricesApiPause | null = null;
  try { p = JSON.parse(db.getConfig('pricesapi_pause') ?? 'null'); } catch { p = null; }
  if (!p) return null;
  if (p.keyFp !== keyFp() || (p.untilMs != null && now >= p.untilMs)) { db.deleteConfig('pricesapi_pause'); return null; }
  return p;
}

export function pausePricesApi(err: PricesApiError, now = Date.now()): PricesApiPause {
  const until = err.details.resetsAt ? Date.parse(err.details.resetsAt) : NaN;
  const p: PricesApiPause = { reason: 'quota', at: now, untilMs: Number.isFinite(until) ? until : null, keyFp: keyFp(), message: err.message };
  db.setConfig('pricesapi_pause', JSON.stringify(p));
  return p;
}

export function minIntervalMs(): number {
  const n = Number(db.getConfig('pricesapi_min_interval_hours') ?? 24);
  return (Number.isFinite(n) && n >= 0 ? n : 24) * HOUR;
}

/** True when this component has not used PricesAPI within the minimum interval. */
export function pricesApiDue(componentId: number, now = Date.now()): boolean {
  const gap = minIntervalMs();
  if (gap === 0) return true;
  const last = Number(db.getConfig(`pricesapi_last:${componentId}`) ?? 0);
  return now - last >= gap;
}

export function markPricesApiRun(componentId: number, now = Date.now()): void {
  db.setConfig(`pricesapi_last:${componentId}`, String(now));
}
