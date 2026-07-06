/**
 * AWIN (Affiliate Window) integration — UK retailer product search.
 * AWIN is the UK's largest affiliate network: Scan, Overclockers, Ebuyer,
 * CCL, Currys, Amazon UK, Novatech and 300+ others publish live product
 * feeds through it — but each merchant approves publishers individually,
 * so awinSearch() only ever returns results for programmes this specific
 * publisher account has been approved for, not the network's full catalogue.
 * Use awinGetMerchants() to see which ones that actually is.
 *
 * Requires a publisher account: https://www.awin.com/gb/publishers
 * Approval takes ~1 week, then per-merchant approval on top of that. Once
 * the account itself is approved:
 *   AWIN_PUBLISHER_ID = your publisher (affiliate) ID
 *   AWIN_API_KEY      = API key from awin.com/gb/publishers/profile/api-credentials
 *
 * Search uses the ProductServe endpoint which queries all joined merchants.
 */

const PRODUCTSERVE = 'https://productserve.awin.com/productserve';
const API_BASE     = 'https://api.awin.com';

export interface AwinProduct {
  id:           string;
  name:         string;
  brand?:       string;
  price:        number | null;
  rrp?:         number | null;
  currency:     string;
  url:          string;
  merchant:     string;
  merchantId:   string;
  inStock:      boolean;
  ean?:         string;
  sku?:         string;
  imageUrl?:    string;
  category?:    string;
  description?: string;
}

export interface AwinSearchResult {
  query:      string;
  products:   AwinProduct[];
  scrapedAt:  string;
  durationMs: number;
  error?:     string;
}

export interface AwinMerchant {
  id:   string;
  name: string;
  url?: string;
}

function creds(): { publisherId: string; apiKey: string } {
  const publisherId = process.env.AWIN_PUBLISHER_ID?.trim();
  const apiKey      = process.env.AWIN_API_KEY?.trim();
  if (!publisherId || !apiKey) {
    throw new Error('AWIN requires AWIN_PUBLISHER_ID and AWIN_API_KEY — sign up at awin.com/gb/publishers');
  }
  return { publisherId, apiKey };
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v));
  return isNaN(n) ? null : n;
}

function mapProduct(item: Record<string, unknown>): AwinProduct {
  return {
    id:          String(item.aw_product_id ?? item.product_id ?? item.id ?? ''),
    name:        String(item.product_name  ?? item.name       ?? 'Unknown'),
    brand:       item.brand_name  != null ? String(item.brand_name)  : undefined,
    price:       toNum(item.search_price   ?? item.price),
    rrp:         toNum(item.rrp),
    currency:    'GBP',
    url:         String(item.aw_deep_link  ?? item.merchant_deep_link ?? item.url ?? ''),
    merchant:    String(item.merchant_name ?? item.merchant ?? 'Unknown'),
    merchantId:  String(item.merchant_id   ?? ''),
    inStock:     item.in_stock !== '0' && item.in_stock !== false && item.in_stock !== 0,
    ean:         item.ean  != null ? String(item.ean)  : undefined,
    sku:         item.sku  != null ? String(item.sku)  : undefined,
    imageUrl:    item.aw_image_url  != null ? String(item.aw_image_url)  : undefined,
    category:    item.category_name != null ? String(item.category_name) : undefined,
    description: item.description   != null ? String(item.description).replace(/<[^>]+>/g, ' ').trim().slice(0, 200) : undefined,
  };
}

// ── Search ─────────────────────────────────────────────────────────────────

export async function awinSearch(query: string, maxResults = 20): Promise<AwinSearchResult> {
  const t0 = Date.now();
  try {
    const { publisherId, apiKey } = creds();
    const params = new URLSearchParams({
      'AWin-Affid':  publisherId,
      'AWin-ApiKey': apiKey,
      keyword:       query,
      market:        'GB',
      currency:      'GBP',
      format:        'json',
      max:           String(Math.min(maxResults, 100)),
    });

    const res = await fetch(`${PRODUCTSERVE}?${params}`, { signal: AbortSignal.timeout(15_000) });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`AWIN ProductServe HTTP ${res.status}: ${body.slice(0, 200)}`);
    }

    // ProductServe may return an array directly or wrapped in an object
    const data = await res.json() as unknown;
    let items: Record<string, unknown>[] = [];
    if (Array.isArray(data)) {
      items = data as Record<string, unknown>[];
    } else if (data != null && typeof data === 'object') {
      const obj = data as Record<string, unknown>;
      const inner = obj.feed ?? obj.product ?? obj.products ?? obj.items ?? obj.results;
      if (Array.isArray(inner)) items = inner as Record<string, unknown>[];
    }

    return {
      query,
      products:   items.slice(0, maxResults).map(mapProduct),
      scrapedAt:  new Date().toISOString(),
      durationMs: Date.now() - t0,
    };
  } catch (e) {
    return { query, products: [], scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0, error: String(e) };
  }
}

// ── Merchant listing ───────────────────────────────────────────────────────

export async function awinGetMerchants(countryCode = 'GB'): Promise<AwinMerchant[]> {
  const { publisherId, apiKey } = creds();
  const res = await fetch(
    `${API_BASE}/publishers/${publisherId}/programmes?relationship=joined&countryCode=${countryCode}`,
    {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal:  AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) throw new Error(`AWIN programmes HTTP ${res.status}`);
  const data = await res.json() as Record<string, unknown>[];
  return data.map(p => ({
    id:   String(p.id ?? p.programmeId ?? ''),
    name: String(p.name ?? p.programName ?? 'Unknown'),
    url:  p.displayUrl != null ? String(p.displayUrl) : undefined,
  }));
}

// ── Product feed download (single merchant, keyword-filtered) ──────────────
// Some merchants don't appear in ProductServe but publish CSV datafeeds.
// This fetches and keyword-filters one merchant's feed on demand.

export async function awinFeedSearch(
  merchantId: string,
  query: string,
  maxResults = 20,
): Promise<AwinSearchResult> {
  const t0 = Date.now();
  const { publisherId, apiKey } = creds();

  try {
    // Get the feed download URL for this programme
    const progRes = await fetch(
      `${API_BASE}/publishers/${publisherId}/programmes/${merchantId}/productfeed`,
      {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal:  AbortSignal.timeout(10_000),
      },
    );
    if (!progRes.ok) throw new Error(`Feed URL lookup HTTP ${progRes.status}`);
    const progData = await progRes.json() as Record<string, unknown>;
    const feedUrl  = String(progData.downloadUrl ?? progData.url ?? '');
    if (!feedUrl) throw new Error('No feed URL returned for this programme');

    // Download and stream-parse the CSV feed
    const feedRes = await fetch(feedUrl, { signal: AbortSignal.timeout(30_000) });
    if (!feedRes.ok) throw new Error(`Feed download HTTP ${feedRes.status}`);
    const text = await feedRes.text();

    const lines  = text.split('\n');
    const header = lines[0].split(',').map(h => h.replace(/^"|"$/g, '').trim().toLowerCase());

    const col = (name: string) => header.indexOf(name);
    const colProdName  = col('product_name') >= 0 ? col('product_name') : col('name');
    const colPrice     = col('search_price')  >= 0 ? col('search_price')  : col('price');
    const colUrl       = col('aw_deep_link')  >= 0 ? col('aw_deep_link')  : col('deeplink');
    const colBrand     = col('brand_name')    >= 0 ? col('brand_name')    : col('brand');
    const colMerchant  = col('merchant_name');
    const colInStock   = col('in_stock');
    const colEan       = col('ean');
    const colImage     = col('aw_image_url');
    const colId        = col('aw_product_id') >= 0 ? col('aw_product_id') : col('product_id');

    const qLow   = query.toLowerCase();
    const results: AwinProduct[] = [];

    for (let i = 1; i < lines.length && results.length < maxResults; i++) {
      const cells = lines[i].split(',').map(c => c.replace(/^"|"$/g, '').trim());
      const name  = cells[colProdName] ?? '';
      if (!name.toLowerCase().includes(qLow)) continue;
      const price = toNum(cells[colPrice]);
      if (price == null || price <= 0) continue;
      results.push({
        id:        cells[colId]      ?? String(i),
        name,
        brand:     cells[colBrand]   ?? undefined,
        price,
        currency:  'GBP',
        url:       cells[colUrl]     ?? '',
        merchant:  cells[colMerchant] ?? 'Unknown',
        merchantId,
        inStock:   cells[colInStock] !== '0' && cells[colInStock] !== 'false',
        ean:       cells[colEan]     ?? undefined,
        imageUrl:  cells[colImage]   ?? undefined,
      });
    }

    return { query, products: results, scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0 };
  } catch (e) {
    return { query, products: [], scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0, error: String(e) };
  }
}
