import { scraperUserAgent } from '../services/scrape-policy.js';
import { assertAllowedByRobots, RobotsDisallowedError } from '../services/robots.js';
// HotUKDeals RSS integration: the UK's largest deal community. No API key.
//
// Rewritten 2026-10-08 after checking the live site (docs/INTEGRATION_OPTIONS.md section 4, S3):
//   - `/search?q=...&view=rss` is disallowed by hotukdeals.com/robots.txt (`Disallow: /search`), so the old search tool was
//     breaking the site's published rules. There is no per-search feed (`/rss/search`, `/rss/tag/ddr5` are 404), so searching now
//     reads the newest ~30 items of the tag feeds below and filters them here.
//   - `/deals/feed.rss?category=computing`, used by the old "hot deals" tool, answers HTTP 410 (gone).
// Feeds that exist and are allowed: `/rss/tag/ram` (about one item a day), `/rss/tag/computers` (30 items span ~14 h),
// `/rss/tag/electronics`, `/rss/trending` (`/rss/hot` redirects to it). Every fetch checks robots.txt first and sends the honest
// User-Agent. Deals are community posts: a lead to check, never proof of price or stock.

const HUKD_BASE = 'https://www.hotukdeals.com';
const TIMEOUT_MS = 10_000;

const hukdHeaders = () => ({
  'User-Agent': scraperUserAgent(),
  Accept: 'application/rss+xml, application/xml, text/xml, */*',
  'Accept-Language': 'en-GB,en;q=0.9',
});

export interface HukdDeal {
  title: string;
  url: string;
  merchant: string | null;
  price: number | null;
  currency: string;
  description: string;
  publishedAt: string;
  category: string | null;
  permalink: string;
  imageUrl: string | null;
  isFreebie: boolean;
  guid: string;
}

export interface HukdSearchResult {
  query: string;
  deals: HukdDeal[];
  fetchedAt: string;
  error?: string;
  /** Set when some feeds answered and others did not: the deals are real but the list may be incomplete. */
  note?: string;
}

// ── Minimal RSS 2.0 parser (no external deps) ──────────────────────────────

function xmlText(block: string, tag: string): string | null {
  const re = new RegExp(
    `<${tag}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))<\\/${tag}>`,
    'i',
  );
  const m = block.match(re);
  if (!m) return null;
  const raw = (m[1] ?? m[2] ?? '').trim();
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    || null;
}

function xmlAttr(block: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}="([^"]*)"`, 'i');
  const m = block.match(re);
  return m ? m[1] : null;
}

function extractItems(xml: string): string[] {
  const items: string[] = [];
  const re = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) items.push(m[1]);
  return items;
}

// ── Price / merchant extraction ────────────────────────────────────────────

function parseDealTitle(title: string): { price: number | null; merchant: string | null; isFreebie: boolean } {
  const isFreebie = /free\b/i.test(title) && !/free\s*delivery/i.test(title);

  const priceMatch = title.match(/£\s*([\d,]+(?:\.\d{2})?)/);
  const price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : null;

  // "@ Merchant" pattern — most common on HUKD
  const atMatch = title.match(/@\s*([^|[\]]+?)(?:\s*[\[|]|$)/);
  // "from Merchant" pattern
  const fromMatch = title.match(/\bfrom\s+([A-Z][a-zA-Z0-9 .&'-]{2,30})(?:\s|$)/);
  const merchant = atMatch?.[1]?.trim() ?? fromMatch?.[1]?.trim() ?? null;

  return { price, merchant, isFreebie };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 400);
}

// ── RSS fetch + parse ──────────────────────────────────────────────────────

/** `£1,049.99` -> 1049.99; null when it is not a positive GBP amount. */
function gbpAmount(text: string | null): number | null {
  const m = text?.match(/£\s*([\d,]+(?:\.\d{1,2})?)/);
  const n = m ? parseFloat(m[1].replace(/,/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function parseHukdFeed(xml: string, fetchedAt = new Date().toISOString()): HukdDeal[] {
  return extractItems(xml).map(item => {
    const title = xmlText(item, 'title') ?? '';
    const link  = xmlText(item, 'link') ?? xmlText(item, 'guid') ?? '';
    const desc  = xmlText(item, 'description') ?? '';
    const pub   = xmlText(item, 'pubDate') ?? '';
    const cat   = xmlText(item, 'category');
    const img   = xmlAttr(item, 'enclosure', 'url') ?? xmlAttr(item, 'media:thumbnail', 'url');
    const parsed = parseDealTitle(title);
    // The feed's own `<pepper:merchant name="Amazon" price="£158.09"/>` is exact where the title's "@ Merchant" guess is not.
    const merchant = xmlAttr(item, 'pepper:merchant', 'name') ?? parsed.merchant;
    const price = gbpAmount(xmlAttr(item, 'pepper:merchant', 'price')) ?? parsed.price;
    const when = pub ? new Date(pub) : null;
    return {
      title, url: link, merchant, price, currency: 'GBP',
      description: stripHtml(desc),
      publishedAt: when && !isNaN(when.getTime()) ? when.toISOString() : fetchedAt,
      category: cat, permalink: link, imageUrl: img ?? null, isFreebie: parsed.isFreebie,
      guid: xmlText(item, 'guid') ?? link,
    };
  });
}

/** One feed, robots.txt checked first. Throws on any failure so the caller decides what a failed feed means. */
export async function fetchHukdFeed(url: string, fetchFn: typeof fetch = fetch): Promise<HukdDeal[]> {
  await assertAllowedByRobots(url, fetchFn);
  const res = await fetchFn(url, { headers: hukdHeaders(), signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  // A challenge or error page is not an empty feed: say so rather than report "no deals".
  if (!/<rss[\s>]/i.test(xml)) throw new Error('response was not an RSS feed (blocked, moved or changed?)');
  return parseHukdFeed(xml);
}

/** Tag feeds worth reading for memory deals; `ram` is the signal, the other two catch posts nobody tagged `ram`. */
export const HUKD_TAG_FEEDS = ['ram', 'computers', 'electronics'] as const;
export const hukdFeedUrl = (tag: string) => `${HUKD_BASE}/rss/tag/${tag}`;

/**
 * Several feeds, merged and deduplicated by guid, newest first. `failures` names feeds that did not answer; `byFeed` lists the guids each
 * feed that DID answer held, so a caller can tell whether two polls of the same feed overlapped (a feed shows only its newest ~30 items).
 */
export async function fetchHukdFeeds(tags: readonly string[] = HUKD_TAG_FEEDS, fetchFn: typeof fetch = fetch): Promise<{ deals: HukdDeal[]; failures: string[]; byFeed?: Record<string, string[]> }> {
  const deals = new Map<string, HukdDeal>();
  const failures: string[] = [];
  const byFeed: Record<string, string[]> = {};
  for (const tag of tags) {
    try {
      const items = await fetchHukdFeed(hukdFeedUrl(tag), fetchFn);
      byFeed[tag] = items.map(d => d.guid);
      for (const d of items) if (!deals.has(d.guid)) deals.set(d.guid, d);
    } catch (e) {
      failures.push(`${tag}: ${e instanceof RobotsDisallowedError ? e.message : (e as Error).message}`);
    }
  }
  return { deals: [...deals.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)), failures, byFeed };
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Every word of the query must appear in the title or description (case-insensitive). */
export function matchesQuery(deal: Pick<HukdDeal, 'title' | 'description'>, query: string): boolean {
  const hay = `${deal.title} ${deal.description}`.toLowerCase();
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every(w => hay.includes(w));
}

export async function searchHukd(
  query: string,
  maxResults = 20,
  fetchFn: typeof fetch = fetch,
): Promise<HukdSearchResult> {
  const fetchedAt = new Date().toISOString();
  const { deals, failures } = await fetchHukdFeeds(HUKD_TAG_FEEDS, fetchFn);
  if (deals.length === 0 && failures.length > 0) return { query, deals: [], fetchedAt, error: failures.join('; ') };
  return {
    query, fetchedAt,
    deals: deals.filter(d => matchesQuery(d, query)).slice(0, maxResults),
    note: failures.length > 0 ? `some feeds did not answer (${failures.join('; ')}); results may be incomplete` : undefined,
  };
}

export async function getHukdHotDeals(
  category: 'computing' | 'all' = 'computing',
  maxResults = 20,
  fetchFn: typeof fetch = fetch,
): Promise<HukdSearchResult> {
  const fetchedAt = new Date().toISOString();
  const label = `Hot ${category} deals`;
  try {
    const deals = await fetchHukdFeed(category === 'all' ? `${HUKD_BASE}/rss/trending` : hukdFeedUrl('computers'), fetchFn);
    return { query: label, deals: deals.slice(0, maxResults), fetchedAt };
  } catch (e) {
    return { query: label, deals: [], fetchedAt, error: e instanceof RobotsDisallowedError ? e.message : (e as Error).message };
  }
}

export async function searchHukdForComponent(componentName: string): Promise<HukdSearchResult> {
  // Remove brand noise and focus on model number for tighter results
  const q = componentName.replace(/\b(graphics card|gpu|cpu|processor|motherboard)\b/gi, '').trim();
  return searchHukd(q, 15);
}
