/**
 * Keepa API — Amazon UK price history and product search.
 * Much more reliable than scraping CamelCamelCamel.
 * Docs:      https://keepa.com/#!api/7-0-request-format
 * Free tier: 100 tokens/minute. 1 product fetch ≈ 1 token.
 * Sign up:   https://keepa.com/#!api
 *
 * Price data comes as compressed arrays: [timestamp, price, timestamp, price, ...]
 * Timestamps are minutes since 2011-01-01T00:00:00Z.
 * Prices are integer 100ths of the currency unit (£9.99 → 999). -1 = unavailable.
 */

const BASE       = 'https://api.keepa.com';
const EPOCH_MS   = 1_293_840_000_000; // 2011-01-01T00:00:00Z
const UK_DOMAIN  = '2';               // Amazon.co.uk

// csv array indices (product.csv[N] = price history for that type)
const CSV_AMAZON = 0; // sold by Amazon
const CSV_NEW    = 1; // 3rd-party new
const CSV_USED   = 2; // any used condition

export interface KeepaProduct {
  asin:         string;
  title:        string;
  brand?:       string;
  url:          string;
  currency:     string;
  currentPrice: number | null;
  allTimeLow:   number | null;
  allTimeHigh:  number | null;
  avg30d:       number | null;
  avg90d:       number | null;
  avg180d:      number | null;
  inStock:      boolean;
  priceHistory: { date: string; price: number }[]; // last 365 days, new price
}

export interface KeepaResult {
  query:      string;
  products:   KeepaProduct[];
  scrapedAt:  string;
  durationMs: number;
  tokensLeft?: number;
  error?:     string;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function key(): string {
  const k = process.env.KEEPA_API_KEY?.trim();
  if (!k) throw new Error('KEEPA_API_KEY not set — get a free key at keepa.com/api');
  return k;
}

function tsToDate(t: number): string {
  return new Date(EPOCH_MS + t * 60_000).toISOString().split('T')[0];
}

function toCurrency(p: number): number | null {
  return p < 0 ? null : p / 100;
}

function decompressHistory(arr: number[] | null | undefined): { date: string; price: number }[] {
  if (!arr || arr.length < 2) return [];
  const out: { date: string; price: number }[] = [];
  for (let i = 0; i + 1 < arr.length; i += 2) {
    const price = toCurrency(arr[i + 1]);
    if (price !== null) out.push({ date: tsToDate(arr[i]), price });
  }
  return out;
}

function last365(history: { date: string; price: number }[]): { date: string; price: number }[] {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  const cutoffStr = cutoff.toISOString().split('T')[0];
  return history.filter(h => h.date >= cutoffStr);
}

async function kFetch(path: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const qs = new URLSearchParams({ key: key(), domain: UK_DOMAIN, ...params });
  const res = await fetch(`${BASE}${path}?${qs}`, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Keepa HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}

// ── Product mapper ─────────────────────────────────────────────────────────

function mapProduct(p: Record<string, unknown>): KeepaProduct {
  const csv    = p.csv as (number[] | null)[] | null;
  const aznArr = csv?.[CSV_AMAZON] ?? [];
  const newArr = csv?.[CSV_NEW]    ?? [];
  const useArr = aznArr.length > 0 ? aznArr : newArr; // prefer Amazon, fall back to 3P

  const histFull  = decompressHistory(useArr);
  const histNew   = useArr === aznArr ? decompressHistory(newArr) : histFull;
  const allPrices = [...histFull.map(h => h.price), ...histNew.map(h => h.price)];

  const stats = p.stats as Record<string, number[]> | null;
  const cur   = stats?.current ?? [];

  const curAzn = toCurrency(cur[CSV_AMAZON] ?? -1);
  const curNew = toCurrency(cur[CSV_NEW]    ?? -1);
  const currentPrice =
    curAzn !== null && curNew !== null ? Math.min(curAzn, curNew) :
    curAzn ?? curNew ?? histFull.at(-1)?.price ?? null;

  const a30  = stats?.avg30  ?? [];
  const a90  = stats?.avg90  ?? [];
  const a180 = stats?.avg180 ?? [];

  function bestAvg(arr: number[]): number | null {
    const v = [arr[CSV_AMAZON], arr[CSV_NEW]].find(x => x != null && x > 0);
    return v != null ? toCurrency(v) : null;
  }

  return {
    asin:         String(p.asin ?? ''),
    title:        String(p.title ?? 'Unknown'),
    brand:        p.brand != null ? String(p.brand) : undefined,
    url:          `https://www.amazon.co.uk/dp/${p.asin}`,
    currency:     'GBP',
    currentPrice,
    allTimeLow:   allPrices.length > 0 ? Math.min(...allPrices) : null,
    allTimeHigh:  allPrices.length > 0 ? Math.max(...allPrices) : null,
    avg30d:       bestAvg(a30),
    avg90d:       bestAvg(a90),
    avg180d:      bestAvg(a180),
    inStock:      p.availabilityAmazon === 0,
    priceHistory: last365(histFull),
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function keepaSearch(query: string, limit = 10): Promise<KeepaResult> {
  const t0 = Date.now();
  try {
    const searchData   = await kFetch('/search', { type: 'product', term: query, limit: String(limit) });
    const asins        = (searchData.asinList as string[] | undefined) ?? [];
    if (asins.length === 0) {
      return { query, products: [], scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0 };
    }
    const productData  = await kFetch('/product', { asin: asins.slice(0, limit).join(','), history: '1', stats: '1' });
    const raw          = (productData.products as Record<string, unknown>[] | undefined) ?? [];
    return {
      query,
      products:   raw.map(mapProduct),
      scrapedAt:  new Date().toISOString(),
      durationMs: Date.now() - t0,
      tokensLeft: productData.tokensLeft as number | undefined,
    };
  } catch (e) {
    return { query, products: [], scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0, error: String(e) };
  }
}

export async function keepaGetByAsin(asin: string): Promise<KeepaProduct | null> {
  try {
    const data = await kFetch('/product', { asin, history: '1', stats: '1' });
    const raw  = (data.products as Record<string, unknown>[] | undefined) ?? [];
    return raw.length > 0 ? mapProduct(raw[0]) : null;
  } catch {
    return null;
  }
}

export async function keepaGetMultiple(asins: string[]): Promise<KeepaProduct[]> {
  if (asins.length === 0) return [];
  try {
    const data = await kFetch('/product', { asin: asins.slice(0, 20).join(','), history: '1', stats: '1' });
    const raw  = (data.products as Record<string, unknown>[] | undefined) ?? [];
    return raw.map(mapProduct);
  } catch {
    return [];
  }
}

export async function keepaGetUsedPrices(asin: string): Promise<{ date: string; price: number }[]> {
  try {
    const data = await kFetch('/product', { asin, history: '1' });
    const raw  = (data.products as Record<string, unknown>[] | undefined) ?? [];
    if (raw.length === 0) return [];
    const csv     = raw[0].csv as (number[] | null)[] | null;
    const usedArr = csv?.[CSV_USED] ?? [];
    return last365(decompressHistory(usedArr));
  } catch {
    return [];
  }
}
