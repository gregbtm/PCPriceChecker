/**
 * PricesAPI.io integration — server-side only (CORS blocked in browsers).
 * Free tier: 50,000 calls/month. Sign up at https://pricesapi.io
 *
 * Cold queries (uncached) can take 30–90 seconds.
 * Cached queries return in ~100ms.
 */

const BASE_URL = 'https://api.pricesapi.io/api/v1';
const TIMEOUT_MS = 95_000;

export interface SearchOffer {
  price: number;
  currency: string;
  merchant: string;
  url: string;
  inStock: boolean;
}

export interface SearchProduct {
  name: string;
  url: string;
  image?: string;
  offers: SearchOffer[];
  cacheSource?: string;
}

function getApiKey(): string {
  const key = process.env.PRICES_API_KEY?.trim();
  if (!key) {
    throw new Error(
      'PRICES_API_KEY environment variable is not set.\n' +
      'Get a free key (50k calls/month) at https://pricesapi.io — no credit card required.',
    );
  }
  return key;
}

export async function searchProducts(
  query: string,
  country = 'gb',
  limit = 5,
  offersLimit = 10,
): Promise<{ products: SearchProduct[]; cacheSource: string; durationMs: number }> {
  const apiKey = getApiKey();
  const t0 = Date.now();

  const params = new URLSearchParams({
    q: query,
    country,
    limit: String(Math.min(limit, 10)),
    offers_limit: String(Math.min(offersLimit, 20)),
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE_URL}/products/search?${params}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    if (res.status === 503) {
      const retryAfter = res.headers.get('Retry-After') ?? '5';
      throw new Error(`PricesAPI scraper is busy — please retry after ${retryAfter}s`);
    }

    if (res.status === 401 || res.status === 403) {
      throw new Error('PricesAPI authentication failed — check your PRICES_API_KEY');
    }

    if (!res.ok) {
      throw new Error(`PricesAPI returned HTTP ${res.status}: ${res.statusText}`);
    }

    const body = (await res.json()) as any;
    const rawProducts: any[] = body?.data?.products ?? [];
    const cacheSource: string = body?.meta?.cache_source ?? 'unknown';

    const products: SearchProduct[] = rawProducts.map((p: any) => ({
      name: p.name ?? p.title ?? 'Unknown Product',
      url: p.url ?? '',
      image: p.image,
      offers: (p.offers ?? []).map((o: any) => ({
        price: Number(o.price ?? 0),
        currency: ((o.currency ?? 'GBP') as string).toUpperCase(),
        merchant: o.merchant ?? o.seller ?? o.store ?? 'Unknown',
        url: o.url ?? o.link ?? '',
        inStock:
          o.availability !== 'OutOfStock' &&
          o.in_stock !== false &&
          o.stock !== 0,
      })),
    }));

    return { products, cacheSource, durationMs: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Retry wrapper with exponential backoff for 503 errors.
 */
export async function searchWithRetry(
  query: string,
  country = 'gb',
  limit = 5,
  offersLimit = 10,
  maxRetries = 3,
): Promise<{ products: SearchProduct[]; cacheSource: string; durationMs: number }> {
  let lastError: Error = new Error('Unknown error');
  const delays = [2_000, 4_000, 8_000];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await searchProducts(query, country, limit, offersLimit);
    } catch (err) {
      lastError = err as Error;
      const isBusy = lastError.message.includes('scraper is busy') || lastError.message.includes('503');
      if (!isBusy || attempt >= maxRetries) throw lastError;

      const retryAfterMatch = lastError.message.match(/after (\d+)s/);
      const waitMs = retryAfterMatch ? Number(retryAfterMatch[1]) * 1000 : delays[attempt] ?? 8_000;
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}
