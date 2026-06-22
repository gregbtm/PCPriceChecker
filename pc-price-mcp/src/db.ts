import Database from 'better-sqlite3';
import { mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_DIR = join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH ?? join(DEFAULT_DB_DIR, 'pc-prices.db');

export interface TrackedComponent {
  id: number;
  name: string;
  category: string;
  search_query: string;
  alert_price: number | null;
  notes: string | null;
  created_at: string;
  last_checked: string | null;
}

export interface PriceRecord {
  id: number;
  component_id: number;
  source: string;
  price: number;
  currency: string;
  retailer: string;
  url: string | null;
  in_stock: number;
  recorded_at: string;
}

export interface PriceSnapshot {
  source: string;
  price: number;
  currency: string;
  retailer: string;
  url: string | null;
  inStock: boolean;
}

export interface Build {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface BuildItem {
  id: number;
  build_id: number;
  component_id: number;
  quantity: number;
  notes: string | null;
  added_at: string;
}

export interface BuildItemWithComponent extends BuildItem {
  component_name: string;
  component_category: string;
  component_search_query: string;
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    const dir = dirname(DB_PATH);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tracked_components (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL,
      category    TEXT    NOT NULL DEFAULT 'general',
      search_query TEXT   NOT NULL,
      alert_price REAL,
      notes       TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      last_checked TEXT
    );

    CREATE TABLE IF NOT EXISTS price_records (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      component_id INTEGER NOT NULL REFERENCES tracked_components(id) ON DELETE CASCADE,
      source       TEXT    NOT NULL,
      price        REAL    NOT NULL,
      currency     TEXT    NOT NULL DEFAULT 'GBP',
      retailer     TEXT    NOT NULL,
      url          TEXT,
      in_stock     INTEGER NOT NULL DEFAULT 1,
      recorded_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS builds (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT    NOT NULL UNIQUE,
      description TEXT,
      created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS build_items (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      build_id     INTEGER NOT NULL REFERENCES builds(id) ON DELETE CASCADE,
      component_id INTEGER NOT NULL REFERENCES tracked_components(id) ON DELETE CASCADE,
      quantity     INTEGER NOT NULL DEFAULT 1,
      notes        TEXT,
      added_at     TEXT    NOT NULL DEFAULT (datetime('now')),
      UNIQUE(build_id, component_id)
    );

    CREATE INDEX IF NOT EXISTS idx_price_component_time
      ON price_records(component_id, recorded_at DESC);

    CREATE INDEX IF NOT EXISTS idx_price_component_retailer
      ON price_records(component_id, retailer, source);
  `);
}

// ── Tracked components ─────────────────────────────────────────────────────

export function addTrackedComponent(
  name: string,
  category: string,
  searchQuery: string,
  alertPrice?: number | null,
  notes?: string | null,
): TrackedComponent {
  return getDb()
    .prepare(`
      INSERT INTO tracked_components (name, category, search_query, alert_price, notes)
      VALUES (?, ?, ?, ?, ?)
      RETURNING *
    `)
    .get(name, category, searchQuery, alertPrice ?? null, notes ?? null) as TrackedComponent;
}

export function getTrackedComponents(): TrackedComponent[] {
  return getDb()
    .prepare('SELECT * FROM tracked_components ORDER BY name ASC')
    .all() as TrackedComponent[];
}

export function getTrackedComponentById(id: number): TrackedComponent | undefined {
  return getDb()
    .prepare('SELECT * FROM tracked_components WHERE id = ?')
    .get(id) as TrackedComponent | undefined;
}

export function removeTrackedComponent(id: number): boolean {
  return getDb().prepare('DELETE FROM tracked_components WHERE id = ?').run(id).changes > 0;
}

export function updateAlertPrice(id: number, alertPrice: number | null): boolean {
  return getDb()
    .prepare('UPDATE tracked_components SET alert_price = ? WHERE id = ?')
    .run(alertPrice, id).changes > 0;
}

export function markLastChecked(id: number): void {
  getDb()
    .prepare("UPDATE tracked_components SET last_checked = datetime('now') WHERE id = ?")
    .run(id);
}

// ── Price records ──────────────────────────────────────────────────────────

export function savePriceSnapshots(componentId: number, snapshots: PriceSnapshot[]): void {
  const db = getDb();
  const insert = db.prepare(`
    INSERT INTO price_records (component_id, source, price, currency, retailer, url, in_stock)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  db.transaction((snaps: PriceSnapshot[]) => {
    for (const s of snaps) {
      insert.run(componentId, s.source, s.price, s.currency, s.retailer, s.url ?? null, s.inStock ? 1 : 0);
    }
  })(snapshots);
}

export function getPriceHistory(componentId: number, days = 30): PriceRecord[] {
  return getDb()
    .prepare(`
      SELECT * FROM price_records
      WHERE component_id = ?
        AND recorded_at >= datetime('now', ? || ' days')
      ORDER BY recorded_at DESC
      LIMIT 1000
    `)
    .all(componentId, `-${days}`) as PriceRecord[];
}

export function getLatestPricePerRetailer(componentId: number): PriceRecord[] {
  return getDb()
    .prepare(`
      SELECT p.* FROM price_records p
      INNER JOIN (
        SELECT retailer, source, MAX(recorded_at) AS max_date
        FROM price_records
        WHERE component_id = ?
        GROUP BY retailer, source
      ) latest
        ON p.retailer = latest.retailer
       AND p.source   = latest.source
       AND p.recorded_at = latest.max_date
      WHERE p.component_id = ?
      ORDER BY p.price ASC
    `)
    .all(componentId, componentId) as PriceRecord[];
}

export interface PriceTrend {
  date: string;
  min_price: number;
  max_price: number;
  avg_price: number;
  record_count: number;
}

export function getDailyPriceTrend(componentId: number, days = 30): PriceTrend[] {
  return getDb()
    .prepare(`
      SELECT
        date(recorded_at) AS date,
        MIN(price)        AS min_price,
        MAX(price)        AS max_price,
        ROUND(AVG(price), 2) AS avg_price,
        COUNT(*)          AS record_count
      FROM price_records
      WHERE component_id = ?
        AND recorded_at >= datetime('now', ? || ' days')
      GROUP BY date(recorded_at)
      ORDER BY date ASC
    `)
    .all(componentId, `-${days}`) as PriceTrend[];
}

// ── Price intelligence ─────────────────────────────────────────────────────

export interface PriceStats {
  component_id: number;
  all_time_low: number | null;
  all_time_high: number | null;
  avg_30d: number | null;
  avg_7d: number | null;
  current_best: number | null;
  prev_best_24h: number | null;
  total_records: number;
  oldest_record: string | null;
  currency: string;
}

export function getPriceStats(componentId: number): PriceStats {
  const db = getDb();

  const stats = db.prepare(`
    SELECT
      MIN(price)                                                              AS all_time_low,
      MAX(price)                                                              AS all_time_high,
      ROUND(AVG(CASE WHEN recorded_at >= datetime('now', '-30 days') THEN price END), 2) AS avg_30d,
      ROUND(AVG(CASE WHEN recorded_at >= datetime('now', '-7 days')  THEN price END), 2) AS avg_7d,
      COUNT(*)                                                                AS total_records,
      MIN(recorded_at)                                                        AS oldest_record,
      MAX(currency)                                                           AS currency
    FROM price_records
    WHERE component_id = ?
  `).get(componentId) as any;

  // Current best (in last 48h so it reflects a "now" price)
  const currentRow = db.prepare(`
    SELECT MIN(price) AS price FROM price_records
    WHERE component_id = ? AND recorded_at >= datetime('now', '-48 hours')
  `).get(componentId) as any;

  // Previous best (24–96h ago) for change comparison
  const prevRow = db.prepare(`
    SELECT MIN(price) AS price FROM price_records
    WHERE component_id = ?
      AND recorded_at >= datetime('now', '-96 hours')
      AND recorded_at <  datetime('now', '-24 hours')
  `).get(componentId) as any;

  return {
    component_id: componentId,
    all_time_low: stats?.all_time_low ?? null,
    all_time_high: stats?.all_time_high ?? null,
    avg_30d: stats?.avg_30d ?? null,
    avg_7d: stats?.avg_7d ?? null,
    current_best: currentRow?.price ?? null,
    prev_best_24h: prevRow?.price ?? null,
    total_records: stats?.total_records ?? 0,
    oldest_record: stats?.oldest_record ?? null,
    currency: stats?.currency ?? 'GBP',
  };
}

export interface PriceDrop {
  component: TrackedComponent;
  currentBest: number;
  previousBest: number;
  dropAmount: number;
  dropPercent: number;
  currency: string;
  bestRetailer: string;
  bestUrl: string | null;
}

export function getRecentPriceDrops(minDropPercent = 2): PriceDrop[] {
  const components = getTrackedComponents();
  const drops: PriceDrop[] = [];

  for (const c of components) {
    const stats = getPriceStats(c.id);
    if (
      stats.current_best == null ||
      stats.prev_best_24h == null ||
      stats.current_best >= stats.prev_best_24h
    ) continue;

    const dropAmount = stats.prev_best_24h - stats.current_best;
    const dropPercent = (dropAmount / stats.prev_best_24h) * 100;
    if (dropPercent < minDropPercent) continue;

    const latest = getLatestPricePerRetailer(c.id);
    const best = latest[0];
    drops.push({
      component: c,
      currentBest: stats.current_best,
      previousBest: stats.prev_best_24h,
      dropAmount,
      dropPercent,
      currency: stats.currency,
      bestRetailer: best?.retailer ?? 'Unknown',
      bestUrl: best?.url ?? null,
    });
  }

  return drops.sort((a, b) => b.dropPercent - a.dropPercent);
}

// ── Alert candidates ───────────────────────────────────────────────────────

export interface AlertCandidate {
  component: TrackedComponent;
  currentBestPrice: number;
  currency: string;
  retailer: string;
  url: string | null;
  dropPercent: number;
}

export function getComponentsBelowAlertPrice(): AlertCandidate[] {
  const components = getTrackedComponents().filter(c => c.alert_price != null);
  const results: AlertCandidate[] = [];

  for (const c of components) {
    const latest = getLatestPricePerRetailer(c.id);
    if (latest.length === 0) continue;
    const best = latest[0];
    if (best.price <= c.alert_price!) {
      results.push({
        component: c,
        currentBestPrice: best.price,
        currency: best.currency,
        retailer: best.retailer,
        url: best.url,
        dropPercent: Math.round(((c.alert_price! - best.price) / c.alert_price!) * 100),
      });
    }
  }
  return results;
}

// ── Builds ─────────────────────────────────────────────────────────────────

export function createBuild(name: string, description?: string | null): Build {
  return getDb()
    .prepare(`
      INSERT INTO builds (name, description)
      VALUES (?, ?)
      RETURNING *
    `)
    .get(name, description ?? null) as Build;
}

export function getBuilds(): Build[] {
  return getDb().prepare('SELECT * FROM builds ORDER BY name ASC').all() as Build[];
}

export function getBuildById(id: number): Build | undefined {
  return getDb().prepare('SELECT * FROM builds WHERE id = ?').get(id) as Build | undefined;
}

export function deleteBuild(id: number): boolean {
  return getDb().prepare('DELETE FROM builds WHERE id = ?').run(id).changes > 0;
}

export function renameBuild(id: number, name: string, description?: string | null): boolean {
  return getDb()
    .prepare(`UPDATE builds SET name = ?, description = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(name, description ?? null, id).changes > 0;
}

export function addBuildItem(
  buildId: number,
  componentId: number,
  quantity = 1,
  notes?: string | null,
): BuildItem {
  return getDb()
    .prepare(`
      INSERT INTO build_items (build_id, component_id, quantity, notes)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(build_id, component_id) DO UPDATE SET quantity = excluded.quantity, notes = excluded.notes
      RETURNING *
    `)
    .get(buildId, componentId, quantity, notes ?? null) as BuildItem;
}

export function removeBuildItem(buildId: number, componentId: number): boolean {
  return getDb()
    .prepare('DELETE FROM build_items WHERE build_id = ? AND component_id = ?')
    .run(buildId, componentId).changes > 0;
}

export function getBuildItems(buildId: number): BuildItemWithComponent[] {
  return getDb()
    .prepare(`
      SELECT bi.*,
             tc.name     AS component_name,
             tc.category AS component_category,
             tc.search_query AS component_search_query
      FROM build_items bi
      JOIN tracked_components tc ON tc.id = bi.component_id
      WHERE bi.build_id = ?
      ORDER BY tc.category ASC, tc.name ASC
    `)
    .all(buildId) as BuildItemWithComponent[];
}

export interface BuildSummary {
  build: Build;
  items: BuildItemWithComponent[];
  bestPrices: Map<number, { price: number; currency: string; retailer: string; url: string | null }>;
  totalCost: number;
  currency: string;
  missingPrices: number;
}

export function getBuildSummary(buildId: number): BuildSummary | null {
  const build = getBuildById(buildId);
  if (!build) return null;

  const items = getBuildItems(buildId);
  const bestPrices = new Map<number, { price: number; currency: string; retailer: string; url: string | null }>();
  let totalCost = 0;
  let missingPrices = 0;

  for (const item of items) {
    const latest = getLatestPricePerRetailer(item.component_id);
    const best = latest[0];
    if (best) {
      const lineTotal = best.price * item.quantity;
      bestPrices.set(item.component_id, {
        price: best.price,
        currency: best.currency,
        retailer: best.retailer,
        url: best.url,
      });
      totalCost += lineTotal;
    } else {
      missingPrices++;
    }
  }

  return { build, items, bestPrices, totalCost, currency: 'GBP', missingPrices };
}
