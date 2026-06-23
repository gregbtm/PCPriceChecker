import type { PriceSnapshot } from '../db.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBrowser = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPage = any;

// Lazily loaded — null if playwright-core is not installed
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _pw: any | null | undefined = undefined;
let _browser: AnyBrowser | null = null;

async function loadPlaywright(): Promise<object | null> {
  if (_pw !== undefined) return _pw;
  try {
    // @ts-ignore — optional dependency; may not be installed
    _pw = await import('playwright-core');
  } catch {
    _pw = null;
  }
  return _pw;
}

async function getBrowser(): Promise<AnyBrowser | null> {
  const pw = await loadPlaywright();
  if (!pw) return null;
  try {
    if (_browser?.isConnected()) return _browser;
    const executablePath =
      process.env.PLAYWRIGHT_CHROMIUM_PATH ??
      '/usr/bin/chromium-browser';
    // @ts-ignore
    _browser = await pw.chromium.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    return _browser;
  } catch {
    return null;
  }
}

export interface BrowserScrapeResult {
  retailer: string;
  results: PriceSnapshot[];
  error?: string;
  durationMs: number;
}

// Shared: extract prices from JSON-LD <script> tags (works on Currys, JL, Very)
async function extractJsonLd(page: AnyPage, retailer: string): Promise<PriceSnapshot[]> {
  const texts: string[] = await page.$$eval(
    'script[type="application/ld+json"]',
    (els: Element[]) => els.map((el) => el.textContent ?? ''),
  );
  const results: PriceSnapshot[] = [];
  for (const text of texts) {
    try {
      const data = JSON.parse(text);
      const items: Record<string, unknown>[] = Array.isArray(data) ? data : [data];
      for (const item of items) {
        const products: Record<string, unknown>[] =
          item['@type'] === 'ItemList'
            ? ((item.itemListElement as Record<string, unknown>[]) ?? []).map(
                (e) => (e.item as Record<string, unknown>) ?? e,
              )
            : item['@type'] === 'Product'
            ? [item]
            : [];
        for (const p of products) {
          if (p['@type'] !== 'Product') continue;
          const offer = (p.offers ?? p.Offers) as Record<string, unknown> | null;
          if (!offer) continue;
          const priceRaw = offer.price ?? offer.lowPrice;
          const price = parseFloat(String(priceRaw).replace(',', ''));
          if (!isNaN(price) && price > 1) {
            const inStock = /instock/i.test(String(offer.availability ?? ''));
            results.push({
              source: 'playwright',
              price: Math.round(price * 100) / 100,
              currency: String(offer.priceCurrency ?? 'GBP'),
              retailer,
              url: String(p.url ?? page.url()),
              inStock,
            });
          }
        }
      }
    } catch { /* skip unparseable JSON-LD */ }
  }
  return results;
}

// Generic DOM fallback: look for price text in common card selectors
async function extractDomPrices(page: AnyPage, retailer: string, selectors: string[]): Promise<PriceSnapshot[]> {
  const pageUrl: string = page.url();
  for (const selector of selectors) {
    try {
      const results: Array<{ price: number; url: string; inStock: boolean }> = await page.$$eval(
        selector,
        (cards: Element[], baseUrl: string) =>
          cards.slice(0, 8).map((card) => {
            const priceEl =
              card.querySelector('[class*="price"]') ??
              card.querySelector('[data-testid*="price"]') ??
              card.querySelector('[aria-label*="£"]');
            const priceText = priceEl?.textContent ?? card.textContent ?? '';
            const m = priceText.match(/£\s*([\d,]+\.?\d*)/);
            if (!m) return null;
            const price = parseFloat(m[1].replace(',', ''));
            if (!isNaN(price) && price > 1) {
              const linkEl = card.closest('a') ?? card.querySelector('a');
              const href = (linkEl as HTMLAnchorElement | null)?.href ?? baseUrl;
              const inStockEl = card.querySelector(
                '[class*="instock"],[class*="in-stock"],[class*="available"]',
              );
              return { price, url: href, inStock: !!inStockEl };
            }
            return null;
          }).filter(Boolean),
        pageUrl,
      );
      const snaps: PriceSnapshot[] = results.map((r) => ({
        source: 'playwright',
        price: r.price,
        currency: 'GBP',
        retailer,
        url: r.url || null,
        inStock: r.inStock,
      }));
      if (snaps.length > 0) return snaps;
    } catch { /* try next selector */ }
  }
  return [];
}

async function doScrape(
  browser: AnyBrowser,
  url: string,
  retailer: string,
  waitForSelector: string,
  jsonLdFirst: boolean,
  domSelectors: string[],
): Promise<BrowserScrapeResult> {
  const t0 = Date.now();
  const page: AnyPage = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-GB,en;q=0.9',
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForSelector(waitForSelector, { timeout: 8000 }).catch(() => {});

    let results: PriceSnapshot[] = [];
    if (jsonLdFirst) results = await extractJsonLd(page, retailer);
    if (results.length === 0) results = await extractDomPrices(page, retailer, domSelectors);
    if (results.length === 0 && !jsonLdFirst) results = await extractJsonLd(page, retailer);

    return { retailer, results, durationMs: Date.now() - t0 };
  } catch (err) {
    return { retailer, results: [], error: (err as Error).message, durationMs: Date.now() - t0 };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function scrapeCurrys(query: string): Promise<BrowserScrapeResult> {
  const browser = await getBrowser();
  if (!browser) return { retailer: 'Currys', results: [], error: 'Playwright/Chromium not available — set PLAYWRIGHT_CHROMIUM_PATH or build with ENABLE_PLAYWRIGHT=true', durationMs: 0 };
  return doScrape(
    browser,
    `https://www.currys.co.uk/search?q=${encodeURIComponent(query)}&searchType=products`,
    'Currys',
    '[data-component="ProductCard"], [class*="product-card"]',
    true,
    ['[data-component="ProductCard"]', '[class*="product-card"]', '[class*="ProductCard"]'],
  );
}

export async function scrapeAo(query: string): Promise<BrowserScrapeResult> {
  const browser = await getBrowser();
  if (!browser) return { retailer: 'AO', results: [], error: 'Playwright/Chromium not available', durationMs: 0 };
  return doScrape(
    browser,
    `https://ao.com/search/${encodeURIComponent(query)}`,
    'AO',
    '[class*="product-card"], [class*="ProductCard"]',
    true,
    ['[class*="product-card"]', '[class*="ProductCard"]', 'article'],
  );
}

export async function scrapeJohnLewis(query: string): Promise<BrowserScrapeResult> {
  const browser = await getBrowser();
  if (!browser) return { retailer: 'John Lewis', results: [], error: 'Playwright/Chromium not available', durationMs: 0 };
  return doScrape(
    browser,
    `https://www.johnlewis.com/search?search-term=${encodeURIComponent(query)}`,
    'John Lewis',
    '[data-testid="product-card"], [class*="product-card"]',
    true,
    ['[data-testid="product-card"]', '[class*="product-card"]', '[class*="ProductCard"]'],
  );
}

export async function scrapeVery(query: string): Promise<BrowserScrapeResult> {
  const browser = await getBrowser();
  if (!browser) return { retailer: 'Very', results: [], error: 'Playwright/Chromium not available', durationMs: 0 };
  return doScrape(
    browser,
    `https://www.very.co.uk/electrical/search-results.aspx?sku=&page=1&dq=${encodeURIComponent(query)}`,
    'Very',
    '[class*="product"], article',
    false,
    ['[class*="product-card"]', '[class*="product-item"]', 'article'],
  );
}

const SCRAPER_FNS: Record<string, (q: string) => Promise<BrowserScrapeResult>> = {
  currys: scrapeCurrys,
  ao: scrapeAo,
  johnlewis: scrapeJohnLewis,
  'john lewis': scrapeJohnLewis,
  very: scrapeVery,
};

export const SUPPORTED_PLAYWRIGHT_RETAILERS = ['currys', 'ao', 'johnlewis', 'very'] as const;

export async function scrapeWithBrowser(
  query: string,
  retailers: string[] = [...SUPPORTED_PLAYWRIGHT_RETAILERS],
): Promise<BrowserScrapeResult[]> {
  const fns = retailers
    .map((r) => r.toLowerCase())
    .filter((r) => r in SCRAPER_FNS)
    .map((r) => SCRAPER_FNS[r]);

  return Promise.all(fns.map((fn) => fn(query)));
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
}

export function isPlaywrightAvailable(): boolean {
  return _pw !== null && _pw !== undefined;
}
