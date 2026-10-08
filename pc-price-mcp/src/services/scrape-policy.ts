/**
 * Scraping policy in one place (owner rule, 2026-10-06: scrape politely, never add measures to defeat a site's protections).
 *
 * `bypassAllowed()` gates everything that exists only to avoid being recognised as automation: browser-fingerprint patching,
 * rotating user-agent strings, proxy rotation, and the optional Novada / Camoufox anti-detect backends. It is OFF unless the owner sets
 * config `allow_bot_bypass` (or env ALLOW_BOT_BYPASS) to "true" on purpose. Plain rendering of a JavaScript page, with an honest
 * identity, does not need it.
 *
 * `scraperUserAgent()` is the identity every plain request sends. The default names the project; the owner can add contact details
 * (config `scraper_user_agent`) so a shop that dislikes the traffic can find who to ask. Disguise is what `allow_bot_bypass` is for.
 */
import * as db from '../db.js';

export const HONEST_UA = 'PCPriceChecker (self-hosted price tracker; github.com/gregbtm/PCPriceChecker)';

export function bypassAllowed(): boolean {
  return (db.getConfig('allow_bot_bypass') ?? process.env.ALLOW_BOT_BYPASS ?? '').trim().toLowerCase() === 'true';
}

export function scraperUserAgent(): string {
  const u = (db.getConfig('scraper_user_agent') ?? process.env.SCRAPER_USER_AGENT ?? '').trim();
  return u || HONEST_UA;
}

/** A response that says "you are a robot": the answer is "blocked", recorded as such, never a cue to escalate. */
export function looksBlocked(status: number, body: string): boolean {
  if (status === 401 || status === 403 || status === 429) return true;
  return /just a moment\.\.\.|cf-chl|challenge-platform|attention required|access denied|captcha|are you a robot|px-captcha|datadome/i.test(body.slice(0, 20_000))
    && !/application\/ld\+json/i.test(body);
}
