import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as db from '../db.js';
import { pingHeartbeat, heartbeatUrl } from './heartbeat.js';

beforeEach(() => { db.getDb().exec('DELETE FROM config;'); delete process.env.HEARTBEAT_URL; });

describe('heartbeat', () => {
  it('does nothing without a URL (and never calls fetch)', async () => {
    const f = vi.fn();
    expect(await pingHeartbeat(f as never)).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });
  it('rejects a value that is not an http(s) address', () => {
    db.setConfig('heartbeat_url', 'javascript:alert(1)');
    expect(heartbeatUrl()).toBeNull();
  });
  it('pings the configured URL and records the time on success', async () => {
    db.setConfig('heartbeat_url', 'http://kuma.lan:3001/api/push/abc?status=up&msg=OK');
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    expect(await pingHeartbeat(f as never)).toBe(true);
    expect(f.mock.calls[0][0]).toBe('http://kuma.lan:3001/api/push/abc?status=up&msg=OK');
    expect(db.getConfig('heartbeat_last_ok')).toBeTruthy();
  });
  it('a non-2xx answer or a network error is recorded and returns false, never throws', async () => {
    process.env.HEARTBEAT_URL = 'https://hc.test/ping/x';
    expect(await pingHeartbeat((async () => ({ ok: false, status: 404 })) as never)).toBe(false);
    expect(db.getConfig('heartbeat_last_error')).toMatch(/HTTP 404/);
    expect(await pingHeartbeat((async () => { throw new Error('ECONNREFUSED'); }) as never)).toBe(false);
    expect(db.getConfig('heartbeat_last_error')).toMatch(/ECONNREFUSED/);
  });
});
