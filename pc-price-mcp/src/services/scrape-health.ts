/**
 * Scraper failure visibility (audit A-10, task P0-8): per-source failure counting and one
 * notification per component per round when a source keeps failing.
 */
import * as db from '../db.js';
import type { notifyAll } from '../notifications.js';

type Notify = typeof notifyAll;

export const DEFAULT_FAILURE_THRESHOLD = 3;
const ALERT_COOLDOWN_MS = 24 * 3_600_000;

export function failureThreshold(): number {
  const n = Number(db.getConfig('scrape_failure_alert_after') ?? process.env.SCRAPE_FAILURE_ALERT_AFTER ?? DEFAULT_FAILURE_THRESHOLD);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : DEFAULT_FAILURE_THRESHOLD;
}

/**
 * Notify (once per source per 24h, across all components) about sources of this component that failed
 * `threshold` or more times in a row. Returns the sources reported. Sources are batched into a single message.
 */
export async function alertOnRepeatedFailures(
  component: Pick<db.TrackedComponent, 'id' | 'name'>,
  sources: string[],
  notify: Notify,
  now = Date.now(),
): Promise<string[]> {
  const threshold = failureThreshold();
  const due: { source: string; n: number; error: string | null }[] = [];
  for (const source of new Set(sources)) {
    const n = db.getConsecutiveFailures(component.id, source);
    if (n < threshold) continue;
    // One notice per source, not per component: when a retailer blocks the server, every tracked
    // component fails on it at once and one message says everything the others would.
    const key = `scrape_fail_alerted:${source}`;
    const last = Number(db.getConfig(key) ?? 0);
    if (now - last < ALERT_COOLDOWN_MS) continue;
    const err = db.getRecentScrapeRuns(20, component.id).find(r => r.source === source && !r.ok)?.error ?? null;
    due.push({ source, n, error: err });
  }
  if (due.length === 0) return [];
  const lines = due.map(d => `- ${d.source}: ${d.n} failures in a row${d.error ? ` (${d.error})` : ''}`);
  await notify({
    type: 'scrape_failure', componentName: component.name,
    message: `Prices may be stale (first seen while refreshing this component; other components may be affected too).\n${lines.join('\n')}`,
  });
  for (const d of due) db.setConfig(`scrape_fail_alerted:${d.source}`, String(now));
  return due.map(d => d.source);
}
