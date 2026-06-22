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
