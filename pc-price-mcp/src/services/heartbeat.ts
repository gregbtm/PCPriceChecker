/**
 * Dead-man's switch. The worst failure of a price watcher is silence: the app stops, nothing alerts, and "no alert" looks like "no deal".
 * After every completed scheduler pass this pings a URL the owner chooses (config `heartbeat_url`, or env HEARTBEAT_URL), typically a
 * self-hosted Uptime Kuma "Push" monitor or a healthchecks.io-style check. The monitor, not this app, raises the alarm when pings stop,
 * so it still fires if this container is down, wedged or the NAS is off. No URL configured = does nothing.
 */
import * as db from '../db.js';

export function heartbeatUrl(): string | null {
  const u = (db.getConfig('heartbeat_url') ?? process.env.HEARTBEAT_URL ?? '').trim();
  return /^https?:\/\//i.test(u) ? u : null;
}

/** Returns true when a ping was sent and answered 2xx. Never throws: a monitor being down must not break a scrape pass. */
export async function pingHeartbeat(fetchFn: typeof fetch = fetch): Promise<boolean> {
  const url = heartbeatUrl();
  if (!url) return false;
  try {
    const res = await fetchFn(url, { method: 'GET', signal: AbortSignal.timeout(10_000) });
    if (res.ok) { db.setConfig('heartbeat_last_ok', new Date().toISOString()); return true; }
    db.setConfig('heartbeat_last_error', `${new Date().toISOString()} HTTP ${res.status}`);
  } catch (e) {
    db.setConfig('heartbeat_last_error', `${new Date().toISOString()} ${(e as Error).message}`);
  }
  return false;
}
