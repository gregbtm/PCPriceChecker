import { describe, it, expect } from 'vitest';
import { parseStockText, stockStateFromAvailability, stockStateFromBoolean } from './stock-state.js';

describe('parseStockText', () => {
  it.each([
    ['Due 8th Oct', 'backorder'],            // Scan, 2026-10-05, 64GB 5600 kit
    ['Due back in 2 weeks', 'backorder'],
    ['Pre-order now', 'backorder'],
    ['Back order', 'backorder'],
    ['Expected 12 Oct', 'backorder'],
    ['Out of stock - due 12th Oct', 'backorder'],
    ['In stock', 'in_stock'],                // Scan
    ['Get it Wednesday, 07 Oct', 'in_stock'],
    ['Add to basket', 'in_stock'],
    ['Low stock', 'in_stock'],
    ['Out of stock', 'out_of_stock'],
    ['Sold out', 'out_of_stock'],
    ['No stock', 'out_of_stock'],
    ['Currently unavailable', 'out_of_stock'],  // must not match "available"
    ['Not available', 'out_of_stock'],
    ['Not in stock', 'out_of_stock'],
    ['Notify me when back in stock', 'out_of_stock'],
    ['', 'unknown'],
    ['Free delivery over £50', 'unknown'],
    [null, 'unknown'],
  ] as const)('%s -> %s', (text, expected) => {
    expect(parseStockText(text)).toBe(expected);
  });
});

describe('stockStateFromAvailability', () => {
  it.each([
    ['https://schema.org/InStock', 'in_stock'],
    ['http://schema.org/OutOfStock', 'out_of_stock'],
    ['https://schema.org/SoldOut', 'out_of_stock'],
    ['https://schema.org/BackOrder', 'backorder'],
    ['https://schema.org/PreOrder', 'backorder'],
    ['https://schema.org/LimitedAvailability', 'in_stock'],
    ['https://schema.org/OnlineOnly', 'in_stock'],
    ['https://schema.org/InStoreOnly', 'unknown'],      // a shop-counter-only item is not a purchase an online buyer can make
    ['https://schema.org/Reserved', 'out_of_stock'],
    ['https://schema.org/MadeToOrder', 'backorder'],
    ['https://schema.org/PreSale', 'backorder'],
    ['InStoreOnly', 'unknown'],
    [undefined, 'unknown'],
    ['', 'unknown'],
  ] as const)('%s -> %s', (v, expected) => {
    expect(stockStateFromAvailability(v)).toBe(expected);
  });
});

describe('stockStateFromBoolean', () => {
  it('never maps a missing flag to in stock', () => {
    expect(stockStateFromBoolean(undefined)).toBe('unknown');
    expect(stockStateFromBoolean(null)).toBe('unknown');
    expect(stockStateFromBoolean(true)).toBe('in_stock');
    expect(stockStateFromBoolean(false)).toBe('out_of_stock');
  });
});
