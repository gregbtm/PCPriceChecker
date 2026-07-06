import type { PriceSnapshot } from '../db.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyBrowser = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyPage = any;

// ── Fingerprint pools ─────────────────────────────────────────────────────────

// Current realistic UAs — weighted towards Chrome on Windows (most common)
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
];
export function randomUA(): string { return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)]; }

// Realistic desktop viewport sizes (width × height)
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1536, height: 864 },
  { width: 1440, height: 900 },
  { width: 1280, height: 720 },
  { width: 1600, height: 900 },
  { width: 2560, height: 1440 },
  { width: 1280, height: 800 },
] as const;
function randomViewport() { return VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)]; }

// ── Stealth init script ───────────────────────────────────────────────────────
// Injected into every page before any scripts run. Removes the most common
// headless-browser tells detected by Cloudflare, PerimeterX, DataDome, etc.

const STEALTH_INIT_SCRIPT = `
(function () {
  // 1. Remove navigator.webdriver — the clearest headless signal
  try {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined, configurable: true });
  } catch (_) {}

  // 2. Spoof navigator.plugins (headless has 0; real Chrome has at least 3)
  try {
    const fakePlugins = [
      { name: 'Chrome PDF Plugin', description: 'Portable Document Format', filename: 'internal-pdf-viewer', length: 1 },
      { name: 'Chrome PDF Viewer', description: '', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', length: 1 },
      { name: 'Native Client', description: '', filename: 'internal-nacl-plugin', length: 2 },
    ];
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const arr = Object.assign([], fakePlugins, {
          refresh: function () {},
          item: (i) => fakePlugins[i] ?? null,
          namedItem: (name) => fakePlugins.find(p => p.name === name) ?? null,
        });
        Object.setPrototypeOf(arr, PluginArray.prototype);
        return arr;
      },
      configurable: true,
    });
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => {
        const mt = [
          { type: 'application/pdf', suffixes: 'pdf', description: '', enabledPlugin: navigator.plugins[0] },
          { type: 'text/pdf', suffixes: 'pdf', description: '', enabledPlugin: navigator.plugins[0] },
        ];
        const arr = Object.assign([], mt, {
          item: (i) => mt[i] ?? null,
          namedItem: (type) => mt.find(m => m.type === type) ?? null,
        });
        Object.setPrototypeOf(arr, MimeTypeArray.prototype);
        return arr;
      },
      configurable: true,
    });
  } catch (_) {}

  // 3. Fix navigator.languages (empty in headless)
  try {
    Object.defineProperty(navigator, 'languages', { get: () => ['en-GB', 'en'], configurable: true });
    Object.defineProperty(navigator, 'language', { get: () => 'en-GB', configurable: true });
  } catch (_) {}

  // 4. Add window.chrome (missing in headless; expected by many fingerprint checks)
  try {
    if (!window.chrome) {
      const chrome = {
        app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
        runtime: { id: undefined, connect: () => {}, sendMessage: () => {} },
        loadTimes: () => ({ requestTime: Date.now() / 1000, startLoadTime: Date.now() / 1000, commitLoadTime: Date.now() / 1000, finishDocumentLoadTime: Date.now() / 1000, finishLoadTime: Date.now() / 1000, firstPaintTime: Date.now() / 1000, firstPaintAfterLoadTime: 0, navigationType: 'Other', wasFetchedViaSpdy: false, wasNpnNegotiated: false, npnNegotiatedProtocol: 'http/1.1', wasAlternateProtocolAvailable: false, connectionInfo: 'http/1.1' }),
        csi: () => ({ startE: Date.now(), onloadT: Date.now(), pageT: Date.now() - 100, tran: 15 }),
      };
      window.chrome = chrome;
      // Expose on all frames
      try { Object.defineProperty(window, 'chrome', { value: chrome, writable: false, enumerable: true, configurable: false }); } catch (_) {}
    }
  } catch (_) {}

  // 5. Permissions API — real Chrome denies notification by default; headless throws
  try {
    const origQuery = window.Notification ? undefined : navigator.permissions?.query?.bind(navigator.permissions);
    if (navigator.permissions) {
      const _orig = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = (params) => {
        if (params.name === 'notifications') {
          return Promise.resolve(Object.assign(Object.create(PermissionStatus.prototype), { state: 'denied', onchange: null }));
        }
        return _orig(params);
      };
    }
  } catch (_) {}

  // 6. WebGL — override renderer/vendor to look like a real GPU
  try {
    const getParam = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param) {
      if (param === 37445) return 'Intel Inc.';         // UNMASKED_VENDOR_WEBGL
      if (param === 37446) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
      return getParam.call(this, param);
    };
    const getParam2 = WebGL2RenderingContext.prototype.getParameter;
    WebGL2RenderingContext.prototype.getParameter = function (param) {
      if (param === 37445) return 'Intel Inc.';
      if (param === 37446) return 'Intel Iris OpenGL Engine';
      return getParam2.call(this, param);
    };
  } catch (_) {}

  // 7. Add small deterministic noise to Canvas fingerprint
  // Shifts pixel values by ±1 so every context gets a unique fingerprint
  try {
    const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      const ctx = this.getContext('2d');
      if (ctx) {
        const shift = { r: Math.floor(Math.random() * 3) - 1, g: Math.floor(Math.random() * 3) - 1, b: Math.floor(Math.random() * 3) - 1 };
        const imgData = ctx.getImageData(0, 0, this.width || 1, this.height || 1);
        for (let i = 0; i < imgData.data.length; i += 4) {
          imgData.data[i]     = Math.max(0, Math.min(255, imgData.data[i]     + shift.r));
          imgData.data[i + 1] = Math.max(0, Math.min(255, imgData.data[i + 1] + shift.g));
          imgData.data[i + 2] = Math.max(0, Math.min(255, imgData.data[i + 2] + shift.b));
        }
        ctx.putImageData(imgData, 0, 0);
      }
      return origToDataURL.apply(this, args);
    };
  } catch (_) {}

  // 8. connection / battery (optional — fills gaps in navigator fingerprint)
  try {
    if (!navigator.connection) {
      Object.defineProperty(navigator, 'connection', {
        get: () => ({ effectiveType: '4g', rtt: 50, downlink: 10, saveData: false, onchange: null }),
        configurable: true,
      });
    }
  } catch (_) {}
})();
`;

// ── Browser management ────────────────────────────────────────────────────────

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

    // Priority 1 — Novada cloud anti-detect browser (stealth + IP rotation + CAPTCHA solving)
    const novadaWs = process.env.NOVADA_BROWSER_WS;
    if (novadaWs) {
      try {
        // @ts-ignore
        _browser = await pw.chromium.connectOverCDP(novadaWs);
        return _browser;
      } catch { /* fall through */ }
    }

    // Priority 2 — Camoufox (self-hosted anti-detect Firefox with built-in spoofing)
    const camofoxUrl = process.env.CAMOFOX_URL;
    if (camofoxUrl) {
      try {
        // @ts-ignore
        _browser = await pw.chromium.connectOverCDP(camofoxUrl);
        return _browser;
      } catch {
        try {
          // @ts-ignore
          _browser = await pw.firefox.connect(camofoxUrl);
          return _browser;
        } catch { /* fall through to local */ }
      }
    }

    // Priority 3 — Local Chromium with stealth hardening
    const launchOpts: Record<string, unknown> = {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        // Remove the primary bot-detection signal: navigator.webdriver
        '--disable-blink-features=AutomationControlled',
        // Reduce passive fingerprinting surface
        '--disable-web-security',
        '--disable-features=IsolateOrigins',
        // Prevent fingerprinting via GPU enumeration
        '--disable-reading-from-canvas',
        // Match a realistic desktop renderer
        '--window-size=1920,1080',
      ],
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

// ── Context factory ───────────────────────────────────────────────────────────

interface ContextOpts {
  proxy?: string;
  ua?: string;
}

export async function newPageWithProxy(proxy?: string): Promise<AnyPage | null> {
  const browser = await getBrowser();
  if (!browser) return null;
  try {
    const page = await _newStealthPage(browser, { proxy });
    return page;
  } catch { return null; }
}

/**
 * Render a URL through the stealth browser chain (local Chromium / Camoufox /
 * Novada, whichever getBrowser() resolves to) and return the rendered HTML.
 * Generic escalation step for callers that already have their own HTML
 * parsing (uk-retailers.ts's per-retailer extractors) and just need a page
 * that plain fetch() can't get past a JS challenge for.
 */
export async function renderPageHtml(url: string): Promise<string | null> {
  const browser = await getBrowser();
  if (!browser) return null;
  const page: AnyPage = await _newStealthPage(browser).catch(() => null);
  if (!page) return null;
  try {
    await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,ico}', (r: AnyPage) => r.abort());
    await page.waitForTimeout(50 + Math.floor(Math.random() * 250));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await page.waitForTimeout(800);
    return await page.content();
  } catch {
    return null;
  } finally {
    const ctx = (page as any).__ctx;
    await ctx?.close().catch(() => {});
  }
}

async function _newStealthPage(browser: AnyBrowser, opts: ContextOpts = {}): Promise<AnyPage> {
  const ua = opts.ua ?? randomUA();
  const vp = randomViewport();

  const ctxOpts: Record<string, unknown> = {
    locale: 'en-GB',
    timezoneId: 'Europe/London',
    userAgent: ua,
    viewport: vp,
    screen: vp,
    deviceScaleFactor: Math.random() > 0.5 ? 1 : 1.5,
    hasTouch: false,
    isMobile: false,
    javaScriptEnabled: true,
    extraHTTPHeaders: {
      'Accept-Language': 'en-GB,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Upgrade-Insecure-Requests': '1',
    },
    permissions: [],
  };
  if (opts.proxy) ctxOpts.proxy = { server: opts.proxy };

  // @ts-ignore
  const ctx = await browser.newContext(ctxOpts);
  // Inject stealth patches before any page scripts run
  // @ts-ignore
  await ctx.addInitScript(STEALTH_INIT_SCRIPT);
  // @ts-ignore
  const page: AnyPage = await ctx.newPage();
  (page as any).__ctx = ctx;
  return page;
}

// ── Price extraction helpers ──────────────────────────────────────────────────

export interface BrowserScrapeResult {
  retailer: string;
  results: PriceSnapshot[];
  error?: string;
  durationMs: number;
}

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

// ── Scrape orchestrator ───────────────────────────────────────────────────────

async function doScrape(
  browser: AnyBrowser,
  url: string,
  retailer: string,
  waitForSelector: string,
  jsonLdFirst: boolean,
  domSelectors: string[],
): Promise<BrowserScrapeResult> {
  const t0 = Date.now();
  const page: AnyPage = await _newStealthPage(browser);
  try {
    // Block non-content resources to speed up load
    await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,ico}', (r: AnyPage) => r.abort());
    // Random human-like delay before navigation (50–300 ms)
    await page.waitForTimeout(50 + Math.floor(Math.random() * 250));
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
    const ctx = (page as any).__ctx;
    await ctx?.close().catch(() => {});
  }
}

// ── Retailer scrapers ─────────────────────────────────────────────────────────

export async function scrapeCurrys(query: string): Promise<BrowserScrapeResult> {
  const browser = await getBrowser();
  if (!browser) return { retailer: 'Currys', results: [], error: 'Playwright/Chromium not available — set PLAYWRIGHT_CHROMIUM_PATH or install playwright-core', durationMs: 0 };
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

// ── Pre-built PC scrapers ─────────────────────────────────────────────────────

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

  const page: AnyPage = await _newStealthPage(browser).catch(() => null);
  if (!page) return { items: [], durationMs: 0, error: 'Could not create browser context' };

  try {
    await page.route('**/*.{png,jpg,jpeg,gif,webp,svg,woff,woff2,ttf,ico}', (r: any) => r.abort());
    await page.waitForTimeout(50 + Math.floor(Math.random() * 250));
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector(waitFor, { timeout: 10_000 }).catch(() => {});

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
          if (name.length > 4 && price > 50 && price < 20000) return [{ name, price, href }];
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

    return { items: [], durationMs: Date.now() - t0, error: `No products parsed from ${retailer}` };
  } catch (err) {
    return { items: [], durationMs: Date.now() - t0, error: (err as Error).message };
  } finally {
    const ctx = (page as any).__ctx;
    await ctx?.close().catch(() => {});
  }
}

export async function scrapeDellPrebuilt(query: string): Promise<{ items: BrowserPrebuiltItem[]; durationMs: number; error?: string }> {
  return scrapePrebuiltPage(
    `https://www.dell.com/en-gb/shop/desktop-computers/sc/desktops?q=${encodeURIComponent(query)}`,
    'Dell UK', 'Dell',
    '[data-testid*="product"], .ps-product-card, [class*="product-card"]',
    ['[data-testid*="product-card"], .ps-product-card', '[class*="product-card"], [class*="ProductCard"]', 'article[class*="product"], li[class*="product"]'],
  );
}

export async function scrapeHpPrebuilt(query: string): Promise<{ items: BrowserPrebuiltItem[]; durationMs: number; error?: string }> {
  return scrapePrebuiltPage(
    `https://www.hp.com/gb-en/shop/discover/desktop-computers?q=${encodeURIComponent(query)}`,
    'HP UK', 'HP',
    '[data-testid*="product"], [class*="product-card"], [class*="ProductCard"]',
    ['[data-testid*="product-card"]', '[class*="product-card"], [class*="ProductCard"]', 'section[class*="product"], li[class*="product"]'],
  );
}

// ── Public API ────────────────────────────────────────────────────────────────

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
