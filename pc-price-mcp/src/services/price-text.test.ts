import { describe, it, expect } from 'vitest';
import { parsePriceText, isAcceptableCurrency } from './price-text.js';

describe('parsePriceText', () => {
  it.each([
    ['£893.99', 893.99, 'GBP'],
    ['£1,299.00', 1299, 'GBP'],
    ['Now £699.99', 699.99, 'GBP'],
    ['Was £999.99 Now £699.99', 699.99, 'GBP'],      // A-19: first number is the "was" price
    ['RRP £120 £89.99', 89.99, 'GBP'],
    ['Save £30 £89.99', 89.99, 'GBP'],
    ['From £799', 799, 'GBP'],
    ['933.49', 933.49, null],
    ['$899.00', 899, 'USD'],
    ['€899,00', 899, 'EUR'],
  ] as const)('%s', (text, price, currency) => {
    expect(parsePriceText(text)).toEqual({ price, currency });
  });
  it('returns null when there is no price', () => {
    expect(parsePriceText('Out of stock')).toBeNull();
    expect(parsePriceText('£0.00')).toBeNull();
  });
  it('honours a custom capture regex and falls back on a bad one', () => {
    expect(parsePriceText('Price: GBP 55.5 inc', 'GBP ([\\d.]+)')?.price).toBe(55.5);
    expect(parsePriceText('£12.50', '([')?.price).toBe(12.5);
  });
});

describe('isAcceptableCurrency', () => {
  it('accepts GBP and unstated, rejects the rest', () => {
    expect(isAcceptableCurrency('GBP')).toBe(true);
    expect(isAcceptableCurrency('gbp')).toBe(true);
    expect(isAcceptableCurrency(null)).toBe(true);
    expect(isAcceptableCurrency('USD')).toBe(false);
    expect(isAcceptableCurrency('EUR')).toBe(false);
  });
});
