/**
 * eBay Browse API v1 — UK marketplace.
 * Official eBay API for live listings: new, used, and refurbished PC parts.
 * Free with a developer account — 5,000 calls/day on the standard tier.
 *
 * Sign up:  https://developer.ebay.com  (instant approval)
 * Docs:     https://developer.ebay.com/api-docs/buy/browse/overview.html
 *
 * Required env vars:
 *   EBAY_CLIENT_ID     — OAuth client ID ("AppID" in the developer portal)
 *   EBAY_CLIENT_SECRET — OAuth client secret ("CertID" in the developer portal)
 *
 * Uses client-credentials OAuth2 — no user login required.
 */

import { Buffer } from 'buffer';

const TOKEN_URL    = 'https://api.ebay.com/identity/v1/oauth2/token';
const BROWSE_URL   = 'https://api.ebay.com/buy/browse/v1';
const MARKETPLACE  = 'EBAY_GB';
const SCOPE        = 'https://api.ebay.com/oauth/api_scope';

// ── OAuth token cache ──────────────────────────────────────────────────────

interface CachedToken { value: string; expiresAt: number }
let tokenCache: CachedToken | null = null;

function getCreds(): { clientId: string; clientSecret: string } {
  const clientId     = process.env.EBAY_CLIENT_ID?.trim();
  const clientSecret = process.env.EBAY_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    throw new Error(
      'eBay requires EBAY_CLIENT_ID and EBAY_CLIENT_SECRET. ' +
      'Sign up (free) at developer.ebay.com — AppID = clientId, CertID = clientSecret.',
    );
  }
  return { clientId, clientSecret };
}

async function getToken(): Promise<string> {
  if (tokenCache && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.value;
  }

  const { clientId, clientSecret } = getCreds();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

  const res = await fetch(TOKEN_URL, {
    method:  'POST',
    headers: {
      Authorization:  `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body:   `grant_type=client_credentials&scope=${encodeURIComponent(SCOPE)}`,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`eBay OAuth failed HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json() as { access_token: string; expires_in: number };
  tokenCache = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1_000 };
  return tokenCache.value;
}

function browseHeaders(token: string): Record<string, string> {
  return {
    Authorization:              `Bearer ${token}`,
    'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE,
    'X-EBAY-C-ENDUSERCTX':    'contextualLocation=country=GB',
    'Content-Language':        'en-GB',
  };
}

// ── Types ──────────────────────────────────────────────────────────────────

export type EbayCondition = 'any' | 'new' | 'used' | 'refurbished';

// conditionIds: 1000=New, 1500=New other, 2000=Mfr refurb, 2500=Seller refurb,
//               2750=Like New, 3000=Used, 7000=For parts
const CONDITION_FILTER: Record<EbayCondition, string | null> = {
  any:         null,
  new:         'conditionIds:{1000|1500}',
  used:        'conditionIds:{3000|7000}',
  refurbished: 'conditionIds:{2000|2500|2750}',
};

export interface EbayListing {
  itemId:       string;
  title:        string;
  price:        number | null;
  currency:     string;
  condition:    string;
  conditionId:  string;
  url:          string;
  imageUrl?:    string;
  seller:       string;
  feedbackPct?: number;
  location?:    string;
  freeShipping: boolean;
  buyItNow:     boolean;
}

export interface EbayBrowseResult {
  query:      string;
  condition:  EbayCondition;
  listings:   EbayListing[];
  total?:     number;
  scrapedAt:  string;
  durationMs: number;
  error?:     string;
}

// ── Mapper ─────────────────────────────────────────────────────────────────

function mapItem(raw: Record<string, unknown>): EbayListing {
  const priceInfo = raw.price      as Record<string, unknown> | null;
  const sellerInfo = raw.seller    as Record<string, unknown> | null;
  const image      = raw.image     as Record<string, unknown> | null;
  const shipping   = (raw.shippingOptions as Record<string, unknown>[] | null) ?? [];
  const location   = raw.itemLocation as Record<string, unknown> | null;

  const freeShipping = shipping.some(s => {
    const type  = s.shippingCostType as string | null;
    const cost  = (s.shippingCost as Record<string, unknown> | null)?.value;
    return type === 'FREE' || parseFloat(String(cost ?? '1')) === 0;
  });

  const buyingOptions = (raw.buyingOptions as string[] | null) ?? [];

  return {
    itemId:       String(raw.itemId  ?? ''),
    title:        String(raw.title   ?? 'Unknown'),
    price:        priceInfo?.value   != null ? parseFloat(String(priceInfo.value)) : null,
    currency:     String(priceInfo?.currency ?? 'GBP'),
    condition:    String(raw.condition  ?? 'Unknown'),
    conditionId:  String(raw.conditionId ?? ''),
    url:          String(raw.itemWebUrl ?? `https://www.ebay.co.uk/itm/${raw.itemId}`),
    imageUrl:     image?.imageUrl   != null ? String(image.imageUrl) : undefined,
    seller:       String(sellerInfo?.username ?? 'unknown'),
    feedbackPct:  sellerInfo?.feedbackPercentage != null
      ? parseFloat(String(sellerInfo.feedbackPercentage)) : undefined,
    location:     location?.country != null ? String(location.country) : undefined,
    freeShipping,
    buyItNow:     buyingOptions.includes('FIXED_PRICE'),
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function ebayBrowseSearch(
  query:      string,
  condition:  EbayCondition = 'any',
  maxResults  = 20,
): Promise<EbayBrowseResult> {
  const t0 = Date.now();
  try {
    const token = await getToken();

    const params = new URLSearchParams({
      q:     query,
      limit: String(Math.min(maxResults, 200)),
    });

    const condFilter = CONDITION_FILTER[condition];
    if (condFilter) params.set('filter', condFilter);

    const res = await fetch(`${BROWSE_URL}/item_summary/search?${params}`, {
      headers: browseHeaders(token),
      signal:  AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`eBay Browse API HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    const data  = await res.json() as Record<string, unknown>;
    const items = (data.itemSummaries as Record<string, unknown>[] | null) ?? [];

    return {
      query,
      condition,
      listings:   items.map(mapItem),
      total:      data.total as number | undefined,
      scrapedAt:  new Date().toISOString(),
      durationMs: Date.now() - t0,
    };
  } catch (e) {
    return {
      query, condition, listings: [],
      scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0, error: String(e),
    };
  }
}

export async function ebayBrowseGetItem(itemId: string): Promise<Record<string, unknown> | null> {
  try {
    const token = await getToken();
    const res   = await fetch(`${BROWSE_URL}/item/${encodeURIComponent(itemId)}`, {
      headers: browseHeaders(token),
      signal:  AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    return res.json() as Promise<Record<string, unknown>>;
  } catch {
    return null;
  }
}
