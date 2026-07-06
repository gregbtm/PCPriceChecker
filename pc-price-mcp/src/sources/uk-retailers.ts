/**
 * Direct scrapers for UK PC component retailers (no API key required).
 * Covered: Scan.co.uk, Overclockers UK, Ebuyer, CCL Online, Box.co.uk,
 *          Novatech, Aria PC, AWD-IT
 *
 * All scrapers are best-effort. These sites render heavily with JS so
 * structured data (JSON-LD, __NEXT_DATA__) is extracted where available,
 * with HTML pattern fallbacks. A plain-fetch miss escalates to a stealth
 * browser render (local Chromium / Camoufox / Novada, whichever is
 * configured) and finally to Byparr, before giving up.
 */
import * as db from '../db.js';
import { renderPageHtml } from './playwright-scraper.js';
import { renderWithByparr } from './byparr-client.js';

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

export type RetailerId = 'scan' | 'overclockers' | 'ebuyer' | 'ccl' | 'box' | 'novatech' | 'aria' | 'awdit'
  | 'corsair' | 'nzxt' | 'coolermaster' | 'lianli' | 'fractal' | 'thermaltake'
  | 'currys' | 'argos' | 'johnlewis';

const SHARED_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Cache-Control': 'no-cache',
};

const TIMEOUT_MS = 12_000;

// ── Shared utilities ───────────────────────────────────────────────────────

function extractGbpPrice(text: string): number | null {
  const m = text.match(/£\s*([\d,]+(?:\.\d{2})?)/);
  if (!m) return null;
  const price = parseFloat(m[1].replace(/,/g, ''));
  return price > 0 && price < 100_000 ? price : null;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractJsonLdProducts(html: string, retailer: string, baseUrl: string): RetailerResult[] {
  const results: RetailerResult[] = [];
  for (const [, raw] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const ld = JSON.parse(raw);
      const items: any[] = Array.isArray(ld) ? ld : [ld];
      for (const item of items) {
        if (item['@type'] !== 'Product') continue;
        const offer = Array.isArray(item.offers) ? item.offers[0] : item.offers;
        const price = offer?.price != null ? Number(offer.price) : null;
        if (!price || price <= 0) continue;
        results.push({
          retailer, name: item.name ?? 'Unknown', price,
          currency: offer?.priceCurrency ?? 'GBP',
          inStock: offer?.availability ? !offer.availability.includes('OutOfStock') : true,
          url: item.url ?? offer?.url ?? baseUrl,
          sku: item.sku ?? item.mpn,
        });
      }
    } catch { /* continue */ }
  }
  return results;
}

function extractFromNextData(html: string): any[] {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  try {
    const data = JSON.parse(m[1]);
    return findProductArray(data?.props?.pageProps);
  } catch { return []; }
}

function findProductArray(obj: unknown, depth = 0): any[] {
  if (depth > 6 || obj == null || typeof obj !== 'object') return [];
  const rec = obj as Record<string, unknown>;
  for (const key of ['products', 'items', 'hits', 'results', 'data']) {
    const val = rec[key];
    if (Array.isArray(val) && val.length > 0 && val[0]?.name != null) return val;
  }
  for (const key of Object.keys(rec)) {
    const res = findProductArray(rec[key], depth + 1);
    if (res.length > 0) return res;
  }
  return [];
}

function parseProductBlocks(html: string, retailer: string, domain: string, fallbackUrl: string): RetailerResult[] {
  const results: RetailerResult[] = [];
  const patterns = [
    /<(?:article|div|li)[^>]*class="[^"]*(?:product[-_]?(?:item|card|tile|listing|result))[^"]*"[^>]*>([\s\S]*?)(?=<\/(?:article|div|li)>)/gi,
    /<div[^>]*itemtype="[^"]*Product[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
  ];
  for (const pattern of patterns) {
    for (const [, block] of html.matchAll(pattern)) {
      const nameMatch = block.match(/<(?:h[1-6]|a)[^>]*(?:class="[^"]*(?:title|name|product)[^"]*")?[^>]*>([\s\S]*?)<\/(?:h[1-6]|a)>/i);
      const price = extractGbpPrice(block);
      const linkMatch = block.match(/href="([^"]{5,}?)"/);
      if (!nameMatch || !price) continue;
      const name = stripHtml(nameMatch[1]);
      if (name.length < 3 || name.length > 250) continue;
      results.push({
        retailer, name, price, currency: 'GBP',
        inStock: !block.toLowerCase().includes('out of stock') && !block.toLowerCase().includes('unavailable'),
        url: linkMatch
          ? linkMatch[1].startsWith('http') ? linkMatch[1] : `https://www.${domain}${linkMatch[1]}`
          : fallbackUrl,
      });
    }
    if (results.length > 0) break;
  }
  return results;
}

async function fetchPage(url: string): Promise<{ html: string; ok: boolean; status: number }> {
  try {
    const res = await fetch(url, { headers: SHARED_HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { html: res.ok ? await res.text() : '', ok: res.ok, status: res.status };
  } catch (e) {
    return { html: '', ok: false, status: 0 };
  }
}

/**
 * Structured-only extraction — JSON-LD / Next.js data / a retailer's own
 * extractor / generic HTML product blocks. Deliberately excludes the crude
 * "grab the lowest £ price on the page" fallback, so callers can tell a real
 * parse from a guess and decide whether to escalate to a rendered page.
 */
function extractStructuredResults(
  html: string, retailer: string, domain: string, searchUrl: string,
  extraExtract?: (html: string, url: string) => RetailerResult[],
): RetailerResult[] {
  let results = extractJsonLdProducts(html, retailer, searchUrl);

  if (results.length === 0) {
    const nextProducts = extractFromNextData(html);
    if (nextProducts.length > 0) {
      results = nextProducts.slice(0, 8).map((p: any) => ({
        retailer,
        name: p.name ?? p.title ?? p.displayName ?? 'Unknown',
        price: p.price != null ? Number(p.price) : (p.priceRange?.min ?? null),
        currency: 'GBP',
        inStock: p.inStock != null ? Boolean(p.inStock) : (p.available != null ? Boolean(p.available) : p.stock_status !== 'outofstock'),
        url: p.url ? (p.url.startsWith('http') ? p.url : `https://www.${domain}${p.url}`) : searchUrl,
        sku: p.sku ?? p.id,
      }));
    }
  }

  if (results.length === 0 && extraExtract) {
    results = extraExtract(html, searchUrl);
  }

  if (results.length === 0) {
    results = parseProductBlocks(html, retailer, domain, searchUrl);
  }

  return results;
}

function crudePriceFallback(html: string, retailer: string, searchUrl: string): RetailerResult[] {
  const prices = [...html.matchAll(/£\s*([\d,]+(?:\.\d{2})?)/g)]
    .map(m => parseFloat(m[1].replace(/,/g, ''))).filter(p => p > 10 && p < 50_000);
  if (prices.length === 0) return [];
  return [{ retailer, name: 'Search results', price: Math.min(...prices), currency: 'GBP',
    inStock: true, url: searchUrl, scraperNote: 'Only lowest price extracted — page requires JS rendering' }];
}

// ── Generic scraper factory ───────────────────────────────────────────────

async function scrapeRetailer(
  retailer: string,
  searchUrl: string,
  domain: string,
  extraExtract?: (html: string, url: string) => RetailerResult[],
): Promise<RetailerSearchResult> {
  const t0 = Date.now();
  const { html, ok, status } = await fetchPage(searchUrl);

  let results: RetailerResult[] = ok ? extractStructuredResults(html, retailer, domain, searchUrl, extraExtract) : [];

  // Plain fetch got blocked or came back with nothing structured — the exact
  // gap a stealth browser render (and, failing that, Byparr) exists to close.
  if (results.length === 0) {
    const rendered = await renderPageHtml(searchUrl);
    if (rendered) {
      const escalatedResults = extractStructuredResults(rendered, retailer, domain, searchUrl, extraExtract);
      if (escalatedResults.length > 0) {
        results = escalatedResults.map(r => ({ ...r, scraperNote: 'via stealth browser' }));
      }
    }
  }

  if (results.length === 0) {
    const byparrUrl = db.getConfig('byparr_url') ?? process.env.BYPARR_URL;
    if (byparrUrl) {
      const rendered = await renderWithByparr(searchUrl, byparrUrl);
      if (rendered) {
        const escalatedResults = extractStructuredResults(rendered, retailer, domain, searchUrl, extraExtract);
        if (escalatedResults.length > 0) {
          results = escalatedResults.map(r => ({ ...r, scraperNote: 'via Byparr' }));
        }
      }
    }
  }

  if (results.length === 0 && html) {
    results = crudePriceFallback(html, retailer, searchUrl);
  }

  return {
    retailer, results: results.slice(0, 8), scrapedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    error: results.length === 0
      ? (ok ? `No products parsed — ${retailer} may require JS rendering` : (status === 0 ? 'Fetch failed (timeout or network error)' : `HTTP ${status}`))
      : undefined,
  };
}

// ── Individual retailer scrapers ───────────────────────────────────────────

export async function scanSearch(query: string): Promise<RetailerSearchResult> {
  return scrapeRetailer('Scan.co.uk', `https://www.scan.co.uk/search?q=${encodeURIComponent(query)}`, 'scan.co.uk',
    (html, url) => {
      // Scan uses data-product-title and data-buy-price attributes
      const results: RetailerResult[] = [];
      for (const [, block] of html.matchAll(/<li[^>]*class="[^"]*product[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)) {
        const titleAttr = block.match(/data-product-title="([^"]+)"/i);
        const priceAttr = block.match(/data-buy-price="([\d.]+)"/i);
        const link = block.match(/href="(\/products?\/[^"]+)"/i);
        if (!titleAttr || !priceAttr) continue;
        const price = parseFloat(priceAttr[1]);
        if (!price || price <= 0) continue;
        results.push({
          retailer: 'Scan.co.uk', name: titleAttr[1].trim(), price, currency: 'GBP',
          inStock: !block.toLowerCase().includes('no stock'),
          url: link ? `https://www.scan.co.uk${link[1]}` : url,
        });
      }
      return results;
    }
  );
}

export async function overclockerSearch(query: string): Promise<RetailerSearchResult> {
  return scrapeRetailer('Overclockers UK',
    `https://www.overclockers.co.uk/search?q=${encodeURIComponent(query)}`, 'overclockers.co.uk');
}

export async function ebuyerSearch(query: string): Promise<RetailerSearchResult> {
  return scrapeRetailer('Ebuyer', `https://www.ebuyer.com/search?q=${encodeURIComponent(query)}`, 'ebuyer.com',
    (html, url) => {
      const results: RetailerResult[] = [];
      // Ebuyer embeds window.__PRELOADED_STATE__ or similar
      for (const [, raw] of html.matchAll(/<script[^>]*>([\s\S]*?window\.__\w+_STATE__[\s\S]*?)<\/script>/g)) {
        const m = raw.match(/window\.__\w+_STATE__\s*=\s*(\{[\s\S]*?\});\s*(?:<|$)/);
        if (!m) continue;
        try {
          const state = JSON.parse(m[1]);
          const products = findProductArray(state);
          for (const p of products.slice(0, 8)) {
            if (!p.name || p.price == null) continue;
            results.push({
              retailer: 'Ebuyer', name: p.name, price: Number(p.price), currency: 'GBP',
              inStock: p.inStock ?? true,
              url: p.url ? (p.url.startsWith('http') ? p.url : `https://www.ebuyer.com${p.url}`) : url,
              sku: p.sku,
            });
          }
          if (results.length > 0) break;
        } catch { /* continue */ }
      }
      return results;
    }
  );
}

export async function cclSearch(query: string): Promise<RetailerSearchResult> {
  // CCL Online — Barnsley-based, competitive pricing on components
  return scrapeRetailer('CCL Online', `https://www.ccl.co.uk/search?q=${encodeURIComponent(query)}`, 'ccl.co.uk');
}

export async function boxSearch(query: string): Promise<RetailerSearchResult> {
  // Box.co.uk — large UK etailer with strong GPU/CPU stock
  return scrapeRetailer('Box.co.uk', `https://www.box.co.uk/search?search=${encodeURIComponent(query)}`, 'box.co.uk',
    (html, url) => {
      // Box uses a standard WooCommerce/Magento layout with .product-item blocks
      return parseProductBlocks(html, 'Box.co.uk', 'box.co.uk', url);
    }
  );
}

export async function novatechSearch(query: string): Promise<RetailerSearchResult> {
  // Novatech — Portsmouth-based, strong on custom build components
  return scrapeRetailer('Novatech', `https://www.novatech.co.uk/search/?q=${encodeURIComponent(query)}`, 'novatech.co.uk');
}

export async function ariaSearch(query: string): Promise<RetailerSearchResult> {
  // Aria PC — Manchester-based, often competitive on GPUs
  return scrapeRetailer('Aria PC', `https://www.aria.co.uk/SuperSpecials/?search=${encodeURIComponent(query)}`, 'aria.co.uk');
}

export async function awditSearch(query: string): Promise<RetailerSearchResult> {
  // AWD-IT — known for competitive GPU and system builder pricing
  return scrapeRetailer('AWD-IT', `https://www.awd-it.co.uk/search?q=${encodeURIComponent(query)}`, 'awd-it.co.uk');
}

// ── Case manufacturer UK direct stores ────────────────────────────────────

export async function corsairSearch(query: string): Promise<RetailerSearchResult> {
  return scrapeRetailer('Corsair UK',
    `https://www.corsair.com/en-gb/search#q=${encodeURIComponent(query)}`,
    'corsair.com',
    (html, url) => {
      const results = extractJsonLdProducts(html, 'Corsair UK', url);
      if (results.length > 0) return results;
      const m = html.match(/window\.__NUXT__\s*=\s*(\{[\s\S]*?\})\s*(?:<\/script>|;)/);
      if (m) {
        try {
          const state = JSON.parse(m[1]);
          return findProductArray(state).slice(0, 8).map((p) => ({
            retailer: 'Corsair UK',
            name: String((p as Record<string, unknown>).name ?? (p as Record<string, unknown>).title ?? 'Unknown'),
            price: (p as Record<string, unknown>).price != null ? Number((p as Record<string, unknown>).price) : null,
            currency: 'GBP', inStock: (p as Record<string, unknown>).inStock !== false,
            url: (p as Record<string, unknown>).url ? `https://www.corsair.com${(p as Record<string, unknown>).url}` : url,
          }));
        } catch { /* continue */ }
      }
      return [];
    },
  );
}

export async function nzxtSearch(query: string): Promise<RetailerSearchResult> {
  // NZXT uses a Shopify storefront — JSON-LD is present on product pages
  return scrapeRetailer('NZXT UK',
    `https://www.nzxt.com/en-gb/search?q=${encodeURIComponent(query)}`,
    'nzxt.com');
}

export async function coolerMasterSearch(query: string): Promise<RetailerSearchResult> {
  return scrapeRetailer('Cooler Master UK',
    `https://www.coolermaster.com/en-gb/search/?q=${encodeURIComponent(query)}`,
    'coolermaster.com',
    (html, url) => {
      const results = extractJsonLdProducts(html, 'Cooler Master UK', url);
      if (results.length > 0) return results;
      const items: RetailerResult[] = [];
      for (const [, block] of html.matchAll(/<(?:article|div)[^>]*class="[^"]*product[-_]?(?:item|card)[^"]*"[^>]*>([\s\S]*?)(?=<\/(?:article|div)>)/gi)) {
        const nameM = block.match(/class="[^"]*(?:product[-_]?(?:name|title)|title)[^"]*"[^>]*>([\s\S]*?)<\//i);
        const price = extractGbpPrice(block);
        const linkM = block.match(/href="([^"]+)"/i);
        if (!nameM || !price) continue;
        const name = stripHtml(nameM[1]);
        if (name.length < 3) continue;
        items.push({
          retailer: 'Cooler Master UK', name, price, currency: 'GBP',
          inStock: !block.toLowerCase().includes('out of stock'),
          url: linkM ? (linkM[1].startsWith('http') ? linkM[1] : `https://www.coolermaster.com${linkM[1]}`) : url,
        });
      }
      return items;
    },
  );
}

export async function lianLiSearch(query: string): Promise<RetailerSearchResult> {
  // Lian Li global store ships to UK; uses WooCommerce with JSON-LD
  return scrapeRetailer('Lian Li',
    `https://lian-li.com/?s=${encodeURIComponent(query)}&post_type=product`,
    'lian-li.com');
}

export async function fractalSearch(query: string): Promise<RetailerSearchResult> {
  // Fractal Design EU store ships to UK
  return scrapeRetailer('Fractal Design',
    `https://www.fractaldesign.com/search?q=${encodeURIComponent(query)}`,
    'fractaldesign.com',
    (html, url) => {
      const results = extractJsonLdProducts(html, 'Fractal Design', url);
      if (results.length > 0) return results;
      const items: RetailerResult[] = [];
      for (const [, block] of html.matchAll(/<(?:article|div|li)[^>]*class="[^"]*(?:product[-_]?(?:item|card|tile))[^"]*"[^>]*>([\s\S]*?)(?=<\/(?:article|div|li)>)/gi)) {
        const nameM = block.match(/class="[^"]*(?:product[-_]?(?:name|title)|title)[^"]*"[^>]*>([\s\S]*?)<\//i);
        const price = extractGbpPrice(block);
        const linkM = block.match(/href="([^"]+)"/i);
        if (!nameM || !price) continue;
        const name = stripHtml(nameM[1]);
        if (name.length < 3) continue;
        items.push({
          retailer: 'Fractal Design', name, price, currency: 'GBP',
          inStock: !block.toLowerCase().includes('out of stock'),
          url: linkM ? (linkM[1].startsWith('http') ? linkM[1] : `https://www.fractaldesign.com${linkM[1]}`) : url,
        });
      }
      return items;
    },
  );
}

export async function thermaltakeSearch(query: string): Promise<RetailerSearchResult> {
  return scrapeRetailer('Thermaltake UK',
    `https://uk.thermaltake.com/search?q=${encodeURIComponent(query)}`,
    'thermaltake.com',
    (html, url) => {
      const results = extractJsonLdProducts(html, 'Thermaltake UK', url);
      if (results.length > 0) return results;
      const items: RetailerResult[] = [];
      for (const [, block] of html.matchAll(/<(?:article|div|li)[^>]*class="[^"]*(?:product[-_]?(?:item|card|tile))[^"]*"[^>]*>([\s\S]*?)(?=<\/(?:article|div|li)>)/gi)) {
        const nameM = block.match(/class="[^"]*(?:product[-_]?(?:name|title)|title)[^"]*"[^>]*>([\s\S]*?)<\//i);
        const price = extractGbpPrice(block);
        const linkM = block.match(/href="([^"]+)"/i);
        if (!nameM || !price) continue;
        const name = stripHtml(nameM[1]);
        if (name.length < 3) continue;
        items.push({
          retailer: 'Thermaltake UK', name, price, currency: 'GBP',
          inStock: !block.toLowerCase().includes('out of stock'),
          url: linkM ? (linkM[1].startsWith('http') ? linkM[1] : `https://uk.thermaltake.com${linkM[1]}`) : url,
        });
      }
      return items;
    },
  );
}

// ── Mainstream UK retailers ─────────────────────────────────────────────────

export async function currysSearch(query: string): Promise<RetailerSearchResult> {
  const t0 = Date.now();
  try {
    const url = `https://api.currys.co.uk/catalog/products/search/v1?q=${encodeURIComponent(query)}&start=0&sz=8&format=json`;
    const res = await fetch(url, {
      headers: {
        ...SHARED_HEADERS,
        Accept: 'application/json',
        Referer: 'https://www.currys.co.uk/',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      return { retailer: 'Currys', results: [], scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0, error: `HTTP ${res.status}` };
    }
    const data = await res.json() as any;
    const products: any[] = data.products ?? data.data?.products ?? [];
    const results: RetailerResult[] = products.slice(0, 8).map((p: any) => {
      const offer = Array.isArray(p.offers) ? p.offers[0] : (p.offers ?? {});
      const rawPrice = offer.salePrice ?? offer.price ?? p.price ?? null;
      return {
        retailer: 'Currys',
        name: [p.brandName, p.name].filter(Boolean).join(' ') || p.title || 'Unknown',
        price: rawPrice != null ? Number(rawPrice) : null,
        currency: 'GBP',
        inStock: offer.availability === 'IN_STOCK' || offer.availability === 'AVAILABLE' || offer.availability == null,
        url: p.links?.www ?? p.url ?? `https://www.currys.co.uk/search/${encodeURIComponent(query)}/`,
        sku: String(p.id ?? p.sku ?? ''),
      };
    }).filter(r => r.price != null && r.price > 0);
    return { retailer: 'Currys', results, scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0,
      error: results.length === 0 ? 'No products returned from Currys API' : undefined };
  } catch (e) {
    return { retailer: 'Currys', results: [], scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0, error: String(e) };
  }
}

export async function argosSearch(query: string): Promise<RetailerSearchResult> {
  const t0 = Date.now();
  const url = `https://www.argos.co.uk/search/${encodeURIComponent(query)}/`;
  const { html, ok, status } = await fetchPage(url);
  if (!ok) {
    return { retailer: 'Argos', results: [], scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0, error: `HTTP ${status}` };
  }

  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (m) {
    try {
      const data = JSON.parse(m[1]);
      // Argos nests results in multiple possible locations
      const pp = data?.props?.pageProps ?? {};
      const products: any[] =
        pp?.searchResultsData?.results ??
        pp?.initialData?.responses?.[0]?.data?.products ??
        findProductArray(pp) ?? [];
      if (products.length > 0) {
        const results: RetailerResult[] = products.slice(0, 8).map((p: any) => {
          const rawPrice = p.price?.now ?? p.listPrice ?? p.price;
          const price = rawPrice != null ? parseFloat(String(rawPrice).replace(/[^0-9.]/g, '')) : null;
          const slug = p.url ?? p.attributes?.url ?? p.pdpUrl ?? '';
          return {
            retailer: 'Argos',
            name: p.name ?? p.title ?? 'Unknown',
            price: price && price > 0 ? price : null,
            currency: 'GBP',
            inStock: (p.attributes?.availabilityType ?? p.availabilityType ?? '').toLowerCase() !== 'outofstock',
            url: slug ? (slug.startsWith('http') ? slug : `https://www.argos.co.uk${slug}`) : url,
            sku: String(p.partNumber ?? p.id ?? ''),
          };
        }).filter(r => r.price != null);
        return { retailer: 'Argos', results, scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0,
          error: results.length === 0 ? 'No priced products found on Argos' : undefined };
      }
    } catch { /* fall through */ }
  }

  const ldResults = extractJsonLdProducts(html, 'Argos', url);
  if (ldResults.length > 0) {
    return { retailer: 'Argos', results: ldResults.slice(0, 8), scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0 };
  }

  return { retailer: 'Argos', results: [], scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0,
    error: 'No products parsed — Argos requires JS rendering' };
}

export async function johnLewisSearch(query: string): Promise<RetailerSearchResult> {
  const t0 = Date.now();
  const url = `https://www.johnlewis.com/search?search-term=${encodeURIComponent(query)}`;
  const { html, ok, status } = await fetchPage(url);
  if (!ok) {
    return { retailer: 'John Lewis', results: [], scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0, error: `HTTP ${status}` };
  }

  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (m) {
    try {
      const data = JSON.parse(m[1]);
      const pp = data?.props?.pageProps ?? {};
      const products: any[] = pp?.searchResults?.products ?? pp?.products ?? findProductArray(pp) ?? [];
      if (products.length > 0) {
        const results: RetailerResult[] = products.slice(0, 8).map((p: any) => {
          const rawPrice = p.price?.was ?? p.price?.now ?? p.priceLabel?.replace(/[^0-9.]/g, '');
          return {
            retailer: 'John Lewis',
            name: p.title ?? p.name ?? 'Unknown',
            price: rawPrice != null ? parseFloat(String(rawPrice)) : null,
            currency: 'GBP',
            inStock: p.availableInStock !== false && p.stockStatus !== 'OUTOFSTOCK',
            url: p.seoURL ? `https://www.johnlewis.com${p.seoURL}` : (p.url ?? url),
            sku: String(p.id ?? ''),
          };
        }).filter(r => r.price != null && r.price > 0);
        return { retailer: 'John Lewis', results, scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0,
          error: results.length === 0 ? 'No priced products found on John Lewis' : undefined };
      }
    } catch { /* fall through */ }
  }

  const ldResults = extractJsonLdProducts(html, 'John Lewis', url);
  if (ldResults.length > 0) {
    return { retailer: 'John Lewis', results: ldResults.slice(0, 8), scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0 };
  }

  return { retailer: 'John Lewis', results: [], scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0,
    error: 'No products parsed — John Lewis requires JS rendering' };
}

// ── Aggregator ─────────────────────────────────────────────────────────────

const RETAILER_FNS: Record<RetailerId, (q: string) => Promise<RetailerSearchResult>> = {
  scan: scanSearch,
  overclockers: overclockerSearch,
  ebuyer: ebuyerSearch,
  ccl: cclSearch,
  box: boxSearch,
  novatech: novatechSearch,
  aria: ariaSearch,
  awdit: awditSearch,
  corsair: corsairSearch,
  nzxt: nzxtSearch,
  coolermaster: coolerMasterSearch,
  lianli: lianLiSearch,
  fractal: fractalSearch,
  thermaltake: thermaltakeSearch,
  currys: currysSearch,
  argos: argosSearch,
  johnlewis: johnLewisSearch,
};

export const ALL_RETAILER_IDS: RetailerId[] = [
  'scan', 'overclockers', 'ebuyer', 'ccl', 'box', 'novatech', 'aria', 'awdit',
  'corsair', 'nzxt', 'coolermaster', 'lianli', 'fractal', 'thermaltake',
  'currys', 'argos', 'johnlewis',
];

export async function searchAllUkRetailers(
  query: string,
  retailers: RetailerId[] = ALL_RETAILER_IDS,
): Promise<RetailerSearchResult[]> {
  return Promise.all(retailers.map(r => RETAILER_FNS[r](query)));
}
