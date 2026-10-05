/**
 * Background price refresh scheduler.
 * Runs on a configurable interval; auto-starts when the MCP server starts.
 * Configuration stored in the DB config table (auto_refresh_interval_minutes).
 * Sends notifications for alerts, price drops (≥5%), and restock events.
 */
import * as db from './db.js';
import { searchWithRetry } from './sources/pricesapi.js';
import { ebayBrowseSearch, ebayConfigured } from './sources/ebay-browse.js';
import { searchUkRetailer, ALL_RETAILER_IDS, type RetailerId } from './sources/uk-retailers.js';
import { scrapeProductUrl } from './sources/url-scraper.js';
import { notifyAll } from './notifications.js';
import { stockStateFromBoolean } from './services/stock-state.js';
import { refreshComponent, DEFAULT_SEARCH_RETAILERS, type RefreshDeps } from './services/refresh.js';
import { alertOnRepeatedFailures } from './services/scrape-health.js';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let lastRunAt: Date | null = null;
let nextRunAt: Date | null = null;
let runCount = 0;
let skippedTicks = 0;

export function getSchedulerStatus() {
  const intervalStr = db.getConfig('auto_refresh_interval_minutes');
  const intervalMinutes = intervalStr ? Number(intervalStr) : null;
  return {
    active: timer != null,
    intervalMinutes,
    lastRunAt: lastRunAt?.toISOString() ?? null,
    nextRunAt: nextRunAt?.toISOString() ?? null,
    runCount,
    skippedTicks,
    currentlyRunning: running,
  };
}

export function startScheduler(): boolean {
  let intervalStr = db.getConfig('auto_refresh_interval_minutes');

  // Bootstrap from env var on first run (no DB config yet)
  if (!intervalStr) {
    const envVal = process.env.SCHEDULER_INTERVAL_MINUTES?.trim();
    if (envVal) {
      const parsed = parseInt(envVal, 10);
      if (!isNaN(parsed) && parsed >= 1) {
        db.setConfig('auto_refresh_interval_minutes', String(parsed));
        intervalStr = String(parsed);
      }
    }
  }

  if (!intervalStr) return false;

  const intervalMs = Number(intervalStr) * 60_000;
  if (isNaN(intervalMs) || intervalMs < 60_000) return false; // minimum 1 minute

  stopScheduler();
  nextRunAt = new Date(Date.now() + intervalMs);

  timer = setInterval(async () => {
    if (running) { skippedTicks++; return; }   // previous run still going; counted, not silent (A-10)
    running = true;
    lastRunAt = new Date();
    runCount++;
    const intervalMs2 = (Number(db.getConfig('auto_refresh_interval_minutes') ?? 60)) * 60_000;
    nextRunAt = new Date(Date.now() + intervalMs2);

    try {
      await scheduledRefreshAll();
    } catch (e) {
      db.recordScrapeRun({ componentId: null, source: 'scheduler', ok: false, error: e instanceof Error ? e.message : String(e) });
    }

    running = false;
  }, intervalMs);

  return true;
}

export function stopScheduler(): void {
  if (timer) { clearInterval(timer); timer = null; nextRunAt = null; }
}

export function restartScheduler(): boolean {
  stopScheduler();
  return startScheduler();
}

// ── Core refresh loop ──────────────────────────────────────────────────────

const realDeps: RefreshDeps = {
  scrapeUrl: scrapeProductUrl,
  searchRetailer: (id, query) => searchUkRetailer(id, query),
  searchPricesApi: async (query, country) => {
    const { products } = await searchWithRetry(query, country, 3, 15);
    return products.flatMap(product => product.offers
      .filter(offer => offer.price > 0)
      .map(offer => ({
        source: 'pricesapi', price: offer.price, currency: offer.currency,
        retailer: offer.merchant, url: offer.url || null, inStock: offer.inStock,
        stockState: stockStateFromBoolean(offer.inStock),
      })));
  },
  pricesApiConfigured: () => !!process.env.PRICES_API_KEY?.trim(),
  ebayConfigured,
  // Condition 'any' unless ebay_allow_used is "false". Fixed-price listings only.
  searchEbay: (query) => ebayBrowseSearch(query, db.getConfig('ebay_allow_used') === 'false' ? 'new' : 'any', 100, { buyItNowOnly: true }),
  notify: notifyAll,
  sleep,
};

function configuredRetailers(): RetailerId[] {
  const raw = db.getConfig('scheduler_retailers') ?? process.env.SCHEDULER_RETAILERS;
  if (!raw) return DEFAULT_SEARCH_RETAILERS;
  const wanted = raw.split(',').map(x => x.trim().toLowerCase()).filter(Boolean);
  const valid = wanted.filter((x): x is RetailerId => (ALL_RETAILER_IDS as string[]).includes(x));
  return valid.length > 0 ? valid : DEFAULT_SEARCH_RETAILERS;
}

export async function scheduledRefreshAll(deps: RefreshDeps = realDeps): Promise<void> {
  const components = db.getTrackedComponents();
  if (components.length === 0) return;

  const ctx = {
    country: db.getConfig('default_country') ?? 'gb',
    dropThresholdPct: Number(db.getConfig('notify_drop_percent') ?? 5),
    retailers: configuredRetailers(),
  };
  const globalIntervalMs = Number(db.getConfig('auto_refresh_interval_minutes') ?? 60) * 60_000;

  for (const component of components) {
    if (component.paused) continue;

    // Respect per-component check interval
    if (component.check_interval_minutes != null && component.last_checked) {
      const componentIntervalMs = component.check_interval_minutes * 60_000;
      const elapsed = Date.now() - new Date(component.last_checked + 'Z').getTime();
      if (elapsed < Math.max(componentIntervalMs, globalIntervalMs)) continue;
    }

    try {
      await refreshComponent(component, ctx, deps);
    } catch (e) {
      // Never swallow silently (A-10): record it, flag the component, and let repeated failures notify.
      db.recordScrapeRun({ componentId: component.id, source: 'scheduler', ok: false,
        error: e instanceof Error ? e.message : String(e) });
      db.markScrapeFailed(component.id);
      await alertOnRepeatedFailures(component, ['scheduler'], deps.notify).catch(() => {});
    }
    await deps.sleep(3_000);
  }
  db.pruneScrapeRuns(30);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
