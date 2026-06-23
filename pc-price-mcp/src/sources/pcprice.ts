/**
 * pcprice.watch scraper — eBay secondhand prices across 100+ countries.
 * Covers GPUs, CPUs, RAM, and motherboards.
 * Used/resale prices only — not new retail pricing.
 * Reference: https://www.pcprice.watch
 */

export type ComponentCategory = 'gpu' | 'cpu' | 'ram' | 'motherboard';

export interface EbayComponentPrice {
  slug: string;
  category: ComponentCategory;
  displayName: string;
  medianPrice: number | null;
  currency: string;
  activeListings: number;
  country: string;
  sourceUrl: string;
  scrapedAt: string;
  scraperNote?: string;
}

// ── GPU slugs ──────────────────────────────────────────────────────────────

const GPU_SLUGS: Record<string, string> = {
  // RTX 50 Series
  'rtx 5090': 'rtx-5090', 'rtx5090': 'rtx-5090',
  'rtx 5080': 'rtx-5080', 'rtx5080': 'rtx-5080',
  'rtx 5070 ti': 'rtx-5070-ti', 'rtx5070ti': 'rtx-5070-ti',
  'rtx 5070': 'rtx-5070', 'rtx5070': 'rtx-5070',
  'rtx 5060 ti': 'rtx-5060-ti', 'rtx 5060': 'rtx-5060',
  // RTX 40 Series
  'rtx 4090': 'rtx-4090', 'rtx4090': 'rtx-4090',
  'rtx 4080 super': 'rtx-4080-super',
  'rtx 4080': 'rtx-4080', 'rtx4080': 'rtx-4080',
  'rtx 4070 ti super': 'rtx-4070-ti-super',
  'rtx 4070 ti': 'rtx-4070-ti', 'rtx 4070 super': 'rtx-4070-super',
  'rtx 4070': 'rtx-4070', 'rtx4070': 'rtx-4070',
  'rtx 4060 ti': 'rtx-4060-ti', 'rtx 4060': 'rtx-4060', 'rtx4060': 'rtx-4060',
  // RTX 30 Series
  'rtx 3090 ti': 'rtx-3090-ti', 'rtx 3090': 'rtx-3090', 'rtx3090': 'rtx-3090',
  'rtx 3080 ti': 'rtx-3080-ti', 'rtx 3080 12gb': 'rtx-3080-12gb',
  'rtx 3080': 'rtx-3080', 'rtx3080': 'rtx-3080',
  'rtx 3070 ti': 'rtx-3070-ti', 'rtx 3070': 'rtx-3070', 'rtx3070': 'rtx-3070',
  'rtx 3060 ti': 'rtx-3060-ti', 'rtx 3060': 'rtx-3060', 'rtx3060': 'rtx-3060',
  // RTX 20 Series
  'rtx 2080 ti': 'rtx-2080-ti', 'rtx 2080 super': 'rtx-2080-super',
  'rtx 2080': 'rtx-2080', 'rtx 2070 super': 'rtx-2070-super',
  'rtx 2070': 'rtx-2070', 'rtx 2060 super': 'rtx-2060-super', 'rtx 2060': 'rtx-2060',
  // GTX
  'gtx 1660 super': 'gtx-1660-super', 'gtx 1660 ti': 'gtx-1660-ti', 'gtx 1660': 'gtx-1660',
  'gtx 1650 super': 'gtx-1650-super', 'gtx 1650': 'gtx-1650',
  // AMD RX 9000
  'rx 9070 xt': 'rx-9070-xt', 'rx9070xt': 'rx-9070-xt',
  'rx 9070': 'rx-9070', 'rx9070': 'rx-9070',
  // AMD RX 7000
  'rx 7900 xtx': 'rx-7900-xtx', 'rx 7900 xt': 'rx-7900-xt',
  'rx 7900 gre': 'rx-7900-gre', 'rx 7800 xt': 'rx-7800-xt',
  'rx 7700 xt': 'rx-7700-xt', 'rx 7600 xt': 'rx-7600-xt', 'rx 7600': 'rx-7600',
  // Intel Arc
  'arc b580': 'arc-b580', 'arc b770': 'arc-b770',
  'arc a770': 'arc-a770', 'arc a750': 'arc-a750', 'arc a580': 'arc-a580',
};

// ── CPU slugs ──────────────────────────────────────────────────────────────

const CPU_SLUGS: Record<string, string> = {
  // AMD Ryzen 9000 Series
  'ryzen 9 9950x3d': 'ryzen-9-9950x3d', 'ryzen 9 9950x': 'ryzen-9-9950x',
  'ryzen 9 9900x': 'ryzen-9-9900x', 'ryzen 7 9800x3d': 'ryzen-7-9800x3d',
  'ryzen 7 9700x': 'ryzen-7-9700x', 'ryzen 5 9600x': 'ryzen-5-9600x',
  // AMD Ryzen 7000 Series
  'ryzen 9 7950x3d': 'ryzen-9-7950x3d', 'ryzen 9 7950x': 'ryzen-9-7950x',
  'ryzen 9 7900x3d': 'ryzen-9-7900x3d', 'ryzen 9 7900x': 'ryzen-9-7900x',
  'ryzen 7 7800x3d': 'ryzen-7-7800x3d', 'ryzen 7 7700x': 'ryzen-7-7700x',
  'ryzen 7 7700': 'ryzen-7-7700', 'ryzen 5 7600x': 'ryzen-5-7600x',
  'ryzen 5 7600': 'ryzen-5-7600',
  // AMD Ryzen 5000 Series
  'ryzen 9 5950x': 'ryzen-9-5950x', 'ryzen 9 5900x': 'ryzen-9-5900x',
  'ryzen 7 5800x3d': 'ryzen-7-5800x3d', 'ryzen 7 5800x': 'ryzen-7-5800x',
  'ryzen 5 5600x': 'ryzen-5-5600x', 'ryzen 5 5600': 'ryzen-5-5600',
  // Intel Core Ultra 200 Series
  'core ultra 9 285k': 'core-ultra-9-285k', 'core ultra 7 265k': 'core-ultra-7-265k',
  'core ultra 7 265kf': 'core-ultra-7-265kf', 'core ultra 5 245k': 'core-ultra-5-245k',
  // Intel Core 14th Gen
  'core i9-14900k': 'core-i9-14900k', 'i9-14900k': 'core-i9-14900k',
  'core i9-14900ks': 'core-i9-14900ks',
  'core i7-14700k': 'core-i7-14700k', 'i7-14700k': 'core-i7-14700k',
  'core i5-14600k': 'core-i5-14600k', 'i5-14600k': 'core-i5-14600k',
  // Intel Core 13th Gen
  'core i9-13900k': 'core-i9-13900k', 'i9-13900k': 'core-i9-13900k',
  'core i9-13900ks': 'core-i9-13900ks',
  'core i7-13700k': 'core-i7-13700k', 'i7-13700k': 'core-i7-13700k',
  'core i5-13600k': 'core-i5-13600k', 'i5-13600k': 'core-i5-13600k',
};

// ── RAM slugs (popular kits) ───────────────────────────────────────────────

const RAM_SLUGS: Record<string, string> = {
  // DDR5 kits by capacity+speed (common search patterns)
  'ddr5 32gb 6000': 'ddr5-32gb-6000', 'ddr5 32gb 6400': 'ddr5-32gb-6400',
  'ddr5 32gb 7200': 'ddr5-32gb-7200', 'ddr5 64gb 6000': 'ddr5-64gb-6000',
  'ddr5 64gb 6400': 'ddr5-64gb-6400', 'ddr5 16gb 6000': 'ddr5-16gb-6000',
  // DDR4 kits
  'ddr4 32gb 3600': 'ddr4-32gb-3600', 'ddr4 32gb 3200': 'ddr4-32gb-3200',
  'ddr4 16gb 3600': 'ddr4-16gb-3600', 'ddr4 16gb 3200': 'ddr4-16gb-3200',
  'ddr4 64gb 3600': 'ddr4-64gb-3600',
};

// ── Motherboard slugs (popular boards) ────────────────────────────────────

const MOTHERBOARD_SLUGS: Record<string, string> = {
  // AM5 X870E
  'asus rog crosshair x870e hero': 'asus-rog-crosshair-x870e-hero',
  'asus rog strix x870e-e': 'asus-rog-strix-x870e-e',
  'msi meg x870e ace': 'msi-meg-x870e-ace',
  'gigabyte x870e aorus master': 'gigabyte-x870e-aorus-master',
  // AM5 X670E
  'asus rog crosshair x670e hero': 'asus-rog-crosshair-x670e-hero',
  'asus rog strix x670e-e': 'asus-rog-strix-x670e-e',
  'msi meg x670e ace': 'msi-meg-x670e-ace',
  'gigabyte x670e aorus master': 'gigabyte-x670e-aorus-master',
  // AM5 B650
  'asus rog strix b650e-f': 'asus-rog-strix-b650e-f',
  'msi mag b650 tomahawk': 'msi-mag-b650-tomahawk',
  'gigabyte b650 aorus elite': 'gigabyte-b650-aorus-elite',
  // LGA1851
  'asus rog maximus z890 apex': 'asus-rog-maximus-z890-apex',
  'msi meg z890 ace': 'msi-meg-z890-ace',
  // LGA1700 Z790
  'asus rog maximus z790 hero': 'asus-rog-maximus-z790-hero',
  'asus rog strix z790-e': 'asus-rog-strix-z790-e',
  'msi meg z790 ace': 'msi-meg-z790-ace',
  'gigabyte z790 aorus master': 'gigabyte-z790-aorus-master',
  // LGA1700 B760
  'asus prime b760m-a': 'asus-prime-b760m-a',
  'msi pro b760m-a': 'msi-pro-b760m-a',
};

const SLUG_MAPS: Record<ComponentCategory, Record<string, string>> = {
  gpu: GPU_SLUGS, cpu: CPU_SLUGS, ram: RAM_SLUGS, motherboard: MOTHERBOARD_SLUGS,
};

export function resolveComponentSlug(category: ComponentCategory, query: string): string | null {
  const norm = query.toLowerCase().replace(/\s+/g, ' ').trim();
  const map = SLUG_MAPS[category];
  if (map[norm]) return map[norm];
  for (const [key, slug] of Object.entries(map)) {
    if (norm.includes(key)) return slug;
  }
  return null;
}

// Keep backward-compat export used in index.ts Phase 1/2
export function resolveGpuSlug(query: string): string | null {
  return resolveComponentSlug('gpu', query);
}

export function listSupportedComponents(category: ComponentCategory): string[] {
  const seen = new Set<string>();
  return Object.values(SLUG_MAPS[category])
    .filter(s => !seen.has(s) && seen.add(s))
    .map(s => s.replace(/-/g, ' ').toUpperCase())
    .sort();
}

export function listSupportedGpus(): string[] { return listSupportedComponents('gpu'); }

// ── Scraper ────────────────────────────────────────────────────────────────

const COUNTRY_CURRENCY: Record<string, string> = {
  gb: 'GBP', us: 'USD', au: 'AUD', ca: 'CAD', de: 'EUR',
  fr: 'EUR', nl: 'EUR', es: 'EUR', it: 'EUR', jp: 'JPY',
  nz: 'NZD', in: 'INR', br: 'BRL', sg: 'SGD',
};

export async function scrapeEbayComponentPrices(
  category: ComponentCategory,
  slug: string,
  country = 'gb',
): Promise<EbayComponentPrice> {
  const currency = COUNTRY_CURRENCY[country.toLowerCase()] ?? 'GBP';
  const url = `https://www.pcprice.watch/${category}/${slug}?country=${country}`;

  const result: EbayComponentPrice = {
    slug, category,
    displayName: slug.replace(/-/g, ' ').toUpperCase(),
    medianPrice: null, currency, activeListings: 0,
    country, sourceUrl: url, scrapedAt: new Date().toISOString(),
  };

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) { result.scraperNote = `HTTP ${res.status}`; return result; }
    const html = await res.text();

    // Strategy 1 — Next.js __NEXT_DATA__
    const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (nextMatch) {
      try {
        const found = deepSearch(JSON.parse(nextMatch[1])?.props?.pageProps);
        if (found) {
          result.medianPrice = found.price;
          result.activeListings = found.listings ?? 0;
          result.scraperNote = 'Extracted from __NEXT_DATA__';
          return result;
        }
      } catch { /* fall through */ }
    }

    // Strategy 2 — JSON-LD
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

    // Strategy 3 — inline medianPrice key
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

    // Strategy 4 — currency pattern extraction
    const sym = currency === 'GBP' ? '£' : '$';
    const prices = [...html.matchAll(new RegExp(`\\${sym}\\s*([\\d,]+(?:\\.\\d{2})?)`, 'g'))]
      .map(m => parseFloat(m[1].replace(/,/g, ''))).filter(p => p > 5 && p < 80_000)
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

// Keep backward-compat export
export async function scrapeEbayGpuPrices(slug: string, country = 'gb'): Promise<EbayComponentPrice> {
  return scrapeEbayComponentPrices('gpu', slug, country);
}

function deepSearch(obj: unknown, depth = 0): { price: number; listings?: number } | null {
  if (depth > 8 || obj == null || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  const keys = Object.keys(rec);
  for (const key of keys) {
    const lk = key.toLowerCase();
    const val = rec[key];
    if ((lk === 'medianprice' || lk === 'median_price' || lk === 'mediansoldprice') && typeof val === 'number' && val > 1) {
      const lk2 = keys.find(k => k.toLowerCase().includes('listing') || k.toLowerCase().includes('count'));
      return { price: val, listings: lk2 ? Number(rec[lk2]) : undefined };
    }
  }
  for (const key of keys) {
    const res = deepSearch(rec[key], depth + 1);
    if (res) return res;
  }
  return null;
}
