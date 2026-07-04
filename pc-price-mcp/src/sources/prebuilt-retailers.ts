/**
 * Pre-built desktop PC scrapers for UK retailers.
 * Top 15: Currys, Argos, John Lewis, AO.com, Very, Ebuyer,
 *         Scan, Overclockers, Box, Novatech, CCL, Chillblast,
 *         Dell UK, HP UK, Amazon UK (via PricesAPI).
 *
 * Uses JSON APIs where available, falls back to JSON-LD / HTML extraction.
 * All scrapers are best-effort — JS-heavy pages may return partial data.
 */

import { searchWithRetry } from './pricesapi.js';
import { scrapeDellPrebuilt, scrapeHpPrebuilt } from './playwright-scraper.js';

export interface PrebuiltResult {
  retailer: string;
  name: string;
  price: number | null;
  currency: string;
  inStock: boolean;
  url: string;
  brand?: string;
  cpu?: string;
  gpu?: string;
  ram?: string;
  storage?: string;
  os?: string;
  formFactor?: string;
  sku?: string;
  scraperNote?: string;
}

export interface PrebuiltSearchResult {
  retailer: string;
  results: PrebuiltResult[];
  scrapedAt: string;
  durationMs: number;
  error?: string;
}

export type PrebuiltRetailerId =
  | 'currys' | 'argos' | 'johnlewis' | 'ao' | 'very'
  | 'ebuyer' | 'scan' | 'overclockers' | 'box' | 'novatech'
  | 'ccl' | 'chillblast' | 'dell' | 'hp' | 'amazon'
  | 'pallicomp' | 'costco' | 'cyberpower' | 'pcspecialist' | 'lenovo'
  | 'bedrock';

export const ALL_PREBUILT_RETAILER_IDS: PrebuiltRetailerId[] = [
  'currys', 'argos', 'johnlewis', 'ao', 'very',
  'ebuyer', 'scan', 'overclockers', 'box', 'novatech',
  'ccl', 'chillblast', 'dell', 'hp', 'amazon',
  'pallicomp', 'costco', 'cyberpower', 'pcspecialist', 'lenovo',
  'bedrock',
];

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
  'Cache-Control': 'no-cache',
};

const API_HEADERS: Record<string, string> = {
  ...BROWSER_HEADERS,
  Accept: 'application/json, text/plain, */*',
};

const TIMEOUT_MS = 12_000;
const MAX_RESULTS = 10;

// ── Spec extraction ────────────────────────────────────────────────────────

export function extractSpecs(text: string): {
  cpu?: string; gpu?: string; ram?: string; storage?: string; os?: string; formFactor?: string;
} {
  const specs: { cpu?: string; gpu?: string; ram?: string; storage?: string; os?: string; formFactor?: string } = {};

  const cpuM = text.match(
    /(?:Intel\s+(?:Core\s+)?(?:i[3579]-\d{4,5}[A-Z0-9]*|Core\s+Ultra\s+\d+\s+\d+[A-Z0-9]*)|AMD\s+Ryzen\s+[3579]\s+\d{4,5}[A-Z0-9]*|Intel\s+(?:Celeron|Pentium)\s+[A-Z\d]+)/i,
  );
  if (cpuM) specs.cpu = cpuM[0].trim();

  const gpuM = text.match(
    /(?:NVIDIA\s+(?:GeForce\s+)?RTX\s*\d{4}(?:\s*Ti|\s*Super)?|NVIDIA\s+(?:GeForce\s+)?GTX\s*\d{4}(?:\s*Ti)?|AMD\s+(?:Radeon\s+)?RX\s*\d{4}(?:\s*XT|XTX)?|Intel\s+Arc\s+[A-Z]\d+|GeForce\s+RTX\s*\d{4}(?:\s*Ti|\s*Super)?|RTX\s*\d{4}(?:\s*Ti|\s*Super)?)/i,
  );
  if (gpuM) specs.gpu = gpuM[0].trim();

  const ramM = text.match(/(\d+)\s*GB\s*(?:DDR[45X]?|LPDDR[45]?|RAM|Memory)/i);
  if (ramM) specs.ram = ramM[0].trim();

  const storeM = text.match(/(\d+)\s*(?:GB|TB)\s*(?:NVMe|SSD|HDD|M\.2|SATA)/i);
  if (storeM) specs.storage = storeM[0].trim();

  const lo = text.toLowerCase();
  if (lo.includes('windows 11')) specs.os = 'Windows 11';
  else if (lo.includes('windows 10')) specs.os = 'Windows 10';
  else if (lo.includes('no os') || lo.includes('without os') || lo.includes('freedos')) specs.os = 'No OS';
  else if (lo.includes('ubuntu') || lo.includes('linux')) specs.os = 'Linux';
  else if (lo.includes('chrome os') || lo.includes('chromeos')) specs.os = 'Chrome OS';

  if (lo.includes('all-in-one') || lo.includes('all in one') || lo.includes(' aio ')) specs.formFactor = 'All-in-One';
  else if (lo.includes('mini pc') || lo.includes('mini-pc') || lo.includes(' nuc') || lo.includes('compact')) specs.formFactor = 'Mini PC';
  else if (lo.includes('tower')) specs.formFactor = 'Tower';
  else if (lo.includes('desktop')) specs.formFactor = 'Desktop';

  return specs;
}

// ── Shared utilities ───────────────────────────────────────────────────────

function extractGbpPrice(text: string): number | null {
  const m = text.match(/£\s*([\d,]+(?:\.\d{2})?)/);
  if (!m) return null;
  const p = parseFloat(m[1].replace(/,/g, ''));
  return p > 50 && p < 20_000 ? p : null;
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

async function fetchPage(url: string, headers: Record<string, string> = BROWSER_HEADERS): Promise<{ text: string; ok: boolean; status: number }> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { text: res.ok ? await res.text() : '', ok: res.ok, status: res.status };
  } catch {
    return { text: '', ok: false, status: 0 };
  }
}

async function fetchJson(url: string, headers: Record<string, string> = API_HEADERS): Promise<unknown> {
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function extractJsonLd(html: string, retailer: string, baseUrl: string): PrebuiltResult[] {
  const results: PrebuiltResult[] = [];
  for (const [, raw] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const ld = JSON.parse(raw) as Record<string, unknown>;
      const items: Record<string, unknown>[] = Array.isArray(ld) ? ld : [ld];
      for (const item of items) {
        if (item['@type'] !== 'Product') continue;
        const offer = (Array.isArray(item.offers) ? item.offers[0] : item.offers) as Record<string, unknown> | undefined;
        const price = offer?.price != null ? Number(offer.price) : null;
        if (!price || price <= 0) continue;
        const name = String(item.name ?? 'Unknown');
        results.push({
          retailer, name, price,
          currency: String(offer?.priceCurrency ?? 'GBP'),
          inStock: offer?.availability != null ? !String(offer.availability).includes('OutOfStock') : true,
          url: String(item.url ?? offer?.url ?? baseUrl),
          sku: item.sku != null ? String(item.sku) : undefined,
          ...extractSpecs(name),
        });
      }
    } catch { /* continue */ }
  }
  return results;
}

function findDeepArray(obj: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 6 || obj == null || typeof obj !== 'object') return [];
  const rec = obj as Record<string, unknown>;
  for (const key of ['products', 'items', 'hits', 'results', 'data', 'records']) {
    const val = rec[key];
    if (Array.isArray(val) && val.length > 0 && val[0] != null && typeof val[0] === 'object') {
      const first = val[0] as Record<string, unknown>;
      if (first.name != null || first.title != null || first.displayName != null) return val as Record<string, unknown>[];
    }
  }
  for (const key of Object.keys(rec)) {
    const res = findDeepArray(rec[key], depth + 1);
    if (res.length > 0) return res;
  }
  return [];
}

function mapGenericProduct(p: Record<string, unknown>, retailer: string, domain: string, fallbackUrl: string): PrebuiltResult {
  const name = String(p.name ?? p.title ?? p.displayName ?? 'Unknown');
  const rawPrice = p.price ?? (p.priceRange as Record<string, unknown> | null)?.min;
  const specs = extractSpecs(name);
  const rawUrl = p.url ?? p.link;
  return {
    retailer, name,
    price: rawPrice != null ? Number(rawPrice) : null,
    currency: 'GBP',
    inStock: p.inStock != null ? Boolean(p.inStock) : (p.available != null ? Boolean(p.available) : true),
    url: rawUrl ? (String(rawUrl).startsWith('http') ? String(rawUrl) : `https://www.${domain}${rawUrl}`) : fallbackUrl,
    sku: p.sku != null ? String(p.sku) : (p.id != null ? String(p.id) : undefined),
    ...specs,
  };
}

async function scrapePrebuiltRetailer(
  retailer: string,
  searchUrl: string,
  domain: string,
  extra?: (html: string, url: string) => PrebuiltResult[],
): Promise<PrebuiltSearchResult> {
  const t0 = Date.now();
  const { text: html, ok, status } = await fetchPage(searchUrl);

  if (!ok) {
    return {
      retailer, results: [], scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0,
      error: status === 0 ? 'Fetch failed (timeout or network error)' : `HTTP ${status}`,
    };
  }

  let results: PrebuiltResult[] = extractJsonLd(html, retailer, searchUrl);

  if (results.length === 0) {
    const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (m) {
      try {
        const data = JSON.parse(m[1]) as Record<string, unknown>;
        const pageProps = (data?.props as Record<string, unknown> | null)?.pageProps;
        const arr = findDeepArray(pageProps);
        results = arr.slice(0, MAX_RESULTS).map(p => mapGenericProduct(p, retailer, domain, searchUrl));
      } catch { /* continue */ }
    }
  }

  if (results.length === 0 && extra) {
    results = extra(html, searchUrl);
  }

  if (results.length === 0) {
    const prices = [...html.matchAll(/£\s*([\d,]+(?:\.\d{2})?)/g)]
      .map(m => parseFloat(m[1].replace(/,/g, ''))).filter(p => p > 50 && p < 20_000);
    if (prices.length > 0) {
      results = [{
        retailer, name: 'Search results', price: Math.min(...prices), currency: 'GBP',
        inStock: true, url: searchUrl,
        scraperNote: 'Page requires JS rendering — only lowest price extracted',
      }];
    }
  }

  return {
    retailer, results: results.slice(0, MAX_RESULTS),
    scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0,
    error: results.length === 0 ? `No products parsed — ${retailer} may require JS rendering` : undefined,
  };
}

// ── JSON API scrapers ──────────────────────────────────────────────────────

export async function johnLewisPrebuiltSearch(query: string): Promise<PrebuiltSearchResult> {
  const t0 = Date.now();
  const apiUrl = `https://api.johnlewis.com/search/api/rest/v2/catalog/products/search/keyword?q=${encodeURIComponent(query)}&pageSize=20&page=1`;
  const data = await fetchJson(apiUrl, { ...API_HEADERS, Accept: 'application/json' }) as Record<string, unknown> | null;

  if (data) {
    const products = Array.isArray(data.products) ? data.products as Record<string, unknown>[] : findDeepArray(data);
    if (products.length > 0) {
      const results: PrebuiltResult[] = products.slice(0, MAX_RESULTS).map((p) => {
        const name = String(p.title ?? p.name ?? 'Unknown');
        const priceObj = p.price as Record<string, unknown> | null;
        const rawPrice = priceObj?.now;
        const price = rawPrice != null ? parseFloat(String(rawPrice).replace(/[£,]/g, '')) : null;
        const id = p.productId ?? p.id;
        return {
          retailer: 'John Lewis', name,
          price: price != null && !isNaN(price) ? price : null,
          currency: 'GBP',
          inStock: p.availability !== 'OUT_OF_STOCK' && p.available !== false,
          url: id ? `https://www.johnlewis.com/product/${id}` : `https://www.johnlewis.com/search-results/desktop-pcs?search-term=${encodeURIComponent(query)}`,
          sku: id != null ? String(id) : undefined,
          brand: p.brand != null ? String(p.brand) : undefined,
          ...extractSpecs(name),
        };
      });
      return { retailer: 'John Lewis', results, scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0 };
    }
  }

  return scrapePrebuiltRetailer('John Lewis', `https://www.johnlewis.com/search-results/desktop-pcs?search-term=${encodeURIComponent(query)}`, 'johnlewis.com');
}

export async function currysPrebuiltSearch(query: string): Promise<PrebuiltSearchResult> {
  const t0 = Date.now();
  const apiUrl = `https://api.currys.co.uk/catalog/v3/search?q=${encodeURIComponent(query)}&size=20`;
  const data = await fetchJson(apiUrl, { ...API_HEADERS, Origin: 'https://www.currys.co.uk', Referer: 'https://www.currys.co.uk/' }) as Record<string, unknown> | null;

  if (data) {
    const products = Array.isArray(data.products) ? data.products as Record<string, unknown>[] : findDeepArray(data);
    if (products.length > 0) {
      const results: PrebuiltResult[] = products.slice(0, MAX_RESULTS).map((p) => {
        const name = String(p.name ?? p.displayName ?? 'Unknown');
        const pricing = p.pricing as Record<string, unknown> | null;
        const priceRaw = pricing?.now ?? p.price;
        const price = priceRaw != null ? Number(priceRaw) : null;
        const rawUrl = p.url;
        return {
          retailer: 'Currys', name,
          price: price != null && !isNaN(price) ? price : null,
          currency: 'GBP',
          inStock: p.inStock !== false && p.availability !== 'OUT_OF_STOCK',
          url: rawUrl ? (String(rawUrl).startsWith('http') ? String(rawUrl) : `https://www.currys.co.uk${rawUrl}`) : `https://www.currys.co.uk/search?q=${encodeURIComponent(query)}`,
          sku: p.sku != null ? String(p.sku) : (p.id != null ? String(p.id) : undefined),
          brand: p.brand != null ? String(p.brand) : undefined,
          ...extractSpecs(name),
        };
      });
      return { retailer: 'Currys', results, scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0 };
    }
  }

  return scrapePrebuiltRetailer('Currys', `https://www.currys.co.uk/search?q=${encodeURIComponent(query)}`, 'currys.co.uk');
}

export async function argosPrebuiltSearch(query: string): Promise<PrebuiltSearchResult> {
  const t0 = Date.now();
  const params = JSON.stringify({ q: query, page: '1', template: 'categorypage', pdpType: 'regular', sessionId: '' });
  const apiUrl = `https://www.argos.co.uk/finder-api/product;isSearch=true;queryParams=${encodeURIComponent(params)}/page/1`;
  const data = await fetchJson(apiUrl, { ...API_HEADERS, Referer: 'https://www.argos.co.uk/' }) as Record<string, unknown> | null;

  if (data) {
    const dataField = data.data as Record<string, unknown> | null;
    const items = Array.isArray(dataField?.products) ? dataField!.products as Record<string, unknown>[] : findDeepArray(data);
    if (items.length > 0) {
      const results: PrebuiltResult[] = items.slice(0, MAX_RESULTS).map((p) => {
        const name = String(p.name ?? p.title ?? 'Unknown');
        const attrs = p.attributes as Record<string, unknown> | null;
        const priceRaw = attrs?.currentPrice ?? p.currentPrice ?? p.price;
        const price = priceRaw != null ? Number(priceRaw) : null;
        const avail = p.availability as Record<string, unknown> | null;
        const stockInfo = avail?.stockInfo as Record<string, unknown> | null;
        return {
          retailer: 'Argos', name,
          price: price != null && !isNaN(price) ? price : null,
          currency: 'GBP',
          inStock: stockInfo?.inStock !== false,
          url: p.id ? `https://www.argos.co.uk/product/${p.id}` : `https://www.argos.co.uk/search/desktop-pcs/?searchTerm=${encodeURIComponent(query)}`,
          sku: p.id != null ? String(p.id) : (p.partNumber != null ? String(p.partNumber) : undefined),
          brand: attrs?.brand != null ? String(attrs.brand) : undefined,
          ...extractSpecs(name),
        };
      });
      return { retailer: 'Argos', results, scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0 };
    }
  }

  return scrapePrebuiltRetailer('Argos', `https://www.argos.co.uk/search/desktop-pcs/?searchTerm=${encodeURIComponent(query)}`, 'argos.co.uk');
}

export async function veryPrebuiltSearch(query: string): Promise<PrebuiltSearchResult> {
  const t0 = Date.now();
  const apiUrl = `https://www.very.co.uk/search/endeca.json?searchTerm=${encodeURIComponent(query)}&start=0&rows=20`;
  const data = await fetchJson(apiUrl, { ...API_HEADERS, Referer: 'https://www.very.co.uk/' }) as Record<string, unknown> | null;

  if (data) {
    const items = Array.isArray(data.records) ? data.records as Record<string, unknown>[] : findDeepArray(data);
    if (items.length > 0) {
      const results: PrebuiltResult[] = items.slice(0, MAX_RESULTS).map((p) => {
        const name = String(p.displayName ?? p.name ?? 'Unknown');
        const attrs = p.attributes as Record<string, string[]> | null;
        const rawPrices = attrs?.PRODUCT_PRICE;
        const rawPrice = Array.isArray(rawPrices) ? rawPrices[0] : (p.price != null ? String(p.price) : null);
        const price = rawPrice != null ? parseFloat(String(rawPrice).replace(/[£,]/g, '')) : null;
        const avail = attrs?.AVAILABILITY;
        const seoUrl = p.seoUrl;
        return {
          retailer: 'Very', name,
          price: price != null && !isNaN(price) ? price : null,
          currency: 'GBP',
          inStock: !(Array.isArray(avail) && avail[0] === 'Out of Stock'),
          url: seoUrl ? `https://www.very.co.uk${seoUrl}` : `https://www.very.co.uk/e/q/${encodeURIComponent(query)}`,
          sku: p.repositoryId != null ? String(p.repositoryId) : undefined,
          ...extractSpecs(name),
        };
      });
      return { retailer: 'Very', results, scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0 };
    }
  }

  return scrapePrebuiltRetailer('Very', `https://www.very.co.uk/e/q/${encodeURIComponent(query)}`, 'very.co.uk');
}

export async function aoPrebuiltSearch(query: string): Promise<PrebuiltSearchResult> {
  return scrapePrebuiltRetailer('AO.com',
    `https://ao.com/l/desktop-pcs/?search=${encodeURIComponent(query)}`, 'ao.com',
    (html, url) => {
      const m = html.match(/window\.__AO_STATE__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
      if (!m) return [];
      try {
        const state = JSON.parse(m[1]) as Record<string, unknown>;
        const products = findDeepArray(state);
        return products.slice(0, MAX_RESULTS).map(p => mapGenericProduct(p, 'AO.com', 'ao.com', url));
      } catch { return []; }
    },
  );
}

export async function chillblastPrebuiltSearch(query: string): Promise<PrebuiltSearchResult> {
  return scrapePrebuiltRetailer('Chillblast',
    `https://www.chillblast.com/search?q=${encodeURIComponent(query)}`,
    'chillblast.com',
    (html, url) => {
      const results: PrebuiltResult[] = [];
      for (const [, block] of html.matchAll(/<(?:article|div)[^>]*class="[^"]*(?:product[-_]?(?:item|card|tile))[^"]*"[^>]*>([\s\S]*?)(?=<\/(?:article|div)>)/gi)) {
        const nameM = block.match(/class="[^"]*(?:product[-_]?(?:name|title)|title)[^"]*"[^>]*>([\s\S]*?)<\//i);
        const price = extractGbpPrice(block);
        const linkM = block.match(/href="([^"]+\/(?:gaming|desktop|custom|pc)[^"]*?)"/i);
        if (!nameM || !price) continue;
        const name = stripHtml(nameM[1]);
        if (name.length < 3) continue;
        results.push({
          retailer: 'Chillblast', name, price, currency: 'GBP',
          inStock: !block.toLowerCase().includes('out of stock'),
          url: linkM ? (linkM[1].startsWith('http') ? linkM[1] : `https://www.chillblast.com${linkM[1]}`) : url,
          ...extractSpecs(name),
        });
      }
      return results;
    },
  );
}

export async function dellPrebuiltSearch(query: string): Promise<PrebuiltSearchResult> {
  const t0 = Date.now();
  const { items, error } = await scrapeDellPrebuilt(query);
  if (items.length > 0) {
    return {
      retailer: 'Dell UK',
      results: items as PrebuiltResult[],
      scrapedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    };
  }

  // Playwright failed or unavailable — fall back to plain fetch + JSON-LD extraction
  return scrapePrebuiltRetailer('Dell UK',
    `https://www.dell.com/en-gb/shop/desktop-computers/sc/desktops?q=${encodeURIComponent(query)}`,
    'dell.com',
    (html, url) => {
      const results = extractJsonLd(html, 'Dell UK', url);
      if (results.length > 0) return results;
      for (const [, raw] of html.matchAll(/data-product-json="([^"]+)"/g)) {
        try {
          const p = JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, '&')) as Record<string, unknown>;
          if (!p.price || !p.name) continue;
          const name = String(p.name);
          const rawUrl = p.url;
          results.push({
            retailer: 'Dell UK', name,
            price: parseFloat(String(p.price).replace(/[£,]/g, '')),
            currency: 'GBP', inStock: p.inStock !== false,
            url: rawUrl ? (String(rawUrl).startsWith('http') ? String(rawUrl) : `https://www.dell.com${rawUrl}`) : url,
            sku: p.sku != null ? String(p.sku) : undefined,
            brand: 'Dell',
            ...extractSpecs(name),
          });
        } catch { /* continue */ }
      }
      return results;
    },
  ).then(r => error ? { ...r, error: r.error ?? error } : r);
}

export async function hpPrebuiltSearch(query: string): Promise<PrebuiltSearchResult> {
  const t0 = Date.now();
  const { items, error } = await scrapeHpPrebuilt(query);
  if (items.length > 0) {
    return {
      retailer: 'HP UK',
      results: items as PrebuiltResult[],
      scrapedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
    };
  }

  // Playwright failed or unavailable — plain fetch fallback
  return scrapePrebuiltRetailer('HP UK',
    `https://www.hp.com/gb-en/shop/discover/desktop-computers?q=${encodeURIComponent(query)}`,
    'hp.com',
    (html, url) => {
      const results = extractJsonLd(html, 'HP UK', url);
      if (results.length > 0) return results;
      const prices = [...html.matchAll(/£\s*([\d,]+(?:\.\d{2})?)/g)]
        .map(m => parseFloat(m[1].replace(/,/g, ''))).filter(p => p > 100 && p < 20_000);
      if (prices.length === 0) return [];
      return [{
        retailer: 'HP UK', name: 'HP Desktop PCs — visit site for models',
        price: Math.min(...prices), currency: 'GBP', inStock: true, url,
        scraperNote: 'HP product listing — visit site for individual specs', brand: 'HP',
      }];
    },
  ).then(r => error ? { ...r, error: r.error ?? error } : r);
}

// ── Specialist PC retailer scrapers ────────────────────────────────────────

export async function ebuyerPrebuiltSearch(query: string): Promise<PrebuiltSearchResult> {
  return scrapePrebuiltRetailer('Ebuyer',
    `https://www.ebuyer.com/search?q=${encodeURIComponent(query)}`, 'ebuyer.com');
}

export async function scanPrebuiltSearch(query: string): Promise<PrebuiltSearchResult> {
  return scrapePrebuiltRetailer('Scan.co.uk',
    `https://www.scan.co.uk/search?q=${encodeURIComponent(query)}`, 'scan.co.uk',
    (html, url) => {
      const results: PrebuiltResult[] = [];
      for (const [, block] of html.matchAll(/<li[^>]*class="[^"]*product[^"]*"[^>]*>([\s\S]*?)<\/li>/gi)) {
        const titleAttr = block.match(/data-product-title="([^"]+)"/i);
        const priceAttr = block.match(/data-buy-price="([\d.]+)"/i);
        const link = block.match(/href="(\/products?\/[^"]+)"/i);
        if (!titleAttr || !priceAttr) continue;
        const price = parseFloat(priceAttr[1]);
        if (!price || price <= 0) continue;
        const name = titleAttr[1].trim();
        results.push({
          retailer: 'Scan.co.uk', name, price, currency: 'GBP',
          inStock: !block.toLowerCase().includes('no stock'),
          url: link ? `https://www.scan.co.uk${link[1]}` : url,
          ...extractSpecs(name),
        });
      }
      return results;
    },
  );
}

export async function overclockerPrebuiltSearch(query: string): Promise<PrebuiltSearchResult> {
  return scrapePrebuiltRetailer('Overclockers UK',
    `https://www.overclockers.co.uk/search?q=${encodeURIComponent(query)}`, 'overclockers.co.uk');
}

export async function boxPrebuiltSearch(query: string): Promise<PrebuiltSearchResult> {
  return scrapePrebuiltRetailer('Box.co.uk',
    `https://www.box.co.uk/search?search=${encodeURIComponent(query)}`, 'box.co.uk');
}

export async function novatechPrebuiltSearch(query: string): Promise<PrebuiltSearchResult> {
  return scrapePrebuiltRetailer('Novatech',
    `https://www.novatech.co.uk/search/?q=${encodeURIComponent(query)}`, 'novatech.co.uk');
}

export async function cclPrebuiltSearch(query: string): Promise<PrebuiltSearchResult> {
  return scrapePrebuiltRetailer('CCL Online',
    `https://www.ccl.co.uk/search?q=${encodeURIComponent(query)}`, 'ccl.co.uk');
}

export async function pallicompPrebuiltSearch(query: string): Promise<PrebuiltSearchResult> {
  return scrapePrebuiltRetailer('Pallicomp',
    `https://www.pallicomp.co.uk/search?q=${encodeURIComponent(query)}`,
    'pallicomp.co.uk',
    (html, url) => {
      const results = extractJsonLd(html, 'Pallicomp', url);
      if (results.length > 0) return results;
      const items: PrebuiltResult[] = [];
      for (const [, block] of html.matchAll(/<(?:article|div|li)[^>]*class="[^"]*(?:product[-_]?(?:item|card|tile))[^"]*"[^>]*>([\s\S]*?)(?=<\/(?:article|div|li)>)/gi)) {
        const nameM = block.match(/class="[^"]*(?:product[-_]?(?:name|title)|title)[^"]*"[^>]*>([\s\S]*?)<\//i);
        const price = extractGbpPrice(block);
        const linkM = block.match(/href="([^"]+)"/i);
        if (!nameM || !price) continue;
        const name = stripHtml(nameM[1]);
        if (name.length < 3) continue;
        items.push({
          retailer: 'Pallicomp', name, price, currency: 'GBP',
          inStock: !block.toLowerCase().includes('out of stock'),
          url: linkM ? (linkM[1].startsWith('http') ? linkM[1] : `https://www.pallicomp.co.uk${linkM[1]}`) : url,
          brand: 'Pallicomp',
          ...extractSpecs(name),
        });
      }
      return items;
    },
  );
}

export async function costcoPrebuiltSearch(query: string): Promise<PrebuiltSearchResult> {
  return scrapePrebuiltRetailer('Costco UK',
    `https://www.costco.co.uk/search?q=${encodeURIComponent(query)}`,
    'costco.co.uk',
    (html, url) => {
      const results = extractJsonLd(html, 'Costco UK', url);
      if (results.length > 0) return results;
      const items: PrebuiltResult[] = [];
      for (const [, block] of html.matchAll(/<div[^>]*class="[^"]*(?:product|item)[-_]?(?:info|card|tile)?[^"]*"[^>]*>([\s\S]*?)(?=<\/div>)/gi)) {
        const nameM = block.match(/<(?:h[23]|a|span)[^>]*class="[^"]*(?:description|name|title)[^"]*"[^>]*>([\s\S]*?)<\/(?:h[23]|a|span)>/i);
        const price = extractGbpPrice(block);
        const linkM = block.match(/href="([^"]+)"/i);
        if (!nameM || !price) continue;
        const name = stripHtml(nameM[1]);
        if (name.length < 3) continue;
        items.push({
          retailer: 'Costco UK', name, price, currency: 'GBP',
          inStock: !block.toLowerCase().includes('out of stock'),
          url: linkM ? (linkM[1].startsWith('http') ? linkM[1] : `https://www.costco.co.uk${linkM[1]}`) : url,
          ...extractSpecs(name),
        });
      }
      return items;
    },
  );
}

export async function cyberpowerPrebuiltSearch(query: string): Promise<PrebuiltSearchResult> {
  return scrapePrebuiltRetailer('CyberPower PC',
    `https://www.cyberpowerpc.co.uk/category/gaming-pcs/?query=${encodeURIComponent(query)}`,
    'cyberpowerpc.co.uk',
    (html, url) => {
      const results = extractJsonLd(html, 'CyberPower PC', url);
      if (results.length > 0) return results;
      const items: PrebuiltResult[] = [];
      for (const [, block] of html.matchAll(/<(?:article|div)[^>]*class="[^"]*(?:product[-_]?(?:item|card|tile|box))[^"]*"[^>]*>([\s\S]*?)(?=<\/(?:article|div)>)/gi)) {
        const nameM = block.match(/class="[^"]*(?:product[-_]?(?:name|title)|title)[^"]*"[^>]*>([\s\S]*?)<\//i);
        const price = extractGbpPrice(block);
        const linkM = block.match(/href="([^"]+)"/i);
        if (!nameM || !price) continue;
        const name = stripHtml(nameM[1]);
        if (name.length < 3) continue;
        items.push({
          retailer: 'CyberPower PC', name, price, currency: 'GBP',
          inStock: !block.toLowerCase().includes('out of stock'),
          url: linkM ? (linkM[1].startsWith('http') ? linkM[1] : `https://www.cyberpowerpc.co.uk${linkM[1]}`) : url,
          brand: 'CyberPower',
          ...extractSpecs(name),
        });
      }
      return items;
    },
  );
}

export async function pcspecialistPrebuiltSearch(query: string): Promise<PrebuiltSearchResult> {
  return scrapePrebuiltRetailer('PC Specialist',
    `https://www.pcspecialist.co.uk/search/?q=${encodeURIComponent(query)}`,
    'pcspecialist.co.uk',
    (html, url) => {
      const results = extractJsonLd(html, 'PC Specialist', url);
      if (results.length > 0) return results;
      const items: PrebuiltResult[] = [];
      for (const [, block] of html.matchAll(/<(?:article|div|li)[^>]*class="[^"]*(?:product[-_]?(?:item|card|tile)|range[-_]?(?:item|card))[^"]*"[^>]*>([\s\S]*?)(?=<\/(?:article|div|li)>)/gi)) {
        const nameM = block.match(/class="[^"]*(?:product[-_]?(?:name|title)|range[-_]?name|title)[^"]*"[^>]*>([\s\S]*?)<\//i);
        const price = extractGbpPrice(block);
        const linkM = block.match(/href="([^"]+)"/i);
        if (!nameM || !price) continue;
        const name = stripHtml(nameM[1]);
        if (name.length < 3) continue;
        items.push({
          retailer: 'PC Specialist', name, price, currency: 'GBP',
          inStock: !block.toLowerCase().includes('out of stock'),
          url: linkM ? (linkM[1].startsWith('http') ? linkM[1] : `https://www.pcspecialist.co.uk${linkM[1]}`) : url,
          brand: 'PC Specialist',
          ...extractSpecs(name),
        });
      }
      return items;
    },
  );
}

export async function lenovoPrebuiltSearch(query: string): Promise<PrebuiltSearchResult> {
  const t0 = Date.now();
  const apiUrl = `https://www.lenovo.com/gb/en/api/2.0/page/search?q=${encodeURIComponent(query)}&filters=category%3ADESKTOPS&pageSize=20&pageNumber=1`;
  const data = await fetchJson(apiUrl) as Record<string, unknown> | null;

  if (data) {
    const products = findDeepArray(data);
    if (products.length > 0) {
      const results: PrebuiltResult[] = products.slice(0, MAX_RESULTS).map((p) => {
        const name = String(p.name ?? p.title ?? 'Unknown');
        const rawPrice = p.price ?? (p.priceRange as Record<string, unknown> | null)?.min;
        const rawUrl = p.url ?? p.link;
        return {
          retailer: 'Lenovo UK', name,
          price: rawPrice != null ? Number(rawPrice) : null,
          currency: 'GBP',
          inStock: p.inStock !== false,
          url: rawUrl ? (String(rawUrl).startsWith('http') ? String(rawUrl) : `https://www.lenovo.com${rawUrl}`) : `https://www.lenovo.com/gb/en/d/desktops`,
          sku: p.sku != null ? String(p.sku) : undefined,
          brand: 'Lenovo',
          ...extractSpecs(name),
        };
      });
      return { retailer: 'Lenovo UK', results, scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0 };
    }
  }

  return scrapePrebuiltRetailer('Lenovo UK',
    `https://www.lenovo.com/gb/en/search?q=${encodeURIComponent(query)}&category=DESKTOPS`,
    'lenovo.com',
    (html, url) => {
      const results = extractJsonLd(html, 'Lenovo UK', url);
      if (results.length > 0) return results;
      const prices = [...html.matchAll(/£\s*([\d,]+(?:\.\d{2})?)/g)]
        .map(m => parseFloat(m[1].replace(/,/g, ''))).filter(p => p > 100 && p < 20_000);
      if (prices.length === 0) return [];
      return [{
        retailer: 'Lenovo UK', name: 'Lenovo Desktop PCs — visit site for models',
        price: Math.min(...prices), currency: 'GBP', inStock: true, url,
        scraperNote: 'Lenovo product listing — visit site for individual specs', brand: 'Lenovo',
      }];
    },
  );
}

export async function amazonPrebuiltSearch(query: string): Promise<PrebuiltSearchResult> {
  const t0 = Date.now();
  try {
    const { products } = await searchWithRetry(query, 'gb', 3, 10);
    const results: PrebuiltResult[] = [];
    for (const p of products) {
      for (const o of p.offers.slice(0, 2)) {
        if (o.price > 0) {
          results.push({
            retailer: o.merchant || 'Amazon UK',
            name: p.name,
            price: o.price,
            currency: o.currency,
            inStock: o.inStock,
            url: o.url || p.url || `https://www.amazon.co.uk/s?k=${encodeURIComponent(query)}`,
            ...extractSpecs(p.name),
          });
        }
      }
      if (results.length >= MAX_RESULTS) break;
    }
    return {
      retailer: 'Amazon UK',
      results: results.slice(0, MAX_RESULTS),
      scrapedAt: new Date().toISOString(),
      durationMs: Date.now() - t0,
      error: results.length === 0 ? 'No results from PricesAPI for this query' : undefined,
    };
  } catch (e) {
    return { retailer: 'Amazon UK', results: [], scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0, error: String(e) };
  }
}

export async function bedrockPrebuiltSearch(query: string): Promise<PrebuiltSearchResult> {
  return scrapePrebuiltRetailer('Bedrock Computers',
    `https://bedrockcomputers.co.uk/search?q=${encodeURIComponent(query)}`,
    'bedrockcomputers.co.uk',
    (html, url) => {
      const results = extractJsonLd(html, 'Bedrock Computers', url);
      if (results.length > 0) return results;
      const items: PrebuiltResult[] = [];
      for (const [, block] of html.matchAll(/<(?:article|div|li)[^>]*class="[^"]*(?:product[-_]?(?:item|card|tile))[^"]*"[^>]*>([\s\S]*?)(?=<\/(?:article|div|li)>)/gi)) {
        const nameM = block.match(/class="[^"]*(?:product[-_]?(?:name|title)|title)[^"]*"[^>]*>([\s\S]*?)<\//i);
        const price = extractGbpPrice(block);
        const linkM = block.match(/href="([^"]+)"/i);
        if (!nameM || !price) continue;
        const name = stripHtml(nameM[1]);
        if (name.length < 3) continue;
        items.push({
          retailer: 'Bedrock Computers', name, price, currency: 'GBP',
          inStock: !block.toLowerCase().includes('out of stock'),
          url: linkM ? (linkM[1].startsWith('http') ? linkM[1] : `https://bedrockcomputers.co.uk${linkM[1]}`) : url,
          brand: 'Bedrock',
          ...extractSpecs(name),
        });
      }
      return items;
    },
  );
}

// ── Aggregator ─────────────────────────────────────────────────────────────

const PREBUILT_FNS: Record<PrebuiltRetailerId, (q: string) => Promise<PrebuiltSearchResult>> = {
  currys: currysPrebuiltSearch,
  argos: argosPrebuiltSearch,
  johnlewis: johnLewisPrebuiltSearch,
  ao: aoPrebuiltSearch,
  very: veryPrebuiltSearch,
  ebuyer: ebuyerPrebuiltSearch,
  scan: scanPrebuiltSearch,
  overclockers: overclockerPrebuiltSearch,
  box: boxPrebuiltSearch,
  novatech: novatechPrebuiltSearch,
  ccl: cclPrebuiltSearch,
  chillblast: chillblastPrebuiltSearch,
  dell: dellPrebuiltSearch,
  hp: hpPrebuiltSearch,
  amazon: amazonPrebuiltSearch,
  pallicomp: pallicompPrebuiltSearch,
  costco: costcoPrebuiltSearch,
  cyberpower: cyberpowerPrebuiltSearch,
  pcspecialist: pcspecialistPrebuiltSearch,
  lenovo: lenovoPrebuiltSearch,
  bedrock: bedrockPrebuiltSearch,
};

// Retailers whose sites block server-side requests (403/404) — served via PricesAPI instead.
const API_BACKED_IDS: ReadonlySet<PrebuiltRetailerId> = new Set([
  'currys', 'argos', 'johnlewis', 'ao', 'very',
  'ebuyer', 'scan', 'overclockers', 'box', 'novatech', 'ccl', 'amazon',
]);

// Keyword(s) in the PricesAPI offer `merchant` field that identify each retailer.
const MERCHANT_MAP: Array<{ keywords: string[]; id: PrebuiltRetailerId; label: string; fallbackUrl: string }> = [
  { keywords: ['currys'],                        id: 'currys',       label: 'Currys',         fallbackUrl: 'https://www.currys.co.uk' },
  { keywords: ['argos'],                         id: 'argos',        label: 'Argos',          fallbackUrl: 'https://www.argos.co.uk' },
  { keywords: ['john lewis'],                    id: 'johnlewis',    label: 'John Lewis',     fallbackUrl: 'https://www.johnlewis.com' },
  { keywords: ['ao.com', 'ao '],                 id: 'ao',           label: 'AO.com',         fallbackUrl: 'https://ao.com' },
  { keywords: ['very'],                          id: 'very',         label: 'Very',           fallbackUrl: 'https://www.very.co.uk' },
  { keywords: ['ebuyer'],                        id: 'ebuyer',       label: 'Ebuyer',         fallbackUrl: 'https://www.ebuyer.com' },
  { keywords: ['scan'],                          id: 'scan',         label: 'Scan.co.uk',     fallbackUrl: 'https://www.scan.co.uk' },
  { keywords: ['overclockers', 'oc.co.uk'],      id: 'overclockers', label: 'Overclockers UK',fallbackUrl: 'https://www.overclockers.co.uk' },
  { keywords: ['box.co.uk'],                     id: 'box',          label: 'Box.co.uk',      fallbackUrl: 'https://www.box.co.uk' },
  { keywords: ['novatech'],                      id: 'novatech',     label: 'Novatech',       fallbackUrl: 'https://www.novatech.co.uk' },
  { keywords: ['ccl'],                           id: 'ccl',          label: 'CCL Online',     fallbackUrl: 'https://www.cclonline.com' },
  { keywords: ['amazon'],                        id: 'amazon',       label: 'Amazon UK',      fallbackUrl: 'https://www.amazon.co.uk' },
];

function merchantToEntry(merchantName: string) {
  const ml = merchantName.toLowerCase();
  return MERCHANT_MAP.find(m => m.keywords.some(kw => ml.includes(kw))) ?? null;
}

async function searchMainstreamViaApi(
  query: string,
  requestedIds: PrebuiltRetailerId[],
): Promise<PrebuiltSearchResult[]> {
  const t0 = Date.now();
  try {
    const { products } = await searchWithRetry(query, 'gb', 10, 20);
    const byId = new Map<PrebuiltRetailerId, PrebuiltResult[]>();

    for (const p of products) {
      for (const o of p.offers) {
        const entry = merchantToEntry(o.merchant);
        if (!entry || !requestedIds.includes(entry.id)) continue;
        const bucket = byId.get(entry.id) ?? [];
        bucket.push({
          retailer: entry.label,
          name: p.name,
          price: o.price,
          currency: o.currency,
          inStock: o.inStock,
          url: o.url || p.url || entry.fallbackUrl,
          ...extractSpecs(p.name),
        });
        byId.set(entry.id, bucket);
      }
    }

    const elapsed = Date.now() - t0;
    return requestedIds.map(id => {
      const entry = MERCHANT_MAP.find(m => m.id === id)!;
      const results = (byId.get(id) ?? []).slice(0, MAX_RESULTS);
      return {
        retailer: entry.label,
        results,
        scrapedAt: new Date().toISOString(),
        durationMs: elapsed,
        error: results.length === 0 ? `No ${entry.label} listings found via PricesAPI for this query` : undefined,
      };
    });
  } catch (err) {
    const elapsed = Date.now() - t0;
    return requestedIds.map(id => {
      const entry = MERCHANT_MAP.find(m => m.id === id)!;
      return {
        retailer: entry.label, results: [], scrapedAt: new Date().toISOString(),
        durationMs: elapsed, error: `PricesAPI error: ${(err as Error).message}`,
      };
    });
  }
}

export async function searchAllPrebuiltRetailers(
  query: string,
  retailers: PrebuiltRetailerId[] = ALL_PREBUILT_RETAILER_IDS,
): Promise<PrebuiltSearchResult[]> {
  const hasApiKey = !!process.env.PRICES_API_KEY;
  const apiRetailers  = retailers.filter(r => API_BACKED_IDS.has(r));
  const scraperRetailers = retailers.filter(r => !API_BACKED_IDS.has(r));

  const [apiResults, scraperResults] = await Promise.all([
    apiRetailers.length > 0
      ? (hasApiKey
          ? searchMainstreamViaApi(query, apiRetailers)
          // No key: fall back to per-retailer scrapers (may hit 403s)
          : Promise.all(apiRetailers.map(r => PREBUILT_FNS[r](query))))
      : Promise.resolve([]),
    Promise.all(scraperRetailers.map(r => PREBUILT_FNS[r](query))),
  ]);

  // Reassemble in the original requested order
  const apiMap  = new Map(apiResults.map(r => [r.retailer, r]));
  const scraperMap = new Map(scraperResults.map(r => [r.retailer, r]));

  return retailers.map(id => {
    const entry = MERCHANT_MAP.find(m => m.id === id);
    const label = entry?.label ?? id;
    return apiMap.get(label) ?? scraperMap.get(label) ?? {
      retailer: label, results: [], scrapedAt: new Date().toISOString(), durationMs: 0,
    };
  });
}
