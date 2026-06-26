/**
 * CamelCamelCamel UK — Amazon price history scraper.
 * URL: https://uk.camelcamelcamel.com
 * Provides all-time low/high and historical price trend for Amazon UK listings.
 */

export interface CamelPricePoint { date: string; price: number; }

export interface CamelProduct {
  name: string;
  asin: string;
  productUrl: string;
  camelUrl: string;
  currentAmazonPrice: number | null;
  allTimeLow: number | null;
  allTimeHigh: number | null;
  avg30d: number | null;
  currency: string;
  priceHistory: CamelPricePoint[];
  scraperNote?: string;
}

export interface CamelSearchResult {
  query: string;
  products: CamelProduct[];
  scrapedAt: string;
  durationMs: number;
  error?: string;
}

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-GB,en;q=0.9',
};

async function fetchCamel(path: string): Promise<string> {
  const res = await fetch(`https://uk.camelcamelcamel.com${path}`, {
    headers: HEADERS,
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from CamelCamelCamel`);
  return res.text();
}

async function searchCamelProducts(query: string): Promise<Array<{ asin: string; name: string; productUrl: string }>> {
  const html = await fetchCamel(`/search?sq=${encodeURIComponent(query)}`);

  const results: Array<{ asin: string; name: string; productUrl: string }> = [];

  // Extract product links — CamelCamelCamel product URLs: /product/ASIN
  for (const [, asin, rawName] of html.matchAll(/href="\/product\/([A-Z0-9]{10})"[^>]*>([\s\S]*?)<\/a>/g)) {
    const name = rawName.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (name.length < 3 || name.length > 300) continue;
    if (results.some(r => r.asin === asin)) continue;
    results.push({ asin, name, productUrl: `https://www.amazon.co.uk/dp/${asin}` });
  }

  return results.slice(0, 5);
}

async function scrapeCamelProductPage(asin: string): Promise<Partial<CamelProduct>> {
  let html: string;
  try {
    html = await fetchCamel(`/product/${asin}`);
  } catch { return {}; }

  // ── Strategy 1: Highcharts / chart data embedded in scripts ───────────────
  const priceHistory: CamelPricePoint[] = [];

  // CamelCamelCamel stores price history as JS arrays: [[epoch_seconds, price], ...]
  for (const [, raw] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    // Look for the Amazon price data array (series[0] typically)
    const arrayMatch = raw.match(/(?:new Date|data)\s*[\(:]\s*\[(\[\d+,[\d.]+\](?:,\[\d+,[\d.]+\])*)\]/);
    if (arrayMatch) {
      try {
        const pairs: [number, number][] = JSON.parse(`[${arrayMatch[1]}]`);
        for (const [ts, price] of pairs) {
          if (ts > 0 && price > 0) {
            priceHistory.push({
              date: new Date(ts * 1000).toISOString().split('T')[0],
              price: Number(price.toFixed(2)),
            });
          }
        }
      } catch { /* continue */ }
    }
  }

  // ── Strategy 2: Extract stats from the price table ─────────────────────────
  let allTimeLow: number | null = null;
  let allTimeHigh: number | null = null;
  let avg30d: number | null = null;
  let currentAmazonPrice: number | null = null;

  // Stats table patterns — CamelCamelCamel shows a table with Lowest/Highest/Average
  const lowMatch = html.match(/(?:all[- ]?time low|lowest)[^£]*£\s*([\d,]+\.?\d*)/i)
    ?? html.match(/class="[^"]*price_low[^"]*"[^>]*>£\s*([\d,]+\.?\d*)/i);
  const highMatch = html.match(/(?:all[- ]?time high|highest)[^£]*£\s*([\d,]+\.?\d*)/i)
    ?? html.match(/class="[^"]*price_high[^"]*"[^>]*>£\s*([\d,]+\.?\d*)/i);
  const avgMatch = html.match(/(?:30.?day|average)[^£]*£\s*([\d,]+\.?\d*)/i);
  const currentMatch = html.match(/(?:current|amazon)[^£]*£\s*([\d,]+\.?\d*)/i)
    ?? html.match(/itemprop="price"[^>]*content="([\d.]+)"/i);

  if (lowMatch) allTimeLow = parseFloat(lowMatch[1].replace(/,/g, ''));
  if (highMatch) allTimeHigh = parseFloat(highMatch[1].replace(/,/g, ''));
  if (avgMatch) avg30d = parseFloat(avgMatch[1].replace(/,/g, ''));
  if (currentMatch) currentAmazonPrice = parseFloat(currentMatch[1].replace(/,/g, ''));

  // Fill from history if stats not found
  if (priceHistory.length > 0) {
    const prices = priceHistory.map(p => p.price);
    if (!allTimeLow) allTimeLow = Math.min(...prices);
    if (!allTimeHigh) allTimeHigh = Math.max(...prices);
    if (!avg30d) {
      const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString().split('T')[0];
      const recent = priceHistory.filter(p => p.date >= cutoff).map(p => p.price);
      if (recent.length > 0) avg30d = Math.round((recent.reduce((a, b) => a + b, 0) / recent.length) * 100) / 100;
    }
    if (!currentAmazonPrice) currentAmazonPrice = priceHistory[priceHistory.length - 1]?.price ?? null;
  }

  const note = priceHistory.length === 0
    ? 'Price history not extracted — CamelCamelCamel may have changed their chart format'
    : `${priceHistory.length} historical price points extracted`;

  return { allTimeLow, allTimeHigh, avg30d, currentAmazonPrice, priceHistory, currency: 'GBP', scraperNote: note };
}

export async function getAmazonPriceHistory(query: string): Promise<CamelSearchResult> {
  const t0 = Date.now();

  try {
    const searchResults = await searchCamelProducts(query);

    if (searchResults.length === 0) {
      return { query, products: [], scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0,
        error: 'No matching products found on CamelCamelCamel UK' };
    }

    // Scrape top 3 — sequential with small delay to be polite
    const products: CamelProduct[] = [];
    for (const sr of searchResults.slice(0, 3)) {
      const details = await scrapeCamelProductPage(sr.asin);
      products.push({
        name: sr.name, asin: sr.asin,
        productUrl: sr.productUrl,
        camelUrl: `https://uk.camelcamelcamel.com/product/${sr.asin}`,
        currentAmazonPrice: details.currentAmazonPrice ?? null,
        allTimeLow: details.allTimeLow ?? null,
        allTimeHigh: details.allTimeHigh ?? null,
        avg30d: details.avg30d ?? null,
        currency: 'GBP',
        priceHistory: details.priceHistory ?? [],
        scraperNote: details.scraperNote,
      });
      await new Promise(r => setTimeout(r, 800));
    }

    return { query, products, scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0 };
  } catch (err) {
    return { query, products: [], scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0,
      error: `Scrape error: ${(err as Error).message}` };
  }
}
