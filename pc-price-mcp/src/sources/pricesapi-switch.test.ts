import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as db from '../db.js';
import { pricesApiSwitchedOff, searchProducts, PricesApiError } from './pricesapi.js';

beforeEach(() => { db.getDb().exec('DELETE FROM config;'); process.env.PRICES_API_KEY = 'test-key-123'; delete process.env.PRICESAPI_ENABLED; });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.PRICES_API_KEY; });

describe('PricesAPI master switch (keeps the key, stops every call)', () => {
  it('is on by default and only the word "false" switches it off', () => {
    expect(pricesApiSwitchedOff()).toBe(false);
    db.setConfig('pricesapi_enabled', 'no');
    expect(pricesApiSwitchedOff()).toBe(false);
    db.setConfig('pricesapi_enabled', 'false');
    expect(pricesApiSwitchedOff()).toBe(true);
    db.setConfig('pricesapi_enabled', 'true');
    expect(pricesApiSwitchedOff()).toBe(false);
  });
  it('when off, a search throws a clear error and never touches the network; the key is untouched', async () => {
    db.setConfig('pricesapi_enabled', 'false');
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(searchProducts('ddr5 so-dimm 64gb')).rejects.toBeInstanceOf(PricesApiError);
    await expect(searchProducts('ddr5 so-dimm 64gb')).rejects.toThrow(/switched off/);
    expect(f).not.toHaveBeenCalled();
    expect(process.env.PRICES_API_KEY).toBe('test-key-123');
  });
});
