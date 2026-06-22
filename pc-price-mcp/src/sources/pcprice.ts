/**
 * pcprice.watch scraper — eBay secondhand GPU prices across 100+ countries.
 * The site is browser-accessible (no CORS issues server-side).
 * Covers used/resale prices only — not new retail pricing.
 * Reference: https://www.pcprice.watch
 */

export interface EbayGpuPrice {
  slug: string;
  displayName: string;
  medianPrice: number | null;
  currency: string;
  activeListings: number;
  country: string;
  sourceUrl: string;
  scrapedAt: string;
  scraperNote?: string;
}

// Known GPU slugs matched against normalised query strings.
// Keys: normalised lowercase name (with and without spaces).
// Values: pcprice.watch URL slug.
const GPU_SLUG_MAP: Record<string, string> = {
  // ── RTX 50 Series ───────────────────────────────────────────────
  'rtx 5090': 'rtx-5090', 'rtx5090': 'rtx-5090',
  'rtx 5080': 'rtx-5080', 'rtx5080': 'rtx-5080',
  'rtx 5070 ti': 'rtx-5070-ti', 'rtx5070ti': 'rtx-5070-ti',
  'rtx 5070': 'rtx-5070', 'rtx5070': 'rtx-5070',
  'rtx 5060 ti': 'rtx-5060-ti', 'rtx5060ti': 'rtx-5060-ti',
  'rtx 5060': 'rtx-5060', 'rtx5060': 'rtx-5060',
  // ── RTX 40 Series ───────────────────────────────────────────────
  'rtx 4090': 'rtx-4090', 'rtx4090': 'rtx-4090',
  'rtx 4080 super': 'rtx-4080-super', 'rtx4080super': 'rtx-4080-super',
  'rtx 4080': 'rtx-4080', 'rtx4080': 'rtx-4080',
  'rtx 4070 ti super': 'rtx-4070-ti-super', 'rtx4070tisuper': 'rtx-4070-ti-super',
  'rtx 4070 ti': 'rtx-4070-ti', 'rtx4070ti': 'rtx-4070-ti',
  'rtx 4070 super': 'rtx-4070-super', 'rtx4070super': 'rtx-4070-super',
  'rtx 4070': 'rtx-4070', 'rtx4070': 'rtx-4070',
  'rtx 4060 ti': 'rtx-4060-ti', 'rtx4060ti': 'rtx-4060-ti',
  'rtx 4060': 'rtx-4060', 'rtx4060': 'rtx-4060',
  // ── RTX 30 Series ───────────────────────────────────────────────
  'rtx 3090 ti': 'rtx-3090-ti', 'rtx3090ti': 'rtx-3090-ti',
  'rtx 3090': 'rtx-3090', 'rtx3090': 'rtx-3090',
  'rtx 3080 ti': 'rtx-3080-ti', 'rtx3080ti': 'rtx-3080-ti',
  'rtx 3080 12gb': 'rtx-3080-12gb',
  'rtx 3080': 'rtx-3080', 'rtx3080': 'rtx-3080',
  'rtx 3070 ti': 'rtx-3070-ti', 'rtx3070ti': 'rtx-3070-ti',
  'rtx 3070': 'rtx-3070', 'rtx3070': 'rtx-3070',
  'rtx 3060 ti': 'rtx-3060-ti', 'rtx3060ti': 'rtx-3060-ti',
  'rtx 3060': 'rtx-3060', 'rtx3060': 'rtx-3060',
  // ── RTX 20 Series ───────────────────────────────────────────────
  'rtx 2080 ti': 'rtx-2080-ti', 'rtx2080ti': 'rtx-2080-ti',
  'rtx 2080 super': 'rtx-2080-super',
  'rtx 2080': 'rtx-2080', 'rtx2080': 'rtx-2080',
  'rtx 2070 super': 'rtx-2070-super',
  'rtx 2070': 'rtx-2070', 'rtx2070': 'rtx-2070',
  'rtx 2060 super': 'rtx-2060-super',
  'rtx 2060': 'rtx-2060', 'rtx2060': 'rtx-2060',
  // ── GTX 16 / 10 Series ──────────────────────────────────────────
  'gtx 1660 super': 'gtx-1660-super',
  'gtx 1660 ti': 'gtx-1660-ti',
  'gtx 1660': 'gtx-1660',
  'gtx 1650 super': 'gtx-1650-super',
  'gtx 1650': 'gtx-1650', 'gtx1650': 'gtx-1650',
  // ── AMD RX 9000 Series ──────────────────────────────────────────
  'rx 9070 xt': 'rx-9070-xt', 'rx9070xt': 'rx-9070-xt',
  'rx 9070': 'rx-9070', 'rx9070': 'rx-9070',
  // ── AMD RX 7000 Series ──────────────────────────────────────────
  'rx 7900 xtx': 'rx-7900-xtx', 'rx7900xtx': 'rx-7900-xtx',
  'rx 7900 xt': 'rx-7900-xt', 'rx7900xt': 'rx-7900-xt',
  'rx 7900 gre': 'rx-7900-gre',
  'rx 7800 xt': 'rx-7800-xt', 'rx7800xt': 'rx-7800-xt',
  'rx 7700 xt': 'rx-7700-xt', 'rx7700xt': 'rx-7700-xt',
  'rx 7600 xt': 'rx-7600-xt',
  'rx 7600': 'rx-7600', 'rx7600': 'rx-7600',
  // ── Intel Arc ───────────────────────────────────────────────────
  'arc b580': 'arc-b580', 'arcb580': 'arc-b580',
  'arc b770': 'arc-b770', 'arcb770': 'arc-b770',
  'arc a770': 'arc-a770', 'arca770': 'arc-a770',
  'arc a750': 'arc-a750', 'arca750': 'arc-a750',
  'arc a580': 'arc-a580', 'arca580': 'arc-a580',
};

export function resolveGpuSlug(query: string): string | null {
  const normalised = query.toLowerCase().replace(/\s+/g, ' ').trim();
  if (GPU_SLUG_MAP[normalised]) return GPU_SLUG_MAP[normalised];
  // Partial match — handles "ASUS ROG RTX 4090 OC 24GB" etc.
  for (const [key, slug] of Object.entries(GPU_SLUG_MAP)) {
    if (normalised.includes(key)) return slug;
  }
  return null;
}

export function listSupportedGpus(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const slug of Object.values(GPU_SLUG_MAP)) {
    if (!seen.has(slug)) {
      seen.add(slug);
      out.push(slug.replace(/-/g, ' ').toUpperCase());
    }
  }
  return out.sort();
}

const COUNTRY_CURRENCY: Record<string, string> = {
  gb: 'GBP', us: 'USD', au: 'AUD', ca: 'CAD', de: 'EUR',
  fr: 'EUR', nl: 'EUR', es: 'EUR', it: 'EUR', jp: 'JPY',
  nz: 'NZD', in: 'INR', br: 'BRL', sg: 'SGD',
};

export async function scrapeEbayGpuPrices(
  gpuSlug: string,
  country = 'gb',
): Promise<EbayGpuPrice> {
  const currency = COUNTRY_CURRENCY[country.toLowerCase()] ?? 'GBP';
  const url = `https://www.pcprice.watch/gpu/${gpuSlug}?country=${country}`;
  const result: EbayGpuPrice = {
    slug: gpuSlug,
    displayName: gpuSlug.replace(/-/g, ' ').toUpperCase(),
    medianPrice: null,
    currency,
    activeListings: 0,
    country,
    sourceUrl: url,
    scrapedAt: new Date().toISOString(),
  };

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      result.scraperNote = `HTTP ${res.status} from pcprice.watch`;
      return result;
    }

    const html = await res.text();

    // Strategy 1 — Next.js __NEXT_DATA__ JSON blob
    const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextMatch) {
      try {
        const nextData = JSON.parse(nextMatch[1]);
        const found = deepSearch(nextData?.props?.pageProps);
        if (found) {
          result.medianPrice = found.price;
          result.activeListings = found.listings ?? 0;
          result.scraperNote = 'Extracted from __NEXT_DATA__';
          return result;
        }
      } catch { /* fall through */ }
    }

    // Strategy 2 — JSON-LD structured data
    for (const [, raw] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
      try {
        const ld = JSON.parse(raw);
        const offer = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
        if (offer?.price != null) {
          result.medianPrice = Number(offer.price);
          result.currency = offer.priceCurrency ?? currency;
          result.scraperNote = 'Extracted from JSON-LD';
          return result;
        }
      } catch { /* fall through */ }
    }

    // Strategy 3 — inline script containing medianPrice key
    for (const [, raw] of html.matchAll(/<script[^>]*>([\s\S]*?medianPrice[\s\S]*?)<\/script>/g)) {
      const m = raw.match(/["']?medianPrice["']?\s*:\s*([\d.]+)/);
      if (m) {
        result.medianPrice = Number(m[1]);
        const lm = raw.match(/["']?activeListings["']?\s*:\s*(\d+)/);
        if (lm) result.activeListings = Number(lm[1]);
        result.scraperNote = 'Extracted from inline script';
        return result;
      }
    }

    // Strategy 4 — currency symbol price extraction from visible text
    const sym = currency === 'GBP' ? '£' : '$';
    const prices = [...html.matchAll(new RegExp(`\\${sym}\\s*([\\d,]+(?:\\.\\d{2})?)`, 'g'))]
      .map(m => parseFloat(m[1].replace(/,/g, '')))
      .filter(p => p > 30 && p < 60_000)
      .sort((a, b) => a - b);

    if (prices.length > 0) {
      result.medianPrice = prices[Math.floor(prices.length / 2)];
      result.activeListings = prices.length;
      result.scraperNote = `Inferred from ${prices.length} price patterns in HTML`;
    } else {
      result.scraperNote = 'Could not extract price — page structure may have changed';
    }
  } catch (err) {
    result.scraperNote = `Fetch error: ${(err as Error).message}`;
  }

  return result;
}

/** Recursively search a Next.js pageProps object for a median price. */
function deepSearch(
  obj: unknown,
  depth = 0,
): { price: number; listings?: number } | null {
  if (depth > 8 || obj == null || typeof obj !== 'object') return null;

  const rec = obj as Record<string, unknown>;
  const keys = Object.keys(rec);

  for (const key of keys) {
    const lk = key.toLowerCase();
    const val = rec[key];
    if (
      (lk === 'medianprice' || lk === 'median_price' || lk === 'mediansoldprice') &&
      typeof val === 'number' &&
      val > 10
    ) {
      const listingKey = keys.find(k =>
        k.toLowerCase().includes('listing') || k.toLowerCase().includes('count'),
      );
      return { price: val, listings: listingKey ? Number(rec[listingKey]) : undefined };
    }
  }

  for (const key of keys) {
    const res = deepSearch(rec[key], depth + 1);
    if (res) return res;
  }

  return null;
}
