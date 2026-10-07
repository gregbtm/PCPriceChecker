import { describe, it, expect } from 'vitest';
import { extractStructuredProducts, bestOffer } from './structured-data.js';
import { SCAN, ldJson } from '../test/fixtures.js';

const offer = (price: unknown, availability?: string, extra: object = {}) =>
  ({ '@type': 'Offer', price, priceCurrency: 'GBP', availability, ...extra });

describe('extractStructuredProducts', () => {
  it('reads a plain Product with a single offer', () => {
    const [p] = extractStructuredProducts(ldJson({ '@type': 'Product', name: SCAN.kit5200InStock, sku: 'CM-1',
      offers: offer('893.99', 'https://schema.org/InStock') }));
    expect(p.name).toBe(SCAN.kit5200InStock);
    expect(bestOffer(p)).toMatchObject({ price: 893.99, currency: 'GBP', stockState: 'in_stock' });
  });

  it('walks @graph and @type arrays (A-05)', () => {
    const [p] = extractStructuredProducts(ldJson({ '@context': 'https://schema.org', '@graph': [
      { '@type': 'WebSite', name: 'x' },
      { '@type': ['Product', 'IndividualProduct'], name: 'Kit', offers: offer(933.49, 'https://schema.org/BackOrder') },
    ] }));
    expect(bestOffer(p)).toMatchObject({ price: 933.49, stockState: 'backorder' });
  });

  it('handles AggregateOffer.lowPrice and nested offers', () => {
    const [low] = extractStructuredProducts(ldJson({ '@type': 'Product', name: 'a',
      offers: { '@type': 'AggregateOffer', lowPrice: '1,299.00', highPrice: 1500, priceCurrency: 'GBP' } }));
    expect(bestOffer(low)?.price).toBe(1299);
    const [nested] = extractStructuredProducts(ldJson({ '@type': 'Product', name: 'b',
      offers: { '@type': 'AggregateOffer', lowPrice: 100, offers: [offer(120, 'InStock'), offer(150, 'InStock')] } }));
    expect(nested.offers.map(o => o.price)).toEqual([120, 150]);   // real offers win over lowPrice
  });

  it('prefers the cheapest IN-STOCK offer over a cheaper out-of-stock one', () => {
    const [p] = extractStructuredProducts(ldJson({ '@type': 'Product', name: 'c', offers: [
      offer(500, 'OutOfStock'), offer(900, 'InStock'), offer(950, 'InStock'),
    ] }));
    expect(bestOffer(p)).toMatchObject({ price: 900, stockState: 'in_stock' });
  });

  it('falls back to the cheapest overall when nothing is in stock', () => {
    const [p] = extractStructuredProducts(ldJson({ '@type': 'Product', name: 'd', offers: [
      offer(500, 'OutOfStock'), offer(450, 'BackOrder'),
    ] }));
    expect(bestOffer(p)).toMatchObject({ price: 450, stockState: 'backorder' });
  });

  it('reads priceSpecification and ignores list/strikethrough prices', () => {
    const [p] = extractStructuredProducts(ldJson({ '@type': 'Product', name: 'e', offers: {
      '@type': 'Offer', availability: 'InStock', priceSpecification: [
        { '@type': 'UnitPriceSpecification', priceType: 'https://schema.org/ListPrice', price: 999, priceCurrency: 'GBP' },
        { '@type': 'UnitPriceSpecification', price: 799, priceCurrency: 'GBP' },
      ] } }));
    expect(bestOffer(p)).toMatchObject({ price: 799, currency: 'GBP' });
  });

  it('reads ProductGroup variants', () => {
    const found = extractStructuredProducts(ldJson({ '@type': 'ProductGroup', name: 'g', hasVariant: [
      { '@type': 'Product', name: '32GB', offers: offer(450, 'InStock') },
      { '@type': 'Product', name: '64GB', offers: offer(893.99, 'InStock') },
    ] }));
    expect(found.map(f => f.name)).toEqual(['32GB', '64GB']);
  });

  it('accepts single-quoted and reordered script attributes and skips malformed blocks', () => {
    const html = `<script id="a" type='application/ld+json'>{not json</script>
      <script data-x="1" type="application/ld+json" defer>${JSON.stringify({ '@type': 'Product', name: 'ok', offers: offer(10, 'InStock') })}</script>`;
    expect(extractStructuredProducts(html)).toHaveLength(1);
  });

  it('ignores products with no usable price', () => {
    expect(extractStructuredProducts(ldJson({ '@type': 'Product', name: 'x', offers: offer(0, 'InStock') }))).toEqual([]);
    expect(extractStructuredProducts(ldJson({ '@type': 'Product', name: 'x' }))).toEqual([]);
  });
});

describe('bestOffer currency handling (P0-12)', () => {
  it('rejects non-GBP offers and accepts unstated currency', () => {
    const usd = extractStructuredProducts(ldJson({ '@type': 'Product', name: 'u',
      offers: offer(899, 'InStock', { priceCurrency: 'USD' }) }))[0];
    expect(bestOffer(usd)).toBeNull();
    const none = extractStructuredProducts(ldJson({ '@type': 'Product', name: 'n',
      offers: { '@type': 'Offer', price: 12, availability: 'InStock' } }))[0];
    expect(bestOffer(none)).toMatchObject({ price: 12, currency: null });
  });
  it('picks the GBP offer when a page lists several currencies', () => {
    const [p] = extractStructuredProducts(ldJson({ '@type': 'Product', name: 'm', offers: [
      offer(899, 'InStock', { priceCurrency: 'USD' }), offer(699, 'InStock'),
    ] }));
    expect(bestOffer(p)?.price).toBe(699);
  });
});

describe('product identity fields (mpn, gtin, brand)', () => {
  const page = (product: object) => `<script type="application/ld+json">${JSON.stringify(product)}</script>`;
  // Shape follows schema.org/Product; values are constructed (the field names are the schema's, the numbers are not a real product's).
  const base = { '@type': 'Product', name: 'x', offers: { '@type': 'Offer', price: '10', priceCurrency: 'GBP', availability: 'https://schema.org/InStock' } };

  it('keeps the manufacturer part number apart from the shop SKU', () => {
    const [p] = extractStructuredProducts(page({ ...base, sku: 'SHOP-1', mpn: 'CT2K32G56C46S5' }));
    expect(p.sku).toBe('SHOP-1');
    expect(p.mpn).toBe('CT2K32G56C46S5');
  });
  it('reads a GTIN under any of its schema.org names, digits only, and rejects wrong lengths', () => {
    expect(extractStructuredProducts(page({ ...base, gtin13: '0649528 903 336' }))[0].gtin).toBe('0649528903336');
    expect(extractStructuredProducts(page({ ...base, gtin: '12345' }))[0].gtin).toBeUndefined();
  });
  it('reads brand as a string or as a Brand object', () => {
    expect(extractStructuredProducts(page({ ...base, brand: 'Crucial' }))[0].brand).toBe('Crucial');
    expect(extractStructuredProducts(page({ ...base, brand: { '@type': 'Brand', name: 'Kingston' } }))[0].brand).toBe('Kingston');
  });
  it('an InStoreOnly offer is never reported as in stock', () => {
    const p = extractStructuredProducts(page({ ...base, offers: { ...base.offers, availability: 'https://schema.org/InStoreOnly' } }))[0];
    expect(bestOffer(p)?.stockState).toBe('unknown');
  });
});
