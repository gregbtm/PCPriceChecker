/**
 * Self-hosted Firecrawl as an optional fetch tier (P2-2). LAN-only; off until `firecrawl_url` (config) or
 * FIRECRAWL_API_URL is set. We ask only for the page's raw HTML (`POST {url}/v2/scrape`, `formats: ["rawHtml"]`) and run our own
 * extractors on it: Firecrawl's LLM extraction is deliberately not used. An API key is optional (self-hosted has none by default).
 *
 * Limits recorded in the research doc: the open-source build has no Fire-engine anti-bot, so a site that blocks us still
 * blocks it. It is for pages that need JavaScript, not for getting around a refusal.
 */
import * as db from '../db.js';

const TIMEOUT_MS = 60_000;   // longer than a normal request: Firecrawl renders the page first

export function firecrawlUrl(): string | null {
  const v = (db.getConfig('firecrawl_url') ?? process.env.FIRECRAWL_API_URL ?? '').trim();
  return v ? v.replace(/\/+$/, '') : null;
}
export function firecrawlConfigured(): boolean { return firecrawlUrl() != null; }

export async function firecrawlFetchHtml(url: string): Promise<{ html: string } | { error: string }> {
  const base = firecrawlUrl();
  if (!base) return { error: 'Firecrawl is not configured' };
  const key = (db.getConfig('firecrawl_api_key') ?? process.env.FIRECRAWL_API_KEY ?? '').trim();
  try {
    const res = await fetch(`${base}/v2/scrape`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ url, formats: ['rawHtml'] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await res.text();
    if (!res.ok) return { error: `Firecrawl HTTP ${res.status}: ${text.slice(0, 160)}` };
    let body: { success?: boolean; error?: string; data?: { rawHtml?: string; html?: string } };
    try { body = JSON.parse(text); } catch { return { error: 'Firecrawl returned non-JSON' }; }
    const html = body.data?.rawHtml ?? body.data?.html;
    if (body.success === false || !html) return { error: body.error ?? 'Firecrawl returned no HTML' };
    return { html };
  } catch (e) {
    return { error: `Firecrawl request failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
