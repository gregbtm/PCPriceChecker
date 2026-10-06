/**
 * Optional product-page discovery through a self-hosted SearXNG (P2-5). Off until `searxng_url` (config) or SEARXNG_URL is set.
 * SearXNG's JSON output must be enabled on the instance (`search.formats` includes `json` in its settings.yml); otherwise it answers 403.
 * Results are only suggestions: nothing here adds a URL to a component or creates a watch by itself.
 */
import * as db from '../db.js';

export interface DiscoveredPage { title: string; url: string; domain: string }

export function searxngUrl(): string | null {
  const v = (db.getConfig('searxng_url') ?? process.env.SEARXNG_URL ?? '').trim();
  return v ? v.replace(/\/+$/, '') : null;
}

/** Product pages for `query`, kept to the given retailer domains (default: the UK retailers this app knows). */
export async function discoverProductPages(query: string, domains: string[], limit = 10): Promise<DiscoveredPage[] | { error: string }> {
  const base = searxngUrl();
  if (!base) return { error: 'SearXNG is not configured (set searxng_url)' };
  const wanted = domains.map(d => d.toLowerCase().replace(/^www\./, ''));
  const siteScope = wanted.map(d => `site:${d}`).join(' OR ');
  try {
    const res = await fetch(`${base}/search?${new URLSearchParams({ q: `${query} ${siteScope ? `(${siteScope})` : ''}`.trim(), format: 'json', language: 'en-GB' })}`, {
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { error: `SearXNG HTTP ${res.status}${res.status === 403 ? ' (is the json format enabled in its settings?)' : ''}` };
    const body = await res.json() as { results?: Array<{ title?: string; url?: string }> };
    const out: DiscoveredPage[] = [];
    const seen = new Set<string>();
    for (const r of body.results ?? []) {
      if (!r.url) continue;
      let domain: string;
      try { domain = new URL(r.url).hostname.toLowerCase().replace(/^www\./, ''); } catch { continue; }
      if (wanted.length > 0 && !wanted.some(d => domain === d || domain.endsWith('.' + d))) continue;
      if (seen.has(r.url)) continue;
      seen.add(r.url);
      out.push({ title: (r.title ?? '').slice(0, 160), url: r.url, domain });
      if (out.length >= limit) break;
    }
    return out;
  } catch (e) {
    return { error: `SearXNG request failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
