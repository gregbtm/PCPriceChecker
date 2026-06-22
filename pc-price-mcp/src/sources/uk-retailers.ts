/**
 * Direct scrapers for UK PC component retailers.
 * Supplements PricesAPI.io with zero-latency scrapes from:
 *   - Scan.co.uk
 *   - Overclockers UK (overclockers.co.uk)
 *   - Ebuyer (ebuyer.com)
 *
 * These sites have no public APIs. Scraping is best-effort;
 * page structure changes will degrade results gracefully.
 */

export interface RetailerResult {
  retailer: string;
  name: string;
  price: number | null;
  currency: string;
  inStock: boolean;
  url: string;
  sku?: string;
  scraperNote?: string;
}

export interface RetailerSearchResult {
  retailer: string;
  results: RetailerResult[];
  scrapedAt: string;
  durationMs: number;
  error?: string;
}

const SHARED_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Cache-Control': 'no-cache',
};

const FETCH_TIMEOUT_MS = 12_000;

// ── Shared utilities ───────────────────────────────────────────────────────

function extractGbpPrice(text: string): number | null {
  const m = text.match(/£\s*([\d,]+(?:\.\d{2})?)/);
  if (!m) return null;
  const price = parseFloat(m[1].replace(/,/g, ''));
  return price > 0 && price < 100_000 ? price : null;
}

function extractJsonLdProducts(html: string): RetailerResult[] {
  const results: RetailerResult[] = [];
  for (const [, raw] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const ld = JSON.parse(raw);
      const items: any[] = Array.isArray(ld) ? ld : [ld];
      for (const item of items) {
        if (item['@type'] !== 'Product') continue;
        const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
        const price = offer?.price != null ? Number(offer.price) : null;
        if (price == null || price <= 0) continue;
        results.push({
          retailer: '',
          name: item.name ?? 'Unknown',
          price,
          currency: offer?.priceCurrency ?? 'GBP',
          inStock:
            offer?.availability == null ||
            offer.availability.includes('InStock') ||
            offer.availability.includes('PreOrder'),
          url: item.url ?? offer?.url ?? '',
          sku: item.sku ?? item.mpn,
        });
      }
    } catch { /* continue */ }
  }
  return results;
}

/** Strip HTML tags and collapse whitespace. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// ── Scan.co.uk ─────────────────────────────────────────────────────────────

export async function scanSearch(query: string): Promise<RetailerSearchResult> {
  const t0 = Date.now();
  const retailer = 'Scan.co.uk';
  const url = `https://www.scan.co.uk/search?q=${encodeURIComponent(query)}`;

  try {
    const res = await fetch(url, {
      headers: SHARED_HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      return { retailer, results: [], scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0, error: `HTTP ${res.status}` };
    }

    const html = await res.text();

    // Strategy 1 — JSON-LD Product structured data (Scan does embed these)
    const fromLd = extractJsonLdProducts(html).map(r => ({ ...r, retailer, url: r.url || url }));
    if (fromLd.length > 0) {
      return { retailer, results: fromLd.slice(0, 8), scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0 };
    }

    // Strategy 2 — Scan product list HTML parsing
    // Scan uses data attributes like data-product-title, data-buy-price
    const results: RetailerResult[] = [];

    // Look for price patterns near product names in the search results
    const productBlocks = html.match(/<li[^>]*class="[^"]*product[^"]*"[^>]*>([\s\S]*?)<\/li>/gi) ?? [];

    for (const block of productBlocks.slice(0, 10)) {
      const nameMatch = block.match(/data-product-title="([^"]+)"/i)
        ?? block.match(/title="([^"]+)"/)
        ?? block.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
      const priceMatch = block.match(/data-buy-price="([\d.]+)"/i)
        ?? block.match(/class="[^"]*price[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i);
      const linkMatch = block.match(/href="(\/[^"]+)"/);

      const rawName = nameMatch ? stripHtml(nameMatch[1]) : null;
      const rawPrice = priceMatch ? extractGbpPrice(stripHtml(priceMatch[0])) : null;

      if (!rawName || !rawPrice) continue;

      results.push({
        retailer,
        name: rawName,
        price: rawPrice,
        currency: 'GBP',
        inStock: !block.toLowerCase().includes('out of stock') && !block.toLowerCase().includes('no stock'),
        url: linkMatch ? `https://www.scan.co.uk${linkMatch[1]}` : url,
      });
    }

    // Strategy 3 — fall back to £price patterns anywhere in page
    if (results.length === 0) {
      const gbpMatches = [...html.matchAll(/£\s*([\d,]+(?:\.\d{2})?)/g)]
        .map(m => parseFloat(m[1].replace(/,/g, '')))
        .filter(p => p > 10 && p < 50_000);

      if (gbpMatches.length > 0) {
        results.push({
          retailer,
          name: query,
          price: Math.min(...gbpMatches),
          currency: 'GBP',
          inStock: true,
          url,
          scraperNote: 'Price inferred from page — could not parse individual products',
        });
      }
    }

    return {
      retailer,
      results: results.slice(0, 8),
      scrapedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      error: results.length === 0 ? 'No products parsed — Scan may require JS rendering' : undefined,
    };
  } catch (err) {
    return {
      retailer,
      results: [],
      scrapedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      error: `Fetch error: ${(err as Error).message}`,
    };
  }
}

// ── Overclockers UK ────────────────────────────────────────────────────────

export async function overclockerSearch(query: string): Promise<RetailerSearchResult> {
  const t0 = Date.now();
  const retailer = 'Overclockers UK';
  const url = `https://www.overclockers.co.uk/search?q=${encodeURIComponent(query)}`;

  try {
    const res = await fetch(url, {
      headers: SHARED_HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      return { retailer, results: [], scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0, error: `HTTP ${res.status}` };
    }

    const html = await res.text();

    // Strategy 1 — JSON-LD
    const fromLd = extractJsonLdProducts(html).map(r => ({ ...r, retailer, url: r.url || url }));
    if (fromLd.length > 0) {
      return { retailer, results: fromLd.slice(0, 8), scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0 };
    }

    // Strategy 2 — __NEXT_DATA__ (Overclockers runs on Next.js)
    const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextMatch) {
      try {
        const nextData = JSON.parse(nextMatch[1]);
        const products: any[] = extractProductsFromNextData(nextData);
        if (products.length > 0) {
          return {
            retailer,
            results: products.slice(0, 8).map(p => ({
              retailer,
              name: p.name ?? p.title ?? query,
              price: p.price != null ? Number(p.price) : null,
              currency: 'GBP',
              inStock: p.inStock != null ? Boolean(p.inStock) : p.stock_status !== 'outofstock',
              url: p.url ? `https://www.overclockers.co.uk${p.url}` : url,
              sku: p.sku,
            })),
            scrapedAt: new Date().toISOString(),
            durationMs: Date.now() - t0,
          };
        }
      } catch { /* fall through */ }
    }

    // Strategy 3 — HTML product block parsing
    const results = parseProductBlocks(html, retailer, 'overclockers.co.uk', url);

    return {
      retailer,
      results: results.slice(0, 8),
      scrapedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      error: results.length === 0 ? 'No products parsed — site may require JS rendering' : undefined,
    };
  } catch (err) {
    return {
      retailer,
      results: [],
      scrapedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      error: `Fetch error: ${(err as Error).message}`,
    };
  }
}

// ── Ebuyer ─────────────────────────────────────────────────────────────────

export async function ebuyerSearch(query: string): Promise<RetailerSearchResult> {
  const t0 = Date.now();
  const retailer = 'Ebuyer';
  const url = `https://www.ebuyer.com/search?q=${encodeURIComponent(query)}`;

  try {
    const res = await fetch(url, {
      headers: SHARED_HEADERS,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!res.ok) {
      return { retailer, results: [], scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0, error: `HTTP ${res.status}` };
    }

    const html = await res.text();

    // Strategy 1 — JSON-LD
    const fromLd = extractJsonLdProducts(html).map(r => ({ ...r, retailer, url: r.url || url }));
    if (fromLd.length > 0) {
      return { retailer, results: fromLd.slice(0, 8), scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0 };
    }

    // Strategy 2 — Ebuyer embeds product JSON in <script> tags
    for (const [, raw] of html.matchAll(/<script[^>]*>([\s\S]*?window\.__(?:INITIAL|NUXT|PRELOADED)_STATE[\s\S]*?)<\/script>/g)) {
      const stateMatch = raw.match(/window\.__\w+_STATE__\s*=\s*(\{[\s\S]*?\});?\s*(?:<|$)/);
      if (stateMatch) {
        try {
          const state = JSON.parse(stateMatch[1]);
          const products = flattenStateProducts(state);
          if (products.length > 0) {
            return {
              retailer,
              results: products.slice(0, 8).map(p => ({
                retailer,
                name: p.name ?? query,
                price: p.price != null ? Number(p.price) : null,
                currency: 'GBP',
                inStock: p.inStock ?? true,
                url: p.url ? (p.url.startsWith('http') ? p.url : `https://www.ebuyer.com${p.url}`) : url,
                sku: p.sku ?? p.id,
              })),
              scrapedAt: new Date().toISOString(),
              durationMs: Date.now() - t0,
            };
          }
        } catch { /* fall through */ }
      }
    }

    // Strategy 3 — HTML product block parsing
    const results = parseProductBlocks(html, retailer, 'ebuyer.com', url);

    return {
      retailer,
      results: results.slice(0, 8),
      scrapedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      error: results.length === 0 ? 'No products parsed — Ebuyer may require JS rendering' : undefined,
    };
  } catch (err) {
    return {
      retailer,
      results: [],
      scrapedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      error: `Fetch error: ${(err as Error).message}`,
    };
  }
}

// ── Aggregator ─────────────────────────────────────────────────────────────

export async function searchAllUkRetailers(
  query: string,
  retailers: ('scan' | 'overclockers' | 'ebuyer')[] = ['scan', 'overclockers', 'ebuyer'],
): Promise<RetailerSearchResult[]> {
  const tasks: Promise<RetailerSearchResult>[] = [];
  if (retailers.includes('scan')) tasks.push(scanSearch(query));
  if (retailers.includes('overclockers')) tasks.push(overclockerSearch(query));
  if (retailers.includes('ebuyer')) tasks.push(ebuyerSearch(query));

  // Run in parallel — each has its own timeout
  return Promise.all(tasks);
}

// ── Private helpers ────────────────────────────────────────────────────────

function parseProductBlocks(
  html: string,
  retailer: string,
  domain: string,
  fallbackUrl: string,
): RetailerResult[] {
  const results: RetailerResult[] = [];

  // Common product block patterns used by many Magento/Shopify/WooCommerce sites
  const blockPatterns = [
    /<(?:article|div|li)[^>]*class="[^"]*(?:product[-_]?(?:item|card|tile|listing))[^"]*"[^>]*>([\s\S]*?)(?=<\/(?:article|div|li)>)/gi,
    /<div[^>]*(?:data-product|itemtype="[^"]*Product")[^>]*>([\s\S]*?)<\/div>/gi,
  ];

  for (const pattern of blockPatterns) {
    for (const [, block] of html.matchAll(pattern)) {
      const nameMatch = block.match(/<(?:h[1-6]|a)[^>]*(?:class="[^"]*(?:title|name)[^"]*")?[^>]*>([\s\S]*?)<\/(?:h[1-6]|a)>/i);
      const price = extractGbpPrice(block);
      const linkMatch = block.match(/href="([^"]*\/(?:product|p|item|products)\/[^"]*?)"/i)
        ?? block.match(/href="(\/[^"]{5,}?)"/);

      if (!nameMatch || !price) continue;
      const name = stripHtml(nameMatch[1]);
      if (name.length < 3 || name.length > 200) continue;

      results.push({
        retailer,
        name,
        price,
        currency: 'GBP',
        inStock:
          !block.toLowerCase().includes('out of stock') &&
          !block.toLowerCase().includes('unavailable'),
        url: linkMatch
          ? linkMatch[1].startsWith('http')
            ? linkMatch[1]
            : `https://www.${domain}${linkMatch[1]}`
          : fallbackUrl,
      });
    }
    if (results.length > 0) break;
  }

  return results;
}

function extractProductsFromNextData(data: any, depth = 0): any[] {
  if (depth > 6 || data == null || typeof data !== 'object') return [];
  if (Array.isArray(data)) {
    if (data.length > 0 && data[0]?.name != null && data[0]?.price != null) return data;
    for (const item of data) {
      const res = extractProductsFromNextData(item, depth + 1);
      if (res.length > 0) return res;
    }
    return [];
  }
  for (const key of Object.keys(data)) {
    const lk = key.toLowerCase();
    if (lk === 'products' || lk === 'items' || lk === 'hits' || lk === 'results') {
      const val = data[key];
      if (Array.isArray(val) && val.length > 0) return val;
    }
  }
  for (const key of Object.keys(data)) {
    const res = extractProductsFromNextData(data[key], depth + 1);
    if (res.length > 0) return res;
  }
  return [];
}

function flattenStateProducts(state: any): any[] {
  return extractProductsFromNextData(state);
}
