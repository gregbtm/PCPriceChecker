// Bing Web Search API v7 — UK product price search.
// Catches retailers and listings that PricesAPI, AWIN, and the direct scrapers miss.
// API key: BING_API_KEY
// Get one: portal.azure.com → Create resource → "Bing Search v7"
// Free tier: 1,000 calls/month. Then ~£0.003/call (S1 tier).

const BING_ENDPOINT = 'https://api.bing.microsoft.com/v7.0/search';
const TIMEOUT_MS = 10_000;

// UK PC retailers included in the site: filter — favours structured results
const UK_RETAILER_SITES = [
  'scan.co.uk',
  'overclockers.co.uk',
  'ebuyer.com',
  'ccl.co.uk',
  'box.co.uk',
  'novatech.co.uk',
  'aria.co.uk',
  'awdit.co.uk',
  'amazon.co.uk',
  'currys.co.uk',
  'argos.co.uk',
  'johnlewis.com',
  'laptopsdirect.co.uk',
  'chillblast.com',
  'pcspecialist.co.uk',
  'cyberpower.co.uk',
];

export interface BingPriceResult {
  name: string;
  url: string;
  siteName: string;
  price: number | null;
  currency: string;
  snippet: string;
  datePublished: string | null;
  inStock: boolean | null;
}

export interface BingSearchResult {
  query: string;
  results: BingPriceResult[];
  totalEstimated: number;
  fetchedAt: string;
  error?: string;
}

// ── Price extraction from snippet/name ───────────────────────────────────

function extractGbpPrice(text: string): number | null {
  const m = text.match(/£\s*([\d,]+(?:\.\d{2})?)/);
  if (!m) return null;
  const p = parseFloat(m[1].replace(/,/g, ''));
  return p > 0 && p < 50_000 ? p : null;
}

function extractSiteName(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host;
  } catch {
    return url;
  }
}

function detectInStock(text: string): boolean | null {
  const lower = text.toLowerCase();
  if (/in stock|available|add to (cart|basket)/i.test(lower)) return true;
  if (/out of stock|unavailable|sold out/i.test(lower)) return false;
  return null;
}

// ── Bing API call ──────────────────────────────────────────────────────────

async function bingGet(query: string, count: number): Promise<any> {
  const apiKey = process.env.BING_API_KEY;
  if (!apiKey) throw new Error('BING_API_KEY not set');

  const params = new URLSearchParams({
    q: query,
    mkt: 'en-GB',
    count: String(count),
    responseFilter: 'Webpages',
    safeSearch: 'Moderate',
  });

  const res = await fetch(`${BING_ENDPOINT}?${params}`, {
    headers: {
      'Ocp-Apim-Subscription-Key': apiKey,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Bing API ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json();
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function bingSearchPrices(
  componentName: string,
  maxResults = 10,
  limitToUkRetailers = true,
): Promise<BingSearchResult> {
  const fetchedAt = new Date().toISOString();

  if (!process.env.BING_API_KEY) {
    return {
      query: componentName,
      results: [],
      totalEstimated: 0,
      fetchedAt,
      error: 'BING_API_KEY not configured. Set it in your environment to enable Bing price search.',
    };
  }

  // Build query: component name + UK price context + optional site: filter
  const siteFilter = limitToUkRetailers
    ? `(${UK_RETAILER_SITES.slice(0, 8).map(s => `site:${s}`).join(' OR ')})`
    : 'site:*.co.uk OR site:*.com';
  const query = `"${componentName}" buy price UK ${siteFilter}`;

  try {
    const data = await bingGet(query, Math.min(maxResults + 5, 50));
    const pages = data?.webPages?.value ?? [];
    const totalEstimated = data?.webPages?.totalEstimatedMatches ?? 0;

    const results: BingPriceResult[] = pages
      .map((page: any): BingPriceResult => {
        const combined = `${page.name ?? ''} ${page.snippet ?? ''}`;
        return {
          name: String(page.name ?? ''),
          url: String(page.url ?? ''),
          siteName: extractSiteName(String(page.url ?? '')),
          price: extractGbpPrice(combined),
          currency: 'GBP',
          snippet: String(page.snippet ?? '').slice(0, 300),
          datePublished: page.dateLastCrawled ? String(page.dateLastCrawled) : null,
          inStock: detectInStock(combined),
        };
      })
      // Prefer results that have a price, then sort by price ascending
      .sort((a: BingPriceResult, b: BingPriceResult) => {
        if (a.price !== null && b.price === null) return -1;
        if (a.price === null && b.price !== null) return 1;
        if (a.price !== null && b.price !== null) return a.price - b.price;
        return 0;
      })
      .slice(0, maxResults);

    return { query: componentName, results, totalEstimated, fetchedAt };
  } catch (err: any) {
    return { query: componentName, results: [], totalEstimated: 0, fetchedAt, error: String(err.message) };
  }
}

export async function bingFindRetailers(
  componentName: string,
): Promise<BingSearchResult> {
  // Broader search — not limited to known retailers, finds long-tail UK shops
  const fetchedAt = new Date().toISOString();

  if (!process.env.BING_API_KEY) {
    return {
      query: componentName,
      results: [],
      totalEstimated: 0,
      fetchedAt,
      error: 'BING_API_KEY not configured.',
    };
  }

  const query = `buy "${componentName}" price £ UK`;

  try {
    const data = await bingGet(query, 20);
    const pages = data?.webPages?.value ?? [];

    const results: BingPriceResult[] = pages
      .map((page: any): BingPriceResult => {
        const combined = `${page.name ?? ''} ${page.snippet ?? ''}`;
        return {
          name: String(page.name ?? ''),
          url: String(page.url ?? ''),
          siteName: extractSiteName(String(page.url ?? '')),
          price: extractGbpPrice(combined),
          currency: 'GBP',
          snippet: String(page.snippet ?? '').slice(0, 300),
          datePublished: page.dateLastCrawled ? String(page.dateLastCrawled) : null,
          inStock: detectInStock(combined),
        };
      })
      .filter((r: BingPriceResult) => r.price !== null) // only results with extractable prices
      .sort((a: BingPriceResult, b: BingPriceResult) => (a.price ?? 0) - (b.price ?? 0))
      .slice(0, 15);

    return { query: componentName, results, totalEstimated: pages.length, fetchedAt };
  } catch (err: any) {
    return { query: componentName, results: [], totalEstimated: 0, fetchedAt, error: String(err.message) };
  }
}
