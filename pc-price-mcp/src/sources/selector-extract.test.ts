import { readFileSync } from 'fs';
import { describe, it, expect, beforeEach } from 'vitest';
import { extractWithRule, structuralExcerpt, validateProposal, healAllowed, resetHealThrottle } from './selector-extract.js';

// Real AWD-IT product block (captured 2026-10-06): Kingston Fury 64GB kit, out of stock, £919.99 incl. VAT.
const AWD = readFileSync(new URL('../test/fixtures/awd-it-kingston-fury-64gb.html', import.meta.url), 'utf8');

describe('P0-6 rules run real CSS selectors', () => {
  it('descendant selector on the real page (the old regex could not express this)', () => {
    const r = extractWithRule(AWD, { price_selector: '.price-including-tax > .price', name_selector: '.product-item-link', avail_selector: '.stock-status' });
    expect(r).toEqual({ price: 919.99, name: 'Kingston Fury 64GB (2x32GB) DDR5 5600MT/s CL40 SODIMM Memory - Black', stockState: 'out_of_stock' });
  });
  it('honours price_attribute, which the old code never read', () => {
    expect(extractWithRule(AWD, { price_selector: '.price-including-tax', price_attribute: 'data-price-amount' })?.price).toBe(919.99);
  });
  it('reads text split across nested tags', () => {
    const html = '<div class="p"><span>£<span>799</span>.99</span></div>';
    expect(extractWithRule(html, { price_selector: '.p' })?.price).toBe(799.99);
  });
  it('picks the right one of two price boxes rather than the first token', () => {
    expect(extractWithRule(AWD, { price_selector: '.price-excluding-tax .price' })?.price).toBe(766.66);
  });
  it('returns null for no match, an invalid selector, or a non-GBP price', () => {
    expect(extractWithRule(AWD, { price_selector: '.nope' })).toBeNull();
    expect(extractWithRule(AWD, { price_selector: '###[' })).toBeNull();
    expect(extractWithRule('<b class="p">$799.00</b>', { price_selector: '.p' })).toBeNull();
  });
  it('stock is unknown, never assumed in stock, when no availability selector matches', () => {
    expect(extractWithRule(AWD, { price_selector: '.price-including-tax .price', avail_selector: '.missing' })?.stockState).toBe('unknown');
  });
});

describe('P0-7 safe self-healing', () => {
  beforeEach(() => resetHealThrottle());
  it('the excerpt keeps structure (class, data attributes, parent) and the price, unlike tag-stripped text', () => {
    const ex = structuralExcerpt(AWD);
    expect(ex).toContain('class="price-wrapper price-including-tax"');
    expect(ex).toContain('data-price-amount="919.99"');
    expect(ex).toContain('£919.99');
    expect(ex).toMatch(/stock-status/);
  });
  it('accepts a proposal that extracts a price from the page', () => {
    expect(validateProposal(AWD, { price_selector: '.price-including-tax .price' })?.price).toBe(919.99);
  });
  it('rejects a proposal that matches nothing, is malformed, or yields an implausible value', () => {
    expect(validateProposal(AWD, { price_selector: '.price-nope' })).toBeNull();
    expect(validateProposal(AWD, { price_selector: null })).toBeNull();
    expect(validateProposal(AWD, { price_selector: '[' })).toBeNull();
    expect(validateProposal('<i class="p">£0.00</i>', { price_selector: '.p' })).toBeNull();
  });
  it('allows one heal attempt per domain per interval', () => {
    expect(healAllowed('a.co.uk', 1_000)).toBe(true);
    expect(healAllowed('a.co.uk', 1_000 + 60_000)).toBe(false);
    expect(healAllowed('b.co.uk', 1_000 + 60_000)).toBe(true);
    expect(healAllowed('a.co.uk', 1_000 + 7 * 3_600_000)).toBe(true);
  });
});
