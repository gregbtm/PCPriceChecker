import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildEbayFilter, ebayBrowseSearch, ebayConfigured } from './ebay-browse.js';

afterEach(() => { vi.unstubAllGlobals(); delete process.env.EBAY_CLIENT_ID; delete process.env.EBAY_CLIENT_SECRET; });

describe('eBay Browse request', () => {
  it('builds ANDed filters: condition and fixed price only', () => {
    expect(buildEbayFilter('any', false)).toBeNull();
    expect(buildEbayFilter('any', true)).toBe('buyingOptions:{FIXED_PRICE}');
    expect(buildEbayFilter('new', true)).toBe('conditionIds:{1000|1500},buyingOptions:{FIXED_PRICE}');
  });
  it('ebayConfigured needs both keys', () => {
    expect(ebayConfigured()).toBe(false);
    process.env.EBAY_CLIENT_ID = 'a';
    expect(ebayConfigured()).toBe(false);
    process.env.EBAY_CLIENT_SECRET = 'b';
    expect(ebayConfigured()).toBe(true);
  });
  it('sends the filter and the UK marketplace header; an HTTP error comes back as error, not a throw', async () => {
    process.env.EBAY_CLIENT_ID = 'id'; process.env.EBAY_CLIENT_SECRET = 'secret';
    const calls: { url: string; headers?: Record<string, string> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: RequestInit) => {
      calls.push({ url: String(url), headers: opts?.headers as Record<string, string> });
      if (String(url).includes('oauth2/token')) return { ok: true, json: async () => ({ access_token: 't', expires_in: 7200 }) };
      return { ok: false, status: 400, text: async () => 'invalid filter' };
    }));
    const r = await ebayBrowseSearch('ddr5 so-dimm 64gb', 'any', 100, { buyItNowOnly: true });
    const search = calls.find(c => c.url.includes('item_summary/search'))!;
    expect(decodeURIComponent(search.url)).toContain('filter=buyingOptions:{FIXED_PRICE}');
    expect(search.url).toContain('limit=100');
    expect(search.headers?.['X-EBAY-C-MARKETPLACE-ID']).toBe('EBAY_GB');
    expect(r.listings).toEqual([]);
    expect(r.error).toContain('HTTP 400');
  });
});
