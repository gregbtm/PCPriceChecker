/**
 * Deal-feed watch: poll HotUKDeals' tag feeds about hourly and tell the owner when a community post looks like a 48GB-or-larger
 * DDR5 SO-DIMM kit (docs/INTEGRATION_OPTIONS.md section 4, S3).
 *
 * A post is a lead, not a fact: nobody has checked the price, the stock or that the kit is non-ECC, so the message says so and the
 * app never records it as an offer. The point is to hear about a flash sale at a shop we cannot read (Scan, Overclockers, Box).
 *
 * Cost: three plain feed requests an hour, robots.txt checked, honest User-Agent (hotukdeals.ts). State lives in the config table
 * (`dealfeed:*`), so no migration. Set config `deal_feeds_enabled` to "false" to stop it.
 */
import * as db from '../db.js';
import { notifyAll } from '../notifications.js';
import { fetchHukdFeeds, HUKD_TAG_FEEDS, type HukdDeal } from '../sources/hotukdeals.js';
import { classifyMemory } from './memory-classifier.js';

type Notify = typeof notifyAll;

export const POLL_EVERY_MS = 55 * 60_000;        // hourly with a little slack so a 60-minute scheduler tick is never skipped
export const MAX_AGE_MS = 72 * 3_600_000;        // an older post is probably expired; the first run must not announce last week's deals
const SEEN_CAP = 500;
const MIN_KIT_GB = 48;

const SEEN_KEY = 'dealfeed:seen';
const LAST_KEY = 'dealfeed:last_poll';
const STATUS_KEY = 'dealfeed:status';
const WINDOWS_KEY = 'dealfeed:windows';

export function dealFeedsEnabled(): boolean {
  return (db.getConfig('deal_feeds_enabled') ?? 'true').trim().toLowerCase() !== 'false';
}

const SODIMM_WORD = /so[\s-]?dimm|(?:laptop|notebook)\s+(?:memory|ram)/i;
const DEVICE_WORD = /\b(?:mini\s?pc|barebones?|nas|all[\s-]in[\s-]one|gaming\s+pc|desktop\s+pc|laptop|notebook|chromebook|macbook|handheld)\b/i;

/**
 * Does this post sell a DDR5 SO-DIMM kit of at least 48GB? Strict on purpose: the TITLE must say SO-DIMM (or "laptop memory"),
 * because desktop RAM deals are common and "DDR5 64GB" alone matches them, and a description that lists "up to 64GB" would match
 * every laptop and mini PC. A title that sells a device (or a device *with* memory) is not a kit. Capacity and generation come
 * from the title, falling back to the description only when the title does not state them.
 */
export function isTargetDeal(d: Pick<HukdDeal, 'title' | 'description'>): boolean {
  if (!SODIMM_WORD.test(d.title)) return false;
  if (DEVICE_WORD.test(d.title.replace(/(?:laptop|notebook)\s+(?:memory|ram)/gi, ' '))) return false;
  const m = classifyMemory(d.title);
  if (m.bundle || m.formFactor === 'DIMM' || m.formFactor === 'CAMM2' || m.ddr === 4) return false;
  const t = m.ddr === 5 && m.totalGb != null ? m : classifyMemory(`${d.title} ${d.description}`);
  return t.ddr === 5 && !t.bundle && (t.totalGb ?? 0) >= MIN_KIT_GB;
}

export interface FeedStatus {
  at: string; ok: boolean; items: number; matched: number; error?: string;
  /** Feeds whose newest ~30 items shared nothing with the previous poll's: posts may have scrolled off between polls and been missed. */
  gaps?: string[];
}

function loadSeen(): string[] {
  try { const a = JSON.parse(db.getConfig(SEEN_KEY) ?? '[]'); return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
}

export function loadDealFeedStatus(): FeedStatus | null {
  try { return JSON.parse(db.getConfig(STATUS_KEY) ?? 'null') as FeedStatus | null; } catch { return null; }
}

function loadWindows(): Record<string, string[]> {
  try { const w = JSON.parse(db.getConfig(WINDOWS_KEY) ?? '{}'); return w && typeof w === 'object' && !Array.isArray(w) ? w : {}; } catch { return {}; }
}

/**
 * A feed is a window onto the newest items, not a complete list (an idea taken from vgvr0/chollo-alerts' `feed_window_risk`, applied here to RSS).
 * If this poll's window shares no item with the previous poll's window of the same feed, more than a window's worth of posts appeared in
 * between and some were never seen. Returns the feeds where that happened; a feed that did not answer keeps its previous window.
 */
export function windowGaps(previous: Record<string, string[]>, current: Record<string, string[]>): string[] {
  const gaps: string[] = [];
  for (const [tag, guids] of Object.entries(current)) {
    const prev = previous[tag];
    if (prev && prev.length > 0 && guids.length > 0 && !guids.some(g => prev.includes(g))) gaps.push(tag);
  }
  return gaps;
}

export interface PollDeps {
  fetchFeeds: typeof fetchHukdFeeds;
  notify: Notify;
  now: () => Date;
}

/**
 * One poll, if one is due. Returns what happened so tests and the health panel can see it.
 * Never throws: a feed outage is recorded in the status line, and only a poll in which every feed failed counts as a failure.
 */
export async function pollDealFeeds(deps: Partial<PollDeps> = {}, force = false): Promise<{ polled: boolean; notified: string[]; status?: FeedStatus }> {
  const now = (deps.now ?? (() => new Date()))();
  if (!force) {
    if (!dealFeedsEnabled()) return { polled: false, notified: [] };
    const last = Number(db.getConfig(LAST_KEY) ?? 0);
    if (Number.isFinite(last) && now.getTime() - last < POLL_EVERY_MS) return { polled: false, notified: [] };
  }
  db.setConfig(LAST_KEY, String(now.getTime()));

  const { deals, failures, byFeed } = await (deps.fetchFeeds ?? fetchHukdFeeds)(HUKD_TAG_FEEDS);
  const allFailed = deals.length === 0 && failures.length > 0;
  const seen = new Set(loadSeen());
  const fresh = deals.filter(d => !seen.has(d.guid) && now.getTime() - new Date(d.publishedAt).getTime() <= MAX_AGE_MS);
  const matched = fresh.filter(isTargetDeal);

  const notified: string[] = [];
  const notify = deps.notify ?? notifyAll;
  for (const d of matched) {
    await notify({
      type: 'new_product',
      componentName: `HotUKDeals lead: ${d.title.slice(0, 120)}`,
      retailer: d.merchant ?? undefined,
      price: d.price ?? undefined, currency: 'GBP',
      url: d.url,
      message: 'A community post, not checked: the price, stock and whether it is non-ECC are unverified. Open the deal, then the merchant page.',
    });
    notified.push(d.guid);
  }

  // Remember everything seen (not only matches) so a post is judged once; cap the list so the config row stays small.
  for (const d of deals) seen.add(d.guid);
  db.setConfig(SEEN_KEY, JSON.stringify([...seen].slice(-SEEN_CAP)));

  const gaps = windowGaps(loadWindows(), byFeed ?? {});
  if (byFeed) db.setConfig(WINDOWS_KEY, JSON.stringify({ ...loadWindows(), ...byFeed }));

  const status: FeedStatus = {
    at: now.toISOString(), ok: !allFailed, items: deals.length, matched: matched.length,
    error: failures.length > 0 ? failures.join('; ') : undefined,
    gaps: gaps.length > 0 ? gaps : undefined,
  };
  db.setConfig(STATUS_KEY, JSON.stringify(status));
  return { polled: true, notified, status };
}
