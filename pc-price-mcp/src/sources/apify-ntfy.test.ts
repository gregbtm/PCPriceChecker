import { describe, it, expect, vi, afterEach } from 'vitest';
import { runApifyActor } from './apify.js';
import { sendNtfy } from '../notifications.js';
import * as db from '../db.js';

afterEach(() => { vi.unstubAllGlobals(); delete process.env.APIFY_API_TOKEN; vi.restoreAllMocks(); });

describe('P0-11 Apify run is aborted on client timeout (A-09)', () => {
  it('POSTs /abort and reports ABORTED instead of leaving the run going', async () => {
    process.env.APIFY_API_TOKEN = 'test-token';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: RequestInit) => {
      calls.push(`${opts?.method ?? 'GET'} ${String(url).replace(/\?.*/, '')}`);
      return { ok: true, status: 200, json: async () => ({ data: { id: 'run1' } }) };
    }));
    const r = await runApifyActor('x~y', {}, 0);   // 0s budget: times out immediately
    expect(r?.status).toBe('ABORTED');
    expect(calls).toEqual(['POST https://api.apify.com/v2/acts/x~y/runs', 'POST https://api.apify.com/v2/actor-runs/run1/abort']);
  });

  it('logs HTTP failures instead of returning null silently', async () => {
    process.env.APIFY_API_TOKEN = 'test-token';
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 402, json: async () => ({}) })));
    expect(await runApifyActor('x~y', {}, 0)).toBeNull();
    expect(err).toHaveBeenCalledWith(expect.stringContaining('HTTP 402'));
  });
});

describe('self-hosted ntfy with access control', () => {
  it('sends a Bearer token when ntfy_token is configured, and none otherwise', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);
    await sendNtfy('prices', 'https://ntfy.lan', { type: 'scrape_failure', componentName: 'kit', message: 'x' });
    expect((fetchMock.mock.calls[0] as any)[1].headers.Authorization).toBeUndefined();
    expect((fetchMock.mock.calls[0] as any)[1].headers.Tags).toBe('warning');
    db.setConfig('ntfy_token', 'tk_secret');
    await sendNtfy('prices', 'https://ntfy.lan', { type: 'price_alert', componentName: 'kit', price: 300 });
    expect((fetchMock.mock.calls[1] as any)[1].headers.Authorization).toBe('Bearer tk_secret');
    expect((fetchMock.mock.calls[1] as any)[0]).toBe('https://ntfy.lan/prices');
  });
});
