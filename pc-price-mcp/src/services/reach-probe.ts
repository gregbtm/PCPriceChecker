/**
 * Reachability probe: what does each shop answer to THIS machine, with our honest identity? (docs/INTEGRATION_OPTIONS.md section 5.)
 *
 * Why: research agents got HTTP 200 from Scan, Box and others while the NAS got 403, so "which shops can we read" cannot be answered
 * from anywhere except the NAS. A table of measured answers decides which shops are worth asking to allow us, and which can be left.
 *
 * Polite by construction: only ever started by the owner (never on a schedule), at most three requests per shop (its robots.txt, the
 * first sitemap that robots.txt names, one page), 1.5 s apart, honest User-Agent, no retry, at most 4 KB / 16 KB of each body read.
 * A page its robots.txt disallows is not requested. A refusal (403, 429, a challenge page) is recorded as a refusal, never worked around.
 * Nothing is stored except status codes, sizes and times: no page content, and nothing that identifies this network.
 */
import * as db from '../db.js';
import { scraperUserAgent, looksBlocked } from './scrape-policy.js';
import { parseRobots, disallowingRule } from './robots.js';

export interface ProbeTarget { id: string; name: string; origin: string; page: string; sitemap?: string }

/** Pages are real product pages or listings checked in the research notes; where none is known, the homepage. */
export const PROBE_TARGETS: ProbeTarget[] = [
  { id: 'scan', name: 'Scan', origin: 'https://www.scan.co.uk', page: 'https://www.scan.co.uk/' },
  { id: 'overclockers', name: 'Overclockers', origin: 'https://www.overclockers.co.uk', page: 'https://www.overclockers.co.uk/' },
  { id: 'ccl', name: 'CCL', origin: 'https://www.cclonline.com', page: 'https://www.cclonline.com/' },
  { id: 'box', name: 'Box', origin: 'https://box.co.uk', page: 'https://box.co.uk/kf556s40ibk2-64-kingston-technology-fury-impact' },
  { id: 'laptopoutlet', name: 'LaptopOutlet', origin: 'https://www.laptopoutlet.co.uk', page: 'https://www.laptopoutlet.co.uk/kingston-impact-kf556s40ibk2-64.html' },
  { id: 'currys', name: 'Currys', origin: 'https://www.currys.co.uk', page: 'https://www.currys.co.uk/' },
  { id: 'ebuyer', name: 'Ebuyer', origin: 'https://www.ebuyer.com', page: 'https://www.ebuyer.com/' },
  { id: 'novatech', name: 'Novatech', origin: 'https://www.novatech.co.uk', page: 'https://www.novatech.co.uk/', sitemap: 'https://www.novatech.co.uk/sitemap-products.xml' },
  { id: 'awdit', name: 'AWD-IT', origin: 'https://www.awd-it.co.uk', page: 'https://www.awd-it.co.uk/crucial-64gb-2x32gb-ddr5-5600mt-s-cl46-sodimm-memory-black.html', sitemap: 'https://www.awd-it.co.uk/media/sitemap/sitemap.xml' },
  { id: 'wired2fire', name: 'Wired2Fire', origin: 'https://wired2fire.co.uk', page: 'https://wired2fire.co.uk/wp-json/wc/store/v1/products?search=so-dimm&per_page=1' },
  { id: 'insidetech', name: 'Inside-Tech', origin: 'https://inside-tech.co.uk', page: 'https://inside-tech.co.uk/wp-json/wc/store/v1/products?search=sodimm&per_page=1' },
  { id: 'buykingston', name: 'Buy Kingston', origin: 'https://www.buykingston.co.uk', page: 'https://www.buykingston.co.uk/kingston-fury-impact-kf556s40ibk2-64-64gb-32gb-x2-ddr5-5600mt-s-non-ecc-sodimm/' },
  { id: 'laptopsdirect', name: 'Laptops Direct', origin: 'https://www.laptopsdirect.co.uk', page: 'https://www.laptopsdirect.co.uk/ct/components/laptop-memory/ddr5' },
  { id: 'hotukdeals', name: 'HotUKDeals (RSS)', origin: 'https://www.hotukdeals.com', page: 'https://www.hotukdeals.com/rss/tag/ram' },
];

export interface ProbeStep {
  step: 'robots' | 'sitemap' | 'page';
  url: string;
  status: number | null;
  ok: boolean;
  /** A 401/403/429 or a bot-challenge page: the shop said no. */
  refused: boolean;
  bytes: number;
  ms: number;
  error?: string;
  skipped?: string;
}

export type ProbeVerdict = 'open' | 'refused' | 'disallowed' | 'unreachable' | 'partial';

export interface ProbeResult { id: string; name: string; verdict: ProbeVerdict; steps: ProbeStep[]; advice: string }
export interface ProbeRun { startedAt: string; finishedAt: string | null; userAgent: string; results: ProbeResult[] }

const GAP_MS = 1_500;
const SITEMAP_BYTES = 4_096;
const PAGE_BYTES = 16_384;
const KEY = 'reach_probe:last';

export interface ProbeDeps { fetchFn: typeof fetch; sleep: (ms: number) => Promise<void>; now: () => Date; targets: ProbeTarget[] }

/** Reads at most `max` bytes of the body, then stops the download. */
async function readHead(res: Response, max: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return (await res.text()).slice(0, max);
  const chunks: Uint8Array[] = [];
  let n = 0;
  while (n < max) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value); n += value.byteLength;
  }
  try { await reader.cancel(); } catch { /* already finished */ }
  return Buffer.concat(chunks).toString('utf8', 0, max);
}

async function request(step: ProbeStep['step'], url: string, max: number, d: ProbeDeps): Promise<{ s: ProbeStep; body: string }> {
  const t0 = Date.now();
  try {
    const res = await d.fetchFn(url, {
      headers: { 'User-Agent': scraperUserAgent(), Accept: step === 'robots' ? 'text/plain' : '*/*' },
      signal: AbortSignal.timeout(20_000),
    });
    const body = await readHead(res, max);
    const refused = looksBlocked(res.status, body);
    return { s: { step, url, status: res.status, ok: res.ok && !refused, refused, bytes: Buffer.byteLength(body), ms: Date.now() - t0 }, body };
  } catch (e) {
    return { s: { step, url, status: null, ok: false, refused: false, bytes: 0, ms: Date.now() - t0, error: (e as Error).message }, body: '' };
  }
}

const skipped = (step: ProbeStep['step'], url: string, why: string): ProbeStep => ({ step, url, status: null, ok: false, refused: false, bytes: 0, ms: 0, skipped: why });

export function verdictFor(steps: ProbeStep[]): ProbeVerdict {
  const page = steps.find(s => s.step === 'page')!;
  if (page.skipped?.startsWith('disallowed')) return 'disallowed';
  const ran = steps.filter(s => !s.skipped);
  if (ran.length > 0 && ran.every(s => s.status === null)) return 'unreachable';
  if (page.ok) return 'open';
  if (page.refused || ran.some(s => s.refused)) return 'refused';
  return 'partial';
}

const ADVICE: Record<ProbeVerdict, string> = {
  open: 'Answers us. Nothing to do.',
  refused: 'Reachable, but the shop refuses this address or identity. We do not work around that. Option: ask the shop to allow it (docs/INTEGRATION_OPTIONS.md section 5); it stays on the refused list and is tried once a day.',
  disallowed: 'Its robots.txt disallows this page, so it was not requested.',
  unreachable: 'No answer at all (network, DNS or timeout): check this machine\'s connection before drawing conclusions about the shop.',
  partial: 'Some requests worked and the page did not (moved, error or empty). Look at the steps.',
};

export async function probeTarget(t: ProbeTarget, d: ProbeDeps): Promise<ProbeResult> {
  const steps: ProbeStep[] = [];

  const robotsUrl = `${t.origin}/robots.txt`;
  const robots = await request('robots', robotsUrl, 64_000, d);
  steps.push(robots.s);

  // First sitemap the robots.txt names, else the one we know. Only its first 4 KB is read: enough to see XML or a challenge page.
  const named = robots.s.ok ? /^\s*sitemap:\s*(\S+)/im.exec(robots.body)?.[1] : undefined;
  const sitemapUrl = named ?? t.sitemap;
  if (sitemapUrl) { await d.sleep(GAP_MS); steps.push((await request('sitemap', sitemapUrl, SITEMAP_BYTES, d)).s); }
  else steps.push(skipped('sitemap', `${t.origin}/`, 'robots.txt names no sitemap and none is known'));

  // A 4xx robots.txt (or none) means no rules, per RFC 9309; a server error or no answer means do not fetch the page.
  const rules = robots.s.ok ? parseRobots(robots.body) : [];
  const robotsDown = robots.s.status === null || (robots.s.status ?? 0) >= 500;
  const pageUrl = new URL(t.page);
  const rule = robotsDown ? null : disallowingRule(rules, pageUrl.pathname + pageUrl.search);
  if (rule) steps.push(skipped('page', t.page, `disallowed by robots.txt (${rule})`));
  else if (robotsDown) steps.push(skipped('page', t.page, 'robots.txt could not be read (server error or no answer); not fetching the page'));
  else { await d.sleep(GAP_MS); steps.push((await request('page', t.page, PAGE_BYTES, d)).s); }

  const robotsUnreadable = steps.find(s => s.step === 'page')?.skipped?.startsWith('robots.txt could not');
  const verdict: ProbeVerdict = robotsUnreadable ? (robots.s.status === null ? 'unreachable' : 'partial') : verdictFor(steps);
  return { id: t.id, name: t.name, verdict, steps, advice: ADVICE[verdict] };
}

let running = false;
export const probeRunning = () => running;

export function loadProbe(): ProbeRun | null {
  try { return JSON.parse(db.getConfig(KEY) ?? 'null') as ProbeRun | null; } catch { return null; }
}

/** Runs the whole probe, one shop at a time, saving after each so a restart mid-run still leaves partial results. Returns false if one is already running. */
export async function runProbe(deps: Partial<ProbeDeps> = {}): Promise<boolean> {
  if (running) return false;
  running = true;
  const d: ProbeDeps = {
    fetchFn: deps.fetchFn ?? fetch,
    sleep: deps.sleep ?? (ms => new Promise(r => setTimeout(r, ms))),
    now: deps.now ?? (() => new Date()),
    targets: deps.targets ?? PROBE_TARGETS,
  };
  try {
    const run: ProbeRun = { startedAt: d.now().toISOString(), finishedAt: null, userAgent: scraperUserAgent(), results: [] };
    db.setConfig(KEY, JSON.stringify(run));
    for (const [i, t] of d.targets.entries()) {
      if (i > 0) await d.sleep(GAP_MS);
      run.results.push(await probeTarget(t, d));
      db.setConfig(KEY, JSON.stringify(run));
    }
    run.finishedAt = d.now().toISOString();
    db.setConfig(KEY, JSON.stringify(run));
    return true;
  } finally { running = false; }
}
