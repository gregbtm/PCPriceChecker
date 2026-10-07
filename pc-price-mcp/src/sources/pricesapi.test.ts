import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { classifyPricesApiFailure, searchProducts, PricesApiError } from './pricesapi.js';

// Error envelope and codes as published at pricesapi.io/docs "Error codes" (read 2026-10-07).
const env = (code: string, message = 'm', details?: object) => JSON.stringify({ success: false, error: { code, message, ...(details ? { details } : {}) } });

describe('PricesAPI failure classification', () => {
  it('exhausted credits are quota, never "check your key" (the reported bug: 403 CREDITS_EXCEEDED)', () => {
    const e = classifyPricesApiFailure(403, env('CREDITS_EXCEEDED', 'used up', { credits_used: 10000, credits_included: 3000, resets_at: null }), null);
    expect(e.kind).toBe('quota');
    expect(e.message).toContain('10000 of 3000 credits used');
    expect(e.message).toContain('does not renew');
    expect(e.message).not.toMatch(/authentication|PRICES_API_KEY/i);
    expect(e.details).toMatchObject({ creditsUsed: 10000, creditsIncluded: 3000, resetsAt: null });
  });
  it('a renewing allowance reports when it resets', () => {
    const e = classifyPricesApiFailure(403, env('MONTHLY_LIMIT_EXCEEDED', 'x', { credits_used: 30000, credits_included: 30000, resets_at: '2026-11-01T00:00:00Z' }), null);
    expect(e).toMatchObject({ kind: 'quota', details: { resetsAt: '2026-11-01T00:00:00Z' } });
    expect(e.message).toContain('renew 2026-11-01');
  });
  it('401 is a key problem; a cancelled subscription is its own message', () => {
    expect(classifyPricesApiFailure(401, env('INVALID_API_KEY'), null)).toMatchObject({ kind: 'auth', code: 'INVALID_API_KEY' });
    expect(classifyPricesApiFailure(403, env('SUBSCRIPTION_CANCELLED'), null).message).toMatch(/cancelled/);
  });
  it('429 is a rate limit with its delay, and warns that over-quota calls can look like one', () => {
    const e = classifyPricesApiFailure(429, env('RATE_LIMIT_EXCEEDED'), '12');
    expect(e).toMatchObject({ kind: 'rate', retryAfterSec: 12 });
    expect(e.message).toMatch(/credit balance/);
  });
  it('503 is busy, 5xx is a server error, an unexplained 403 is not called an authentication failure', () => {
    expect(classifyPricesApiFailure(503, '', '7')).toMatchObject({ kind: 'busy', retryAfterSec: 7 });
    expect(classifyPricesApiFailure(500, env('SEARCH_FAILED'), null).kind).toBe('server');
    const e = classifyPricesApiFailure(403, 'forbidden', null);
    expect(e.kind).toBe('other');
    expect(e.message).not.toMatch(/authentication failed/i);
  });
});

describe('searchProducts throws the typed error', () => {
  beforeEach(() => { process.env.PRICES_API_KEY = 'pricesapi_test'; });
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.PRICES_API_KEY; });
  it('on a 403 CREDITS_EXCEEDED response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, headers: new Headers(), text: async () => env('CREDITS_EXCEEDED', 'x', { credits_used: 1, credits_included: 1, resets_at: null }) })));
    await expect(searchProducts('ddr5')).rejects.toBeInstanceOf(PricesApiError);
    await expect(searchProducts('ddr5')).rejects.toMatchObject({ kind: 'quota' });
  });
});
