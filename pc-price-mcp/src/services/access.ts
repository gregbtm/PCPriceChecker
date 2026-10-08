/**
 * Optional access control for the dashboard API, and masking of stored secrets (roadmap B9, NEXT.md #1).
 *
 * Off by default: with no `app_token` (config) or APP_TOKEN (env) nothing changes. With one, every /api request except `/api/health`
 * (the container healthcheck) and `/api/auth/*` must carry it as `Authorization: Bearer <token>`, `X-API-Key: <token>` or the
 * `pcpc_token` cookie that `POST /api/auth/login` sets (HttpOnly, SameSite=Strict, so a page on another site cannot use it).
 * The dashboard's static files stay public: they hold no data, and the page needs to load to show its sign-in box.
 *
 * Masking is always on: `GET /api/config` used to return every stored secret in clear to anything that could reach the port.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import * as db from '../db.js';

export const MASK = '••••••••';

export function appToken(): string | null {
  const t = (db.getConfig('app_token') ?? process.env.APP_TOKEN ?? '').trim();
  return t || null;
}

const digest = (s: string) => createHash('sha256').update(s).digest();
export function tokenMatches(given: string | undefined | null, expected: string): boolean {
  if (!given) return false;
  return timingSafeEqual(digest(given), digest(expected));   // fixed-length digests: no length leak, no early exit
}

function cookieValue(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) { try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return null; } }
  }
  return null;
}

export function presentedToken(req: Pick<Request, 'headers'>): string | null {
  const auth = req.headers.authorization;
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  const key = req.headers['x-api-key'];
  if (typeof key === 'string' && key) return key.trim();
  return cookieValue(req.headers.cookie, 'pcpc_token');
}

export function isAuthorised(req: Pick<Request, 'headers'>): boolean {
  const expected = appToken();
  return expected == null || tokenMatches(presentedToken(req), expected);
}

const OPEN_PATHS = new Set(['/health', '/auth/login', '/auth/logout', '/auth/status']);

export function requireToken(req: Request, res: Response, next: NextFunction): void {
  if (appToken() == null || OPEN_PATHS.has(req.path) || isAuthorised(req)) { next(); return; }
  res.status(401).json({ error: 'unauthorised', hint: 'send the app token as "Authorization: Bearer <token>" or sign in on the dashboard' });
}

export function loginCookie(token: string): string {
  return `pcpc_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${30 * 86_400}`;
}
export const logoutCookie = 'pcpc_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0';

// ── Secret masking ─────────────────────────────────────────────────────────

/** Config keys whose values are credentials or contain one (a webhook path, a push-monitor token, a proxy login). */
const SECRET_KEY = /(api_key|_secret|secret$|token|password|passwd|_key$|webhook_url|apprise_url|heartbeat_url|novada_browser_ws|scrape_proxies)/i;
export const isSecretKey = (k: string) => SECRET_KEY.test(k);
export const isMasked = (v: unknown) => typeof v === 'string' && v.startsWith('••••');

/** A recognisable stub: the first dots then the last four characters, so "which key is this" is answerable without revealing it. */
export function maskValue(v: string): string {
  return v.length > 12 ? `${MASK}${v.slice(-4)}` : MASK;
}

export function maskConfig(all: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(all)) out[k] = isSecretKey(k) && v ? maskValue(v) : v;
  return out;
}
