/**
 * robots.txt compliance (RFC 9309) for every site this app fetches, other than official APIs such as eBay's.
 *
 * Found 2026-10-07 (research row 36): the app's search requests broke the published rules of AWD-IT (`Disallow: /*?`, which
 * covers every query string), Novatech (`Disallow: /search.html`), Overclockers and CCL (`Disallow: /search`). The scrapers now
 * ask this module first and make **no request** to a disallowed address; the attempt is recorded as a failure that says why.
 *
 * Matching: the most specific group (our product token, else `*`); groups for the same agent are merged; the longest matching
 * pattern wins and Allow beats Disallow on a tie; `*` matches any run of characters and a trailing `$` anchors the end.
 * Availability: 2xx = use it; 4xx (including a bot-challenge 403 that hides the file) = no rules, allowed, per RFC 9309; 5xx or a
 * network error = treated as disallowed, and retried after 10 minutes rather than cached for a day.
 */
import { scraperUserAgent } from './scrape-policy.js';

const AGENT = 'pcpricechecker';
const TTL_MS = 24 * 3_600_000;
const RETRY_MS = 10 * 60_000;

export interface RobotsRules { rules: Array<{ allow: boolean; pattern: string }>; status: 'ok' | 'unavailable' | 'error' }

export function parseRobots(text: string): RobotsRules['rules'] {
  type Group = { agents: string[]; rules: Array<{ allow: boolean; pattern: string }> };
  const groups: Group[] = [];
  let cur: Group | null = null;
  let lastWasAgent = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase(), value = m[2].trim();
    if (field === 'user-agent') {
      if (!cur || !lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if (field === 'allow' || field === 'disallow') {
      lastWasAgent = false;
      if (cur && value !== '') cur.rules.push({ allow: field === 'allow', pattern: value });
      // an empty Disallow means "allow everything" and adds no rule
    } else lastWasAgent = false;
  }
  const specific = groups.filter(g => g.agents.includes(AGENT));
  const chosen = specific.length > 0 ? specific : groups.filter(g => g.agents.includes('*'));
  return chosen.flatMap(g => g.rules);
}

function toRegex(pattern: string): RegExp {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

/** `path` is pathname plus query string. Returns the deciding rule when disallowed, else null. */
export function disallowingRule(rules: RobotsRules['rules'], path: string): string | null {
  let best: { allow: boolean; len: number; pattern: string } | null = null;
  for (const r of rules) {
    if (!toRegex(r.pattern).test(path)) continue;
    const len = r.pattern.replace(/\*/g, '').length;
    if (!best || len > best.len || (len === best.len && r.allow && !best.allow)) best = { allow: r.allow, len, pattern: r.pattern };
  }
  return best && !best.allow ? best.pattern : null;
}

const cache = new Map<string, { at: number; ttl: number; value: RobotsRules }>();
export function clearRobotsCache(): void { cache.clear(); }

export async function loadRobots(origin: string, fetchFn: typeof fetch = fetch, now = Date.now()): Promise<RobotsRules> {
  const hit = cache.get(origin);
  if (hit && now - hit.at < hit.ttl) return hit.value;
  let value: RobotsRules, ttl = TTL_MS;
  try {
    const res = await fetchFn(`${origin}/robots.txt`, { headers: { 'User-Agent': scraperUserAgent(), Accept: 'text/plain' }, signal: AbortSignal.timeout(10_000) });
    if (res.ok) value = { rules: parseRobots(await res.text()), status: 'ok' };
    else if (res.status >= 500) { value = { rules: [{ allow: false, pattern: '/' }], status: 'error' }; ttl = RETRY_MS; }
    else value = { rules: [], status: 'unavailable' };
  } catch {
    value = { rules: [{ allow: false, pattern: '/' }], status: 'error' }; ttl = RETRY_MS;
  }
  cache.set(origin, { at: now, ttl, value });
  return value;
}

export class RobotsDisallowedError extends Error {
  constructor(public url: string, public rule: string, public status: RobotsRules['status']) {
    super(status === 'error'
      ? `robots.txt of ${new URL(url).host} could not be read (server error); not fetching until it can`
      : `disallowed by ${new URL(url).host}/robots.txt (${rule}); not fetched`);
    this.name = 'RobotsDisallowedError';
  }
}

/** Throws RobotsDisallowedError when the site's robots.txt forbids this address. Never throws for any other reason. */
export async function assertAllowedByRobots(url: string, fetchFn: typeof fetch = fetch): Promise<void> {
  let u: URL;
  try { u = new URL(url); } catch { return; }
  if (!/^https?:$/.test(u.protocol)) return;
  const robots = await loadRobots(u.origin, fetchFn);
  const rule = disallowingRule(robots.rules, u.pathname + u.search);
  if (rule) throw new RobotsDisallowedError(url, rule, robots.status);
}
