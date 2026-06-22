#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ErrorCode,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import * as db from './db.js';
import { searchWithRetry } from './sources/pricesapi.js';
import { scrapeEbayGpuPrices, resolveGpuSlug, listSupportedGpus } from './sources/pcprice.js';

// ── Argument schemas ───────────────────────────────────────────────────────

const SearchSchema = z.object({
  query: z.string().min(1).describe('Component name or description, e.g. "RTX 4080" or "Ryzen 9 7950X"'),
  country: z.string().default('gb').describe('Two-letter country code (default: gb for UK)'),
  max_results: z.number().int().min(1).max(10).default(5).describe('Number of products to return (1–10)'),
  offers_per_product: z.number().int().min(1).max(20).default(10).describe('Retailer offers per product (1–20)'),
});

const TrackSchema = z.object({
  name: z.string().min(1).describe('Friendly display name, e.g. "RTX 4080 GPU"'),
  search_query: z.string().min(1).describe('Search query used for price lookups, e.g. "RTX 4080 16GB"'),
  category: z
    .enum(['gpu', 'cpu', 'ram', 'motherboard', 'storage', 'psu', 'case', 'cooling', 'monitor', 'other'])
    .default('other'),
  alert_price: z
    .number()
    .positive()
    .optional()
    .describe('Alert when price drops below this GBP value'),
  notes: z.string().optional().describe('Optional notes about this component'),
  fetch_now: z.boolean().default(true).describe('Fetch and store current prices immediately'),
  country: z.string().default('gb'),
});

const UntrackSchema = z.object({
  id: z.number().int().positive().describe('Tracked component ID (from list_tracked)'),
});

const SetAlertSchema = z.object({
  id: z.number().int().positive(),
  alert_price: z.number().positive().nullable().describe('GBP threshold; null to remove alert'),
});

const HistorySchema = z.object({
  id: z.number().int().positive(),
  days: z.number().int().min(1).max(365).default(30),
  show_trend: z.boolean().default(false).describe('Show daily min/avg/max trend instead of raw records'),
});

const LatestSchema = z.object({
  id: z.number().int().positive(),
});

const RefreshSchema = z.object({
  id: z.number().int().positive().optional().describe('Specific component ID to refresh; omit for all'),
  country: z.string().default('gb'),
});

const EbaySchema = z.object({
  query: z.string().min(1).describe('GPU model name, e.g. "RTX 4080" or "RX 7900 XTX"'),
  country: z.string().default('gb').describe('Two-letter country code for eBay market'),
});

// ── Helpers ────────────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency = 'GBP'): string {
  const symbols: Record<string, string> = { GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$' };
  const sym = symbols[currency] ?? `${currency} `;
  return `${sym}${amount.toFixed(2)}`;
}

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function err(message: string): never {
  throw new McpError(ErrorCode.InvalidRequest, message);
}

async function refreshComponent(
  component: db.TrackedComponent,
  country: string,
): Promise<{ saved: number; note: string }> {
  const { products } = await searchWithRetry(component.search_query, country, 3, 15);
  const snapshots: db.PriceSnapshot[] = [];

  for (const product of products) {
    for (const offer of product.offers) {
      if (offer.price > 0) {
        snapshots.push({
          source: 'pricesapi',
          price: offer.price,
          currency: offer.currency,
          retailer: offer.merchant,
          url: offer.url || null,
          inStock: offer.inStock,
        });
      }
    }
  }

  if (snapshots.length > 0) {
    db.savePriceSnapshots(component.id, snapshots);
    db.markLastChecked(component.id);
  }

  return {
    saved: snapshots.length,
    note: products.length === 0 ? 'No products found for this query' : `${products.length} products, ${snapshots.length} offers`,
  };
}

// ── Tool definitions ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: 'search_components',
    description:
      'Search for UK PC component prices across 40+ retailers (Amazon UK, Scan, Ebuyer, etc.) ' +
      'using PricesAPI.io. Cold queries can take 30–90s; cached queries return instantly. ' +
      'Results are not saved — use track_component to persist and monitor prices.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Component name, e.g. "RTX 4080 16GB" or "Ryzen 9 7950X"' },
        country: { type: 'string', description: 'Two-letter country code (default: gb)', default: 'gb' },
        max_results: { type: 'number', description: 'Products to return (1–10)', default: 5 },
        offers_per_product: { type: 'number', description: 'Retailer offers per product (1–20)', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'track_component',
    description:
      'Add a PC component to your price watchlist. Stores it in the local SQLite database ' +
      'and optionally fetches current prices immediately. Set alert_price to be notified when ' +
      'prices drop below your target.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Display name, e.g. "RTX 4080 GPU"' },
        search_query: { type: 'string', description: 'Query for price lookups, e.g. "RTX 4080 16GB"' },
        category: {
          type: 'string',
          enum: ['gpu', 'cpu', 'ram', 'motherboard', 'storage', 'psu', 'case', 'cooling', 'monitor', 'other'],
          default: 'other',
        },
        alert_price: { type: 'number', description: 'Alert threshold in GBP' },
        notes: { type: 'string', description: 'Optional notes' },
        fetch_now: { type: 'boolean', description: 'Fetch current prices immediately', default: true },
        country: { type: 'string', default: 'gb' },
      },
      required: ['name', 'search_query'],
    },
  },
  {
    name: 'untrack_component',
    description: 'Remove a component from tracking. Deletes all stored price history for that component.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Component ID from list_tracked' },
      },
      required: ['id'],
    },
  },
  {
    name: 'list_tracked',
    description: 'List all tracked components with their latest known prices and alert thresholds.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'set_price_alert',
    description: 'Set or remove a price alert threshold for a tracked component. Use null to remove the alert.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Component ID' },
        alert_price: { type: ['number', 'null'], description: 'GBP alert price; null to remove' },
      },
      required: ['id', 'alert_price'],
    },
  },
  {
    name: 'get_price_history',
    description:
      'Get stored price history for a tracked component. Use show_trend for a daily min/avg/max summary.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Component ID' },
        days: { type: 'number', description: 'History window in days (default: 30)', default: 30 },
        show_trend: {
          type: 'boolean',
          description: 'Show daily trend (true) or raw records (false)',
          default: false,
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_latest_prices',
    description: 'Get the most recent price for each retailer for a tracked component.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Component ID' },
      },
      required: ['id'],
    },
  },
  {
    name: 'refresh_prices',
    description:
      'Fetch fresh prices from PricesAPI.io and save them to the database. ' +
      'Omit id to refresh all tracked components (may take several minutes for cold queries).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Component ID to refresh; omit for all' },
        country: { type: 'string', default: 'gb' },
      },
    },
  },
  {
    name: 'check_price_alerts',
    description:
      'Check all tracked components against their alert thresholds. Returns components whose ' +
      'current best price is at or below the alert_price.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_ebay_gpu_prices',
    description:
      'Get eBay UK secondhand GPU prices from pcprice.watch. Covers 40+ GPU models with ' +
      'median prices from active listings. Useful for used/resale price research.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'GPU model, e.g. "RTX 4080" or "RX 9070 XT"' },
        country: { type: 'string', description: 'eBay market country code (default: gb)', default: 'gb' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_supported_gpus',
    description: 'List all GPU models supported by the pcprice.watch eBay price scraper.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
];

// ── Server ─────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'uk-pc-price-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args = rawArgs ?? {};

  try {
    switch (name) {
      // ── search_components ──────────────────────────────────────────────
      case 'search_components': {
        const { query, country, max_results, offers_per_product } = SearchSchema.parse(args);
        const { products, cacheSource, durationMs } = await searchWithRetry(
          query, country, max_results, offers_per_product,
        );

        if (products.length === 0) {
          return ok(`No products found for "${query}" in ${country.toUpperCase()}.`);
        }

        const lines: string[] = [
          `## Search: "${query}" (${country.toUpperCase()})`,
          `*${products.length} product(s) — ${cacheSource} — ${(durationMs / 1000).toFixed(1)}s*\n`,
        ];

        for (const [i, p] of products.entries()) {
          lines.push(`### ${i + 1}. ${p.name}`);
          if (p.url) lines.push(`URL: ${p.url}`);
          if (p.offers.length === 0) {
            lines.push('  No offers available.');
          } else {
            lines.push(`  **${p.offers.length} offer(s):**`);
            for (const o of p.offers) {
              const stock = o.inStock ? '✅ In stock' : '❌ Out of stock';
              lines.push(`  - ${o.merchant}: **${formatCurrency(o.price, o.currency)}** — ${stock}`);
              if (o.url) lines.push(`    ${o.url}`);
            }
          }
          lines.push('');
        }

        return ok(lines.join('\n'));
      }

      // ── track_component ────────────────────────────────────────────────
      case 'track_component': {
        const { name: displayName, search_query, category, alert_price, notes, fetch_now, country } =
          TrackSchema.parse(args);

        const component = db.addTrackedComponent(displayName, category, search_query, alert_price, notes);
        const lines = [
          `✅ **${displayName}** added to watchlist (ID: ${component.id})`,
          `Category: ${category}`,
          `Search query: "${search_query}"`,
        ];
        if (alert_price != null) {
          lines.push(`Alert threshold: ${formatCurrency(alert_price)}`);
        }

        if (fetch_now) {
          lines.push('\n*Fetching current prices (may take up to 90s for uncached query)…*');
          try {
            const { saved, note } = await refreshComponent(component, country);
            lines.push(saved > 0 ? `Saved ${saved} price records. ${note}` : `No prices saved. ${note}`);
          } catch (fetchErr) {
            lines.push(`Warning: could not fetch initial prices — ${(fetchErr as Error).message}`);
            lines.push('Run refresh_prices later to populate price history.');
          }
        }

        return ok(lines.join('\n'));
      }

      // ── untrack_component ──────────────────────────────────────────────
      case 'untrack_component': {
        const { id } = UntrackSchema.parse(args);
        const component = db.getTrackedComponentById(id);
        if (!component) err(`No tracked component with ID ${id}`);

        db.removeTrackedComponent(id);
        return ok(`🗑️ Removed "${component.name}" (ID: ${id}) from watchlist. All price history deleted.`);
      }

      // ── list_tracked ───────────────────────────────────────────────────
      case 'list_tracked': {
        const components = db.getTrackedComponents();
        if (components.length === 0) {
          return ok(
            'No components tracked yet.\n' +
            'Use `track_component` to start watching prices.\n' +
            'Use `search_components` to discover pricing first.',
          );
        }

        const lines = [`## Tracked Components (${components.length})\n`];

        for (const c of components) {
          const latest = db.getLatestPricePerRetailer(c.id);
          const bestPrice = latest[0];
          const alertLine = c.alert_price != null
            ? ` | Alert: ${formatCurrency(c.alert_price)}`
            : '';
          const checked = c.last_checked
            ? new Date(c.last_checked).toLocaleString('en-GB')
            : 'Never';

          lines.push(`### [${c.id}] ${c.name} *(${c.category})*`);
          lines.push(`Query: "${c.search_query}"${alertLine}`);

          if (bestPrice) {
            const stock = bestPrice.in_stock ? '✅' : '❌';
            lines.push(
              `Best price: **${formatCurrency(bestPrice.price, bestPrice.currency)}** ` +
              `at ${bestPrice.retailer} ${stock}`,
            );
            if (latest.length > 1) {
              lines.push(`+${latest.length - 1} more retailer(s) — use \`get_latest_prices\` for full list`);
            }
          } else {
            lines.push('No price data yet — run `refresh_prices` to fetch.');
          }

          if (c.alert_price != null && bestPrice) {
            if (bestPrice.price <= c.alert_price) {
              lines.push(`🔔 **ALERT: Current price is at or below target!**`);
            }
          }

          if (c.notes) lines.push(`Notes: ${c.notes}`);
          lines.push(`Last checked: ${checked}\n`);
        }

        return ok(lines.join('\n'));
      }

      // ── set_price_alert ────────────────────────────────────────────────
      case 'set_price_alert': {
        const { id, alert_price } = SetAlertSchema.parse(args);
        const component = db.getTrackedComponentById(id);
        if (!component) err(`No tracked component with ID ${id}`);

        db.updateAlertPrice(id, alert_price);
        const msg =
          alert_price == null
            ? `🔕 Price alert removed from "${component.name}"`
            : `🔔 Price alert set for "${component.name}" at ${formatCurrency(alert_price)}`;
        return ok(msg);
      }

      // ── get_price_history ──────────────────────────────────────────────
      case 'get_price_history': {
        const { id, days, show_trend } = HistorySchema.parse(args);
        const component = db.getTrackedComponentById(id);
        if (!component) err(`No tracked component with ID ${id}`);

        if (show_trend) {
          const trend = db.getDailyPriceTrend(id, days);
          if (trend.length === 0) {
            return ok(`No price history for "${component.name}" in the last ${days} days.`);
          }

          const lines = [
            `## Price Trend: ${component.name} (last ${days} days)\n`,
            '| Date | Min | Avg | Max | Records |',
            '|------|-----|-----|-----|---------|',
          ];
          for (const row of trend) {
            lines.push(
              `| ${row.date} | ${formatCurrency(row.min_price)} | ${formatCurrency(row.avg_price)} | ` +
              `${formatCurrency(row.max_price)} | ${row.record_count} |`,
            );
          }
          return ok(lines.join('\n'));
        }

        const records = db.getPriceHistory(id, days);
        if (records.length === 0) {
          return ok(`No price history for "${component.name}" in the last ${days} days.`);
        }

        const lines = [
          `## Price History: ${component.name} (last ${days} days, ${records.length} records)\n`,
          '| Date/Time | Retailer | Price | Stock | Source |',
          '|-----------|----------|-------|-------|--------|',
        ];
        for (const r of records) {
          const dt = new Date(r.recorded_at + 'Z').toLocaleString('en-GB');
          const stock = r.in_stock ? '✅' : '❌';
          lines.push(
            `| ${dt} | ${r.retailer} | ${formatCurrency(r.price, r.currency)} | ${stock} | ${r.source} |`,
          );
        }

        return ok(lines.join('\n'));
      }

      // ── get_latest_prices ──────────────────────────────────────────────
      case 'get_latest_prices': {
        const { id } = LatestSchema.parse(args);
        const component = db.getTrackedComponentById(id);
        if (!component) err(`No tracked component with ID ${id}`);

        const latest = db.getLatestPricePerRetailer(id);
        if (latest.length === 0) {
          return ok(
            `No price data for "${component.name}" yet.\n` +
            'Run `refresh_prices` to fetch current prices.',
          );
        }

        const lines = [
          `## Latest Prices: ${component.name}\n`,
          `*${latest.length} retailer(s) — sorted by price ascending*\n`,
          '| # | Retailer | Price | In Stock | Last Updated |',
          '|---|----------|-------|----------|--------------|',
        ];

        for (const [i, r] of latest.entries()) {
          const dt = new Date(r.recorded_at + 'Z').toLocaleString('en-GB', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
          });
          const stock = r.in_stock ? '✅' : '❌';
          const alert =
            component.alert_price != null && r.price <= component.alert_price ? ' 🔔' : '';
          lines.push(
            `| ${i + 1} | ${r.retailer} | **${formatCurrency(r.price, r.currency)}**${alert} | ${stock} | ${dt} |`,
          );
        }

        if (component.alert_price != null) {
          lines.push(`\n*Alert threshold: ${formatCurrency(component.alert_price)}*`);
        }

        return ok(lines.join('\n'));
      }

      // ── refresh_prices ─────────────────────────────────────────────────
      case 'refresh_prices': {
        const { id, country } = RefreshSchema.parse(args);
        const targets = id != null
          ? (() => {
              const c = db.getTrackedComponentById(id);
              if (!c) err(`No tracked component with ID ${id}`);
              return [c];
            })()
          : db.getTrackedComponents();

        if (targets.length === 0) {
          return ok('No tracked components to refresh. Use `track_component` to add some.');
        }

        const results: string[] = [
          `## Refreshing prices for ${targets.length} component(s)…\n`,
        ];

        for (const component of targets) {
          results.push(`### ${component.name}`);
          try {
            const { saved, note } = await refreshComponent(component, country);
            results.push(saved > 0 ? `✅ Saved ${saved} offer(s). ${note}` : `⚠️ ${note}`);
          } catch (e) {
            results.push(`❌ Error: ${(e as Error).message}`);
          }
          results.push('');
        }

        return ok(results.join('\n'));
      }

      // ── check_price_alerts ─────────────────────────────────────────────
      case 'check_price_alerts': {
        const all = db.getTrackedComponents();
        const withAlerts = all.filter(c => c.alert_price != null);

        if (withAlerts.length === 0) {
          return ok(
            'No price alerts configured.\n' +
            'Use `set_price_alert` to set a target price on any tracked component.',
          );
        }

        const triggered = db.getComponentsBelowAlertPrice();

        const lines = [
          `## Price Alert Check`,
          `*${withAlerts.length} component(s) with alerts — ${triggered.length} triggered*\n`,
        ];

        if (triggered.length === 0) {
          lines.push('No alerts triggered — prices are still above your targets.');
          lines.push('\n**Monitored components:**');
          for (const c of withAlerts) {
            const latest = db.getLatestPricePerRetailer(c.id);
            const best = latest[0];
            const current = best ? formatCurrency(best.price, best.currency) : 'No data';
            lines.push(
              `- **${c.name}**: Alert at ${formatCurrency(c.alert_price!)} | Current best: ${current}`,
            );
          }
        } else {
          lines.push('### 🔔 Alerts Triggered!\n');
          for (const t of triggered) {
            lines.push(`#### ${t.component.name}`);
            lines.push(
              `Current price: **${formatCurrency(t.currentBestPrice, t.currency)}** ` +
              `at ${t.retailer}`,
            );
            lines.push(
              `Alert threshold: ${formatCurrency(t.component.alert_price!)} ` +
              `(${Math.abs(t.dropPercent)}% ${t.dropPercent >= 0 ? 'below' : 'above'} target)`,
            );
            if (t.url) lines.push(`URL: ${t.url}`);
            lines.push('');
          }
        }

        return ok(lines.join('\n'));
      }

      // ── get_ebay_gpu_prices ────────────────────────────────────────────
      case 'get_ebay_gpu_prices': {
        const { query, country } = EbaySchema.parse(args);
        const slug = resolveGpuSlug(query);

        if (!slug) {
          return ok(
            `Could not match "${query}" to a known GPU model.\n` +
            'Use `list_supported_gpus` to see all supported models, or check the spelling.\n' +
            'Supported brands: NVIDIA RTX/GTX, AMD RX, Intel Arc.',
          );
        }

        const data = await scrapeEbayGpuPrices(slug, country);

        const lines = [
          `## eBay ${country.toUpperCase()} Prices: ${data.displayName}`,
          `*Source: pcprice.watch | eBay secondhand/resale market only*\n`,
        ];

        if (data.medianPrice != null) {
          lines.push(`**Median price: ${formatCurrency(data.medianPrice, data.currency)}**`);
          lines.push(`Active listings: ${data.activeListings}`);
        } else {
          lines.push('⚠️ Could not retrieve price data.');
        }

        if (data.scraperNote) lines.push(`\n*Note: ${data.scraperNote}*`);
        lines.push(`\nSource URL: ${data.sourceUrl}`);
        lines.push(`Scraped at: ${new Date(data.scrapedAt).toLocaleString('en-GB')}`);
        lines.push('\n> eBay prices reflect **used/secondhand** market. For new retail prices, use `search_components`.');

        return ok(lines.join('\n'));
      }

      // ── list_supported_gpus ────────────────────────────────────────────
      case 'list_supported_gpus': {
        const gpus = listSupportedGpus();
        const lines = [
          `## Supported GPUs for eBay Price Lookup (${gpus.length} models)\n`,
          '*Source: pcprice.watch — secondhand/resale eBay prices only*\n',
        ];

        const sections: Record<string, string[]> = {};
        for (const gpu of gpus) {
          const brand =
            gpu.startsWith('RTX') || gpu.startsWith('GTX')
              ? 'NVIDIA GeForce'
              : gpu.startsWith('RX')
              ? 'AMD Radeon'
              : gpu.startsWith('ARC')
              ? 'Intel Arc'
              : 'Other';
          sections[brand] = sections[brand] ?? [];
          sections[brand].push(gpu);
        }

        for (const [brand, models] of Object.entries(sections)) {
          lines.push(`### ${brand}`);
          lines.push(models.join(', '));
          lines.push('');
        }

        return ok(lines.join('\n'));
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
  } catch (error) {
    if (error instanceof McpError) throw error;
    if (error instanceof z.ZodError) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Invalid arguments: ${error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
      );
    }
    throw new McpError(
      ErrorCode.InternalError,
      `Tool "${name}" failed: ${(error as Error).message}`,
    );
  }
});

// ── Start ──────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
