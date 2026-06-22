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
import { searchAllUkRetailers } from './sources/uk-retailers.js';

// ── Argument schemas ───────────────────────────────────────────────────────

const SearchSchema = z.object({
  query: z.string().min(1),
  country: z.string().default('gb'),
  max_results: z.number().int().min(1).max(10).default(5),
  offers_per_product: z.number().int().min(1).max(20).default(10),
});

const UkRetailersSchema = z.object({
  query: z.string().min(1),
  retailers: z
    .array(z.enum(['scan', 'overclockers', 'ebuyer']))
    .default(['scan', 'overclockers', 'ebuyer'])
    .describe('Which retailers to query'),
});

const TrackSchema = z.object({
  name: z.string().min(1),
  search_query: z.string().min(1),
  category: z
    .enum(['gpu', 'cpu', 'ram', 'motherboard', 'storage', 'psu', 'case', 'cooling', 'monitor', 'other'])
    .default('other'),
  alert_price: z.number().positive().optional(),
  notes: z.string().optional(),
  fetch_now: z.boolean().default(true),
  country: z.string().default('gb'),
});

const IdSchema = z.object({ id: z.number().int().positive() });

const SetAlertSchema = z.object({
  id: z.number().int().positive(),
  alert_price: z.number().positive().nullable(),
});

const HistorySchema = z.object({
  id: z.number().int().positive(),
  days: z.number().int().min(1).max(365).default(30),
  show_trend: z.boolean().default(false),
});

const RefreshSchema = z.object({
  id: z.number().int().positive().optional(),
  country: z.string().default('gb'),
});

const EbaySchema = z.object({
  query: z.string().min(1),
  country: z.string().default('gb'),
});

const PriceDropSchema = z.object({
  min_drop_percent: z.number().min(0).default(2),
});

const CreateBuildSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
});

const AddBuildItemSchema = z.object({
  build_id: z.number().int().positive(),
  component_id: z.number().int().positive(),
  quantity: z.number().int().min(1).default(1),
  notes: z.string().optional(),
});

const RemoveBuildItemSchema = z.object({
  build_id: z.number().int().positive(),
  component_id: z.number().int().positive(),
});

const GetBuildSchema = z.object({ id: z.number().int().positive() });

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(amount: number, currency = 'GBP'): string {
  const symbols: Record<string, string> = {
    GBP: '£', USD: '$', EUR: '€', AUD: 'A$', CAD: 'C$', JPY: '¥',
  };
  const sym = symbols[currency] ?? `${currency} `;
  return `${sym}${amount.toFixed(2)}`;
}

function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function notFound(entity: string, id: number): never {
  throw new McpError(ErrorCode.InvalidRequest, `No ${entity} with ID ${id}`);
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
    note:
      products.length === 0
        ? 'No products found for this query'
        : `${products.length} products, ${snapshots.length} offers saved`,
  };
}

// ── Tool catalogue ─────────────────────────────────────────────────────────

const TOOLS = [
  // ── Search ──────────────────────────────────────────────────────────────
  {
    name: 'search_components',
    description:
      'Search UK PC component prices across 40+ retailers via PricesAPI.io (Amazon UK, Scan, Ebuyer, etc.). ' +
      'Cold queries take 30–90s; cached queries return instantly. ' +
      'Results are NOT saved — use track_component to persist and monitor.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Component name, e.g. "RTX 4080 16GB"' },
        country: { type: 'string', default: 'gb' },
        max_results: { type: 'number', default: 5 },
        offers_per_product: { type: 'number', default: 10 },
      },
      required: ['query'],
    },
  },
  {
    name: 'search_uk_retailers',
    description:
      'Directly scrape Scan.co.uk, Overclockers UK, and Ebuyer in parallel — no API key required. ' +
      'Results are best-effort (these sites are JS-heavy; JSON-LD and structured data are extracted where available). ' +
      'Faster than search_components for new-retail GB pricing.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Component to search for' },
        retailers: {
          type: 'array',
          items: { type: 'string', enum: ['scan', 'overclockers', 'ebuyer'] },
          description: 'Which retailers to query (default: all three)',
          default: ['scan', 'overclockers', 'ebuyer'],
        },
      },
      required: ['query'],
    },
  },
  // ── Tracking ─────────────────────────────────────────────────────────────
  {
    name: 'track_component',
    description:
      'Add a PC component to your watchlist. Stored in local SQLite. ' +
      'Optionally fetches current prices immediately to establish a baseline. ' +
      'Set alert_price to be notified when price drops below your target.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string' },
        search_query: { type: 'string', description: 'Query string used for price lookups' },
        category: {
          type: 'string',
          enum: ['gpu', 'cpu', 'ram', 'motherboard', 'storage', 'psu', 'case', 'cooling', 'monitor', 'other'],
          default: 'other',
        },
        alert_price: { type: 'number', description: 'Alert threshold in GBP' },
        notes: { type: 'string' },
        fetch_now: { type: 'boolean', default: true },
        country: { type: 'string', default: 'gb' },
      },
      required: ['name', 'search_query'],
    },
  },
  {
    name: 'untrack_component',
    description: 'Remove a component from the watchlist and delete all stored price history.',
    inputSchema: {
      type: 'object' as const,
      properties: { id: { type: 'number', description: 'Component ID from list_tracked' } },
      required: ['id'],
    },
  },
  {
    name: 'list_tracked',
    description: 'List all tracked components with their best current price and alert status.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'set_price_alert',
    description: 'Set or remove a GBP price alert threshold for a tracked component.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number' },
        alert_price: { type: ['number', 'null'], description: 'GBP threshold, or null to remove' },
      },
      required: ['id', 'alert_price'],
    },
  },
  // ── Price data ────────────────────────────────────────────────────────────
  {
    name: 'get_latest_prices',
    description: 'Latest price per retailer for a tracked component, sorted cheapest first.',
    inputSchema: {
      type: 'object' as const,
      properties: { id: { type: 'number' } },
      required: ['id'],
    },
  },
  {
    name: 'get_price_history',
    description: 'Stored price history for a tracked component. Use show_trend for a daily summary table.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number' },
        days: { type: 'number', default: 30 },
        show_trend: { type: 'boolean', default: false },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_price_stats',
    description:
      'Price intelligence summary for a tracked component: all-time low/high, 7-day and 30-day averages, ' +
      'current best price, and change vs. previous 24h. Requires price history — run refresh_prices first.',
    inputSchema: {
      type: 'object' as const,
      properties: { id: { type: 'number' } },
      required: ['id'],
    },
  },
  {
    name: 'refresh_prices',
    description:
      'Fetch fresh prices from PricesAPI.io and save to database. ' +
      'Omit id to refresh all tracked components (may take several minutes for cold queries). ' +
      'Displays price change vs previous refresh.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Component ID; omit for all' },
        country: { type: 'string', default: 'gb' },
      },
    },
  },
  {
    name: 'check_price_alerts',
    description: 'Show tracked components whose current best price is at or below their alert threshold.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_price_drops',
    description:
      'Show tracked components where the best price has dropped since the previous check. ' +
      'Compares the last 24h best price against the 24–96h window.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        min_drop_percent: { type: 'number', description: 'Minimum drop % to include (default: 2)', default: 2 },
      },
    },
  },
  // ── eBay ─────────────────────────────────────────────────────────────────
  {
    name: 'get_ebay_gpu_prices',
    description:
      'eBay secondhand GPU prices from pcprice.watch. Median prices from active listings. ' +
      'Used/resale market only — not new retail pricing.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'GPU model, e.g. "RTX 4080" or "RX 9070 XT"' },
        country: { type: 'string', default: 'gb' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_supported_gpus',
    description: 'List all GPU models supported by the pcprice.watch eBay scraper.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  // ── Builds ────────────────────────────────────────────────────────────────
  {
    name: 'create_build',
    description: 'Create a named PC build to group components and track total cost.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Build name, e.g. "Gaming Rig 2024"' },
        description: { type: 'string' },
      },
      required: ['name'],
    },
  },
  {
    name: 'list_builds',
    description: 'List all saved PC builds with their component count and total cost.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'get_build',
    description: 'Get full build details — all components, individual prices, and total cost.',
    inputSchema: {
      type: 'object' as const,
      properties: { id: { type: 'number' } },
      required: ['id'],
    },
  },
  {
    name: 'add_to_build',
    description: 'Add a tracked component to a build. The component must already be in the watchlist.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        build_id: { type: 'number' },
        component_id: { type: 'number', description: 'ID from list_tracked' },
        quantity: { type: 'number', default: 1, description: 'Number of units (e.g. 2 for dual RAM sticks)' },
        notes: { type: 'string' },
      },
      required: ['build_id', 'component_id'],
    },
  },
  {
    name: 'remove_from_build',
    description: 'Remove a component from a build (does not delete the component from tracking).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        build_id: { type: 'number' },
        component_id: { type: 'number' },
      },
      required: ['build_id', 'component_id'],
    },
  },
  {
    name: 'delete_build',
    description: 'Delete a build (does not delete the tracked components inside it).',
    inputSchema: {
      type: 'object' as const,
      properties: { id: { type: 'number' } },
      required: ['id'],
    },
  },
];

// ── Server ─────────────────────────────────────────────────────────────────

const server = new Server(
  { name: 'uk-pc-price-mcp', version: '2.0.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArgs } = request.params;
  const args = rawArgs ?? {};

  try {
    switch (name) {

      // ── search_components ────────────────────────────────────────────────
      case 'search_components': {
        const { query, country, max_results, offers_per_product } = SearchSchema.parse(args);
        const { products, cacheSource, durationMs } = await searchWithRetry(
          query, country, max_results, offers_per_product,
        );

        if (products.length === 0) return ok(`No products found for "${query}" in ${country.toUpperCase()}.`);

        const lines = [
          `## Search: "${query}" (${country.toUpperCase()})`,
          `*${products.length} product(s) · ${cacheSource} · ${(durationMs / 1000).toFixed(1)}s*\n`,
        ];
        for (const [i, p] of products.entries()) {
          lines.push(`### ${i + 1}. ${p.name}`);
          if (p.url) lines.push(`<${p.url}>`);
          if (p.offers.length === 0) {
            lines.push('  No offers available.\n');
          } else {
            for (const o of p.offers) {
              lines.push(
                `  - **${fmt(o.price, o.currency)}** at ${o.merchant} — ${o.inStock ? '✅ In stock' : '❌ Out of stock'}`,
              );
            }
            lines.push('');
          }
        }
        return ok(lines.join('\n'));
      }

      // ── search_uk_retailers ──────────────────────────────────────────────
      case 'search_uk_retailers': {
        const { query, retailers } = UkRetailersSchema.parse(args);
        const searchResults = await searchAllUkRetailers(query, retailers);

        const lines = [`## UK Retailer Search: "${query}"\n`];

        for (const sr of searchResults) {
          lines.push(`### ${sr.retailer} *(${sr.durationMs}ms)*`);
          if (sr.error) {
            lines.push(`⚠️ ${sr.error}`);
          } else if (sr.results.length === 0) {
            lines.push('No results found.');
          } else {
            for (const r of sr.results) {
              const priceStr = r.price != null ? `**${fmt(r.price, r.currency)}**` : 'Price unknown';
              const stock = r.inStock ? '✅' : '❌';
              lines.push(`- ${stock} ${r.name} — ${priceStr}`);
              if (r.url && r.url !== `https://www.${sr.retailer.toLowerCase()}.co.uk/search?q=${encodeURIComponent(query)}`) {
                lines.push(`  <${r.url}>`);
              }
              if (r.scraperNote) lines.push(`  *${r.scraperNote}*`);
            }
          }
          lines.push('');
        }

        lines.push('> *Scraped directly from retailer websites. Prices and availability may differ from their apps/checkout.*');
        return ok(lines.join('\n'));
      }

      // ── track_component ──────────────────────────────────────────────────
      case 'track_component': {
        const { name: displayName, search_query, category, alert_price, notes, fetch_now, country } =
          TrackSchema.parse(args);

        const component = db.addTrackedComponent(displayName, category, search_query, alert_price, notes);
        const lines = [
          `✅ **${displayName}** added to watchlist (ID: **${component.id}**)`,
          `Category: ${category} · Query: "${search_query}"`,
        ];
        if (alert_price != null) lines.push(`Alert threshold: ${fmt(alert_price)}`);

        if (fetch_now) {
          lines.push('\n*Fetching current prices (cold query may take up to 90s)…*');
          try {
            const { saved, note } = await refreshComponent(component, country);
            lines.push(saved > 0 ? `✅ ${note}` : `⚠️ ${note}`);
          } catch (e) {
            lines.push(`⚠️ Could not fetch initial prices: ${(e as Error).message}`);
            lines.push('Run `refresh_prices` later to populate price history.');
          }
        }
        return ok(lines.join('\n'));
      }

      // ── untrack_component ────────────────────────────────────────────────
      case 'untrack_component': {
        const { id } = IdSchema.parse(args);
        const component = db.getTrackedComponentById(id) ?? notFound('tracked component', id);
        db.removeTrackedComponent(id);
        return ok(`🗑️ Removed **${component.name}** (ID: ${id}) and all its price history.`);
      }

      // ── list_tracked ─────────────────────────────────────────────────────
      case 'list_tracked': {
        const components = db.getTrackedComponents();
        if (components.length === 0) {
          return ok('No components tracked yet.\nUse `track_component` to start watching prices.');
        }

        const lines = [`## Tracked Components (${components.length})\n`];
        for (const c of components) {
          const latest = db.getLatestPricePerRetailer(c.id);
          const best = latest[0];
          const alertLine = c.alert_price != null ? ` · Alert: ${fmt(c.alert_price)}` : '';
          const checked = c.last_checked
            ? new Date(c.last_checked + 'Z').toLocaleString('en-GB')
            : 'Never';

          lines.push(`### [${c.id}] ${c.name} *(${c.category})*`);
          lines.push(`Query: "${c.search_query}"${alertLine}`);

          if (best) {
            const triggerFlag =
              c.alert_price != null && best.price <= c.alert_price ? ' 🔔' : '';
            lines.push(
              `Best price: **${fmt(best.price, best.currency)}** at ${best.retailer} ` +
              `${best.in_stock ? '✅' : '❌'}${triggerFlag}`,
            );
            if (latest.length > 1) lines.push(`+${latest.length - 1} more retailer(s)`);
          } else {
            lines.push('No price data yet — run `refresh_prices`.');
          }

          if (c.notes) lines.push(`Notes: ${c.notes}`);
          lines.push(`Last checked: ${checked}\n`);
        }
        return ok(lines.join('\n'));
      }

      // ── set_price_alert ──────────────────────────────────────────────────
      case 'set_price_alert': {
        const { id, alert_price } = SetAlertSchema.parse(args);
        const component = db.getTrackedComponentById(id) ?? notFound('tracked component', id);
        db.updateAlertPrice(id, alert_price);
        return ok(
          alert_price == null
            ? `🔕 Alert removed from **${component.name}**`
            : `🔔 Alert set for **${component.name}** at ${fmt(alert_price)}`,
        );
      }

      // ── get_latest_prices ────────────────────────────────────────────────
      case 'get_latest_prices': {
        const { id } = IdSchema.parse(args);
        const component = db.getTrackedComponentById(id) ?? notFound('tracked component', id);
        const latest = db.getLatestPricePerRetailer(id);

        if (latest.length === 0) {
          return ok(`No price data for **${component.name}** yet.\nRun \`refresh_prices\` to fetch.`);
        }

        const lines = [
          `## Latest Prices: ${component.name}`,
          `*${latest.length} retailer(s) — sorted cheapest first*\n`,
          '| # | Retailer | Price | In Stock | Updated |',
          '|---|----------|-------|----------|---------|',
        ];

        for (const [i, r] of latest.entries()) {
          const dt = new Date(r.recorded_at + 'Z').toLocaleString('en-GB', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
          });
          const alert =
            component.alert_price != null && r.price <= component.alert_price ? ' 🔔' : '';
          lines.push(
            `| ${i + 1} | ${r.retailer} | **${fmt(r.price, r.currency)}**${alert} | ` +
            `${r.in_stock ? '✅' : '❌'} | ${dt} |`,
          );
        }

        if (component.alert_price != null) {
          lines.push(`\n*Alert threshold: ${fmt(component.alert_price)}*`);
        }
        return ok(lines.join('\n'));
      }

      // ── get_price_history ────────────────────────────────────────────────
      case 'get_price_history': {
        const { id, days, show_trend } = HistorySchema.parse(args);
        const component = db.getTrackedComponentById(id) ?? notFound('tracked component', id);

        if (show_trend) {
          const trend = db.getDailyPriceTrend(id, days);
          if (trend.length === 0) {
            return ok(`No price history for **${component.name}** in the last ${days} days.`);
          }
          const lines = [
            `## Price Trend: ${component.name} (last ${days} days)\n`,
            '| Date | Min | Avg | Max | Records |',
            '|------|-----|-----|-----|---------|',
          ];
          for (const row of trend) {
            lines.push(
              `| ${row.date} | ${fmt(row.min_price)} | ${fmt(row.avg_price)} | ` +
              `${fmt(row.max_price)} | ${row.record_count} |`,
            );
          }
          return ok(lines.join('\n'));
        }

        const records = db.getPriceHistory(id, days);
        if (records.length === 0) {
          return ok(`No price history for **${component.name}** in the last ${days} days.`);
        }

        const lines = [
          `## Price History: ${component.name} (last ${days} days, ${records.length} records)\n`,
          '| Date/Time | Retailer | Price | Stock | Source |',
          '|-----------|----------|-------|-------|--------|',
        ];
        for (const r of records) {
          const dt = new Date(r.recorded_at + 'Z').toLocaleString('en-GB');
          lines.push(
            `| ${dt} | ${r.retailer} | ${fmt(r.price, r.currency)} | ` +
            `${r.in_stock ? '✅' : '❌'} | ${r.source} |`,
          );
        }
        return ok(lines.join('\n'));
      }

      // ── get_price_stats ──────────────────────────────────────────────────
      case 'get_price_stats': {
        const { id } = IdSchema.parse(args);
        const component = db.getTrackedComponentById(id) ?? notFound('tracked component', id);
        const stats = db.getPriceStats(id);

        if (stats.total_records === 0) {
          return ok(
            `No price data for **${component.name}** yet.\n` +
            'Run `refresh_prices` to start collecting price history.',
          );
        }

        let changeStr = '';
        if (stats.current_best != null && stats.prev_best_24h != null) {
          const diff = stats.current_best - stats.prev_best_24h;
          const pct = (diff / stats.prev_best_24h) * 100;
          if (Math.abs(pct) >= 0.5) {
            const arrow = diff < 0 ? '📉' : '📈';
            changeStr = `${arrow} ${diff < 0 ? '-' : '+'}${fmt(Math.abs(diff), stats.currency)} ` +
              `(${pct > 0 ? '+' : ''}${pct.toFixed(1)}%) vs previous check`;
          } else {
            changeStr = '↔️ Price unchanged vs previous check';
          }
        }

        const oldest = stats.oldest_record
          ? new Date(stats.oldest_record + 'Z').toLocaleDateString('en-GB')
          : 'unknown';

        const lines = [
          `## Price Statistics: ${component.name}\n`,
          `**Current best price:** ${stats.current_best != null ? fmt(stats.current_best, stats.currency) : 'No recent data (>48h)'}`,
          changeStr,
          '',
          `| Metric | Value |`,
          `|--------|-------|`,
          `| All-time low | ${stats.all_time_low != null ? fmt(stats.all_time_low, stats.currency) : 'N/A'} |`,
          `| All-time high | ${stats.all_time_high != null ? fmt(stats.all_time_high, stats.currency) : 'N/A'} |`,
          `| 30-day average | ${stats.avg_30d != null ? fmt(stats.avg_30d, stats.currency) : 'N/A'} |`,
          `| 7-day average | ${stats.avg_7d != null ? fmt(stats.avg_7d, stats.currency) : 'N/A'} |`,
          `| Total records | ${stats.total_records} |`,
          `| Tracking since | ${oldest} |`,
        ];

        if (component.alert_price != null) {
          lines.push(`| Alert threshold | ${fmt(component.alert_price)} |`);
          if (stats.current_best != null) {
            const gap = stats.current_best - component.alert_price;
            lines.push(
              `| Distance to alert | ${gap > 0 ? `${fmt(gap)} above` : `${fmt(Math.abs(gap))} BELOW TARGET 🔔`} |`,
            );
          }
        }

        return ok(lines.filter(Boolean).join('\n'));
      }

      // ── refresh_prices ───────────────────────────────────────────────────
      case 'refresh_prices': {
        const { id, country } = RefreshSchema.parse(args);
        const targets = id != null
          ? [db.getTrackedComponentById(id) ?? notFound('tracked component', id)]
          : db.getTrackedComponents();

        if (targets.length === 0) {
          return ok('No tracked components to refresh. Use `track_component` to add some.');
        }

        const lines = [`## Refreshing prices for ${targets.length} component(s)…\n`];

        for (const component of targets) {
          const prevBest = db.getLatestPricePerRetailer(component.id)[0]?.price;
          lines.push(`### ${component.name}`);
          try {
            const { saved, note } = await refreshComponent(component, country);
            if (saved > 0) {
              lines.push(`✅ ${note}`);
              const newBest = db.getLatestPricePerRetailer(component.id)[0];
              if (prevBest != null && newBest) {
                const diff = newBest.price - prevBest;
                if (Math.abs(diff) > 0.01) {
                  const arrow = diff < 0 ? '📉' : '📈';
                  lines.push(
                    `${arrow} Price change: ${fmt(prevBest)} → **${fmt(newBest.price, newBest.currency)}** ` +
                    `(${diff < 0 ? '' : '+'}${fmt(diff, newBest.currency)})`,
                  );
                }
              }
            } else {
              lines.push(`⚠️ ${note}`);
            }
          } catch (e) {
            lines.push(`❌ Error: ${(e as Error).message}`);
          }
          lines.push('');
        }

        return ok(lines.join('\n'));
      }

      // ── check_price_alerts ───────────────────────────────────────────────
      case 'check_price_alerts': {
        const withAlerts = db.getTrackedComponents().filter(c => c.alert_price != null);
        if (withAlerts.length === 0) {
          return ok('No price alerts set.\nUse `set_price_alert` to add a GBP target to any tracked component.');
        }

        const triggered = db.getComponentsBelowAlertPrice();
        const lines = [
          `## Price Alert Check`,
          `*${withAlerts.length} component(s) monitored · ${triggered.length} triggered*\n`,
        ];

        if (triggered.length === 0) {
          lines.push('No alerts triggered — all prices still above target.\n');
          lines.push('**Monitored components:**');
          for (const c of withAlerts) {
            const best = db.getLatestPricePerRetailer(c.id)[0];
            const current = best ? fmt(best.price, best.currency) : 'No data';
            const gap = best ? ` (${fmt(best.price - c.alert_price!)} above target)` : '';
            lines.push(`- **${c.name}**: Target ${fmt(c.alert_price!)} · Current: ${current}${gap}`);
          }
        } else {
          lines.push('### 🔔 Alerts Triggered!\n');
          for (const t of triggered) {
            lines.push(`#### ${t.component.name}`);
            lines.push(`Price: **${fmt(t.currentBestPrice, t.currency)}** at ${t.retailer}`);
            lines.push(`Target: ${fmt(t.component.alert_price!)} — **${Math.abs(t.dropPercent)}% below target**`);
            if (t.url) lines.push(`<${t.url}>`);
            lines.push('');
          }
        }

        return ok(lines.join('\n'));
      }

      // ── get_price_drops ──────────────────────────────────────────────────
      case 'get_price_drops': {
        const { min_drop_percent } = PriceDropSchema.parse(args);
        const drops = db.getRecentPriceDrops(min_drop_percent);

        if (drops.length === 0) {
          return ok(
            `No price drops ≥${min_drop_percent}% detected in the last 24h.\n` +
            'Run `refresh_prices` first to get up-to-date data.',
          );
        }

        const lines = [
          `## Recent Price Drops (≥${min_drop_percent}% in last 24h)\n`,
          `*${drops.length} component(s) dropped in price*\n`,
        ];

        for (const d of drops) {
          lines.push(
            `### 📉 ${d.component.name}`,
            `${fmt(d.previousBest, d.currency)} → **${fmt(d.currentBest, d.currency)}** ` +
            `at ${d.bestRetailer} — **-${fmt(d.dropAmount, d.currency)} (-${d.dropPercent.toFixed(1)}%)**`,
          );
          if (d.bestUrl) lines.push(`<${d.bestUrl}>`);
          if (d.component.alert_price != null) {
            const distToAlert = d.currentBest - d.component.alert_price;
            lines.push(
              distToAlert <= 0
                ? `🔔 **At or below alert threshold (${fmt(d.component.alert_price)})**`
                : `Alert target: ${fmt(d.component.alert_price)} — ${fmt(distToAlert)} away`,
            );
          }
          lines.push('');
        }

        return ok(lines.join('\n'));
      }

      // ── get_ebay_gpu_prices ──────────────────────────────────────────────
      case 'get_ebay_gpu_prices': {
        const { query, country } = EbaySchema.parse(args);
        const slug = resolveGpuSlug(query);
        if (!slug) {
          return ok(
            `Could not match "${query}" to a known GPU.\n` +
            'Use `list_supported_gpus` to see all supported models.',
          );
        }

        const data = await scrapeEbayGpuPrices(slug, country);
        const lines = [
          `## eBay ${country.toUpperCase()} Prices: ${data.displayName}`,
          `*Source: pcprice.watch — eBay secondhand/resale only*\n`,
        ];

        if (data.medianPrice != null) {
          lines.push(`**Median price: ${fmt(data.medianPrice, data.currency)}**`);
          if (data.activeListings > 0) lines.push(`Active listings: ${data.activeListings}`);
        } else {
          lines.push('⚠️ Could not retrieve price data.');
        }

        if (data.scraperNote) lines.push(`\n*Note: ${data.scraperNote}*`);
        lines.push(`\nSource: <${data.sourceUrl}>`);
        lines.push(`Scraped: ${new Date(data.scrapedAt).toLocaleString('en-GB')}`);
        lines.push('\n> eBay prices are **used/secondhand**. For new retail, use `search_components` or `search_uk_retailers`.');
        return ok(lines.join('\n'));
      }

      // ── list_supported_gpus ──────────────────────────────────────────────
      case 'list_supported_gpus': {
        const gpus = listSupportedGpus();
        const sections: Record<string, string[]> = {};
        for (const gpu of gpus) {
          const brand = gpu.startsWith('RTX') || gpu.startsWith('GTX')
            ? 'NVIDIA GeForce' : gpu.startsWith('RX') ? 'AMD Radeon' : 'Intel Arc';
          (sections[brand] ??= []).push(gpu);
        }
        const lines = [`## Supported GPUs for eBay Lookup (${gpus.length} models)\n`];
        for (const [brand, models] of Object.entries(sections)) {
          lines.push(`### ${brand}\n${models.join(', ')}\n`);
        }
        return ok(lines.join('\n'));
      }

      // ── create_build ─────────────────────────────────────────────────────
      case 'create_build': {
        const { name: buildName, description } = CreateBuildSchema.parse(args);
        const build = db.createBuild(buildName, description);
        return ok(
          `🖥️ Build **"${build.name}"** created (ID: **${build.id}**)\n` +
          `Use \`add_to_build\` to add tracked components.\n` +
          `Use \`get_build\` to see cost breakdown.`,
        );
      }

      // ── list_builds ───────────────────────────────────────────────────────
      case 'list_builds': {
        const builds = db.getBuilds();
        if (builds.length === 0) {
          return ok('No builds yet.\nUse `create_build` to start a new PC build.');
        }

        const lines = [`## PC Builds (${builds.length})\n`];
        for (const b of builds) {
          const summary = db.getBuildSummary(b.id);
          const itemCount = summary?.items.length ?? 0;
          const totalStr =
            summary && summary.totalCost > 0 ? fmt(summary.totalCost) : 'No price data';
          const missingStr =
            summary && summary.missingPrices > 0 ? ` (${summary.missingPrices} missing prices)` : '';

          lines.push(`### [${b.id}] ${b.name}`);
          if (b.description) lines.push(b.description);
          lines.push(`${itemCount} component(s) · Total: **${totalStr}**${missingStr}`);
          lines.push(`Created: ${new Date(b.created_at + 'Z').toLocaleDateString('en-GB')}\n`);
        }
        return ok(lines.join('\n'));
      }

      // ── get_build ─────────────────────────────────────────────────────────
      case 'get_build': {
        const { id } = GetBuildSchema.parse(args);
        const summary = db.getBuildSummary(id);
        if (!summary) notFound('build', id);

        const { build, items, bestPrices, totalCost, missingPrices } = summary!;

        const lines = [
          `## 🖥️ ${build.name}`,
          build.description ? `*${build.description}*\n` : '',
          `| # | Component | Category | Qty | Best Price | Retailer | Stock |`,
          `|---|-----------|----------|-----|------------|----------|-------|`,
        ];

        for (const [i, item] of items.entries()) {
          const p = bestPrices.get(item.component_id);
          const priceCell = p
            ? `${fmt(p.price, p.currency)}${item.quantity > 1 ? ` × ${item.quantity} = ${fmt(p.price * item.quantity, p.currency)}` : ''}`
            : 'No data';
          const retailerCell = p?.retailer ?? '—';
          const stockCell = p ? '✅' : '—';

          lines.push(
            `| ${i + 1} | [${item.component_id}] ${item.component_name} | ${item.component_category} | ` +
            `${item.quantity} | ${priceCell} | ${retailerCell} | ${stockCell} |`,
          );
        }

        lines.push('');
        lines.push(`**Total build cost: ${fmt(totalCost)}**`);
        if (missingPrices > 0) {
          lines.push(
            `⚠️ ${missingPrices} component(s) have no price data — run \`refresh_prices\` to update.`,
          );
        }
        lines.push(`\n*Run \`refresh_prices\` to get the latest prices for all components.*`);

        return ok(lines.filter(l => l !== '').join('\n'));
      }

      // ── add_to_build ──────────────────────────────────────────────────────
      case 'add_to_build': {
        const { build_id, component_id, quantity, notes } = AddBuildItemSchema.parse(args);
        const build = db.getBuildById(build_id) ?? notFound('build', build_id);
        const component = db.getTrackedComponentById(component_id) ?? notFound('tracked component', component_id);

        db.addBuildItem(build_id, component_id, quantity, notes);
        return ok(
          `✅ Added **${component.name}** (×${quantity}) to build **"${build.name}"**.\n` +
          `Use \`get_build\` with id ${build_id} to see the updated cost breakdown.`,
        );
      }

      // ── remove_from_build ─────────────────────────────────────────────────
      case 'remove_from_build': {
        const { build_id, component_id } = RemoveBuildItemSchema.parse(args);
        const build = db.getBuildById(build_id) ?? notFound('build', build_id);
        const component = db.getTrackedComponentById(component_id);

        const removed = db.removeBuildItem(build_id, component_id);
        if (!removed) {
          return ok(`Component ID ${component_id} was not in build **"${build.name}"**.`);
        }
        return ok(
          `🗑️ Removed **${component?.name ?? `Component ${component_id}`}** from build **"${build.name}"**.`,
        );
      }

      // ── delete_build ──────────────────────────────────────────────────────
      case 'delete_build': {
        const { id } = GetBuildSchema.parse(args);
        const build = db.getBuildById(id) ?? notFound('build', id);
        db.deleteBuild(id);
        return ok(
          `🗑️ Build **"${build.name}"** deleted.\n` +
          'All tracked components in the build are still in your watchlist.',
        );
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
