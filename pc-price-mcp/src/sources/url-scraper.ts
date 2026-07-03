/**
 * Generic product URL scraper — PriceBuddy-style fallback chain:
 *   1. Fetch HTML → JSON-LD structured data
 *   2. Open Graph / meta product tags
 *   3. User-defined CSS selector rules (per domain, stored in DB)
 *   4. Generic DOM price heuristics
 *   5. Playwright headless browser (JS-rendered pages)
 *   5b. Camofox stealth browser (Cloudflare bypass — optional, requires running server)
 *   6. AI extraction via Claude API (last resort, requires ANTHROPIC_API_KEY)
 */
import { getBrowser, randomUA, newPageWithProxy } from './playwright-scraper.js';
import { scrapeWithCamofox } from './camofox-client.js';
import * as db from '../db.js';

export interface ScrapedProduct {
  name: string;
  price: number | null;
  currency: string;
  inStock: boolean;
  url: string;
  image?: string;
  method: 'json-ld' | 'meta' | 'rules' | 'dom' | 'playwright' | 'ai' | 'failed';
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-GB,en;q=0.9',
};

function extractDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

function parsePrice(text: string, regex?: string | null): number | null {
  if (regex) {
    try { const m = text.match(new RegExp(regex)); if (m?.[1]) return parseFloat(m[1].replace(/,/g, '')); } catch { /* bad regex */ }
  }
  const m = text.replace(/,/g, '').match(/£?\s*([\d]+(?:\.\d{1,2})?)/);
  const p = m ? parseFloat(m[1]) : NaN;
  return p > 0 && p < 50_000 ? p : null;
}

// ── Step 1: JSON-LD ────────────────────────────────────────────────────────

function tryJsonLd(html: string): Partial<ScrapedProduct> | null {
  for (const [, raw] of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(raw);
      const items: Record<string, unknown>[] = Array.isArray(data) ? data : [data];
      for (const item of items) {
        if (item['@type'] !== 'Product') continue;
        const offer = (Array.isArray(item.offers) ? (item.offers as Record<string, unknown>[])[0] : item.offers) as Record<string, unknown> | undefined;
        if (!offer) continue;
        const price = offer.price != null ? Number(offer.price) : null;
        if (!price || isNaN(price) || price <= 0) continue;
        const img = Array.isArray(item.image) ? String(item.image[0]) : (item.image ? String(item.image) : undefined);
        return {
          name: item.name != null ? String(item.name) : undefined,
          price, currency: offer.priceCurrency != null ? String(offer.priceCurrency) : 'GBP',
          inStock: !/OutOfStock/i.test(String(offer.availability ?? '')),
          image: img, method: 'json-ld',
        };
      }
    } catch { /* skip */ }
  }
  return null;
}

// ── Step 2: Open Graph / meta product tags ─────────────────────────────────

function tryMeta(html: string): Partial<ScrapedProduct> | null {
  const get = (attr: string, val: string) => {
    const m = html.match(new RegExp(`<meta[^>]+${attr}="${val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]+content="([^"]+)"`, 'i'))
      ?? html.match(new RegExp(`<meta[^>]+content="([^"]+)"[^>]+${attr}="${val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'i'));
    return m?.[1]?.trim();
  };
  const priceStr = get('property', 'product:price:amount') ?? get('property', 'og:price:amount')
    ?? get('name', 'price') ?? get('itemprop', 'price');
  if (!priceStr) return null;
  const price = parsePrice(priceStr);
  if (!price) return null;
  const name = get('property', 'og:title') ?? get('name', 'twitter:title');
  const currency = get('property', 'product:price:currency') ?? get('property', 'og:price:currency') ?? 'GBP';
  const avail = get('property', 'product:availability') ?? get('property', 'og:availability');
  const image = get('property', 'og:image') ?? get('name', 'twitter:image');
  return { name, price, currency, inStock: avail ? /in.?stock/i.test(avail) : true, image, method: 'meta' };
}

// ── Step 3: User-defined rules (simplified regex-based selector matching) ──

function tryRules(html: string, rule: db.ScrapeRule): Partial<ScrapedProduct> | null {
  const pickText = (selector: string | null): string | null => {
    if (!selector) return null;
    const classM = selector.match(/\.([a-zA-Z0-9_-]+)/);
    const idM = selector.match(/#([a-zA-Z0-9_-]+)/);
    const attrM = selector.match(/\[([a-zA-Z-]+)="([^"]+)"\]/);
    if (idM) {
      const m = html.match(new RegExp(`id="${idM[1]}"[^>]*>([^<]{1,300})<`, 'i'));
      if (m) return m[1].trim();
    }
    if (attrM) {
      const m = html.match(new RegExp(`${attrM[1]}="${attrM[2]}"[^>]*>([^<]{1,300})<`, 'i'));
      if (m) return m[1].trim();
    }
    if (classM) {
      const cls = classM[1].replace(/-/g, '[-_]?');
      const m = html.match(new RegExp(`class="[^"]*${cls}[^"]*"[^>]*>([^<]{1,300})<`, 'i'));
      if (m) return m[1].trim();
    }
    return null;
  };

  const priceText = pickText(rule.price_selector);
  if (!priceText) return null;
  const price = parsePrice(priceText, rule.price_regex);
  if (!price) return null;
  const nameText = pickText(rule.name_selector);
  const availText = pickText(rule.avail_selector);
  return {
    name: nameText ?? undefined, price, currency: 'GBP',
    inStock: availText ? /in.?stock|available|add to/i.test(availText) : true,
    method: 'rules',
  };
}

// ── Step 4: Generic DOM heuristics ─────────────────────────────────────────

function tryDom(html: string): Partial<ScrapedProduct> | null {
  const titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const name = titleM ? titleM[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : undefined;

  const patterns = [
    /class="[^"]*(?:price|Price)[^"]*"[^>]*>[\s\S]*?£\s*([\d,]+\.?\d*)/,
    /itemprop="price"[^>]*content="([\d.]+)"/,
    /data-price="([\d.]+)"/,
    /<span[^>]*>£\s*([\d]+\.\d{2})<\/span>/,
    /class="[^"]*(?:price|Price)[^"]*"[^>]*>\s*£\s*([\d,]+\.?\d*)/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) { const price = parsePrice(m[1]); if (price) return { name, price, currency: 'GBP', inStock: true, method: 'dom' }; }
  }
  return null;
}

// ── Step 5: Playwright (with UA + proxy rotation) ─────────────────────────

function getNextProxy(): string | undefined {
  const raw = db.getConfig('scrape_proxies');
  if (!raw) return undefined;
  const proxies = raw.split(',').map(p => p.trim()).filter(Boolean);
  if (!proxies.length) return undefined;
  return proxies[Math.floor(Math.random() * proxies.length)];
}

async function tryPlaywright(url: string): Promise<Partial<ScrapedProduct> | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const page: any = await newPageWithProxy(getNextProxy());
  if (!page) return null;
  try {
    await page.setExtraHTTPHeaders({ 'User-Agent': randomUA(), 'Accept-Language': BROWSER_HEADERS['Accept-Language'] });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 25_000 });
    await page.waitForTimeout(1000);

    const renderedHtml: string = await page.content();
    const jld = tryJsonLd(renderedHtml); if (jld?.price) return { ...jld, method: 'playwright' };
    const meta = tryMeta(renderedHtml);  if (meta?.price) return { ...meta, method: 'playwright' };

    const extracted = await page.evaluate((baseUrl: string) => {
      const name = document.querySelector('h1')?.textContent?.replace(/\s+/g, ' ').trim();
      const sels = ['[class*="price"]:not([class*="was"]):not([class*="rrp"])', '[data-testid*="price"]', '[itemprop="price"]', '#price', '.price'];
      let price: number | null = null;
      for (const sel of sels) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const txt = el.getAttribute('content') ?? el.getAttribute('data-price') ?? el.textContent ?? '';
        const m = txt.replace(/,/g, '').match(/£?\s*([\d]+(?:\.\d{1,2})?)/);
        if (m) { const p = parseFloat(m[1]); if (p > 0 && p < 50000) { price = p; break; } }
      }
      const stockEl = document.querySelector('[class*="stock"],[itemprop="availability"],[data-testid*="stock"]');
      const inStock = stockEl ? /in.?stock|available|add to/i.test(stockEl.textContent ?? '') : true;
      return { name, price, inStock };
    }, url).catch(() => null);

    if (extracted?.price) {
      return { name: extracted.name, price: extracted.price, currency: 'GBP', inStock: extracted.inStock, method: 'playwright' };
    }
    return null;
  } catch { return null; }
  finally {
    await page.__ctx?.close().catch(() => {});
  }
}

// ── Step 5b: Camofox stealth browser (Cloudflare bypass) ──────────────────

async function tryCamofox(url: string): Promise<Partial<ScrapedProduct> | null> {
  const camofoxUrl = db.getConfig('camofox_url') ?? process.env.CAMOFOX_URL;
  if (!camofoxUrl) return null;
  const result = await scrapeWithCamofox(url, camofoxUrl);
  if (!result?.price) return null;
  return { name: result.name, price: result.price, currency: result.currency, inStock: result.inStock, method: 'playwright' };
}

// ── Step 6: AI extraction (Claude API) ────────────────────────────────────

async function tryAi(html: string): Promise<Partial<ScrapedProduct> | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .slice(0, 5000);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: `Extract product info from this retail page text. Reply ONLY with JSON: {"name":"...","price":123.45,"currency":"GBP","inStock":true}. Return null if no price found.\n\n${text}` }],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    const raw: string = data?.content?.[0]?.text ?? '';
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const parsed = JSON.parse(m[0]);
    if (parsed?.price) return { name: parsed.name, price: Number(parsed.price), currency: parsed.currency ?? 'GBP', inStock: parsed.inStock !== false, method: 'ai' };
  } catch { /* ignore */ }
  return null;
}

// ── Main entry ─────────────────────────────────────────────────────────────

export async function scrapeProductUrl(url: string): Promise<ScrapedProduct> {
  const domain = extractDomain(url);
  const fallback: ScrapedProduct = { name: domain, price: null, currency: 'GBP', inStock: false, url, method: 'failed' };

  let html = '';
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(12_000) });
    if (res.ok) html = await res.text();
  } catch { /* try Playwright next */ }

  if (html) {
    const jld = tryJsonLd(html);
    if (jld?.price) return { ...fallback, ...jld, url } as ScrapedProduct;

    const meta = tryMeta(html);
    if (meta?.price) return { ...fallback, ...meta, url } as ScrapedProduct;

    const rule = db.getScrapeRule(domain);
    if (rule) {
      const r = tryRules(html, rule);
      if (r?.price) return { ...fallback, ...r, url } as ScrapedProduct;
    }

    const dom = tryDom(html);
    if (dom?.price) return { ...fallback, ...dom, url } as ScrapedProduct;
  }

  const pw = await tryPlaywright(url);
  if (pw?.price) return { ...fallback, ...pw, url } as ScrapedProduct;

  const cfx = await tryCamofox(url);
  if (cfx?.price) return { ...fallback, ...cfx, url } as ScrapedProduct;

  if (html) {
    const ai = await tryAi(html);
    if (ai?.price) return { ...fallback, ...ai, url } as ScrapedProduct;
  }

  return fallback;
}
