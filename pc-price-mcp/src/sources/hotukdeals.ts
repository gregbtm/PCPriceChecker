// HotUKDeals RSS integration — UK's largest deal community.
// No API key required. Covers flash sales, voucher codes, and time-limited
// deals that don't appear on retailer APIs.
//
// RSS search: https://www.hotukdeals.com/search?q={query}&view=rss
// Hot deals:  https://www.hotukdeals.com/deals/feed.rss?category=computing

const HUKD_BASE = 'https://www.hotukdeals.com';
const TIMEOUT_MS = 10_000;

const HUKD_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (compatible; pc-price-mcp/1.0; RSS reader)',
  Accept: 'application/rss+xml, application/xml, text/xml, */*',
  'Accept-Language': 'en-GB,en;q=0.9',
};

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
}

export interface HukdSearchResult {
  query: string;
  deals: HukdDeal[];
  fetchedAt: string;
  error?: string;
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

async function fetchAndParse(url: string, queryLabel: string): Promise<HukdSearchResult> {
  const fetchedAt = new Date().toISOString();
  try {
    const res = await fetch(url, {
      headers: HUKD_HEADERS,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();

    const rawItems = extractItems(xml);
    const deals: HukdDeal[] = rawItems.map(item => {
      const title = xmlText(item, 'title') ?? '';
      const link  = xmlText(item, 'link') ?? xmlText(item, 'guid') ?? '';
      const desc  = xmlText(item, 'description') ?? '';
      const pub   = xmlText(item, 'pubDate') ?? '';
      const cat   = xmlText(item, 'category');
      const img   = xmlAttr(item, 'enclosure', 'url') ?? xmlAttr(item, 'media:thumbnail', 'url');

      const { price, merchant, isFreebie } = parseDealTitle(title);

      return {
        title,
        url: link,
        merchant,
        price,
        currency: 'GBP',
        description: stripHtml(desc),
        publishedAt: pub ? new Date(pub).toISOString() : fetchedAt,
        category: cat,
        permalink: link,
        imageUrl: img ?? null,
        isFreebie,
      };
    });

    return { query: queryLabel, deals, fetchedAt };
  } catch (err: any) {
    return { query: queryLabel, deals: [], fetchedAt, error: String(err.message) };
  }
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function searchHukd(
  query: string,
  maxResults = 20,
): Promise<HukdSearchResult> {
  const url = `${HUKD_BASE}/search?q=${encodeURIComponent(query)}&view=rss`;
  const result = await fetchAndParse(url, query);
  result.deals = result.deals.slice(0, maxResults);
  return result;
}

export async function getHukdHotDeals(
  category: 'computing' | 'all' = 'computing',
  maxResults = 20,
): Promise<HukdSearchResult> {
  const url =
    category === 'all'
      ? `${HUKD_BASE}/deals/feed.rss`
      : `${HUKD_BASE}/deals/feed.rss?category=${category}`;
  const result = await fetchAndParse(url, `Hot ${category} deals`);
  result.deals = result.deals.slice(0, maxResults);
  return result;
}

export async function searchHukdForComponent(componentName: string): Promise<HukdSearchResult> {
  // Remove brand noise and focus on model number for tighter results
  const q = componentName.replace(/\b(graphics card|gpu|cpu|processor|motherboard)\b/gi, '').trim();
  return searchHukd(q, 15);
}
