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
