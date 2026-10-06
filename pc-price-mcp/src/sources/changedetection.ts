/**
 * changedetection.io REST API v1 client (P3-1) and the spike diagnostic (P3-2).
 *
 * Self-hosted and LAN-only; the tier is off until CHANGEDETECTION_URL and CHANGEDETECTION_API_KEY
 * (config keys changedetection_url / changedetection_api_key) are set. Auth is the `x-api-key` header.
 * Endpoints (api docs v0.1.9, checked 2026-10-06): GET/POST /api/v1/watch, GET /api/v1/watch/{uuid},
 * GET /api/v1/watch/{uuid}?recheck=1, GET /api/v1/watch/{uuid}/history,
 * GET /api/v1/watch/{uuid}/history/{timestamp|latest}.
 *
 * Unverified until the spike has run against a live watch: where the current price and stock state
 * can be read. The documented watch JSON has no current-price field, so nothing here assumes one.
 */
const TIMEOUT_MS = 15_000;

export function changedetectionConfigured(): boolean {
  return !!(process.env.CHANGEDETECTION_URL?.trim() && process.env.CHANGEDETECTION_API_KEY?.trim());
}

function base(): string {
  const url = process.env.CHANGEDETECTION_URL?.trim();
  if (!url) throw new Error('CHANGEDETECTION_URL is not set');
  return url.replace(/\/+$/, '');
}

async function request(path: string, init: { method?: string; body?: unknown; text?: boolean } = {}): Promise<unknown> {
  const key = process.env.CHANGEDETECTION_API_KEY?.trim();
  if (!key) throw new Error('CHANGEDETECTION_API_KEY is not set');
  const res = await fetch(`${base()}/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: { 'x-api-key': key, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`changedetection.io ${init.method ?? 'GET'} ${path} -> HTTP ${res.status}: ${text.slice(0, 200)}`);
  if (init.text) return text;
  try { return JSON.parse(text); } catch { return text; }
}

export interface CdWatchSummary { uuid: string; url: string; title?: string; last_checked?: number; last_error?: string | false; [k: string]: unknown }

export async function listWatches(): Promise<CdWatchSummary[]> {
  const raw = (await request('/watch')) as Record<string, Record<string, unknown>>;
  return Object.entries(raw ?? {}).map(([uuid, w]) => ({ uuid, url: String(w.url ?? ''), ...w }) as CdWatchSummary);
}

export async function getWatch(uuid: string): Promise<Record<string, unknown>> {
  return (await request(`/watch/${encodeURIComponent(uuid)}`)) as Record<string, unknown>;
}

export interface NewRestockWatch { url: string; title?: string; maxPrice?: number; browser?: boolean; tag?: string }

/** Creates a restock/price watch. `browser: true` uses the JS-rendering fetcher (needs a browser-capable deployment). */
export async function createRestockWatch(w: NewRestockWatch): Promise<string> {
  const body: Record<string, unknown> = {
    url: w.url,
    title: w.title,
    processor: 'restock_diff',
    processor_config_restock_diff: {
      in_stock_processing: 'all_changes',
      follow_price_changes: true,
      ...(w.maxPrice != null ? { price_change_max: w.maxPrice } : {}),
    },
    ...(w.browser ? { fetch_backend: 'html_webdriver' } : {}),
    ...(w.tag ? { tag: w.tag } : {}),
  };
  const out = (await request('/watch', { method: 'POST', body })) as { uuid?: string };
  if (!out?.uuid) throw new Error('changedetection.io did not return a watch uuid');
  return out.uuid;
}

/** Plain text-change watch (the default processor); `browser` renders JavaScript before taking the snapshot. */
export async function createTextWatch(w: { url: string; title: string; browser?: boolean }): Promise<string> {
  const out = (await request('/watch', { method: 'POST', body: {
    url: w.url, title: w.title, ...(w.browser ? { fetch_backend: 'html_webdriver' } : {}),
  } })) as { uuid?: string };
  if (!out?.uuid) throw new Error('changedetection.io did not return a watch uuid');
  return out.uuid;
}

export async function recheckWatch(uuid: string): Promise<void> {
  await request(`/watch/${encodeURIComponent(uuid)}?recheck=1`);
}

/** timestamp -> snapshot path, as returned by the history endpoint. */
export async function getHistory(uuid: string): Promise<Record<string, string>> {
  return ((await request(`/watch/${encodeURIComponent(uuid)}/history`)) ?? {}) as Record<string, string>;
}

export async function getLatestSnapshot(uuid: string): Promise<string> {
  return (await request(`/watch/${encodeURIComponent(uuid)}/history/latest`, { text: true })) as string;
}

/** Watch-JSON keys that could plausibly carry a price or stock state. Used only by the spike. */
export function priceLikeKeys(watch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(watch)) {
    if (/restock|price|stock|ldjson/i.test(k)) out[k] = v;
  }
  return out;
}

/**
 * P3-2 spike: for each watch (or one uuid), report everything we could read a price/stock from,
 * so the integration mode is chosen from observation. Never includes the API key.
 */
export async function spike(uuid?: string, snapshotChars = 600): Promise<Record<string, unknown>> {
  const watches = uuid ? [{ uuid, url: '' } as CdWatchSummary] : (await listWatches()).slice(0, 10);
  const out: Record<string, unknown>[] = [];
  for (const w of watches) {
    const entry: Record<string, unknown> = { uuid: w.uuid };
    try {
      const full = await getWatch(w.uuid);
      entry.url = full.url; entry.processor = full.processor; entry.fetch_backend = full.fetch_backend;
      entry.last_checked = full.last_checked; entry.last_error = full.last_error;
      entry.price_like_fields = priceLikeKeys(full);
      const hist = await getHistory(w.uuid);
      entry.history_count = Object.keys(hist).length;
      if (entry.history_count) entry.latest_snapshot = (await getLatestSnapshot(w.uuid)).slice(0, snapshotChars);
    } catch (err) {
      entry.error = (err as Error).message;
    }
    out.push(entry);
  }
  return { watches: out };
}

export interface WatchReading { price: number; inStock: boolean; checkedAt: number | null }

/**
 * Reads a restock_diff snapshot. Observed 2026-10-06 on a live 0.55.8 instance: the snapshot text is
 * exactly `In Stock: False - Price: 919.99` (no currency symbol). Anything else returns null.
 */
export function parseRestockSnapshot(text: string): { price: number; inStock: boolean } | null {
  const m = /In Stock:\s*(True|False)\s*-\s*Price:\s*([0-9][0-9,]*(?:\.[0-9]+)?)/i.exec(text);
  if (!m) return null;
  const price = Number(m[2].replace(/,/g, ''));
  return Number.isFinite(price) && price > 0 ? { price, inStock: m[1].toLowerCase() === 'true' } : null;
}

export const norm = (u: string) => u.replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();

/** Latest reading from the watch on `url`, or null when there is no such watch or nothing usable yet. */
export async function readWatchForUrl(url: string): Promise<WatchReading | null> {
  const w = (await listWatches()).find(x => norm(x.url) === norm(url));
  if (!w) return null;
  const parsed = parseRestockSnapshot(await getLatestSnapshot(w.uuid).catch(() => ''));
  return parsed ? { ...parsed, checkedAt: typeof w.last_checked === 'number' ? w.last_checked : null } : null;
}

/** Title prefix of watches this app creates; the dashboard only deletes watches that carry it. */
export const PCPC_TITLE_PREFIX = 'PCPC';

export async function deleteWatch(uuid: string): Promise<void> {
  const w = await getWatch(uuid);
  const title = String(w.title ?? w.page_title ?? '');
  if (!title.startsWith(PCPC_TITLE_PREFIX)) throw new Error('refusing to delete a watch this app did not create');
  await request(`/watch/${encodeURIComponent(uuid)}`, { method: 'DELETE' });
}
