/**
 * Express HTTP server — web dashboard for the UK PC Price MCP.
 * Binds to 0.0.0.0 so it's accessible on the local network (NAS use).
 * Serves static files from ../public and REST API at /api/*.
 */
import express, { Request, Response, NextFunction } from 'express';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import * as db from './db.js';
import { searchWithRetry } from './sources/pricesapi.js';
import { searchAllUkRetailers, ALL_RETAILER_IDS } from './sources/uk-retailers.js';
import { keepaSearch, keepaGetByAsin, keepaGetUsedPrices } from './sources/keepa.js';
import { awinSearch, awinGetMerchants, awinFeedSearch } from './sources/awin.js';
import { paapiSearch, paapiGetItems } from './sources/amazon-paapi.js';
import { ebayBrowseSearch, ebayBrowseGetItem, type EbayCondition } from './sources/ebay-browse.js';
import { searchAllPrebuiltRetailers, ALL_PREBUILT_RETAILER_IDS, PrebuiltRetailerId } from './sources/prebuilt-retailers.js';
import { getSchedulerStatus, restartScheduler, stopScheduler } from './scheduler.js';
import { notifyAll } from './notifications.js';
import { searchCex, getCexProduct } from './sources/cex.js';
import { searchDataset, browseDataset, DATASET_SLUGS, type DatasetSlug } from './sources/pcpartpicker-dataset.js';
import {
  exportPriceHistoryCsv, exportPriceHistoryJson,
  exportBuildCsv, exportBuildJson, exportTrackedComponentsCsv,
} from './export.js';
import { searchPcPartPicker, getPcPartPickerProductPrices } from './sources/pcpartpicker-live.js';
import { apifyScrapePcPartPicker, isApifyConfigured } from './sources/apify.js';
import { budgetBuilder, buildVsBuy, upgradeAdvisor, type UseCase } from './services/build-advisor.js';
import { checkCompatibility } from './services/compatibility.js';
import { findCpuBenchmark, findGpuBenchmark, CPU_BENCHMARKS, GPU_BENCHMARKS } from './data/benchmarks.js';
import { getDealScoresForAll } from './services/deal-scorer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PUBLIC_DIR = join(__dirname, '..', 'public');

// Wrap async route handlers — Express 5 propagates thrown errors automatically,
// but this keeps the pattern explicit and compatible with Express 4 too.
function h(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

// Express 5 types params as string | string[] — normalise to string.
function param(p: string | string[]): string {
  return Array.isArray(p) ? p[0] : p;
}

// DB config keys that map directly to environment variables used by the source modules.
const DB_KEY_TO_ENV: Record<string, string> = {
  prices_api_key:       'PRICES_API_KEY',
  ebay_client_id:       'EBAY_CLIENT_ID',
  ebay_client_secret:   'EBAY_CLIENT_SECRET',
  keepa_api_key:        'KEEPA_API_KEY',
  amazon_access_key:    'AMAZON_ACCESS_KEY',
  amazon_secret_key:    'AMAZON_SECRET_KEY',
  amazon_associate_tag: 'AMAZON_ASSOCIATE_TAG',
  awin_publisher_id:    'AWIN_PUBLISHER_ID',
  awin_api_key:         'AWIN_API_KEY',
  reddit_client_id:     'REDDIT_CLIENT_ID',
  reddit_client_secret: 'REDDIT_CLIENT_SECRET',
  youtube_api_key:      'YOUTUBE_API_KEY',
  bing_api_key:         'BING_API_KEY',
  anthropic_api_key:    'ANTHROPIC_API_KEY',
  camofox_url:          'CAMOFOX_URL',
  novada_browser_ws:    'NOVADA_BROWSER_WS',
  novada_api_key:       'NOVADA_API_KEY',
  gotify_server_url:    'GOTIFY_SERVER_URL',
  gotify_app_token:     'GOTIFY_APP_TOKEN',
  apprise_url:          'APPRISE_URL',
  openai_api_key:       'OPENAI_API_KEY',
  apify_api_token:      'APIFY_API_TOKEN',
};

function syncEnvFromDb(): void {
  const cfg = db.getAllConfig();
  for (const [dbKey, envVar] of Object.entries(DB_KEY_TO_ENV)) {
    if (cfg[dbKey]) {
      process.env[envVar] = cfg[dbKey];
    }
  }
}

export function startWebServer(port: number): void {
  const app = express();
  app.use(express.json());
  app.use(express.static(PUBLIC_DIR));

  // Seed process.env from any API keys previously saved in the DB.
  syncEnvFromDb();

  // ── Components ───────────────────────────────────────────────────────────

  app.get('/api/components', h(async (_req, res) => {
    const components = db.getTrackedComponents();
    const ids = components.map(c => c.id);
    const dealRatios = db.getBatchDealRatios(ids);
    const result = components.map(c => {
      const latest = db.getLatestPricePerRetailer(c.id);
      const best = latest[0] ?? null;
      const dr = dealRatios.get(c.id);
      return {
        ...c,
        best_price: best?.price ?? null,
        best_retailer: best?.retailer ?? null,
        best_in_stock: best?.in_stock ?? null,
        best_currency: best?.currency ?? 'GBP',
        best_url: best?.url ?? null,
        deal_ratio: dr?.deal_ratio ?? null,
        all_time_low: dr?.all_time_low ?? null,
        avg_30d: dr?.avg_30d ?? null,
      };
    });
    res.json(result);
  }));

  app.post('/api/components', h(async (req, res) => {
    const { name, search_query, category = 'other', alert_price, notes } = req.body;
    if (!name || !search_query) {
      res.status(400).json({ error: 'name and search_query are required' });
      return;
    }
    const component = db.addTrackedComponent(name, category, search_query,
      alert_price ? Number(alert_price) : undefined, notes);
    res.json(component);
  }));

  app.delete('/api/components/:id', h(async (req, res) => {
    const id = parseInt(param(req.params.id));
    const removed = db.removeTrackedComponent(id);
    res.json({ removed });
  }));

  app.patch('/api/components/:id/alert', h(async (req, res) => {
    const id = parseInt(param(req.params.id));
    const { alert_price } = req.body;
    db.updateAlertPrice(id, alert_price != null ? Number(alert_price) : null);
    res.json({ ok: true });
  }));

  app.post('/api/components/:id/refresh', h(async (req, res) => {
    const id = parseInt(param(req.params.id));
    const component = db.getTrackedComponentById(id);
    if (!component) { res.status(404).json({ error: 'Component not found' }); return; }

    const country = (req.body?.country as string) ?? db.getConfig('default_country') ?? 'gb';
    const { products } = await searchWithRetry(component.search_query, country, 3, 15);
    const snapshots: db.PriceSnapshot[] = [];

    for (const p of products) {
      for (const o of p.offers) {
        if (o.price > 0) {
          snapshots.push({
            source: 'pricesapi', price: o.price, currency: o.currency,
            retailer: o.merchant, url: o.url || null, inStock: o.inStock,
          });
        }
      }
    }
    if (snapshots.length > 0) {
      db.savePriceSnapshots(id, snapshots);
      db.markLastChecked(id);
    }

    const latest = db.getLatestPricePerRetailer(id);
    res.json({ saved: snapshots.length, products: products.length, latest });
  }));

  app.get('/api/components/:id/history', h(async (req, res) => {
    const id = parseInt(param(req.params.id));
    const days = parseInt(req.query.days as string) || 30;
    const history = db.getPriceHistory(id, days);
    const trend = db.getDailyPriceTrend(id, days);
    res.json({ history, trend });
  }));

  app.get('/api/dashboard/sparklines', h(async (_req, res) => {
    const components = db.getTrackedComponents();
    const ids = components.map(c => c.id);
    const sparklines = db.getBatchSparklines(ids, 7);
    const result: Record<number, { date: string; min_price: number }[]> = {};
    for (const [id, points] of sparklines) result[id] = points;
    res.json(result);
  }));

  app.get('/api/components/:id/stats', h(async (req, res) => {
    const id = parseInt(param(req.params.id));
    res.json(db.getPriceStats(id));
  }));

  app.get('/api/components/:id/latest', h(async (req, res) => {
    const id = parseInt(param(req.params.id));
    res.json(db.getLatestPricePerRetailer(id));
  }));

  // ── Search ───────────────────────────────────────────────────────────────

  app.get('/api/search/retailers', h(async (req, res) => {
    const query = req.query.q as string;
    if (!query) { res.status(400).json({ error: 'q is required' }); return; }
    const rawRetailers = req.query.retailers as string;
    const retailers = rawRetailers ? rawRetailers.split(',') : [...ALL_RETAILER_IDS];
    const results = await searchAllUkRetailers(query, retailers as Parameters<typeof searchAllUkRetailers>[1]);
    res.json(results);
  }));

  app.get('/api/search/api', h(async (req, res) => {
    const query = req.query.q as string;
    if (!query) { res.status(400).json({ error: 'q is required' }); return; }
    const country = (req.query.country as string) ?? 'gb';
    const result = await searchWithRetry(query, country, 5, 10);
    res.json(result);
  }));

  // ── Builds ───────────────────────────────────────────────────────────────

  app.get('/api/builds', h(async (_req, res) => {
    const builds = db.getBuilds();
    const result = builds.map(b => {
      const summary = db.getBuildSummary(b.id);
      return {
        ...b,
        item_count: summary?.items.length ?? 0,
        total_cost: summary?.totalCost ?? 0,
        missing_prices: summary?.missingPrices ?? 0,
      };
    });
    res.json(result);
  }));

  app.post('/api/builds', h(async (req, res) => {
    const { name, description } = req.body;
    if (!name) { res.status(400).json({ error: 'name is required' }); return; }
    res.json(db.createBuild(name, description));
  }));

  app.get('/api/builds/:id', h(async (req, res) => {
    const id = parseInt(param(req.params.id));
    const summary = db.getBuildSummary(id);
    if (!summary) { res.status(404).json({ error: 'Build not found' }); return; }
    // Convert Map to plain object for JSON serialisation
    const bestPrices: Record<number, unknown> = {};
    for (const [cid, p] of summary.bestPrices) bestPrices[cid] = p;
    res.json({ ...summary, bestPrices });
  }));

  app.delete('/api/builds/:id', h(async (req, res) => {
    const id = parseInt(param(req.params.id));
    db.deleteBuild(id);
    res.json({ ok: true });
  }));

  app.post('/api/builds/:id/items', h(async (req, res) => {
    const buildId = parseInt(param(req.params.id));
    const { component_id, quantity = 1, notes } = req.body;
    if (!component_id) { res.status(400).json({ error: 'component_id is required' }); return; }
    db.addBuildItem(buildId, parseInt(component_id), parseInt(quantity), notes);
    res.json({ ok: true });
  }));

  app.delete('/api/builds/:buildId/items/:componentId', h(async (req, res) => {
    db.removeBuildItem(parseInt(param(req.params.buildId)), parseInt(param(req.params.componentId)));
    res.json({ ok: true });
  }));

  // ── Scheduler ─────────────────────────────────────────────────────────────

  app.get('/api/scheduler', h(async (_req, res) => {
    res.json(getSchedulerStatus());
  }));

  app.post('/api/scheduler', h(async (req, res) => {
    const mins = parseInt(req.body.interval_minutes);
    if (isNaN(mins) || mins === 0) {
      db.deleteConfig('auto_refresh_interval_minutes');
      stopScheduler();
      res.json({ ok: true, active: false });
    } else if (mins < 1) {
      res.status(400).json({ error: 'Minimum interval is 1 minute' });
    } else {
      db.setConfig('auto_refresh_interval_minutes', String(mins));
      restartScheduler();
      res.json({ ok: true, active: true, intervalMinutes: mins });
    }
  }));

  // ── Config ────────────────────────────────────────────────────────────────

  app.get('/api/config', h(async (_req, res) => {
    res.json(db.getAllConfig());
  }));

  app.post('/api/config', h(async (req, res) => {
    const { key, value } = req.body;
    if (!key) { res.status(400).json({ error: 'key is required' }); return; }
    if (value === null || value === '' || value === undefined) {
      db.deleteConfig(key);
      if (DB_KEY_TO_ENV[key]) delete process.env[DB_KEY_TO_ENV[key]];
    } else {
      db.setConfig(key, String(value));
      if (DB_KEY_TO_ENV[key]) process.env[DB_KEY_TO_ENV[key]] = String(value);
    }
    if (key === 'auto_refresh_interval_minutes') restartScheduler();
    res.json({ ok: true });
  }));

  // ── Notifications ─────────────────────────────────────────────────────────

  app.post('/api/notifications/test', h(async (_req, res) => {
    const result = await notifyAll({
      type: 'test',
      componentName: 'Test Component',
      message: 'Test notification from UK PC Price MCP web dashboard.',
    });
    res.json(result);
  }));

  // ── Price intelligence ────────────────────────────────────────────────────

  app.get('/api/alerts', h(async (_req, res) => {
    res.json(db.getComponentsBelowAlertPrice());
  }));

  app.get('/api/price-drops', h(async (req, res) => {
    const minPct = parseFloat(req.query.min_percent as string) || 2;
    res.json(db.getRecentPriceDrops(minPct));
  }));

  app.get('/api/stock-changes', h(async (req, res) => {
    const hours = parseInt(req.query.hours as string) || 24;
    res.json(db.getRecentStockChanges(hours));
  }));

  // ── Waitlist ──────────────────────────────────────────────────────────────

  app.get('/api/waitlist', h(async (_req, res) => {
    res.json(db.getWaitlist());
  }));

  app.post('/api/waitlist', h(async (req, res) => {
    const { component_id, retailer, max_price } = req.body;
    if (!component_id) { res.status(400).json({ error: 'component_id is required' }); return; }
    const item = db.addToWaitlist(parseInt(component_id), retailer, max_price);
    res.json(item);
  }));

  app.delete('/api/waitlist/:componentId', h(async (req, res) => {
    db.removeFromWaitlist(parseInt(param(req.params.componentId)));
    res.json({ ok: true });
  }));

  // ── Prebuilt systems ──────────────────────────────────────────────────────

  app.get('/api/prebuilts', h(async (_req, res) => {
    const systems = db.getPrebuiltSystems();
    const result = systems.map(s => {
      const latest = db.getLatestPrebuiltPricePerRetailer(s.id);
      const best = latest[0] ?? null;
      return { ...s, best_price: best?.price ?? null, best_retailer: best?.retailer ?? null, best_in_stock: best?.in_stock ?? null, best_url: best?.url ?? null };
    });
    res.json(result);
  }));

  app.post('/api/prebuilts', h(async (req, res) => {
    const { name, search_query, category = 'gaming', brand, cpu, gpu, ram, storage, os, form_factor, alert_price, notes } = req.body;
    if (!name || !search_query) { res.status(400).json({ error: 'name and search_query are required' }); return; }
    const system = db.addPrebuiltSystem(name, category, search_query, {
      brand: brand ?? null, cpu: cpu ?? null, gpu: gpu ?? null,
      ram: ram ?? null, storage: storage ?? null, os: os ?? null, formFactor: form_factor ?? null,
      alertPrice: alert_price ? Number(alert_price) : null, notes: notes ?? null,
    });
    res.json(system);
  }));

  app.get('/api/prebuilts/:id', h(async (req, res) => {
    const id = parseInt(param(req.params.id));
    const system = db.getPrebuiltSystemById(id);
    if (!system) { res.status(404).json({ error: 'System not found' }); return; }
    const latest = db.getLatestPrebuiltPricePerRetailer(id);
    res.json({ ...system, latest });
  }));

  app.delete('/api/prebuilts/:id', h(async (req, res) => {
    const id = parseInt(param(req.params.id));
    const removed = db.removePrebuiltSystem(id);
    res.json({ removed });
  }));

  app.patch('/api/prebuilts/:id/alert', h(async (req, res) => {
    const id = parseInt(param(req.params.id));
    const { alert_price } = req.body;
    db.updatePrebuiltAlertPrice(id, alert_price != null ? Number(alert_price) : null);
    res.json({ ok: true });
  }));

  app.post('/api/prebuilts/:id/refresh', h(async (req, res) => {
    const id = parseInt(param(req.params.id));
    const system = db.getPrebuiltSystemById(id);
    if (!system) { res.status(404).json({ error: 'System not found' }); return; }
    const rawRetailers = req.body?.retailers as string[] | undefined;
    const retailers = (rawRetailers ?? ALL_PREBUILT_RETAILER_IDS) as PrebuiltRetailerId[];
    const searchResults = await searchAllPrebuiltRetailers(system.search_query, retailers);
    const snapshots: db.PrebuiltPriceSnapshot[] = [];
    for (const r of searchResults) {
      for (const p of r.results) {
        if (p.price && p.price > 0) {
          snapshots.push({ source: r.retailer, price: p.price, currency: p.currency, retailer: r.retailer, url: p.url, inStock: p.inStock });
        }
      }
    }
    if (snapshots.length > 0) { db.savePrebuiltPriceSnapshots(id, snapshots); db.markPrebuiltLastChecked(id); }
    const latest = db.getLatestPrebuiltPricePerRetailer(id);
    res.json({ saved: snapshots.length, retailers: searchResults.length, latest });
  }));

  app.get('/api/prebuilts/:id/history', h(async (req, res) => {
    const id = parseInt(param(req.params.id));
    const days = parseInt(req.query.days as string) || 30;
    const history = db.getPrebuiltPriceHistory(id, days);
    const trend = db.getPrebuiltDailyPriceTrend(id, days);
    res.json({ history, trend });
  }));

  app.get('/api/prebuilts/:id/stats', h(async (req, res) => {
    const id = parseInt(param(req.params.id));
    res.json(db.getPrebuiltPriceStats(id));
  }));

  app.get('/api/prebuilts/:id/latest', h(async (req, res) => {
    const id = parseInt(param(req.params.id));
    res.json(db.getLatestPrebuiltPricePerRetailer(id));
  }));

  app.get('/api/search/prebuilts', h(async (req, res) => {
    const query = req.query.q as string;
    if (!query) { res.status(400).json({ error: 'q is required' }); return; }
    const rawRetailers = req.query.retailers as string;
    const retailers = (rawRetailers ? rawRetailers.split(',') : [...ALL_PREBUILT_RETAILER_IDS]) as PrebuiltRetailerId[];
    const results = await searchAllPrebuiltRetailers(query, retailers);
    res.json(results);
  }));

  app.get('/api/prebuilts/alerts', h(async (_req, res) => {
    res.json(db.getPrebuiltsBelowAlertPrice());
  }));

  // ── Keepa ─────────────────────────────────────────────────────────────────

  app.get('/api/keepa/search', h(async (req, res) => {
    const { q, limit = '5' } = req.query as Record<string, string>;
    if (!q) { res.status(400).json({ error: 'q is required' }); return; }
    res.json(await keepaSearch(q, Math.min(parseInt(limit) || 5, 20)));
  }));

  app.get('/api/keepa/product/:asin', h(async (req, res) => {
    const product = await keepaGetByAsin(param(req.params.asin));
    if (!product) { res.status(404).json({ error: 'Product not found' }); return; }
    res.json(product);
  }));

  app.get('/api/keepa/product/:asin/used', h(async (req, res) => {
    res.json(await keepaGetUsedPrices(param(req.params.asin)));
  }));

  // ── AWIN ──────────────────────────────────────────────────────────────────

  app.get('/api/awin/search', h(async (req, res) => {
    const { q, max = '20' } = req.query as Record<string, string>;
    if (!q) { res.status(400).json({ error: 'q is required' }); return; }
    res.json(await awinSearch(q, Math.min(parseInt(max) || 20, 100)));
  }));

  app.get('/api/awin/merchants', h(async (_req, res) => {
    res.json(await awinGetMerchants());
  }));

  app.get('/api/awin/feed/:merchantId', h(async (req, res) => {
    const { q, max = '20' } = req.query as Record<string, string>;
    if (!q) { res.status(400).json({ error: 'q is required' }); return; }
    res.json(await awinFeedSearch(param(req.params.merchantId), q, parseInt(max) || 20));
  }));

  // ── Amazon PAAPI ──────────────────────────────────────────────────────────

  app.get('/api/amazon/search', h(async (req, res) => {
    const { q, index = 'Electronics', max = '10' } = req.query as Record<string, string>;
    if (!q) { res.status(400).json({ error: 'q is required' }); return; }
    res.json(await paapiSearch(q, index, Math.min(parseInt(max) || 10, 10)));
  }));

  app.get('/api/amazon/items', h(async (req, res) => {
    const { asins } = req.query as Record<string, string>;
    if (!asins) { res.status(400).json({ error: 'asins is required (comma-separated)' }); return; }
    res.json(await paapiGetItems(asins.split(',').map(s => s.trim()).slice(0, 10)));
  }));

  // ── eBay Browse API ───────────────────────────────────────────────────────

  app.get('/api/ebay/search', h(async (req, res) => {
    const { q, condition = 'any', max = '20' } = req.query as Record<string, string>;
    if (!q) { res.status(400).json({ error: 'q is required' }); return; }
    res.json(await ebayBrowseSearch(q, condition as EbayCondition, Math.min(parseInt(max) || 20, 200)));
  }));

  app.get('/api/ebay/item/:itemId', h(async (req, res) => {
    const item = await ebayBrowseGetItem(param(req.params.itemId));
    if (!item) { res.status(404).json({ error: 'Item not found' }); return; }
    res.json(item);
  }));

  // ── CeX UK ───────────────────────────────────────────────────────────────

  app.get('/api/cex/search', h(async (req, res) => {
    const { q, in_stock = 'false', limit = '25' } = req.query as Record<string, string>;
    if (!q) { res.status(400).json({ error: 'q is required' }); return; }
    res.json(await searchCex(q, in_stock === 'true', Math.min(parseInt(limit) || 25, 50)));
  }));

  app.get('/api/cex/product/:boxId', h(async (req, res) => {
    const product = await getCexProduct(param(req.params.boxId));
    if (!product) { res.status(404).json({ error: 'Product not found' }); return; }
    res.json(product);
  }));

  // ── Saved searches ────────────────────────────────────────────────────────

  app.get('/api/saved-searches', h(async (_req, res) => {
    res.json(db.getSavedSearches());
  }));

  app.post('/api/saved-searches', h(async (req, res) => {
    const { name, query, max_price, category } = req.body;
    if (!name || !query) { res.status(400).json({ error: 'name and query are required' }); return; }
    res.json(db.addSavedSearch(name, query, max_price ? Number(max_price) : null, category || null));
  }));

  app.delete('/api/saved-searches/:id', h(async (req, res) => {
    const removed = db.removeSavedSearch(parseInt(param(req.params.id)));
    res.json({ removed });
  }));

  // ── Parts database (docyx dataset) ───────────────────────────────────────

  app.get('/api/dataset/browse', h(async (req, res) => {
    const { part_type, priced_only = 'false', limit = '40' } = req.query as Record<string, string>;
    if (!part_type || !(DATASET_SLUGS as readonly string[]).includes(part_type)) {
      res.status(400).json({ error: `part_type must be one of: ${DATASET_SLUGS.join(', ')}` });
      return;
    }
    const result = await browseDataset(part_type as DatasetSlug, priced_only === 'true', Math.min(parseInt(limit) || 40, 100));
    res.json(result);
  }));

  app.get('/api/dataset/search', h(async (req, res) => {
    const { q, part_type, priced_only = 'false', limit = '40' } = req.query as Record<string, string>;
    if (!q) { res.status(400).json({ error: 'q is required' }); return; }
    if (!part_type || !(DATASET_SLUGS as readonly string[]).includes(part_type)) {
      res.status(400).json({ error: `part_type must be one of: ${DATASET_SLUGS.join(', ')}` });
      return;
    }
    const slug = part_type as DatasetSlug;
    const results = await searchDataset(q, slug, priced_only === 'true', Math.min(parseInt(limit) || 40, 100));
    res.json({ results, query: q, part_type: slug });
  }));

  app.get('/api/dataset/slugs', (_req, res) => {
    res.json({ slugs: DATASET_SLUGS });
  });

  // ── Component pause / resume / interval / unit pricing ───────────────────

  app.post('/api/components/:id/pause', h(async (req, res) => {
    db.pauseComponent(parseInt(param(req.params.id)));
    res.json({ ok: true, paused: true });
  }));

  app.post('/api/components/:id/resume', h(async (req, res) => {
    db.resumeComponent(parseInt(param(req.params.id)));
    res.json({ ok: true, paused: false });
  }));

  app.patch('/api/components/:id/interval', h(async (req, res) => {
    const id = parseInt(param(req.params.id));
    const minutes = req.body.minutes != null ? Number(req.body.minutes) : null;
    db.setComponentInterval(id, minutes);
    res.json({ ok: true, check_interval_minutes: minutes });
  }));

  app.patch('/api/components/:id/unit', h(async (req, res) => {
    const id = parseInt(param(req.params.id));
    const { quantity, unit_type } = req.body;
    db.setComponentUnitPricing(id, quantity != null ? Number(quantity) : null, unit_type ?? null);
    res.json({ ok: true });
  }));

  // ── Component URLs ────────────────────────────────────────────────────────

  app.get('/api/components/:id/urls', h(async (req, res) => {
    res.json(db.getComponentUrls(parseInt(param(req.params.id))));
  }));

  app.post('/api/components/:id/urls', h(async (req, res) => {
    const id = parseInt(param(req.params.id));
    const { url, retailer, label } = req.body;
    if (!url) { res.status(400).json({ error: 'url is required' }); return; }
    const record = db.addComponentUrl(id, url, retailer, label);
    res.json(record);
  }));

  app.delete('/api/component-urls/:urlId', h(async (req, res) => {
    const removed = db.removeComponentUrl(parseInt(param(req.params.urlId)));
    res.json({ removed });
  }));

  // ── Tags ──────────────────────────────────────────────────────────────────

  app.get('/api/tags', h(async (_req, res) => {
    res.json(db.getTags());
  }));

  app.post('/api/tags', h(async (req, res) => {
    const { name, color } = req.body;
    if (!name) { res.status(400).json({ error: 'name is required' }); return; }
    res.json(db.createTag(name, color));
  }));

  app.delete('/api/tags/:id', h(async (req, res) => {
    const removed = db.deleteTag(parseInt(param(req.params.id)));
    res.json({ removed });
  }));

  app.get('/api/components/:id/tags', h(async (req, res) => {
    res.json(db.getTagsForComponent(parseInt(param(req.params.id))));
  }));

  app.put('/api/components/:id/tags', h(async (req, res) => {
    const id = parseInt(param(req.params.id));
    const { tag_ids } = req.body;
    if (!Array.isArray(tag_ids)) { res.status(400).json({ error: 'tag_ids must be an array' }); return; }
    db.setComponentTags(id, tag_ids.map(Number));
    res.json({ ok: true });
  }));

  app.post('/api/components/:id/tags/:tagId', h(async (req, res) => {
    db.addTagToComponent(parseInt(param(req.params.id)), parseInt(param(req.params.tagId)));
    res.json({ ok: true });
  }));

  app.delete('/api/components/:id/tags/:tagId', h(async (req, res) => {
    db.removeTagFromComponent(parseInt(param(req.params.id)), parseInt(param(req.params.tagId)));
    res.json({ ok: true });
  }));

  // ── Needs attention ───────────────────────────────────────────────────────

  app.get('/api/needs-attention', h(async (_req, res) => {
    res.json(db.getComponentsNeedingAttention());
  }));

  // ── AI bootstrap: auto-detect selectors from a URL ───────────────────────

  app.post('/api/scrape-rules/bootstrap', h(async (req, res) => {
    const { url } = req.body;
    if (!url) { res.status(400).json({ error: 'url is required' }); return; }
    const { scrapeProductUrl } = await import('./sources/url-scraper.js');
    const result = await scrapeProductUrl(url);
    const domain = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } })();
    const existing = db.getScrapeRule(domain);
    res.json({ scraped: result, domain, rule: existing ?? null });
  }));

  // ── PCPartPicker live search ──────────────────────────────────────────────

  app.get('/api/pcpartpicker/search', h(async (req, res) => {
    const { category = 'gpu', q, limit = '20' } = req.query as Record<string, string>;
    const products = await searchPcPartPicker(category, q || undefined, Math.min(parseInt(limit) || 20, 50));
    res.json({ products, category, query: q ?? null, source: 'pcpartpicker-live' });
  }));

  app.get('/api/pcpartpicker/product', h(async (req, res) => {
    const { url } = req.query as Record<string, string>;
    if (!url) { res.status(400).json({ error: 'url is required' }); return; }
    const product = await getPcPartPickerProductPrices(url);
    if (!product) { res.status(404).json({ error: 'Product not found or scrape failed' }); return; }
    res.json(product);
  }));

  app.post('/api/pcpartpicker/apify', h(async (req, res) => {
    const { startUrls } = req.body;
    if (!Array.isArray(startUrls) || startUrls.length === 0) {
      res.status(400).json({ error: 'startUrls array is required' }); return;
    }
    if (!isApifyConfigured()) {
      res.status(400).json({ error: 'APIFY_API_TOKEN not configured — add it in Settings → API Keys' }); return;
    }
    const items = await apifyScrapePcPartPicker(startUrls.map(String));
    res.json({ items, count: items.length });
  }));

  // ── Import / export ───────────────────────────────────────────────────────

  app.post('/api/import/csv', h(async (req, res) => {
    const { csv } = req.body;
    if (typeof csv !== 'string' || !csv.trim()) {
      res.status(400).json({ error: 'csv string body field is required' }); return;
    }
    const lines = csv.trim().split('\n').filter(l => l.trim());
    if (lines.length < 2) {
      res.status(400).json({ error: 'CSV must have a header row and at least one data row' }); return;
    }

    const parseRow = (line: string): string[] => {
      const result: string[] = [];
      let current = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
          else { inQuotes = !inQuotes; }
        } else if (ch === ',' && !inQuotes) {
          result.push(current.trim()); current = '';
        } else { current += ch; }
      }
      result.push(current.trim());
      return result;
    };

    const headers = parseRow(lines[0]).map(h => h.toLowerCase());
    const idx = (names: string[]) => names.map(n => headers.indexOf(n)).find(i => i >= 0) ?? -1;
    const nameIdx   = idx(['name']);
    const queryIdx  = idx(['search_query', 'query', 'search']);
    const catIdx    = idx(['category']);
    const alertIdx  = idx(['alert_price', 'alert']);
    const notesIdx  = idx(['notes']);
    const urlIdx    = idx(['source_url', 'url']);

    if (nameIdx === -1) { res.status(400).json({ error: 'CSV must have a "name" column' }); return; }

    const rows: db.BulkImportRow[] = [];
    for (const line of lines.slice(1)) {
      const cols = parseRow(line);
      const name = cols[nameIdx]?.trim();
      if (!name) continue;
      rows.push({
        name,
        search_query: queryIdx >= 0 ? cols[queryIdx]?.trim() || name : name,
        category:     catIdx   >= 0 ? cols[catIdx]?.trim()   || 'other' : 'other',
        alert_price:  alertIdx >= 0 && cols[alertIdx] ? parseFloat(cols[alertIdx]) || null : null,
        notes:        notesIdx >= 0 ? cols[notesIdx]?.trim() || null : null,
        source_url:   urlIdx   >= 0 ? cols[urlIdx]?.trim()   || null : null,
      });
    }

    res.json(db.bulkImportComponents(rows));
  }));

  app.post('/api/import/json', h(async (req, res) => {
    const data = req.body;
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      res.status(400).json({ error: 'A JSON backup object is required' }); return;
    }
    const result = db.importFullBackupJson(data as Record<string, unknown>);
    res.json(result);
  }));

  app.get('/api/export/backup', h(async (_req, res) => {
    const backup = db.exportFullBackupJson();
    const filename = `pc-price-backup-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(backup);
  }));

  // ── Advisor ───────────────────────────────────────────────────────────────

  app.get('/api/advisor/budget', h(async (req, res) => {
    const { budget, use_case = 'gaming_1440p' } = req.query as Record<string, string>;
    if (!budget || isNaN(parseFloat(budget))) { res.status(400).json({ error: 'budget required' }); return; }
    const result = budgetBuilder(parseFloat(budget), use_case as UseCase);
    // Attach PassMark benchmark data for CPU and GPU rows
    const enriched = {
      ...result,
      allocations: result.allocations.map(a => {
        const benchmark =
          a.category === 'CPU' ? findCpuBenchmark(a.suggestion) :
          a.category === 'GPU' ? findGpuBenchmark(a.suggestion) :
          null;
        return { ...a, benchmark };
      }),
    };
    res.json(enriched);
  }));

  app.get('/api/advisor/deals', h(async (_req, res) => {
    res.json(getDealScoresForAll());
  }));

  app.get('/api/advisor/benchmark-compare', h(async (req, res) => {
    const { a, b, type = 'auto' } = req.query as Record<string, string>;
    if (!a || !b) { res.status(400).json({ error: 'a and b required' }); return; }
    const lookup = (q: string) =>
      type === 'cpu' ? findCpuBenchmark(q) :
      type === 'gpu' ? findGpuBenchmark(q) :
      findGpuBenchmark(q) ?? findCpuBenchmark(q);
    const ra = lookup(a);
    const rb = lookup(b);
    if (!ra || !rb) {
      res.status(404).json({ error: !ra ? `Not found: ${a}` : `Not found: ${b}` }); return;
    }
    const diff = Math.round(Math.abs(ra.score - rb.score) / Math.max(ra.score, rb.score) * 100);
    res.json({ a: ra, b: rb, faster: ra.score >= rb.score ? ra.name : rb.name, differencePercent: diff });
  }));

  const TIER_PRICES: Record<string, number> = {
    budget: 80, entry: 130, mid: 220, 'mid-high': 340, high: 520, ultra: 850,
  };
  app.get('/api/advisor/value', h(async (req, res) => {
    const { type = 'gpu', budget_max, budget_min = '0', top_n = '10' } = req.query as Record<string, string>;
    if (!budget_max) { res.status(400).json({ error: 'budget_max required' }); return; }
    const data = type === 'gpu' ? (GPU_BENCHMARKS as readonly object[]) : (CPU_BENCHMARKS as readonly object[]);
    const maxP = parseFloat(budget_max);
    const minP = parseFloat(budget_min);
    const results = (data as Array<{ name: string; score: number; tier: string }>)
      .map(c => ({ ...c, estimatedPrice: TIER_PRICES[c.tier] ?? 300, scorePerPound: 0 }))
      .map(c => ({ ...c, scorePerPound: Math.round(c.score / c.estimatedPrice) }))
      .filter(c => c.estimatedPrice >= minP && c.estimatedPrice <= maxP)
      .sort((a, b) => b.scorePerPound - a.scorePerPound)
      .slice(0, parseInt(top_n));
    res.json(results);
  }));

  app.post('/api/advisor/build-vs-buy', h(async (req, res) => {
    const { cpu, gpu, ram_gb, storage_gb } = req.body as Record<string, string | number>;
    res.json(buildVsBuy({
      cpu: cpu as string | undefined,
      gpu: gpu as string | undefined,
      ramGb: ram_gb ? Number(ram_gb) : undefined,
      storageGb: storage_gb ? Number(storage_gb) : undefined,
    }));
  }));

  app.post('/api/advisor/upgrade', h(async (req, res) => {
    const { current_cpu, current_gpu, budget, use_case = 'gaming_1440p' } = req.body as Record<string, string>;
    if (!current_cpu || !current_gpu || !budget) {
      res.status(400).json({ error: 'current_cpu, current_gpu, budget required' }); return;
    }
    res.json(upgradeAdvisor({
      currentCpu: current_cpu,
      currentGpu: current_gpu,
      budget: parseFloat(budget),
      useCase: use_case as UseCase,
    }));
  }));

  app.post('/api/advisor/compat', h(async (req, res) => {
    res.json(checkCompatibility(req.body));
  }));

  app.get('/api/benchmark', h(async (req, res) => {
    const { q, type = 'auto' } = req.query as Record<string, string>;
    if (!q) { res.status(400).json({ error: 'q required' }); return; }
    const result =
      type === 'cpu' ? findCpuBenchmark(q) :
      type === 'gpu' ? findGpuBenchmark(q) :
      findGpuBenchmark(q) ?? findCpuBenchmark(q);
    res.json(result ?? { error: 'not found' });
  }));

  // ── Health check ──────────────────────────────────────────────────────────

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), ts: new Date().toISOString() });
  });

  // ── Export ────────────────────────────────────────────────────────────────

  app.get('/api/export', h(async (req, res) => {
    const { type, format = 'csv', id, days = '90' } = req.query as Record<string, string>;
    const numId = id ? parseInt(id) : undefined;
    const numDays = parseInt(days) || 90;

    let filePath: string;
    if (type === 'price_history') {
      if (!numId) { res.status(400).json({ error: 'id required for price_history' }); return; }
      filePath = format === 'json' ? exportPriceHistoryJson(numId, numDays) : exportPriceHistoryCsv(numId, numDays);
    } else if (type === 'build') {
      if (!numId) { res.status(400).json({ error: 'id required for build' }); return; }
      filePath = format === 'json' ? exportBuildJson(numId) : exportBuildCsv(numId);
    } else {
      filePath = exportTrackedComponentsCsv();
    }

    res.download(filePath);
  }));

  // ── Error handler ─────────────────────────────────────────────────────────

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[web error]', err.message);
    res.status(500).json({ error: err.message });
  });

  app.listen(port, '0.0.0.0', () => {
    console.error(`[web] Dashboard → http://0.0.0.0:${port}`);
  });
}
