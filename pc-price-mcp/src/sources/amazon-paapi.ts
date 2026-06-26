/**
 * Amazon Product Advertising API 5.0 — UK marketplace.
 * Official Amazon data: live prices, stock, product info, images.
 * Free with an Amazon Associates account (requires making affiliate sales
 * to keep access active — Amazon suspends inactive accounts after 90 days).
 *
 * Sign up:  https://affiliate-program.amazon.co.uk/
 * Docs:     https://webservices.amazon.co.uk/paapi5/documentation/
 *
 * Required env vars:
 *   AMAZON_ACCESS_KEY    — IAM access key from the Associates portal
 *   AMAZON_SECRET_KEY    — IAM secret key
 *   AMAZON_ASSOCIATE_TAG — your Associates tag (e.g. mysite-21)
 */

import { createHmac, createHash } from 'crypto';

const SERVICE    = 'ProductAdvertisingAPI';
const REGION     = 'eu-west-1';
const HOST       = 'webservices.amazon.co.uk';
const MARKETPLACE = 'www.amazon.co.uk';

// PAAPI operation targets
const TARGET_SEARCH   = 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.SearchItems';
const TARGET_GET      = 'com.amazon.paapi5.v1.ProductAdvertisingAPIv1.GetItems';
const ENDPOINT_SEARCH = `https://${HOST}/paapi5/searchitems`;
const ENDPOINT_GET    = `https://${HOST}/paapi5/getitems`;

const RESOURCES = [
  'ItemInfo.Title',
  'ItemInfo.ByLineInfo',
  'ItemInfo.Features',
  'Offers.Listings.Price',
  'Offers.Listings.Availability.Type',
  'Offers.Listings.IsPrimeEligible',
  'Offers.Summaries.LowestPrice',
  'Images.Primary.Medium',
];

export interface PaapiProduct {
  asin:           string;
  title:          string;
  brand?:         string;
  features:       string[];
  url:            string;
  price:          number | null;
  lowestNewPrice: number | null;
  currency:       string;
  isPrime:        boolean;
  inStock:        boolean;
  imageUrl?:      string;
}

export interface PaapiSearchResult {
  query:      string;
  products:   PaapiProduct[];
  scrapedAt:  string;
  durationMs: number;
  totalResults?: number;
  error?:     string;
}

// ── AWS Signature V4 ───────────────────────────────────────────────────────

interface Creds { accessKey: string; secretKey: string; associateTag: string }

function getCreds(): Creds {
  const accessKey    = process.env.AMAZON_ACCESS_KEY?.trim();
  const secretKey    = process.env.AMAZON_SECRET_KEY?.trim();
  const associateTag = process.env.AMAZON_ASSOCIATE_TAG?.trim();
  if (!accessKey || !secretKey || !associateTag) {
    throw new Error(
      'Amazon PAAPI requires AMAZON_ACCESS_KEY, AMAZON_SECRET_KEY, and AMAZON_ASSOCIATE_TAG. ' +
      'Sign up at affiliate-program.amazon.co.uk',
    );
  }
  return { accessKey, secretKey, associateTag };
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

function sha256(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex');
}

function awsDateTime(): string {
  // Format: YYYYMMDDTHHMMSSZ
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
}

function sign(
  body:     string,
  dateTime: string,
  path:     string,
  target:   string,
  creds:    Creds,
): Record<string, string> {
  const dateStamp = dateTime.slice(0, 8);
  const bodyHash  = sha256(body);

  const canonHeaders =
    `content-encoding:amz-1.0\n` +
    `content-type:application/json; charset=UTF-8\n` +
    `host:${HOST}\n` +
    `x-amz-date:${dateTime}\n` +
    `x-amz-target:${target}\n`;

  const signedHeaders = 'content-encoding;content-type;host;x-amz-date;x-amz-target';

  const canonRequest = [
    'POST', path, '',
    canonHeaders, signedHeaders, bodyHash,
  ].join('\n');

  const credScope  = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const strToSign  = ['AWS4-HMAC-SHA256', dateTime, credScope, sha256(canonRequest)].join('\n');

  const kDate    = hmac(`AWS4${creds.secretKey}`, dateStamp);
  const kRegion  = hmac(kDate,    REGION);
  const kService = hmac(kRegion,  SERVICE);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = hmac(kSigning, strToSign).toString('hex');

  return {
    Authorization:    `AWS4-HMAC-SHA256 Credential=${creds.accessKey}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'Content-Encoding': 'amz-1.0',
    'Content-Type':   'application/json; charset=UTF-8',
    Host:             HOST,
    'X-Amz-Date':    dateTime,
    'X-Amz-Target':  target,
  };
}

// ── Product mapper ─────────────────────────────────────────────────────────

function mapItem(item: Record<string, unknown>): PaapiProduct {
  const info    = item.ItemInfo   as Record<string, unknown> | null;
  const offers  = item.Offers     as Record<string, unknown> | null;
  const images  = item.Images     as Record<string, unknown> | null;

  const title   = (info?.Title     as Record<string, unknown> | null)?.DisplayValue;
  const brand   = ((info?.ByLineInfo as Record<string, unknown> | null)?.Brand as Record<string, unknown> | null)?.DisplayValue;
  const featureList = (info?.Features as Record<string, unknown> | null)?.DisplayValues;

  const listings  = (offers?.Listings  as Record<string, unknown>[] | null) ?? [];
  const summaries = (offers?.Summaries as Record<string, unknown>[] | null) ?? [];
  const listing   = listings[0] ?? null;
  const priceInfo = listing?.Price    as Record<string, unknown> | null;
  const avail     = (listing?.Availability as Record<string, unknown> | null)?.Type;

  const lowestSummary = summaries[0];
  const lowestPrice   = (lowestSummary?.LowestPrice as Record<string, unknown> | null);

  const imgUrl = ((images?.Primary as Record<string, unknown> | null)?.Medium as Record<string, unknown> | null)?.URL;

  return {
    asin:           String(item.ASIN ?? ''),
    title:          title != null ? String(title) : 'Unknown',
    brand:          brand != null ? String(brand) : undefined,
    features:       Array.isArray(featureList) ? featureList.slice(0, 5).map(String) : [],
    url:            String(item.DetailPageURL ?? `https://www.amazon.co.uk/dp/${item.ASIN}`),
    price:          priceInfo?.Amount != null ? Number(priceInfo.Amount) : null,
    lowestNewPrice: lowestPrice?.Amount != null ? Number(lowestPrice.Amount) : null,
    currency:       String(priceInfo?.Currency ?? lowestPrice?.Currency ?? 'GBP'),
    isPrime:        Boolean(listing?.IsPrimeEligible),
    inStock:        avail === 'Now',
    imageUrl:       imgUrl != null ? String(imgUrl) : undefined,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

async function paapiPost(
  endpoint: string,
  path:     string,
  target:   string,
  body:     string,
): Promise<Record<string, unknown>> {
  const creds    = getCreds();
  const dateTime = awsDateTime();
  const headers  = sign(body, dateTime, path, target, creds);

  const res = await fetch(endpoint, {
    method:  'POST',
    headers,
    body,
    signal:  AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PAAPI HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  return res.json() as Promise<Record<string, unknown>>;
}

export async function paapiSearch(
  query:      string,
  searchIndex = 'Electronics',
  maxResults  = 10,
): Promise<PaapiSearchResult> {
  const t0 = Date.now();
  try {
    const { associateTag } = getCreds();
    const body = JSON.stringify({
      Keywords:    query,
      Resources:   RESOURCES,
      SearchIndex: searchIndex,
      ItemCount:   Math.min(maxResults, 10),
      PartnerTag:  associateTag,
      PartnerType: 'Associates',
      Marketplace: MARKETPLACE,
    });

    const data   = await paapiPost(ENDPOINT_SEARCH, '/paapi5/searchitems', TARGET_SEARCH, body);
    const result = data.SearchResult as Record<string, unknown> | null;
    const items  = (result?.Items as Record<string, unknown>[] | null) ?? [];

    return {
      query,
      products:     items.map(mapItem),
      scrapedAt:    new Date().toISOString(),
      durationMs:   Date.now() - t0,
      totalResults: result?.TotalResultCount as number | undefined,
    };
  } catch (e) {
    return { query, products: [], scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0, error: String(e) };
  }
}

export async function paapiGetItems(asins: string[]): Promise<PaapiSearchResult> {
  const t0 = Date.now();
  try {
    const { associateTag } = getCreds();
    const body = JSON.stringify({
      ItemIds:    asins.slice(0, 10),
      Resources:  RESOURCES,
      PartnerTag:  associateTag,
      PartnerType: 'Associates',
      Marketplace: MARKETPLACE,
    });

    const data  = await paapiPost(ENDPOINT_GET, '/paapi5/getitems', TARGET_GET, body);
    const items = (data.ItemsResult as Record<string, unknown> | null)?.Items as Record<string, unknown>[] | null ?? [];

    return {
      query:      asins.join(','),
      products:   items.map(mapItem),
      scrapedAt:  new Date().toISOString(),
      durationMs: Date.now() - t0,
    };
  } catch (e) {
    return { query: asins.join(','), products: [], scrapedAt: new Date().toISOString(), durationMs: Date.now() - t0, error: String(e) };
  }
}
