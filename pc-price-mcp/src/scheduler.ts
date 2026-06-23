/**
 * Background price refresh scheduler.
 * Runs on a configurable interval; auto-starts when the MCP server starts.
 * Configuration stored in the DB config table (auto_refresh_interval_minutes).
 * Sends notifications for alerts, price drops (≥5%), and restock events.
 */
import * as db from './db.js';
import { searchWithRetry } from './sources/pricesapi.js';
import { notifyAll } from './notifications.js';

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let lastRunAt: Date | null = null;
let nextRunAt: Date | null = null;
let runCount = 0;

export function getSchedulerStatus() {
  const intervalStr = db.getConfig('auto_refresh_interval_minutes');
  const intervalMinutes = intervalStr ? Number(intervalStr) : null;
  return {
    active: timer != null,
    intervalMinutes,
    lastRunAt: lastRunAt?.toISOString() ?? null,
    nextRunAt: nextRunAt?.toISOString() ?? null,
    runCount,
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
    if (running) return;
    running = true;
    lastRunAt = new Date();
    runCount++;
    const intervalMs2 = (Number(db.getConfig('auto_refresh_interval_minutes') ?? 60)) * 60_000;
    nextRunAt = new Date(Date.now() + intervalMs2);

    try {
      await scheduledRefreshAll();
    } catch { /* keep scheduler alive on error */ }

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

async function scheduledRefreshAll(): Promise<void> {
  const components = db.getTrackedComponents();
  if (components.length === 0) return;

  const country = db.getConfig('default_country') ?? 'gb';
  const dropThresholdPct = Number(db.getConfig('notify_drop_percent') ?? 5);

  for (const component of components) {
    try {
      // Snapshot previous state before refresh
      const prevLatest = db.getLatestPricePerRetailer(component.id);
      const prevBestPrice = prevLatest[0]?.price ?? null;
      const prevStockMap = new Map(prevLatest.map(r => [r.retailer, r.in_stock === 1]));

      const { products } = await searchWithRetry(component.search_query, country, 3, 15);
      const snapshots: db.PriceSnapshot[] = [];

      for (const product of products) {
        for (const offer of product.offers) {
          if (offer.price > 0) {
            snapshots.push({
              source: 'pricesapi', price: offer.price, currency: offer.currency,
              retailer: offer.merchant, url: offer.url || null, inStock: offer.inStock,
            });
          }
        }
      }

      if (snapshots.length === 0) { await sleep(2_000); continue; }

      // Detect stock changes before saving
      for (const snap of snapshots) {
        const wasInStock = prevStockMap.get(snap.retailer);
        if (wasInStock === true && !snap.inStock) {
          db.recordStockChange(component.id, snap.retailer, true, false, snap.price);
        } else if (wasInStock === false && snap.inStock) {
          db.recordStockChange(component.id, snap.retailer, false, true, snap.price);
          // Check waitlist
          if (db.isOnWaitlist(component.id, snap.retailer, snap.price)) {
            await notifyAll({ type: 'restock', componentName: component.name,
              price: snap.price, currency: snap.currency, retailer: snap.retailer, url: snap.url });
          }
        }
      }

      db.savePriceSnapshots(component.id, snapshots);
      db.markLastChecked(component.id);

      const newBest = db.getLatestPricePerRetailer(component.id)[0];
      if (!newBest) { await sleep(2_000); continue; }

      // Price alert check
      if (component.alert_price != null && newBest.price <= component.alert_price) {
        await notifyAll({ type: 'price_alert', componentName: component.name,
          price: newBest.price, currency: newBest.currency, retailer: newBest.retailer,
          alertThreshold: component.alert_price, url: newBest.url });
      }

      // Price drop notification (vs previous best, must exceed threshold %)
      if (prevBestPrice != null && newBest.price < prevBestPrice) {
        const dropPct = ((prevBestPrice - newBest.price) / prevBestPrice) * 100;
        if (dropPct >= dropThresholdPct) {
          await notifyAll({ type: 'price_drop', componentName: component.name,
            price: newBest.price, currency: newBest.currency, retailer: newBest.retailer,
            dropAmount: prevBestPrice - newBest.price, dropPercent: dropPct, url: newBest.url });
        }
      }

      // Throttle between components — PricesAPI free tier has per-minute limits
      await sleep(3_000);
    } catch { await sleep(2_000); }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
