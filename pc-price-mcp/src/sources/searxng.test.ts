import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as db from '../db.js';
import { discoverProductPages, searxngUrl } from './searxng.js';

beforeEach(() => { db.getDb().exec('DELETE FROM config;'); delete process.env.SEARXNG_URL; });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.SEARXNG_URL; });

describe('P2-5 SearXNG discovery', () => {
  it('is off until configured', async () => {
    expect(searxngUrl()).toBeNull();
    expect(await discoverProductPages('ddr5', ['novatech.co.uk'])).toEqual({ error: expect.stringMatching(/not configured/) });
  });
  it('keeps only the wanted retailers, drops duplicates and other sites, and builds a JSON query', async () => {
    db.setConfig('searxng_url', 'http://sx:8080/');
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ results: [
      { title: 'KLEVV 64GB kit', url: 'https://www.novatech.co.uk/products/klevv/kd5.html' },
      { title: 'dup', url: 'https://www.novatech.co.uk/products/klevv/kd5.html' },
      { title: 'forum thread', url: 'https://www.reddit.com/r/x' },
      { title: 'Kingston', url: 'https://www.awd-it.co.uk/kingston.html' },
    ] }) }));
    vi.stubGlobal('fetch', f);
    const r = await discoverProductPages('ddr5 so-dimm 64gb', ['novatech.co.uk', 'awd-it.co.uk']);
    expect(r).toEqual([
      { title: 'KLEVV 64GB kit', url: 'https://www.novatech.co.uk/products/klevv/kd5.html', domain: 'novatech.co.uk' },
      { title: 'Kingston', url: 'https://www.awd-it.co.uk/kingston.html', domain: 'awd-it.co.uk' },
    ]);
    const url = new URL((f.mock.calls[0] as unknown as [string])[0]);
    expect(url.origin + url.pathname).toBe('http://sx:8080/search');
    expect(url.searchParams.get('format')).toBe('json');
    expect(url.searchParams.get('q')).toContain('site:novatech.co.uk OR site:awd-it.co.uk');
  });
  it('explains a 403 and reports transport errors', async () => {
    process.env.SEARXNG_URL = 'http://sx:8080';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({}) })));
    expect(await discoverProductPages('x', [])).toEqual({ error: expect.stringMatching(/json format/) });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED'); }));
    expect(await discoverProductPages('x', [])).toEqual({ error: expect.stringMatching(/ECONNREFUSED/) });
  });
});
