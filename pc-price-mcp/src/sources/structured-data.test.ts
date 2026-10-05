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
