import { readFileSync } from 'fs';
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

describe('unknown retailer ids give a clear error, not "RETAILER_FNS[r] is not a function"', () => {
  it('unknownRetailerIds flags typos such as "cc"', async () => {
    const { unknownRetailerIds } = await import('./uk-retailers.js');
    expect(unknownRetailerIds(['scan', 'ebuyer', 'cc'])).toEqual(['cc']);
    expect(unknownRetailerIds(['scan', 'ccl'])).toEqual([]);
  });
  it('searchAllUkRetailers rejects before making any request', async () => {
    const { searchAllUkRetailers } = await import('./uk-retailers.js');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(searchAllUkRetailers('x', ['scan', 'cc'] as never)).rejects.toThrow(/Unknown retailer id\(s\): cc\. Valid ids: scan/);
    expect(f).not.toHaveBeenCalled();
  });
});

describe('AWD-IT (Magento) against the REAL page block captured 2026-10-06', () => {
  const fixture = readFileSync(new URL('../test/fixtures/awd-it-kingston-fury-64gb.html', import.meta.url), 'utf8');

  it('requests the real search path (the old /search?q= was a 404 on the owner\'s NAS)', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => fixture });
    vi.stubGlobal('fetch', f);
    const { awditSearch } = await import('./uk-retailers.js');
    await awditSearch('ddr5 so-dimm 64gb');
    expect(String(f.mock.calls[0][0])).toBe('https://www.awd-it.co.uk/catalogsearch/result/?q=ddr5%20so-dimm%2064gb');
  });

  it('extracts name, the VAT-inclusive price (not the ex-VAT 766.66) and the out-of-stock state', async () => {
    const { extractMagentoProducts } = await import('./uk-retailers.js');
    const r = extractMagentoProducts(fixture, 'AWD-IT', 'https://www.awd-it.co.uk/catalogsearch/result/?q=x');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      name: 'Kingston Fury 64GB (2x32GB) DDR5 5600MT/s CL40 SODIMM Memory - Black',
      price: 919.99, currency: 'GBP', stockState: 'out_of_stock', inStock: false,
      url: 'https://www.awd-it.co.uk/kingston-fury-64gb-2x32gb-ddr5-5600mt-s-cl40-sodimm-memory-black.html',
    });
  });

  it('the real title fits the n5-air-ram profile (accepted, price per GB 14.37)', async () => {
    const { extractMagentoProducts } = await import('./uk-retailers.js');
    const { classifyMemory, matchesProfile, N5_AIR_RAM } = await import('../services/memory-classifier.js');
    const [p] = extractMagentoProducts(fixture, 'AWD-IT', 'https://www.awd-it.co.uk/');
    const listing = classifyMemory(p.name);
    expect(listing).toMatchObject({ ddr: 5, formFactor: 'SODIMM', modules: 2, totalGb: 64, speedMts: 5600, cl: 40 });
    expect(matchesProfile(listing, N5_AIR_RAM).match).toBe(true);
    expect(Math.round((p.price as number / 64) * 100) / 100).toBe(14.37);
  });

  it('in-stock markup is SYNTHETIC (only the out-of-stock variant has been seen): an add-to-cart button means in stock', async () => {
    const { extractMagentoProducts } = await import('./uk-retailers.js');
    const synthetic = fixture.replace(/<div[^>]*class="stock-status[^"]*"[^>]*>[\s\S]*?<\/div>/i, '<button class="action tocart primary" type="button">Add to Basket</button>');
    expect(synthetic).not.toBe(fixture);
    expect(extractMagentoProducts(synthetic, 'AWD-IT', 'https://x/')[0]).toMatchObject({ stockState: 'in_stock', price: 919.99 });
  });

  it('skips a product that shows no VAT-inclusive price rather than guessing from the ex-VAT one', async () => {
    const { extractMagentoProducts } = await import('./uk-retailers.js');
    const noIncl = fixture.replace(/price-including-tax/g, 'price-something-else');
    expect(extractMagentoProducts(noIncl, 'AWD-IT', 'https://x/')).toEqual([]);
  });
});

describe('default retailer list', () => {
  it('no longer includes Aria, which closed its online shop in August 2022', async () => {
    const { DEFAULT_SEARCH_RETAILERS } = await import('../services/refresh.js');
    expect(DEFAULT_SEARCH_RETAILERS).not.toContain('aria');
    expect(DEFAULT_SEARCH_RETAILERS).toContain('awdit');
  });
});

describe('search addresses confirmed from the owner\'s browser, 2026-10-06 (the old ones were HTTP 404 from the NAS)', () => {
  it.each([
    ['ebuyerSearch', 'https://www.ebuyer.com/searchresults?descriptionfilter=ddr5%20so-dimm%2064gb'],
    ['cclSearch', 'https://www.cclonline.com/search?query=ddr5%20so-dimm%2064gb'],
    ['novatechSearch', 'https://www.novatech.co.uk/search.html?search=ddr5%20so-dimm%2064gb'],
  ] as const)('%s requests %s', async (fn, expected) => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '<html></html>' });
    vi.stubGlobal('fetch', f);
    const mod = await import('./uk-retailers.js');
    await mod[fn]('ddr5 so-dimm 64gb');
    expect(String(f.mock.calls[0][0])).toBe(expected);
  });
});

describe('result cap: the listing being searched for must not be cut off (AWD-IT, owner\'s NAS 2026-10-06)', () => {
  const real = readFileSync(new URL('../test/fixtures/awd-it-kingston-fury-64gb.html', import.meta.url), 'utf8');
  /** SYNTHETIC page: the real Kingston block placed 10th among 11 other blocks derived from it. */
  function pageWithKitAt(position: number, total: number): string {
    const block = real.match(/<li class="item product product-item">[\s\S]*?<\/li>/i)![0];
    const items = Array.from({ length: total }, (_, i) => i === position
      ? block
      : block.replace(/Kingston Fury 64GB \(2x32GB\) DDR5 5600MT\/s CL40 SODIMM Memory - Black/g, `Gaming Monitor ${i}`)
             .replace(/919\.99/g, `${100 + i}.99`).replace(/kingston-fury-64gb-2x32gb-ddr5-5600mt-s-cl40-sodimm-memory-black/g, `monitor-${i}`));
    return `<ol class="products list items product-items">${items.join('\n')}</ol>`;
  }
  const stub = (html: string) => vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => html }));

  it('awditSearch keeps all 12 products, including the kit at position 10', async () => {
    stub(pageWithKitAt(9, 12));
    const { awditSearch } = await import('./uk-retailers.js');
    const r = await awditSearch('ddr5 so-dimm 64gb');
    expect(r.results).toHaveLength(12);
    expect(r.results[9].name).toContain('Kingston Fury 64GB');
  });

  it('display paths still trim to 8 per retailer', async () => {
    stub(pageWithKitAt(9, 12));
    const { searchAllUkRetailers } = await import('./uk-retailers.js');
    const [r] = await searchAllUkRetailers('x', ['awdit']);
    expect(r.results).toHaveLength(8);
    const [all] = await searchAllUkRetailers('x', ['awdit'], 100);
    expect(all.results).toHaveLength(12);
  });
});

describe('diagnoseRetailerPage (read-only page diagnostic)', () => {
  it('describes a page: title, signals, price contexts and a text sample', async () => {
    const html = '<html><head><title>Search results - Ebuyer</title></head><body><script>window.__PRELOADED_STATE__={}</script>'
      + '<div class="product"><span class="p">£1,299.99</span></div><div>£45.00</div></body></html>';
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => html });
    vi.stubGlobal('fetch', f);
    const { diagnoseRetailerPage } = await import('./uk-retailers.js');
    const d = await diagnoseRetailerPage('ebuyer', 'ddr5 so-dimm 64gb');
    expect(String(f.mock.calls[0][0])).toBe('https://www.ebuyer.com/searchresults?descriptionfilter=ddr5%20so-dimm%2064gb');
    expect(d).toMatchObject({ status: 200, title: 'Search results - Ebuyer',
      signals: { jsonLdBlocks: 0, jsonLdProducts: 0, nextData: false, stateVariables: ['__PRELOADED_STATE__'], poundPrices: 2 } });
    expect(d.priceContexts[0]).toContain('£1,299.99');
    expect(d.textSample).toContain('£1,299.99');
  });

  it('recognises a block page and refuses retailers without a built-in address', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => '<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>' }));
    const { diagnoseRetailerPage } = await import('./uk-retailers.js');
    const blocked = await diagnoseRetailerPage('scan', 'x');
    expect(blocked).toMatchObject({ status: 403, title: 'Just a moment...' });
    expect(blocked.textSample).toContain('Checking your browser');
    await expect(diagnoseRetailerPage('currys', 'x')).rejects.toThrow(/No plain-HTML search address/);
  });
});
