import type { PriceSnapshot } from '../db.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBrowser = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPage = any;

// Realistic browser UAs — rotated per scrape session to reduce fingerprinting
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36 Edg/123.0.0.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];
export function randomUA(): string { return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]; }

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

export async function getBrowser(): Promise<AnyBrowser | null> {
  const pw = await loadPlaywright();
  if (!pw) return null;
  try {
    if (_browser?.isConnected()) return _browser;
    const launchOpts: Record<string, unknown> = {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    };
    const customPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;
    if (customPath) launchOpts.executablePath = customPath;
    // @ts-ignore
    _browser = await pw.chromium.launch(launchOpts);
    return _browser;
  } catch {
    return null;
  }
}

export async function newPageWithProxy(proxy?: string): Promise<AnyPage | null> {
  const browser = await getBrowser();
  if (!browser) return null;
  try {
    // @ts-ignore
    const ctx = proxy ? await browser.newContext({ proxy: { server: proxy } }) : await browser.newContext();
    // @ts-ignore
    const page = await ctx.newPage();
    // Attach context to page so we can close it
    (page as any).__ctx = ctx;
    return page;
  } catch { return null; }
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

// ── Prebuilt-oriented scrapers (return richer product data for Dell / HP) ──

export interface BrowserPrebuiltItem {
  retailer: string;
  name: string;
  price: number;
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
}

function extractSpecsFromText(text: string): Partial<BrowserPrebuiltItem> {
  const specs: Partial<BrowserPrebuiltItem> = {};
  const cpuM = text.match(/(?:Intel\s+Core(?:\s+Ultra)?\s+(?:i[3579]-\d{4,5}[A-Z0-9]*|\d{3,4}[A-Z0-9]*)|AMD\s+Ryzen\s+[3579]\s+\d{4,5}[A-Z0-9]*)/i);
  if (cpuM) specs.cpu = cpuM[0].trim();
  const gpuM = text.match(/(?:NVIDIA\s+(?:GeForce\s+)?RTX\s*\d{4}(?:\s*Ti|\s*Super)?|AMD\s+Radeon\s+RX\s*\d{4}(?:\s*XT|XTX)?|Intel\s+Arc\s+[A-Z]\d+)/i);
  if (gpuM) specs.gpu = gpuM[0].trim();
  const ramM = text.match(/(\d+)\s*GB\s*(?:DDR[45X]?|LPDDR[45]?|RAM)/i);
  if (ramM) specs.ram = ramM[0].trim();
  const storeM = text.match(/(\d+)\s*(?:GB|TB)\s*(?:NVMe|SSD|HDD|M\.2)/i);
  if (storeM) specs.storage = storeM[0].trim();
  const lo = text.toLowerCase();
  if (lo.includes('windows 11')) specs.os = 'Windows 11';
  else if (lo.includes('windows 10')) specs.os = 'Windows 10';
  if (lo.includes('all-in-one') || lo.includes(' aio ')) specs.formFactor = 'All-in-One';
  else if (lo.includes('mini pc') || lo.includes('mini-pc')) specs.formFactor = 'Mini PC';
  else if (lo.includes('tower')) specs.formFactor = 'Tower';
  return specs;
}

async function scrapePrebuiltPage(
  url: string,
  retailer: string,
  brand: string,
  waitFor: string,
  cardSelectors: string[],
): Promise<{ items: BrowserPrebuiltItem[]; durationMs: number; error?: string }> {
  const t0 = Date.now();
  const browser = await getBrowser();
  if (!browser) return { items: [], durationMs: 0, error: 'Playwright/Chromium not available' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page: any = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Accept-Language': 'en-GB,en;q=0.9',
    });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    await page.waitForSelector(waitFor, { timeout: 10_000 }).catch(() => {});

    // 1. Try JSON-LD first
    const ldTexts: string[] = await page.$$eval(
      'script[type="application/ld+json"]',
      (els: Element[]) => els.map(el => el.textContent ?? ''),
    );
    const items: BrowserPrebuiltItem[] = [];
    for (const text of ldTexts) {
      try {
        const data = JSON.parse(text);
        const entries: Record<string, unknown>[] = Array.isArray(data) ? data : [data];
        for (const entry of entries) {
          if (entry['@type'] !== 'Product') continue;
          const offer = (Array.isArray(entry.offers) ? (entry.offers as Record<string, unknown>[])[0] : entry.offers) as Record<string, unknown> | undefined;
          const price = offer?.price != null ? Number(offer.price) : 0;
          if (price <= 0) continue;
          const name = String(entry.name ?? 'Unknown');
          items.push({
            retailer, name, price,
            currency: String(offer?.priceCurrency ?? 'GBP'),
            inStock: !/OutOfStock/i.test(String(offer?.availability ?? '')),
            url: String(entry.url ?? url),
            brand,
            ...extractSpecsFromText(name),
          });
        }
      } catch { /* skip */ }
    }
    if (items.length > 0) return { items: items.slice(0, 10), durationMs: Date.now() - t0 };

    // 2. DOM fallback: broad product card selectors
    for (const selector of cardSelectors) {
      const cards: Array<{ name: string; price: number; href: string }> = await page.$$eval(
        selector,
        (els: Element[], baseUrl: string) => els.slice(0, 10).flatMap((el): Array<{ name: string; price: number; href: string }> => {
          const nameEl =
            el.querySelector('[data-testid*="name"],[data-testid*="title"],[class*="product-name"],[class*="product-title"],[class*="ProductName"]') ??
            el.querySelector('h2,h3,h4');
          const priceEl =
            el.querySelector('[data-testid*="price"],[class*="price"],[aria-label*="£"]') ??
            el.querySelector('[class*="Price"]');
          const linkEl = (el.closest('a') ?? el.querySelector('a')) as HTMLAnchorElement | null;
          const name = nameEl?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
          const priceText = priceEl?.textContent ?? el.textContent ?? '';
          const m = priceText.match(/£\s*([\d,]+\.?\d*)/);
          const price = m ? parseFloat(m[1].replace(/,/g, '')) : 0;
          const href = linkEl?.href ?? baseUrl;
          if (name.length > 4 && price > 50 && price < 20000) {
            return [{ name, price, href }];
          }
          return [];
        }),
        url,
      ).catch(() => []);

      if (cards.length > 0) {
        return {
          items: cards.slice(0, 10).map(c => ({
            retailer, name: c.name, price: c.price, currency: 'GBP',
            inStock: true, url: c.href, brand, ...extractSpecsFromText(c.name),
          })),
          durationMs: Date.now() - t0,
        };
      }
    }

    return { items: [], durationMs: Date.now() - t0, error: `No products parsed from ${retailer} — page structure may have changed` };
  } catch (err) {
    return { items: [], durationMs: Date.now() - t0, error: (err as Error).message };
  } finally {
    await page.close().catch(() => {});
  }
}

export async function scrapeDellPrebuilt(query: string): Promise<{ items: BrowserPrebuiltItem[]; durationMs: number; error?: string }> {
  return scrapePrebuiltPage(
    `https://www.dell.com/en-gb/shop/desktop-computers/sc/desktops?q=${encodeURIComponent(query)}`,
    'Dell UK',
    'Dell',
    '[data-testid*="product"], .ps-product-card, [class*="product-card"]',
    [
      '[data-testid*="product-card"], .ps-product-card',
      '[class*="product-card"], [class*="ProductCard"]',
      'article[class*="product"], li[class*="product"]',
    ],
  );
}

export async function scrapeHpPrebuilt(query: string): Promise<{ items: BrowserPrebuiltItem[]; durationMs: number; error?: string }> {
  return scrapePrebuiltPage(
    `https://www.hp.com/gb-en/shop/discover/desktop-computers?q=${encodeURIComponent(query)}`,
    'HP UK',
    'HP',
    '[data-testid*="product"], [class*="product-card"], [class*="ProductCard"]',
    [
      '[data-testid*="product-card"]',
      '[class*="product-card"], [class*="ProductCard"]',
      'section[class*="product"], li[class*="product"]',
    ],
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
