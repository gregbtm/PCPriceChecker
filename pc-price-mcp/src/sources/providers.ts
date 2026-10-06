/**
 * Provider chain for scraping one product URL (P2-1, P2-3).
 *
 * Providers: `direct` is the existing chain in url-scraper.ts, unchanged (fetch, JSON-LD, meta, rules, DOM, Playwright,
 * Camofox, AI); `firecrawl` is the optional self-hosted renderer. A provider returns an offer or a failure with a reason,
 * never throws. Per-domain memory: the provider that last worked for a domain is tried first, and one that has failed
 * three times in a row for it is demoted to last. The memory is a config row, `provider_strategy:<domain>`.
 */
import * as db from '../db.js';
import { scrapeProductUrl, extractFromHtml, type ScrapedProduct } from './url-scraper.js';
import { firecrawlConfigured, firecrawlFetchHtml } from './firecrawl.js';

export type ProviderResult = { ok: true; offer: ScrapedProduct } | { ok: false; reason: string };

export interface Provider {
  id: string;
  configured(): boolean;
  fetchOffer(url: string): Promise<ProviderResult>;
}

const domainOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

export const directProvider: Provider = {
  id: 'direct',
  configured: () => true,
  async fetchOffer(url) {
    try {
      const o = await scrapeProductUrl(url);
      return o.price != null ? { ok: true, offer: o } : { ok: false, reason: 'no price extracted from page' };
    } catch (e) { return { ok: false, reason: e instanceof Error ? e.message : String(e) }; }
  },
};

export const firecrawlProvider: Provider = {
  id: 'firecrawl',
  configured: firecrawlConfigured,
  async fetchOffer(url) {
    const r = await firecrawlFetchHtml(url);
    if ('error' in r) return { ok: false, reason: r.error };
    const domain = domainOf(url);
    const got = extractFromHtml(r.html, domain);
    if (!got?.price) return { ok: false, reason: 'Firecrawl returned HTML but no price could be extracted' };
    return { ok: true, offer: { name: domain, currency: 'GBP', inStock: false, stockState: 'unknown', ...got, url, method: 'firecrawl' } as ScrapedProduct };
  },
};

interface Memory { provider: string; fails: Record<string, number> }

function readMemory(domain: string): Memory {
  try {
    const m = JSON.parse(db.getConfig(`provider_strategy:${domain}`) ?? 'null') as Memory | null;
    if (m && typeof m.provider === 'string') return { provider: m.provider, fails: m.fails ?? {} };
  } catch { /* fall through */ }
  return { provider: '', fails: {} };
}

/** Remembered-good first, repeatedly failing last, otherwise the declared order. */
export function orderProviders(providers: Provider[], domain: string): Provider[] {
  const mem = readMemory(domain);
  const rank = (p: Provider) => (mem.fails[p.id] ?? 0) >= 3 ? 2 : p.id === mem.provider ? 0 : 1;
  return providers.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map(x => x.p);
}

function remember(domain: string, winner: string | null, tried: string[]): void {
  const mem = readMemory(domain);
  for (const id of tried) mem.fails[id] = id === winner ? 0 : (mem.fails[id] ?? 0) + 1;
  if (winner) mem.provider = winner;
  db.setConfig(`provider_strategy:${domain}`, JSON.stringify(mem));
}

/** Tries the configured providers in memory order; returns the first offer, or the last failure's ScrapedProduct shape. */
export async function scrapeViaChain(url: string, providers: Provider[] = [directProvider, firecrawlProvider]): Promise<ScrapedProduct> {
  const domain = domainOf(url);
  const tried: string[] = [];
  const reasons: string[] = [];
  for (const p of orderProviders(providers.filter(x => x.configured()), domain)) {
    tried.push(p.id);
    const r = await p.fetchOffer(url);
    if (r.ok) { remember(domain, p.id, tried); return r.offer; }
    reasons.push(`${p.id}: ${r.reason}`);
  }
  remember(domain, null, tried);
  if (reasons.length) console.warn(`[providers] ${domain}: ${reasons.join('; ')}`);
  return { name: domain, price: null, currency: 'GBP', inStock: false, stockState: 'unknown', url, method: 'failed' };
}
