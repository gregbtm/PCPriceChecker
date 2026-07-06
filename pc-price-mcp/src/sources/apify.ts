/**
 * Apify API client — run cloud actors for advanced scraping tasks.
 * Primary use: lulzasaur/pcpartpicker-scraper for PCPartPicker price data.
 *
 * Requires APIFY_API_TOKEN in env or stored in DB config.
 * https://docs.apify.com/api/v2
 */

const BASE = 'https://api.apify.com/v2';

function getToken(): string | null {
  return process.env.APIFY_API_TOKEN ?? null;
}

export interface ApifyRunResult {
  runId: string;
  datasetId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'RUNNING' | 'ABORTED';
}

export interface ApifyPcppItem {
  name: string;
  url: string;
  category: string | null;
  imageUrl: string | null;
  prices: { merchant: string; price: number; currency: string; url: string | null }[];
}

async function apifyFetch(path: string, opts?: RequestInit): Promise<unknown | null> {
  const token = getToken();
  if (!token) return null;
  try {
    const sep = path.includes('?') ? '&' : '?';
    const res = await fetch(`${BASE}${path}${sep}token=${token}`, {
      ...opts,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** Start an Apify actor run and return the run ID + dataset ID once it succeeds. */
export async function runApifyActor(
  actorId: string,
  input: unknown,
  timeoutSecs = 120,
): Promise<ApifyRunResult | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = await apifyFetch(`/acts/${actorId}/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  }) as any;
  if (!run?.data?.id) return null;

  const runId = run.data.id as string;

  // Poll until finished (max timeoutSecs)
  const deadline = Date.now() + timeoutSecs * 1_000;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 4_000));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const status = await apifyFetch(`/actor-runs/${runId}`) as any;
    const state: string = status?.data?.status ?? 'RUNNING';
    if (state === 'SUCCEEDED') {
      return {
        runId,
        datasetId: status.data.defaultDatasetId,
        status: 'SUCCEEDED',
      };
    }
    if (state === 'FAILED' || state === 'ABORTED') {
      return { runId, datasetId: '', status: state as 'FAILED' | 'ABORTED' };
    }
  }
  // Timed out waiting locally — the run keeps executing on Apify's side and
  // consuming account concurrency/cost unless explicitly stopped. Fire-and-
  // forget so a slow abort call doesn't add to the caller's own timeout.
  apifyFetch(`/actor-runs/${runId}/abort`, { method: 'POST' }).catch(() => {});
  return { runId, datasetId: '', status: 'RUNNING' };
}

/** Fetch items from an Apify dataset. */
export async function getApifyDatasetItems<T>(datasetId: string, limit = 100): Promise<T[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = await apifyFetch(`/datasets/${datasetId}/items?limit=${limit}`) as any;
  if (!Array.isArray(data)) return [];
  return data as T[];
}

/** High-level: scrape PCPartPicker for a category or URL via Apify actor. */
export async function apifyScrapePcPartPicker(
  startUrls: string[],
): Promise<ApifyPcppItem[]> {
  const token = getToken();
  if (!token) return [];

  const result = await runApifyActor(
    'lulzasaur~pcpartpicker-scraper',
    { startUrls: startUrls.map(url => ({ url })) },
    180,
  );
  if (!result || result.status !== 'SUCCEEDED' || !result.datasetId) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = await getApifyDatasetItems<any>(result.datasetId, 200);

  return items.map(item => ({
    name: item.name ?? item.title ?? '',
    url: item.url ?? item.partUrl ?? '',
    category: item.category ?? null,
    imageUrl: item.imageUrl ?? item.image ?? null,
    prices: (item.prices ?? item.offers ?? []).map((p: any) => ({
      merchant: p.merchant ?? p.retailer ?? p.seller ?? 'Unknown',
      price: Number(p.price ?? 0),
      currency: p.currency ?? 'GBP',
      url: p.url ?? null,
    })).filter((p: any) => p.price > 0),
  })).filter(i => i.name.length > 2);
}

export function isApifyConfigured(): boolean {
  return !!getToken();
}

// ── Shared normalised price result ────────────────────────────────────────────

export interface ApifyPriceItem {
  name: string;
  price: number;
  currency: string;
  retailer: string;
  url: string | null;
  inStock: boolean;
  imageUrl?: string | null;
  ean?: string | null;
  asin?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
}

// ── Currys product scraper ────────────────────────────────────────────────────
// Actor: sian.agency~currys-product-scraper
// Searches currys.co.uk and returns product listings with price and availability.

export async function apifyScrapeCurrys(
  query: string,
  maxItems = 20,
): Promise<ApifyPriceItem[]> {
  const token = getToken();
  if (!token) return [];

  const result = await runApifyActor(
    'sian.agency~currys-product-scraper',
    { search: query, maxItems },
    120,
  );
  if (!result || result.status !== 'SUCCEEDED' || !result.datasetId) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = await getApifyDatasetItems<any>(result.datasetId, maxItems);
  return items.map(item => ({
    name:        item.name ?? item.title ?? item.productName ?? '',
    price:       Number(item.price ?? item.currentPrice ?? item.salePrice ?? 0),
    currency:    item.currency ?? 'GBP',
    retailer:    'Currys',
    url:         item.url ?? item.productUrl ?? item.link ?? null,
    inStock:     item.inStock != null ? Boolean(item.inStock) : item.availability !== 'Out of stock',
    imageUrl:    item.image ?? item.imageUrl ?? null,
    ean:         item.ean ?? item.gtin ?? null,
  })).filter(i => i.name.length > 2 && i.price > 0);
}

// ── Google Shopping scraper ───────────────────────────────────────────────────
// Actor: s-r~free-google-shopping-scraper---extract-offers-from-any-ean-sku
// Searches Google Shopping by keyword, EAN, or SKU. Returns offers from
// multiple merchants. Best for finding the cheapest live offer across the web.

export interface ApifyGoogleShoppingOffer {
  productName: string;
  merchant: string;
  price: number;
  currency: string;
  url: string | null;
  condition: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  imageUrl?: string | null;
}

export async function apifyScrapeGoogleShopping(
  query: string,
  countryCode = 'GB',
  maxResults = 40,
  timeoutSecs = 180,
): Promise<ApifyGoogleShoppingOffer[]> {
  const token = getToken();
  if (!token) return [];

  const result = await runApifyActor(
    's-r~free-google-shopping-scraper---extract-offers-from-any-ean-sku',
    {
      queries: [query],
      countryCode,
      maxPagesPerQuery: Math.ceil(maxResults / 20),
      languageCode: 'en',
    },
    timeoutSecs,
  );
  if (!result || result.status !== 'SUCCEEDED' || !result.datasetId) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = await getApifyDatasetItems<any>(result.datasetId, maxResults * 3);

  const offers: ApifyGoogleShoppingOffer[] = [];
  for (const item of items) {
    // Actor may return top-level offers or nested shoppingResults / offers array
    const rows: unknown[] = Array.isArray(item.shoppingResults)
      ? item.shoppingResults
      : Array.isArray(item.offers)
      ? item.offers
      : [item];

    for (const row of rows as Record<string, unknown>[]) {
      const priceRaw = row.price ?? row.extractedPrice ?? row.currentPrice;
      const price = typeof priceRaw === 'number'
        ? priceRaw
        : parseFloat(String(priceRaw ?? '').replace(/[^0-9.]/g, ''));
      if (!price || price <= 0) continue;
      offers.push({
        productName: String(row.title ?? row.name ?? row.productName ?? item.query ?? ''),
        merchant:    String(row.source ?? row.merchant ?? row.seller ?? row.storeName ?? 'Unknown'),
        price,
        currency:    String(row.currency ?? 'GBP'),
        url:         String(row.link ?? row.url ?? row.productLink ?? ''),
        // Preserve unknown as null rather than assuming 'New' — a used/
        // refurbished listing with no condition field shouldn't be relabelled.
        condition:   (row.condition ?? row.itemCondition) != null ? String(row.condition ?? row.itemCondition) : null,
        rating:      row.rating != null ? Number(row.rating) : null,
        reviewCount: row.reviews != null ? Number(row.reviews) : null,
        imageUrl:    row.thumbnail != null ? String(row.thumbnail) : null,
      });
    }
  }

  return offers.slice(0, maxResults);
}

// ── Argos product search ──────────────────────────────────────────────────────
// Actor: ecomscrape~argos-product-search-scraper
// Searches argos.co.uk and returns matching products with price and availability.

export async function apifyScrapeArgos(
  query: string,
  maxItems = 20,
): Promise<ApifyPriceItem[]> {
  const token = getToken();
  if (!token) return [];

  const result = await runApifyActor(
    'ecomscrape~argos-product-search-scraper',
    { searchTerm: query, maxItems },
    120,
  );
  if (!result || result.status !== 'SUCCEEDED' || !result.datasetId) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = await getApifyDatasetItems<any>(result.datasetId, maxItems);
  return items.map(item => ({
    name:     item.name ?? item.title ?? item.productName ?? '',
    price:    Number(item.price ?? item.salePrice ?? item.currentPrice ?? 0),
    currency: item.currency ?? 'GBP',
    retailer: 'Argos',
    url:      item.url ?? item.productUrl ?? item.link ?? null,
    inStock:  item.inStock != null ? Boolean(item.inStock) : item.availability !== 'Out of stock',
    imageUrl: item.image ?? item.imageUrl ?? null,
    ean:      item.ean ?? null,
  })).filter(i => i.name.length > 2 && i.price > 0);
}

// ── Idealo price comparison scraper ──────────────────────────────────────────
// Actor: studio-amba~idealo-scraper
// Scrapes idealo.co.uk (UK price comparison) for a product URL or keyword.
// Returns the cheapest offers from multiple UK retailers on that product.

export interface ApifyIdealoOffer {
  productName: string;
  merchant: string;
  price: number;
  currency: string;
  url: string | null;
  shippingCost: number | null;
  totalPrice: number | null;
  rating?: number | null;
}

export async function apifyScrapeIdealo(
  query: string,
  maxItems = 30,
): Promise<ApifyIdealoOffer[]> {
  const token = getToken();
  if (!token) return [];

  // Idealo actor accepts either a direct product URL or a search keyword
  const isUrl = query.startsWith('http');
  const input = isUrl
    ? { startUrls: [{ url: query }], maxItems }
    : { keyword: query, maxItems };

  const result = await runApifyActor('studio-amba~idealo-scraper', input, 180);
  if (!result || result.status !== 'SUCCEEDED' || !result.datasetId) return [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = await getApifyDatasetItems<any>(result.datasetId, maxItems * 3);

  const offers: ApifyIdealoOffer[] = [];
  for (const item of items) {
    // Actor may nest offers or return them flat
    const rows: unknown[] = Array.isArray(item.offers) ? item.offers : [item];
    for (const row of rows as Record<string, unknown>[]) {
      const price = Number(row.price ?? row.offerPrice ?? 0);
      if (!price || price <= 0) continue;
      offers.push({
        productName: String(row.productName ?? row.name ?? item.name ?? ''),
        merchant:    String(row.merchant ?? row.shop ?? row.shopName ?? 'Unknown'),
        price,
        currency:    String(row.currency ?? 'GBP'),
        url:         row.url != null ? String(row.url) : null,
        shippingCost: row.shippingCost != null ? Number(row.shippingCost) : null,
        totalPrice:   row.totalPrice != null ? Number(row.totalPrice) : null,
        rating:       row.rating != null ? Number(row.rating) : null,
      });
    }
  }

  return offers.slice(0, maxItems);
}

// ── Amazon product details scraper ────────────────────────────────────────────
// Actor: alpha-scraper~amazon-product-details-scraper-single-rental
// Returns detailed product data from Amazon UK: price, rating, features,
// variants, seller info. Useful when Keepa / PA-API quota is exhausted.

export interface ApifyAmazonProduct {
  asin: string;
  name: string;
  price: number;
  currency: string;
  inStock: boolean;
  url: string;
  rating: number | null;
  reviewCount: number | null;
  seller: string | null;
  brand: string | null;
  imageUrl: string | null;
  features: string[];
}

export async function apifyScrapeAmazon(
  asinOrUrl: string,
  countryCode = 'GB',
): Promise<ApifyAmazonProduct | null> {
  const token = getToken();
  if (!token) return null;

  const isUrl = asinOrUrl.startsWith('http');
  const input = isUrl
    ? { productUrl: asinOrUrl, countryCode }
    : { asin: asinOrUrl, countryCode };

  const result = await runApifyActor(
    'alpha-scraper~amazon-product-details-scraper-single-rental',
    input,
    120,
  );
  if (!result || result.status !== 'SUCCEEDED' || !result.datasetId) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = await getApifyDatasetItems<any>(result.datasetId, 1);
  const item = items[0];
  if (!item) return null;

  return {
    asin:        item.asin ?? item.ASIN ?? '',
    name:        item.name ?? item.title ?? item.productName ?? '',
    price:       Number(item.price ?? item.currentPrice ?? item.salePrice ?? 0),
    currency:    item.currency ?? 'GBP',
    inStock:     item.inStock ?? item.availability !== 'Currently unavailable',
    url:         item.url ?? item.productUrl ?? `https://www.amazon.co.uk/dp/${item.asin ?? ''}`,
    rating:      item.rating != null ? Number(item.rating) : null,
    reviewCount: item.reviewCount ?? item.ratingsCount ?? item.numberOfReviews ?? null,
    seller:      item.seller ?? item.soldBy ?? item.sellerName ?? null,
    brand:       item.brand ?? item.brandName ?? null,
    imageUrl:    item.image ?? item.imageUrl ?? item.mainImage ?? null,
    features:    Array.isArray(item.features) ? item.features.slice(0, 8) : [],
  };
}
