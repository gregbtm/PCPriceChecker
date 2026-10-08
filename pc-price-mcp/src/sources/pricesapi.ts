/**
 * PricesAPI.io integration — server-side only (CORS blocked in browsers).
 *
 * Cost, from pricesapi.io/pricing and /docs (read 2026-10-07): a Search that returns at least one merchant offer costs
 * **10 credits**, cache hits included; a search with no offers, and any failed request, costs nothing. The free Personal plan
 * is **3,000 credits, one-time, never renewed** (about 300 searches, 6 requests a minute, at most 3 products per search). The
 * old comment here, "50,000 calls/month free", was wrong. Market code `gb` is the United Kingdom (`uk` is rejected).
 *
 * Errors come as `{ success: false, error: { code, message, details } }`. Out of credits is `403 CREDITS_EXCEEDED` (or
 * `MONTHLY_LIMIT_EXCEEDED`) with details.credits_used / credits_included / resets_at (null when the allowance does not renew);
 * 401 is a bad key; 429 `RATE_LIMIT_EXCEEDED` carries Retry-After. These must not be confused: an exhausted balance
 * needs a pause, not a "check your key".
 *
 * Cold queries (uncached) can take 30–90 seconds. Cached queries return in ~100ms.
 */
import * as db from '../db.js';

const BASE_URL = 'https://api.pricesapi.io/api/v1';
const TIMEOUT_MS = 95_000;

export interface SearchOffer {
  price: number;
  currency: string;
  merchant: string;
  merchantUrl: string;
  url: string;
  condition: string;
  shipping: number | null;
  inStock: boolean;
}

export interface SearchProduct {
  name: string;
  url: string;
  image?: string;
  offers: SearchOffer[];
  cacheSource?: string;
}

export type PricesApiErrorKind = 'auth' | 'quota' | 'rate' | 'busy' | 'server' | 'other';

export class PricesApiError extends Error {
  constructor(
    message: string,
    public kind: PricesApiErrorKind,
    public status: number,
    public code: string | null = null,
    public details: { creditsUsed?: number; creditsIncluded?: number; resetsAt?: string | null } = {},
    public retryAfterSec: number | null = null,
  ) { super(message); this.name = 'PricesApiError'; }
}

/** Turns a failed response into a typed error. Exported for tests. */
export function classifyPricesApiFailure(status: number, bodyText: string, retryAfter: string | null): PricesApiError {
  let code: string | null = null, apiMessage = '';
  let details: any = {};
  try {
    const b = JSON.parse(bodyText);
    code = b?.error?.code ?? null; apiMessage = b?.error?.message ?? ''; details = b?.error?.details ?? {};
  } catch { /* not JSON */ }
  const retry = retryAfter != null && /^\d+$/.test(retryAfter) ? Number(retryAfter) : null;
  const tail = apiMessage ? ` (${apiMessage})` : '';

  if (code === 'CREDITS_EXCEEDED' || code === 'MONTHLY_LIMIT_EXCEEDED' || code === 'INSUFFICIENT_CREDITS') {
    const d = { creditsUsed: details.credits_used, creditsIncluded: details.credits_included, resetsAt: details.resets_at ?? null };
    const used = d.creditsUsed != null && d.creditsIncluded != null ? ` (${d.creditsUsed} of ${d.creditsIncluded} credits used)` : '';
    const renew = d.resetsAt ? `; credits renew ${d.resetsAt}` : '; this allowance does not renew';
    return new PricesApiError(`PricesAPI credits are used up${used}${renew}. PricesAPI is paused until the key is replaced or credits return.`, 'quota', status, code, d);
  }
  if (status === 401) return new PricesApiError(`PricesAPI rejected the API key (${code ?? 'HTTP 401'}): check PRICES_API_KEY${tail}`, 'auth', status, code);
  if (code === 'SUBSCRIPTION_CANCELLED') return new PricesApiError('PricesAPI subscription is cancelled; reactivate it or remove the key', 'auth', status, code);
  if (status === 429) return new PricesApiError(`PricesAPI rate limit${retry ? `, retry after ${retry}s` : ''}. Repeated over-quota searches can also return 429, so check the credit balance${tail}`, 'rate', status, code, {}, retry);
  if (status === 503) return new PricesApiError(`PricesAPI scraper is busy — please retry after ${retry ?? 5}s`, 'busy', status, code, {}, retry ?? 5);
  if (status >= 500) return new PricesApiError(`PricesAPI server error HTTP ${status}${code ? ` ${code}` : ''}${tail}`, 'server', status, code);
  if (status === 403) return new PricesApiError(`PricesAPI refused the request (HTTP 403${code ? ` ${code}` : ', no error code in the response'})${tail}`, 'other', status, code);
  return new PricesApiError(`PricesAPI returned HTTP ${status}${code ? ` ${code}` : ''}${tail}`, 'other', status, code);
}

/** Master switch (config `pricesapi_enabled`, or env PRICESAPI_ENABLED): `false` stops every call and keeps the key, so it can be turned back on when credits reset. */
export function pricesApiSwitchedOff(): boolean {
  return (db.getConfig('pricesapi_enabled') ?? process.env.PRICESAPI_ENABLED ?? '').trim().toLowerCase() === 'false';
}

function getApiKey(): string {
  if (pricesApiSwitchedOff()) throw new PricesApiError('PricesAPI is switched off in Settings (the key is kept); switch it back on on the Integrations tab', 'other', 0);
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
      // Playground uses x-api-key; send both for compatibility
      headers: { 'x-api-key': apiKey, Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw classifyPricesApiFailure(res.status, await res.text().catch(() => ''), res.headers.get('Retry-After'));
    }

    const body = (await res.json()) as any;
    // Support both response shapes: { data: { products } } and { products }
    const rawProducts: any[] = body?.data?.products ?? body?.products ?? [];
    const cacheSource: string = body?.meta?.cache_source ?? body?.data?.cache_source ?? 'unknown';

    const products: SearchProduct[] = rawProducts.map((p: any) => {
      // PricesAPI docs: offer fields are seller, seller_url, price, currency, shipping, condition, url
      const rawOffers: any[] = p.offers ?? p.pricing ?? p.prices ?? p.sellers ?? [];
      return {
        name: p.name ?? p.title ?? 'Unknown Product',
        url: p.url ?? p.link ?? '',
        image: p.image,
        offers: rawOffers.map((o: any) => ({
          price: Number(o.price ?? o.salePrice ?? 0),
          currency: ((o.currency ?? 'GBP') as string).toUpperCase(),
          // API field is `seller`; fall back to other common names
          merchant: o.seller ?? o.merchant ?? o.merchant_name ?? o.store ?? o.retailer ?? 'Unknown',
          merchantUrl: o.seller_url ?? o.merchant_url ?? '',
          url: o.url ?? o.product_url ?? o.link ?? '',
          condition: o.condition ?? o.item_condition ?? 'New',
          shipping: o.shipping != null ? Number(o.shipping) : null,
          inStock:
            o.availability !== 'OutOfStock' &&
            o.in_stock !== false &&
            o.stock !== 0 &&
            (o.condition ?? '').toLowerCase() !== 'out of stock',
        })),
      };
    });

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
      const isBusy = lastError instanceof PricesApiError ? lastError.kind === 'busy' : lastError.message.includes('scraper is busy');
      if (!isBusy || attempt >= maxRetries) throw lastError;

      const retryAfterMatch = lastError.message.match(/after (\d+)s/);
      const waitMs = retryAfterMatch ? Number(retryAfterMatch[1]) * 1000 : delays[attempt] ?? 8_000;
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw lastError;
}
