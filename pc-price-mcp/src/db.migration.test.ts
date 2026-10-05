import { describe, it, expect, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('runMigrations: stock_state on a pre-existing (legacy) database', () => {
  it('adds the column and backfills it from in_stock without touching existing data', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pcpc-'));
    const file = join(dir, 'legacy.db');
    // Legacy shape: price_records as created before stock_state existed.
    const legacy = new Database(file);
    legacy.exec(`
      CREATE TABLE tracked_components (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'general', search_query TEXT NOT NULL, alert_price REAL, notes TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), last_checked TEXT);
      CREATE TABLE price_records (id INTEGER PRIMARY KEY AUTOINCREMENT, component_id INTEGER NOT NULL,
        source TEXT NOT NULL, price REAL NOT NULL, currency TEXT NOT NULL DEFAULT 'GBP', retailer TEXT NOT NULL,
        url TEXT, in_stock INTEGER NOT NULL DEFAULT 1, recorded_at TEXT NOT NULL DEFAULT (datetime('now')));
      INSERT INTO tracked_components (name, search_query) VALUES ('kit', 'ddr5');
      INSERT INTO price_records (component_id, source, price, retailer, in_stock) VALUES (1, 't', 893.99, 'scan', 1);
      INSERT INTO price_records (component_id, source, price, retailer, in_stock) VALUES (1, 't', 199.99, 'oos', 0);
    `);
    legacy.close();

    vi.resetModules();
    process.env.DB_PATH = file;
    try {
      const db = await import('./db.js');
      const cols = (db.getDb().prepare('PRAGMA table_info(price_records)').all() as { name: string }[]).map(c => c.name);
      expect(cols).toEqual(expect.arrayContaining(['stock_state', 'listing_name', 'kit_total_gb', 'modules', 'price_per_gb', 'profile_match', 'profile_flags']));
      const tcols = (db.getDb().prepare('PRAGMA table_info(tracked_components)').all() as { name: string }[]).map(c => c.name);
      expect(tcols).toContain('profile_id');
      const by = Object.fromEntries(db.getLatestPricePerRetailer(1).map(r => [r.retailer, [r.price, r.stock_state]]));
      expect(by).toEqual({ scan: [893.99, 'in_stock'], oos: [199.99, 'out_of_stock'] });
      expect(db.getBestInStockOffer(1)).toMatchObject({ retailer: 'scan' });
      // Opening again (second migration pass) is a no-op.
      expect(() => db.getDb()).not.toThrow();
    } finally {
      process.env.DB_PATH = ':memory:';
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
