import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as db from './db.js';
import { notifyAll, sendWebhook } from './notifications.js';

beforeEach(() => { db.getDb().exec('DELETE FROM config;'); });
afterEach(() => vi.unstubAllGlobals());

describe('generic webhook channel (n8n)', () => {
  it('posts JSON with event, ts and the payload, plus the token header', async () => {
    const f = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', f);
    const ok = await sendWebhook('http://n8n.lan:5678/webhook/pcpc', 's3cret',
      { type: 'price_alert', componentName: 'kit', price: 340, currency: 'GBP', retailer: 'Ebuyer', alertThreshold: 350, url: 'https://e/x' });
    expect(ok).toBe(true);
    const [url, opts] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://n8n.lan:5678/webhook/pcpc');
    expect((opts.headers as Record<string, string>)['X-PCPC-Token']).toBe('s3cret');
    expect((opts.headers as Record<string, string>)['X-PCPC-Event']).toBe('price_alert');
    expect(JSON.parse(opts.body as string)).toMatchObject({
      event: 'price_alert', componentName: 'kit', price: 340, currency: 'GBP', retailer: 'Ebuyer', alertThreshold: 350, url: 'https://e/x',
    });
    expect(JSON.parse(opts.body as string).ts).toMatch(/^\d{4}-\d\d-\d\dT/);
  });

  it('omits the token header when no secret is set and reports failure on HTTP errors / network errors', async () => {
    const f = vi.fn(async () => ({ ok: false }));
    vi.stubGlobal('fetch', f);
    expect(await sendWebhook('http://x', null, { type: 'test', componentName: 'c' })).toBe(false);
    expect((((f.mock.calls[0] as unknown) as [string, RequestInit])[1].headers as Record<string, string>)['X-PCPC-Token']).toBeUndefined();
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    expect(await sendWebhook('http://x', null, { type: 'test', componentName: 'c' })).toBe(false);
  });

  it('notifyAll uses it only when webhook_url is configured', async () => {
    const f = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', f);
    expect((await notifyAll({ type: 'test', componentName: 'c' })).webhook).toBe(false);
    expect(f).not.toHaveBeenCalled();
    db.setConfig('webhook_url', 'http://n8n.lan/webhook/x');
    expect((await notifyAll({ type: 'scrape_failure', componentName: 'c', message: 'm' })).webhook).toBe(true);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
