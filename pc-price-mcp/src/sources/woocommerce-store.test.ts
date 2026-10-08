import { readFileSync } from 'fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { searchWooStore, wooStockState, wooPrice, wooSearchTerm } from './woocommerce-store.js';
import { clearRobotsCache } from '../services/robots.js';
import { classifyMemory, matchesProfile, PROFILES } from '../services/memory-classifier.js';

// Real Wired2Fire Store API response and robots.txt, captured 2026-10-07 (response trimmed to the fields used).
const API = readFileSync(new URL('../test/fixtures/wired2fire-store-api-so-dimm.json', import.meta.url), 'utf8');
const ROBOTS = readFileSync(new URL('../test/fixtures/robots/wired2fire.txt', import.meta.url), 'utf8');

beforeEach(() => clearRobotsCache());

function fakeFetch(apiBody: string, status = 200) {
  const calls: string[] = [];
  const f = vi.fn(async (url: string) => {
    calls.push(url);
    if (url.endsWith('/robots.txt')) return { ok: true, status: 200, headers: new Headers(), text: async () => ROBOTS };
    return { ok: status === 200, status, headers: new Headers(), text: async () => apiBody, json: async () => JSON.parse(apiBody) };
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('WooCommerce Store API (Wired2Fire)', () => {
  it('reads the real response: price in major units, GBP, and a backordered kit is NOT in stock', async () => {
    const { f, calls } = fakeFetch(API);
    const r = await searchWooStore('wired2fire', 'ddr5 so-dimm 64gb', f);
    expect(r.error).toBeUndefined();
    const kit = r.results.find(x => /2 x 32GB/.test(x.name))!;
    expect(kit.price).toBe(600);
    expect(kit.currency).toBe('GBP');
    // The live response says is_in_stock:true AND is_on_backorder:true. Reading only the first would alert on a kit that cannot ship.
    expect(kit.stockState).toBe('backorder');
    expect(kit.inStock).toBe(false);
    expect(kit.url).toBe('https://wired2fire.co.uk/product/64gb-ddr5-5600mhz-so-dimm-memory-2-x-32gb/');
    expect(calls.some(u => u.includes('/wp-json/wc/store/v1/products?search=so-dimm'))).toBe(true);
  });

  it('the 64GB kit matches the N5 Air profile and the 2 x 16GB kit does not', async () => {
    const r = await searchWooStore('wired2fire', 'ddr5 so-dimm 64gb', fakeFetch(API).f);
    const profile = PROFILES['n5-air-ram'];
    const verdict = (n: RegExp) => matchesProfile(classifyMemory(r.results.find(x => n.test(x.name))!.name), profile).match;
    expect(verdict(/2 x 32GB/)).toBe(true);
    expect(verdict(/2 x 16GB/)).toBe(false);
  });

  it('a non-list body (a challenge page, an error object) is a failure, not an empty result', async () => {
    const r = await searchWooStore('wired2fire', 'so-dimm', fakeFetch('{"code":"rest_no_route"}').f);
    expect(r.error).toMatch(/did not return a product list/);
    expect(r.emptyIsOk).toBeFalsy();
  });

  it('an HTTP error is a failure; an empty list is a healthy "nothing today"', async () => {
    expect((await searchWooStore('wired2fire', 'so-dimm', fakeFetch('', 403).f)).error).toBe('HTTP 403');
    const empty = await searchWooStore('wired2fire', 'so-dimm', fakeFetch('[]').f);
    expect(empty.error).toBeUndefined();
    expect(empty.emptyIsOk).toBe(true);
  });

  it('stock mapping: backorder wins over in-stock; unknown never counts as in stock', () => {
    expect(wooStockState({ is_in_stock: true, is_on_backorder: true })).toBe('backorder');
    expect(wooStockState({ is_in_stock: true, is_on_backorder: false, is_purchasable: true })).toBe('in_stock');
    expect(wooStockState({ is_in_stock: true, stock_availability: { class: 'available-on-backorder' } })).toBe('backorder');
    expect(wooStockState({ is_in_stock: false })).toBe('out_of_stock');
    expect(wooStockState({})).toBe('unknown');
    expect(wooStockState({ is_in_stock: true, is_purchasable: false })).toBe('unknown');
  });

  it('price and search-term helpers', () => {
    expect(wooPrice({ prices: { price: '60000', currency_minor_unit: 2 } })).toBe(600);
    expect(wooPrice({ prices: { price: '0', currency_minor_unit: 2 } })).toBeNull();
    expect(wooPrice({})).toBeNull();
    expect(wooSearchTerm('DDR5 SO-DIMM 64GB')).toBe('so-dimm');
    expect(wooSearchTerm('ddr5 sodimm 64gb')).toBe('so-dimm');
    expect(wooSearchTerm('rtx 5090')).toBe('rtx');
  });

  it('an unknown store id is an error, not a crash', async () => {
    expect((await searchWooStore('nope', 'x', fakeFetch('[]').f)).error).toMatch(/unknown WooCommerce store/);
  });
});

// Real Inside-Tech Store API products and robots.txt, captured 2026-10-08 (response trimmed to six products and the fields used).
const IT_API = readFileSync(new URL('../test/fixtures/insidetech-store-api-sodimm.json', import.meta.url), 'utf8');
const IT_ROBOTS = readFileSync(new URL('../test/fixtures/robots/insidetech.txt', import.meta.url), 'utf8');

function itFetch(apiBody: string) {
  const calls: string[] = [];
  const f = vi.fn(async (url: string) => {
    calls.push(url);
    if (url.endsWith('/robots.txt')) return { ok: true, status: 200, headers: new Headers(), text: async () => IT_ROBOTS };
    return { ok: true, status: 200, headers: new Headers(), text: async () => apiBody, json: async () => JSON.parse(apiBody) };
  }) as unknown as typeof fetch;
  return { f, calls };
}

describe('WooCommerce Store API (Inside-Tech)', () => {
  it('searches "sodimm" (its titles do not hyphenate it), while Wired2Fire keeps "so-dimm"', async () => {
    expect(wooSearchTerm('ddr5 so-dimm 64gb', 'sodimm')).toBe('sodimm');
    const it = itFetch(IT_API);
    await searchWooStore('insidetech', 'DDR5 SO-DIMM 64GB kit', it.f);
    expect(it.calls.some(u => u.startsWith('https://inside-tech.co.uk/wp-json/wc/store/v1/products?search=sodimm&'))).toBe(true);
    const w = fakeFetch(API);
    await searchWooStore('wired2fire', 'DDR5 SO-DIMM 64GB kit', w.f);
    expect(w.calls.some(u => u.includes('search=so-dimm&'))).toBe(true);
  });

  it('reads the real response: GBP prices in major units, in stock, and none of today\'s products fits the N5 Air', async () => {
    const r = await searchWooStore('insidetech', 'ddr5 so-dimm 64gb', itFetch(IT_API).f);
    expect(r.error).toBeUndefined();
    expect(r.retailer).toBe('Inside-Tech');
    const single32 = r.results.find(x => x.name === '32GB DDR5 RAM SODIMM')!;
    expect(single32.price).toBe(428);
    expect(single32.stockState).toBe('in_stock');
    // the trap in the real data: a GBP 12 "product" that is the no-RAM option, not memory
    expect(r.results.find(x => /No RAM/.test(x.name))?.price).toBe(12);
    const profile = PROFILES['n5-air-ram'];
    for (const x of r.results) expect(matchesProfile(classifyMemory(x.name), profile).match, x.name).toBe(false);
  });

  it('a 64GB kit, if the shop lists one, matches the profile (constructed product, not captured)', async () => {
    const real = JSON.parse(IT_API) as Array<Record<string, unknown>>;
    const kit = { ...real[0], id: 1, name: 'Kingston FURY Impact KF556S40IBK2-64 64GB (2x 32GB) SODIMM System Memory, 5600MHz, DDR5, CL40', permalink: 'https://inside-tech.co.uk/product/constructed-64gb-kit/', prices: { price: '59900', currency_code: 'GBP', currency_minor_unit: 2 } };
    const r = await searchWooStore('insidetech', 'ddr5 so-dimm 64gb', itFetch(JSON.stringify([...real, kit])).f);
    const found = r.results.find(x => /64GB/.test(x.name))!;
    expect(found.price).toBe(599);
    expect(matchesProfile(classifyMemory(found.name), PROFILES['n5-air-ram']).match).toBe(true);
  });
});
