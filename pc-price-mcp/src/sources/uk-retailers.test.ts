import { describe, it, expect, vi, afterEach } from 'vitest';
import { johnLewisPrice, johnLewisSearch, scanSearch } from './uk-retailers.js';
import { SCAN, ldJson } from '../test/fixtures.js';

function stubFetch(html: string) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => html }));
}
afterEach(() => vi.unstubAllGlobals());

describe('P0-3 John Lewis price selection (A-03)', () => {
  it('uses `now`, never `was`', () => {
    expect(johnLewisPrice({ price: { was: '999.00', now: '799.00' } })).toBe(799);
    expect(johnLewisPrice({ price: { was: 999, now: 799 } })).toBe(799);
  });
  it('falls back to a priceLabel and ignores its was-price', () => {
    expect(johnLewisPrice({ price: { was: '999.00' }, priceLabel: 'Was £999.00 Now £799.00' })).toBe(799);
    expect(johnLewisPrice({ priceLabel: '£799.00' })).toBe(799);
  });
  it('returns null (not the was price) when only `was` is known', () => {
    expect(johnLewisPrice({ price: { was: '999.00' } })).toBeNull();
  });
  it('rejects non-GBP labels', () => {
    expect(johnLewisPrice({ priceLabel: '$799.00' })).toBeNull();
  });

  it('johnLewisSearch end to end on a __NEXT_DATA__ page', async () => {
    const data = { props: { pageProps: { searchResults: { products: [
      { title: SCAN.kit5200InStock, price: { was: '999.00', now: '893.99' }, availableInStock: true, seoURL: '/p/1', id: 1 },
    ] } } } };
    stubFetch(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(data)}</script>`);
    const r = await johnLewisSearch('ddr5');
    expect(r.results[0]).toMatchObject({ price: 893.99, stockState: 'in_stock' });
  });
});

describe('P0-4 no "Search results" fallback (A-04)', () => {
  it('does not invent a result from the lowest £ amount on the page', async () => {
    stubFetch('<html><body><p>Free delivery over £50. Basket from £12.99</p><div>Banner £15.00</div></body></html>');
    const r = await scanSearch('ddr5 so-dimm 64gb');
    expect(r.results).toEqual([]);
    expect(r.error).toMatch(/No products parsed/);
  });
});

describe('Scan extractor classifies stock text (A-02)', () => {
  it('maps "Due 8th Oct" to backorder and "In stock" to in_stock', async () => {
    const li = (title: string, price: string, text: string) =>
      `<li class="product"><a href="/products/x"><span>${title}</span></a><div data-product-title="${title}" data-buy-price="${price}"></div><p>${text}</p></li>`;
    stubFetch(`<ul>${li(SCAN.kit5600Backorder, '933.49', 'Due 8th Oct')}${li(SCAN.kit5200InStock, '893.99', 'In stock Get it Wednesday, 07 Oct')}</ul>`);
    const r = await scanSearch('ddr5 so-dimm 64gb');
    const by = Object.fromEntries(r.results.map(x => [x.price, x.stockState]));
    expect(by).toEqual({ 933.49: 'backorder', 893.99: 'in_stock' });
  });
});

describe('JSON-LD in retailer scrapers uses the shared module', () => {
  it('skips USD products and keeps GBP ones', async () => {
    stubFetch(ldJson({ '@graph': [
      { '@type': 'Product', name: 'US kit', offers: { '@type': 'Offer', price: 899, priceCurrency: 'USD', availability: 'InStock' } },
      { '@type': 'Product', name: SCAN.kit5200InStock, offers: { '@type': 'Offer', price: '893.99', priceCurrency: 'GBP', availability: 'https://schema.org/InStock' } },
    ] }));
    const r = await scanSearch('x');
    expect(r.results.map(x => x.name)).toEqual([SCAN.kit5200InStock]);
  });
});
