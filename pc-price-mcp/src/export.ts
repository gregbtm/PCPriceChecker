/**
 * CSV and JSON exporters for price history and build specs.
 * Output directory defaults to cwd; override with EXPORT_DIR env var.
 */
import { writeFileSync } from 'fs';
import { join } from 'path';
import * as db from './db.js';

const EXPORT_DIR = process.env.EXPORT_DIR ?? process.cwd();

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ── Price history ──────────────────────────────────────────────────────────

export function exportPriceHistoryCsv(componentId: number, days = 90): string {
  const component = db.getTrackedComponentById(componentId);
  if (!component) throw new Error(`Component ${componentId} not found`);
  const records = db.getPriceHistory(componentId, days);

  const rows = [
    'Date/Time (UTC),Retailer,Price,Currency,In Stock,Source,URL',
    ...records.map(r => [
      r.recorded_at, `"${r.retailer}"`, r.price.toFixed(2), r.currency,
      r.in_stock ? 'true' : 'false', r.source, r.url ? `"${r.url}"` : '',
    ].join(',')),
  ].join('\n');

  const filename = `price-history-${slug(component.name)}-${Date.now()}.csv`;
  const filePath = join(EXPORT_DIR, filename);
  writeFileSync(filePath, rows, 'utf-8');
  return filePath;
}

export function exportPriceHistoryJson(componentId: number, days = 90): string {
  const component = db.getTrackedComponentById(componentId);
  if (!component) throw new Error(`Component ${componentId} not found`);
  const records = db.getPriceHistory(componentId, days);
  const stats = db.getPriceStats(componentId);

  const data = {
    component: { id: component.id, name: component.name, category: component.category, search_query: component.search_query },
    stats: { all_time_low: stats.all_time_low, all_time_high: stats.all_time_high,
      avg_30d: stats.avg_30d, avg_7d: stats.avg_7d, total_records: stats.total_records },
    history: records.map(r => ({
      recorded_at: r.recorded_at, retailer: r.retailer, price: r.price,
      currency: r.currency, in_stock: r.in_stock === 1, source: r.source, url: r.url,
    })),
    exported_at: new Date().toISOString(),
  };

  const filename = `price-history-${slug(component.name)}-${Date.now()}.json`;
  const filePath = join(EXPORT_DIR, filename);
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return filePath;
}

// ── Build ──────────────────────────────────────────────────────────────────

export function exportBuildCsv(buildId: number): string {
  const summary = db.getBuildSummary(buildId);
  if (!summary) throw new Error(`Build ${buildId} not found`);

  const rows = [
    'Component,Category,Quantity,Best Price (GBP),Line Total,Retailer,In Stock,URL,Notes',
    ...summary.items.map(item => {
      const p = summary.bestPrices.get(item.component_id);
      return [
        `"${item.component_name}"`, item.component_category, item.quantity,
        p?.price.toFixed(2) ?? '', p ? (p.price * item.quantity).toFixed(2) : '',
        p ? `"${p.retailer}"` : '', p ? 'yes' : 'unknown',
        p?.url ? `"${p.url}"` : '', item.notes ? `"${item.notes}"` : '',
      ].join(',');
    }),
    `TOTAL,,,,,${summary.totalCost.toFixed(2)},,,,`,
  ].join('\n');

  const filename = `build-${slug(summary.build.name)}-${Date.now()}.csv`;
  const filePath = join(EXPORT_DIR, filename);
  writeFileSync(filePath, rows, 'utf-8');
  return filePath;
}

export function exportBuildJson(buildId: number): string {
  const summary = db.getBuildSummary(buildId);
  if (!summary) throw new Error(`Build ${buildId} not found`);

  const data = {
    build: { id: summary.build.id, name: summary.build.name, description: summary.build.description,
      created_at: summary.build.created_at },
    components: summary.items.map(item => {
      const p = summary.bestPrices.get(item.component_id);
      return { id: item.component_id, name: item.component_name, category: item.component_category,
        search_query: item.component_search_query, quantity: item.quantity, notes: item.notes,
        best_price: p?.price ?? null, line_total: p ? p.price * item.quantity : null,
        currency: p?.currency ?? 'GBP', retailer: p?.retailer ?? null, url: p?.url ?? null };
    }),
    total_cost: summary.totalCost, currency: summary.currency,
    missing_prices: summary.missingPrices, exported_at: new Date().toISOString(),
  };

  const filename = `build-${slug(summary.build.name)}-${Date.now()}.json`;
  const filePath = join(EXPORT_DIR, filename);
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
  return filePath;
}

// ── Tracked components list ────────────────────────────────────────────────

export function exportTrackedComponentsCsv(): string {
  const components = db.getTrackedComponents();
  const rows = [
    'ID,Name,Category,Search Query,Alert Price (GBP),Best Current Price,Retailer,Last Checked,Notes',
    ...components.map(c => {
      const best = db.getLatestPricePerRetailer(c.id)[0];
      return [
        c.id, `"${c.name}"`, c.category, `"${c.search_query}"`,
        c.alert_price?.toFixed(2) ?? '', best?.price.toFixed(2) ?? '',
        best ? `"${best.retailer}"` : '', c.last_checked ?? '',
        c.notes ? `"${c.notes}"` : '',
      ].join(',');
    }),
  ].join('\n');

  const filename = `tracked-components-${Date.now()}.csv`;
  const filePath = join(EXPORT_DIR, filename);
  writeFileSync(filePath, rows, 'utf-8');
  return filePath;
}
