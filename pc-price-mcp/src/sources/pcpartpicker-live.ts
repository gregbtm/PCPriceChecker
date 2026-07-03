/**
 * PCPartPicker UK live price scraper.
 * Scrapes uk.pcpartpicker.com product listing and product detail pages
 * to get current UK prices from multiple retailers.
 *
 * PCPartPicker does not have a public API — this uses HTML scraping.
 * Rate-limit respectfully; PCPartPicker data is US/UK market aggregated.
 */
import { getBrowser, randomUA } from './playwright-scraper.js';

export interface PcppProduct {
  name: string;
  partUrl: string | null;
  prices: PcppPrice[];
  imageUrl: string | null;
  rating: string | null;
  category: string;
}

export interface PcppPrice {
  retailer: string;
  price: number;
  currency: string;
  url: string | null;
  inStock: boolean;
}

// PCPartPicker category slugs → our category strings
const PCPP_CATEGORIES: Record<string, string> = {
  'video-card': 'gpu',
  'cpu': 'cpu',
  'memory': 'ram',
  'internal-hard-drive': 'storage',
  'motherboard': 'motherboard',
  'power-supply': 'psu',
  'case': 'case',
  'cpu-cooler': 'cooling',
  'monitor': 'monitor',
  'case-fan': 'cooling',
  'thermal-paste': 'cooling',
};

export const PCPP_CATEGORY_SLUGS = Object.keys(PCPP_CATEGORIES);

/** Search PCPartPicker UK for products in a category, optionally filtered by keyword. */
export async function searchPcPartPicker(
  category: string,
  query?: string,
  limit = 20,
): Promise<PcppProduct[]> {
  const slug = Object.entries(PCPP_CATEGORIES).find(([, v]) => v === category)?.[0] ?? category;
  const url = query
    ? `https://uk.pcpartpicker.com/search/#W=${encodeURIComponent(query)}&t=${slug}`
    : `https://uk.pcpartpicker.com/products/${slug}/`;

  const html = await fetchWithPlaywright(url);
  if (!html) return [];
  return parsePcppListing(html, slug);
}

/** Get full price table for a specific PCPartPicker product URL. */
export async function getPcPartPickerProductPrices(productUrl: string): Promise<PcppProduct | null> {
  const html = await fetchWithPlaywright(productUrl);
  if (!html) return null;
  return parsePcppProduct(html, productUrl);
}

async function fetchWithPlaywright(url: string): Promise<string | null> {
  const browser = await getBrowser();
  if (!browser) return null;
  let ctx: any = null;
  try {
    ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.setExtraHTTPHeaders({ 'User-Agent': randomUA() });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(2_000);
    return await page.content();
  } catch { return null; }
  finally { await ctx?.close().catch(() => {}); }
}

function parsePcppListing(html: string, category: string): PcppProduct[] {
  const products: PcppProduct[] = [];

  // PCPartPicker listing rows: <li class="pp_picker__product" ...>
  // They also use class="xs-block" or similar — parse product cards
  const rows = [...html.matchAll(
    /class="[^"]*search_results--block[^"]*"[\s\S]*?<\/section>/gi,
  )];

  // Alternative: table-based listing for category pages
  const tableRows = [...html.matchAll(
    /<tr[^>]*id="tr_[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi,
  )];

  for (const [, row] of tableRows.length > 0 ? tableRows : rows) {
    const nameM = row.match(/class="[^"]*td__name[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i)
      ?? row.match(/class="[^"]*name[^"]*"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i);
    const name = nameM ? nameM[1].replace(/<[^>]+>/g, '').trim() : null;
    if (!name || name.length < 3) continue;

    const linkM = row.match(/href="(https:\/\/uk\.pcpartpicker\.com\/product\/[^"]+)"/i);
    const partUrl = linkM?.[1] ?? null;

    const priceM = row.match(/class="[^"]*td__price[^"]*"[^>]*>[\s\S]*?£\s*([\d,]+\.?\d*)/i);
    const price = priceM ? parseFloat(priceM[1].replace(/,/g, '')) : null;

    const retailerM = row.match(/class="[^"]*td__where[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
    const retailer = retailerM ? retailerM[1].trim() : 'PCPartPicker';

    const imgM = row.match(/<img[^>]+src="([^"]+pcpartpicker[^"]*\.(jpg|png|webp)[^"]*)"[^>]*>/i);

    if (price && price > 0) {
      products.push({
        name, partUrl, imageUrl: imgM?.[1] ?? null, rating: null,
        category: PCPP_CATEGORIES[category] ?? category,
        prices: [{ retailer, price, currency: 'GBP', url: partUrl, inStock: true }],
      });
    } else {
      products.push({
        name, partUrl, imageUrl: imgM?.[1] ?? null, rating: null,
        category: PCPP_CATEGORIES[category] ?? category,
        prices: [],
      });
    }
  }

  return products.slice(0, 40);
}

function parsePcppProduct(html: string, sourceUrl: string): PcppProduct | null {
  // Product name
  const nameM = html.match(/<h1[^>]*class="[^"]*pageTitle[^"]*"[^>]*>([^<]+)<\/h1>/i)
    ?? html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const name = nameM ? nameM[1].replace(/<[^>]+>/g, '').trim() : null;
  if (!name) return null;

  // Category from breadcrumb
  const breadM = html.match(/breadcrumbs[\s\S]*?href="\/products\/([a-z-]+)\//i);
  const catSlug = breadM?.[1] ?? 'other';

  // Price rows — PCPartPicker shows a price table
  const prices: PcppPrice[] = [];

  // Try to get prices from the structured price table rows
  for (const [, row] of html.matchAll(
    /<tr[^>]*class="[^"]*tr__product[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi,
  )) {
    const retailerM = row.match(/class="[^"]*where[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const retailer = retailerM
      ? retailerM[1].replace(/<[^>]+>/g, '').trim()
      : null;
    if (!retailer) continue;

    const priceM = row.match(/£\s*([\d,]+\.?\d*)/);
    const price = priceM ? parseFloat(priceM[1].replace(/,/g, '')) : null;
    if (!price || price <= 0) continue;

    const linkM = row.match(/href="(https?:\/\/[^"]+)"/);
    prices.push({ retailer, price, currency: 'GBP', url: linkM?.[1] ?? null, inStock: true });
  }

  // Also try JSON-LD for structured offers
  for (const [, raw] of html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(raw);
      const offers = Array.isArray(data.offers) ? data.offers : (data.offers ? [data.offers] : []);
      for (const offer of offers) {
        if (!offer.price) continue;
        const price = Number(offer.price);
        if (price <= 0) continue;
        const seller = offer.seller?.name ?? offer.offeredBy ?? 'Unknown';
        if (!prices.find(p => p.retailer === seller && p.price === price)) {
          prices.push({ retailer: seller, price, currency: offer.priceCurrency ?? 'GBP', url: offer.url ?? null, inStock: !/OutOfStock/i.test(String(offer.availability ?? '')) });
        }
      }
    } catch { /* skip */ }
  }

  const imgM = html.match(/<img[^>]+class="[^"]*product__image[^"]*"[^>]+src="([^"]+)"/i)
    ?? html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i);

  return {
    name,
    partUrl: sourceUrl,
    imageUrl: imgM?.[1] ?? null,
    rating: null,
    category: PCPP_CATEGORIES[catSlug] ?? 'other',
    prices: prices.sort((a, b) => a.price - b.price),
  };
}
