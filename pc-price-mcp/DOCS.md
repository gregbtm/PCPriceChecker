# UK PC Price MCP — Technical Reference

## Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Installation & Startup](#2-installation--startup)
3. [Configuration Reference](#3-configuration-reference)
4. [Database Schema](#4-database-schema)
5. [REST API Reference](#5-rest-api-reference)
6. [MCP Tool Catalogue](#6-mcp-tool-catalogue)
7. [Notification Channels](#7-notification-channels)
8. [Scheduler & Auto-Refresh](#8-scheduler--auto-refresh)
9. [URL-Based Scraping](#9-url-based-scraping)
10. [Browser Integration (Playwright / Novada / Camoufox / Byparr)](#10-browser-integration-playwright--novada--camoufox--byparr)
11. [Export & Import](#11-export--import)
12. [Advisor Engine](#12-advisor-engine)
13. [Deployment](#13-deployment)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  Claude / AI client                                              │
│  (calls MCP tools over stdio)                                    │
└────────────────────┬─────────────────────────────────────────────┘
                     │ stdio MCP transport
┌────────────────────▼─────────────────────────────────────────────┐
│  src/index.ts  — MCP server (@modelcontextprotocol/sdk)          │
│  Exposes 50+ tools; handles price refresh, search, builds, etc.  │
└────────────────────┬─────────────────────────────────────────────┘
                     │ shared DB layer
┌────────────────────▼─────────────────────────────────────────────┐
│  src/db.ts  — better-sqlite3 (WAL mode, FK enforcement)          │
│  data/pc-prices.db  ← default path (override: DB_PATH)          │
└──────┬──────────────────────────────────────────────────────────-┘
       │
       │  also used by
┌──────▼───────────────────────────────────────────────────────────┐
│  src/web.ts  — Express 5 REST API + static file server           │
│  Serves public/index.html dashboard on port 3456 (default)       │
└──────────────────────────────────────────────────────────────────┘
```

**Key source files:**

| File | Purpose |
|------|---------|
| `src/index.ts` | MCP stdio server — tool definitions and handlers |
| `src/web.ts` | Express REST API; also starts the scheduler |
| `src/db.ts` | All SQLite reads/writes; schema init and migrations |
| `src/scheduler.ts` | Background auto-refresh timer |
| `src/notifications.ts` | Discord, Slack, Telegram, email, ntfy, Pushover dispatch |
| `src/export.ts` | CSV / JSON export helpers |
| `src/sources/playwright-scraper.ts` | Playwright headless browser scraping |
| `src/sources/url-scraper.ts` | Multi-strategy URL scraping (JSON-LD → meta → CSS → AI) |
| `public/index.html` | Single-page Alpine.js + DaisyUI v5 dashboard |

---

## 2. Installation & Startup

### As a standalone web dashboard

```bash
npm install
npm run build          # compiles TypeScript → dist/
npm run web            # starts dashboard on http://0.0.0.0:3456
# OR for development (no build step):
npm run dev:web
```

### As a Claude MCP server

Add to your Claude config (`~/.config/claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "uk-pc-price": {
      "command": "npx",
      "args": ["-y", "uk-pc-price-mcp"],
      "env": {
        "PRICES_API_KEY": "your_key_here"
      }
    }
  }
}
```

Or point at a local build:

```json
{
  "mcpServers": {
    "uk-pc-price": {
      "command": "node",
      "args": ["/path/to/uk-pc-price-mcp/dist/index.js"]
    }
  }
}
```

### Environment variable lookup order

On startup `src/web.ts` reads all rows from the `config` SQLite table and
injects them into `process.env`. This means every key you save via the
Settings tab or `/api/config` POST is live immediately — no server restart
required. The priority is: **existing env var → SQLite config**.

---

## 3. Configuration Reference

### Port and paths

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | HTTP server port |
| `DB_PATH` | `./data/pc-prices.db` | SQLite database file path |
| `EXPORT_DIR` | process cwd | Directory for exported CSV/JSON files |

### API keys (stored in SQLite `config` table)

All of the following can be set via `POST /api/config` or the Settings tab.
They are synced to `process.env` at server startup and on every update.

| Config key | Description |
|------------|-------------|
| `prices_api_key` | **Required.** PricesAPI.io key for UK retailer price lookups |
| `ebay_client_id` | eBay OAuth client ID (Browse API) |
| `ebay_client_secret` | eBay OAuth client secret |
| `keepa_api_key` | Keepa.com API key for Amazon price history |
| `amazon_access_key` | Amazon PA API v5 access key |
| `amazon_secret_key` | Amazon PA API v5 secret |
| `amazon_associate_tag` | Amazon associate / affiliate tag |
| `awin_publisher_id` | AWIN publisher ID |
| `awin_api_key` | AWIN API key for affiliate product feeds |
| `reddit_client_id` | Reddit app client ID (for `/api/search/api`) |
| `reddit_client_secret` | Reddit app client secret |
| `youtube_api_key` | YouTube Data API v3 key |
| `bing_api_key` | Bing Web Search API key |
| `anthropic_api_key` | Anthropic API key (used for AI price extraction fallback) |
| `openai_api_key` | OpenAI API key (alternative AI extraction) |
| `apify_api_token` | Apify platform token — unlocks all six Apify cloud actor scrapers (Currys, Google Shopping, Argos, Idealo, Amazon, PCPartPicker) |
| `camofox_url` | Camoufox CDP/WebSocket endpoint — self-hosted anti-detect Firefox (priority 2 scraping backend) |
| `novada_browser_ws` | Novada Browser API WebSocket endpoint (CDP) — cloud anti-detect (priority 1 scraping backend) |
| `novada_api_key` | Novada API key |
| `byparr_url` | Byparr / FlareSolverr-compatible server URL — Cloudflare Turnstile / managed-challenge solver, last-resort scraping backend |
| `gotify_server_url` | Self-hosted Gotify push server URL |
| `gotify_app_token` | Gotify application token |
| `apprise_url` | Apprise notification URL (supports 50+ services) |

### Notification keys (also in SQLite, not exported in backups)

| Config key | Description |
|------------|-------------|
| `discord_webhook_url` | Discord webhook URL |
| `slack_webhook_url` | Slack webhook URL |
| `telegram_bot_token` | Telegram Bot API token |
| `telegram_chat_id` | Telegram chat or group ID |
| `resend_api_key` | Resend transactional email API key |
| `alert_email` | Destination address for email alerts |
| `ntfy_topic` | ntfy topic name (e.g. `my-pc-alerts`) |
| `ntfy_server` | ntfy server (default: `https://ntfy.sh`) |
| `pushover_app_token` | Pushover application token |
| `pushover_user_key` | Pushover user/group key |
| `generic_webhook_url` | Raw JSON POST of the notification payload — no platform-specific formatting, for n8n/Zapier/Make/Home Assistant/scripts |
| `changedetection_url` | ChangeDetection.io instance URL — selector-picking helper only, not a scraping backend; just powers a Settings shortcut link |

> **Security note:** The export backup endpoint (`GET /api/export/backup`) deliberately excludes any config keys matching `%_key%`, `%_token%`, `%_secret%`, or `%_password%` patterns to prevent credentials leaking into backup files.

---

## 4. Database Schema

The SQLite database is created automatically at `data/pc-prices.db`. Schema migrations run on every startup — no manual migration steps required.

### `tracked_components`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment ID |
| `name` | TEXT | Display name |
| `category` | TEXT | `gpu`, `cpu`, `ram`, `motherboard`, `storage`, `psu`, `case`, `cooling`, `monitor`, `other` |
| `search_query` | TEXT | Query sent to PricesAPI.io |
| `alert_price` | REAL | GBP alert threshold (nullable) |
| `notes` | TEXT | Free-form notes |
| `created_at` | TEXT | ISO timestamp |
| `last_checked` | TEXT | Last successful refresh |
| `source_url` | TEXT | If tracked via URL, the original URL |
| `paused` | INTEGER | 0=active, 1=paused |
| `check_interval_minutes` | INTEGER | Per-component override (nullable) |
| `last_scrape_failed` | INTEGER | 0=ok, 1=last attempt failed |
| `unit_quantity` | REAL | Pack size (e.g. 2 for dual-channel RAM) |
| `unit_type` | TEXT | Unit label (e.g. `pack`, `GB`) |

### `price_records`

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `component_id` | INTEGER FK | → tracked_components.id |
| `source` | TEXT | `pricesapi`, `scrape`, `ebay`, etc. |
| `price` | REAL | Price in GBP |
| `currency` | TEXT | Default `GBP` |
| `retailer` | TEXT | Retailer name |
| `url` | TEXT | Direct product URL |
| `in_stock` | INTEGER | 0/1 |
| `recorded_at` | TEXT | ISO timestamp |
| `is_outlier` | INTEGER | 0/1 — statistical outlier flag |
| `confidence` | REAL | 0–1 confidence score |
| `z_score` | REAL | Z-score from IQR validation |

### `builds` / `build_items`

`builds`: `id`, `name` (UNIQUE), `description`, `created_at`, `updated_at`

`build_items`: `id`, `build_id` FK, `component_id` FK, `quantity`, `notes`, `added_at`  
Unique constraint: `(build_id, component_id)`

### `prebuilt_systems` / `prebuilt_price_records`

Pre-built PC systems with `brand`, `cpu`, `gpu`, `ram`, `storage`, `os`, `form_factor`, `category` (`gaming`, `workstation`, `office`, `home`, `mini`, `aio`, `other`).

Price records have the same shape as `price_records` but with `system_id` FK instead of `component_id`.

### `config`

| Column | Type | Notes |
|--------|------|-------|
| `key` | TEXT PK | Config key name |
| `value` | TEXT | Stored value |
| `updated_at` | TEXT | Last update timestamp |

Upserted — no duplicate keys. Used as the primary key-value store for all API credentials and notification settings.

### `tags` / `component_tags`

`tags`: `id`, `name` (UNIQUE), `color` (hex, default `#6366f1`), `created_at`

`component_tags`: `(component_id, tag_id)` composite PK — many-to-many join.

### `scrape_rules`

Per-domain CSS extraction rules. `domain` is the PK (e.g. `ebuyer.com`).  
Fields: `name_selector`, `price_selector`, `avail_selector`, `price_attribute`, `price_regex`, `notes`, `updated_at`.

### `component_urls`

Multiple tracked URLs per component. `(component_id, url)` unique constraint.  
Fields: `id`, `component_id`, `url`, `retailer`, `label`, `added_at`.

### `saved_searches`

`id`, `name`, `query`, `max_price`, `category`, `created_at`, `last_checked`, `last_result_count`.

### `stock_history`

Change log for in-stock → out-of-stock transitions.  
`id`, `component_id`, `retailer`, `was_in_stock`, `is_in_stock`, `price`, `recorded_at`.

### `waitlist`

Components the user wants notified about when they restock.  
`id`, `component_id`, `retailer_filter`, `max_price`, `added_at`.  
Unique: `(component_id, retailer_filter)`.

---

## 5. REST API Reference

Base URL: `http://localhost:3456` (configurable via `PORT`).

All endpoints return JSON. Errors return `{ "error": "message" }` with an appropriate HTTP status code. The `h()` wrapper catches async errors and passes them to the Express error handler (500 + JSON body).

### Health

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Returns `{ status, uptime, ts }` |

---

### Components

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/components` | List all tracked components with latest prices |
| POST | `/api/components` | Add a component: `{ name, search_query, category?, alert_price?, notes?, fetch_now? }` |
| PUT | `/api/components/:id` | Update name, category, notes, alert_price, search_query |
| DELETE | `/api/components/:id` | Remove component + all price history |
| POST | `/api/components/:id/refresh` | Force-refresh prices for one component |
| GET | `/api/components/:id/history` | Price history — `?days=30` |
| GET | `/api/components/:id/stats` | Price stats: ATL/ATH, 7d/30d avg, 24h change |
| GET | `/api/components/:id/latest` | Latest per-retailer prices, sorted cheapest first |
| POST | `/api/components/:id/pause` | Pause auto-refresh (`{ paused: true/false }`) |
| POST | `/api/components/:id/interval` | Set per-component refresh interval (`{ interval_minutes: N }`) |
| POST | `/api/components/:id/unit` | Set unit quantity/type (`{ unit_quantity, unit_type }`) |
| GET | `/api/components/:id/urls` | List tracked URLs for this component |
| POST | `/api/components/:id/urls` | Add a URL: `{ url, retailer?, label? }` |
| DELETE | `/api/components/:id/urls/:urlId` | Remove a tracked URL |

---

### Search

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/search/retailers` | Direct-scrape UK retailers in parallel, no key needed — `?q=RTX+4080&retailers=scan,ebuyer,...` |
| GET | `/api/search/api` | PricesAPI.io search (40+ retailers) — `?q=query&country=gb` |
| GET | `/api/cex/search` | CeX (used/refurb) — `?q=query&in_stock=&limit=` |
| GET | `/api/pcpartpicker/search` | PCPartPicker UK live scrape — `?category=gpu&q=query&limit=` |
| GET | `/api/awin/search` | AWIN affiliate feed — `?q=query&max=` |
| GET | `/api/search/unified` | **All five sources fanned out and merged in one call** — `?q=query&retailers=...&pcpp_category=&cex_in_stock=` |

`/api/search/unified` is what the Search tab actually calls. It normalizes every source into one offer shape, then clusters them — see `src/services/search-merge.ts` for the listing-dedup (exact URL / same retailer+price) and product-clustering (EAN match / fuzzy name+price) passes. Response shape:

```json
{ "query": "RTX 4070", "clusters": [{ "clusterId": "...", "displayName": "...", "offers": [...], "bestPrice": 579.99, "confidence": "ean" }],
  "perSource": [{ "source": "retailers", "ok": true, "count": 3 }, ...] }
```

`confidence` is `"ean"` (barcode-matched, deterministic), `"fuzzy"` (name+price similarity, shown to the user as "possibly the same item"), or `"single"` (no match). The four non-unified endpoints above still work standalone and are what `/api/search/unified` calls internally in parallel.

---

### Builds

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/builds` | List all builds |
| POST | `/api/builds` | Create build: `{ name, description? }` |
| GET | `/api/builds/:id` | Get build with all component details |
| DELETE | `/api/builds/:id` | Delete build (components are not deleted) |
| POST | `/api/builds/:id/items` | Add component to build: `{ component_id, quantity?, notes? }` |
| DELETE | `/api/builds/:id/items/:componentId` | Remove component from build |

---

### Scheduler

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/scheduler` | Get scheduler status (active, interval, last run, next run) |
| POST | `/api/scheduler` | Configure scheduler: `{ interval_minutes, notify_drop_percent? }` |

---

### Config

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/config` | Get all config key-value pairs |
| POST | `/api/config` | Set/update config keys: `{ key: value, ... }` |
| DELETE | `/api/config/:key` | Delete a config key |

---

### Notifications

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/notifications/status` | Check which channels are configured |
| POST | `/api/notifications/test` | Send test message — `{ channel?: "discord"|"slack"|"telegram"|"ntfy"|"pushover"|"all" }` |

---

### Alerts & Price Drops

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/alerts` | Components whose current price ≤ alert threshold |
| GET | `/api/price-drops` | Components with price drops in last 24h — `?min_drop_percent=2` |
| GET | `/api/stock-changes` | Recent in/out-of-stock changes — `?hours=24` |

---

### Waitlist

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/waitlist` | List waitlist entries |
| POST | `/api/waitlist` | Add component: `{ component_id, retailer?, max_price? }` |
| DELETE | `/api/waitlist/:id` | Remove from waitlist |

---

### Pre-Built Systems

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/prebuilts` | List all tracked pre-built systems |
| POST | `/api/prebuilts` | Track a new system: `{ name, search_query, category?, brand?, cpu?, gpu?, ram?, storage?, os?, alert_price?, notes? }` |
| PUT | `/api/prebuilts/:id` | Update system details |
| DELETE | `/api/prebuilts/:id` | Remove system + history |
| POST | `/api/prebuilts/:id/refresh` | Refresh prices across all 15 retailers |
| GET | `/api/prebuilts/:id/history` | Price history — `?days=30` |
| GET | `/api/prebuilts/:id/stats` | Price stats for pre-built |
| GET | `/api/prebuilts/:id/latest` | Latest per-retailer prices |
| POST | `/api/prebuilts/:id/alert` | Set alert price: `{ alert_price: N|null }` |

---

### Keepa (Amazon Price History)

Requires `keepa_api_key` in config.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/keepa/search` | Search products — `?q=RTX+4080` |
| GET | `/api/keepa/product/:asin` | Full price history + stats for an ASIN |
| GET | `/api/keepa/used/:asin` | Used/refurb price history for an ASIN |

---

### AWIN Affiliate

Requires `awin_publisher_id` and `awin_api_key` in config. AWIN's product catalogue is only as wide as the merchants that have approved *your* publisher account — check which ones that is with `GET /api/awin/merchants` (also surfaced as a "Check joined merchants" button in Settings) before assuming a given retailer is covered.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/awin/search` | Search AWIN product catalogue — `?q=query&merchant_id=` |
| GET | `/api/awin/merchants` | List merchants that have approved this publisher account |
| GET | `/api/awin/feed` | Browse product feed — `?merchant_id=&page=1` |

AWIN is also wired into `GET /api/search/unified` (§ Search, above) as a fifth source. Its feed carries three fields none of the other four sources provide, all consumed for real:

- **`ean`** (barcode) — the strongest possible product-matching signal. Two offers sharing an EAN are merged into one product cluster regardless of price gap or how differently their names read, since a barcode match is a deterministic identity rather than a guess.
- **`imageUrl`** — shown as a thumbnail on the product and the individual offer, the first product photos to appear anywhere in Search.
- **`rrp`** — when the retailer's own price undercuts it, renders as a "N% off RRP" badge, a deal signal none of the other sources can supply.

---

### Amazon PA API

Requires `amazon_access_key`, `amazon_secret_key`, `amazon_associate_tag`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/amazon/search` | Search Amazon UK — `?q=query&page=1` |
| GET | `/api/amazon/items` | Get items by ASIN — `?asins=B08XYZ,B09ABC` |

---

### eBay

Requires `ebay_client_id` and `ebay_client_secret`.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/ebay/search` | Search eBay UK listings — `?q=query&limit=20` |
| GET | `/api/ebay/item/:itemId` | Get single eBay item detail |

---

### CeX (WeBuyAnyCex)

No API key required — scrapes the CeX website.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/cex/search` | Search CeX buy/sell prices — `?q=query` |
| GET | `/api/cex/product/:id` | CeX product detail by box ID |

---

### Saved Searches

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/saved-searches` | List all saved searches |
| POST | `/api/saved-searches` | Save a search: `{ name, query, max_price?, category? }` |
| DELETE | `/api/saved-searches/:id` | Delete a saved search |
| POST | `/api/saved-searches/:id/run` | Run the search now and update result count |

---

### Dataset (Parts DB)

Browse the static component benchmark / pricing dataset.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/dataset` | Browse dataset — `?category=gpu&page=1&limit=20&q=search` |
| GET | `/api/dataset/search` | Full-text search — `?q=RTX+4070` |
| GET | `/api/dataset/slugs` | List all known component slugs |

---

### PCPartPicker

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/pcpartpicker/search` | Search PCPartPicker UK — `?q=query&category=` |
| GET | `/api/pcpartpicker/product` | Product detail — `?url=https://uk.pcpartpicker.com/...` |
| POST | `/api/pcpartpicker/apify` | Trigger Apify scraper — `{ startUrls: [...] }` (requires `apify_api_token`) |

---

### Apify Cloud Actor Scrapers

All endpoints below require `APIFY_API_TOKEN`. They run real cloud actors on the Apify platform and return
live data. Allow 30–180 s per call (actor cold-start + execution). The token can be set in the web UI under
Settings → API Keys or via the `configure_api_keys` MCP tool.

| Method | Path | Query params | Description |
|--------|------|--------------|-------------|
| GET | `/api/apify/currys` | `q`, `max` (default 20) | Search Currys.co.uk — returns name, price, stock status, URL |
| GET | `/api/apify/google-shopping` | `q`, `country` (default `GB`), `max` (default 40) | Google Shopping multi-merchant offers |
| GET | `/api/apify/argos` | `q`, `max` (default 20) | Search Argos.co.uk — returns name, price, stock status, URL |
| GET | `/api/apify/idealo` | `q`, `max` (default 30) | idealo.co.uk comparison — includes shipping & total prices |
| GET | `/api/apify/amazon` | `asin` or `url`, `country` (default `GB`) | Amazon product detail (price, rating, features, seller) |

---

### Tags

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tags` | List all tags |
| POST | `/api/tags` | Create tag: `{ name, color? }` |
| DELETE | `/api/tags/:id` | Delete tag |
| GET | `/api/components/:id/tags` | Get tags for a component |
| POST | `/api/components/:id/tags` | Add tag to component: `{ tag_id }` |
| DELETE | `/api/components/:id/tags/:tagId` | Remove tag from component |

---

### Import

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/import/csv` | Bulk import components from CSV (multipart form, field `file`) |
| POST | `/api/import/json` | Bulk import from JSON array body |

CSV columns: `name` (required), `search_query` (required), `category`, `alert_price`, `notes`, `source_url`.

---

### Scrape Rules

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/scrape-rules` | List all per-domain CSS rules |
| POST | `/api/scrape-rules` | Set/update rule for a domain |
| DELETE | `/api/scrape-rules/:domain` | Delete a rule |
| POST | `/api/scrape-rules/bootstrap` | Auto-bootstrap rules from a URL using JSON-LD or meta tags |

---

### Benchmark

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/benchmark` | Look up PassMark / performance score — `?q=RTX+4080&type=auto|gpu|cpu` |

---

### Advisor

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/advisor/budget` | Budget allocation — `?budget=1500&use_case=gaming_1440p` |
| GET | `/api/advisor/deals` | Deal scores for all tracked components |
| GET | `/api/advisor/benchmark-compare` | Compare two components — `?a=RTX+4080&b=RTX+4070&type=auto` |
| GET | `/api/advisor/value` | Best value components in a price range — `?type=gpu&budget_max=500&top_n=10` |
| POST | `/api/advisor/build-vs-buy` | Build vs buy analysis — `{ cpu, gpu, ram_gb, storage_gb }` |
| POST | `/api/advisor/upgrade` | Upgrade path recommendations — `{ current_cpu, current_gpu, budget, use_case }` |
| POST | `/api/advisor/compat` | Compatibility check — `{ cpu, motherboard, ram, ... }` |

**`use_case` values:** `gaming_1080p`, `gaming_1440p`, `gaming_4k`, `workstation`, `streaming`, `office`, `htpc`

---

### Export & Backup

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/export` | Export data file — `?type=price_history|build|tracked_components&format=csv|json&id=N&days=90` |
| GET | `/api/export/backup` | Full database backup as JSON (credentials excluded) |

---

## 6. MCP Tool Catalogue

The MCP server exposes the following tools over stdio. All tool names are listed with their required parameters.

### Search & Discovery

| Tool | Required params | Description |
|------|----------------|-------------|
| `search_components` | `query` | Search PricesAPI.io for UK component prices (not saved) |
| `search_uk_retailers` | `query` | Search across UK PC retailers for any product |

### Tracking

| Tool | Required | Optional | Description |
|------|----------|----------|-------------|
| `track_component` | `name`, `search_query` | `category`, `alert_price`, `notes`, `fetch_now`, `country` | Add to watchlist |
| `untrack_component` | `id` | — | Remove from watchlist |
| `list_tracked` | — | — | Show all tracked components |
| `set_price_alert` | `id`, `alert_price` | — | Set/remove alert threshold |

### Price Data

| Tool | Required | Optional | Description |
|------|----------|----------|-------------|
| `get_latest_prices` | `id` | — | Current prices per retailer |
| `get_price_history` | `id` | `days`, `show_trend` | Stored price history |
| `get_price_stats` | `id` | — | ATL/ATH, 7d/30d avg, 24h change |
| `refresh_prices` | — | `id`, `country` | Fetch fresh prices (all if no `id`) |
| `check_price_alerts` | — | — | Show triggered alerts |
| `get_price_drops` | — | `min_drop_percent` | Price drops in last 24h |

### eBay (secondhand)

| Tool | Required | Description |
|------|----------|-------------|
| `get_ebay_gpu_prices` | `query` | Median eBay GPU prices from pcprice.watch |
| `get_ebay_component_prices` | `query`, `category` | eBay prices for cpu/gpu/ram/motherboard |
| `list_supported_gpus` | — | All supported GPU models |
| `list_supported_components` | `category` | All supported models by category |

### Amazon

| Tool | Required | Description |
|------|----------|-------------|
| `get_amazon_price_history` | `query` | CamelCamelCamel ATL/ATH + 30d avg |

### Comparison

| Tool | Required | Description |
|------|----------|-------------|
| `compare_components` | `ids` (2–5) | Side-by-side price table |
| `compare_builds` | `build_ids` (2–4) | Side-by-side build cost |

### Export

| Tool | Required | Optional | Description |
|------|----------|----------|-------------|
| `export_data` | `type` | `format`, `id`, `days` | Export to CSV/JSON file |

### PCPartPicker

| Tool | Required | Optional | Description |
|------|----------|----------|-------------|
| `import_pcpartpicker` | `url` | `create_build`, `track_components` | Import a PCPartPicker list URL |
| `export_to_pcpartpicker` | `build_id` | — | Generate PCPartPicker search links |

### URL-based tracking

| Tool | Required | Optional | Description |
|------|----------|----------|-------------|
| `track_url` | `url` | `category`, `alert_price`, `notes` | Paste any product URL to track |
| `set_scrape_rule` | `domain` | All selector fields | CSS rules for a domain |
| `delete_scrape_rule` | `domain` | — | Remove domain rule |
| `list_scrape_rules` | — | — | Show all saved rules |

### Notifications

| Tool | Optional | Description |
|------|----------|-------------|
| `configure_notifications` | All fields nullable | Set Discord/Slack/Telegram/email/ntfy/Pushover config |
| `test_notification` | `channel` | Send test to all or specific channel |

### Scheduler

| Tool | Optional | Description |
|------|----------|-------------|
| `configure_scheduler` | `interval_minutes`, `notify_drop_percent` | Set auto-refresh interval |
| `get_scheduler_status` | — | Current scheduler state |

### Waitlist / Stock

| Tool | Required | Optional | Description |
|------|----------|----------|-------------|
| `add_to_waitlist` | `component_id` | `retailer`, `max_price` | Watch for restock |
| `remove_from_waitlist` | `component_id` | — | Remove from waitlist |
| `list_waitlist` | — | — | Show waitlist |
| `check_stock_changes` | — | `hours` | Recent stock transitions |

### VAT

| Tool | Required | Description |
|------|----------|-------------|
| `set_vat_mode` | `mode` | `inc_vat` (default) or `ex_vat` (strips UK 20%) |

### Builds

| Tool | Required | Optional | Description |
|------|----------|----------|-------------|
| `create_build` | `name` | `description` | New build |
| `list_builds` | — | — | All builds |
| `get_build` | `id` | — | Build detail |
| `add_to_build` | `build_id`, `component_id` | `quantity`, `notes` | Add component |
| `remove_from_build` | `build_id`, `component_id` | — | Remove component |
| `delete_build` | `id` | — | Delete build |

### Pre-built Systems

| Tool | Required | Optional | Description |
|------|----------|----------|-------------|
| `search_prebuilt_pcs` | `query` | `retailers` | Search 15 UK retailers |
| `track_prebuilt_pc` | `name`, `search_query` | All spec fields, `alert_price`, `fetch_now` | Monitor a system |
| `list_tracked_prebuilts` | — | — | All tracked systems |
| `refresh_prebuilt_prices` | `id` | `retailers` | Refresh prices |
| `get_prebuilt_price_history` | `id` | `days` | Price history |
| `compare_prebuilt_systems` | `ids` (2–5) | — | Side-by-side comparison |
| `set_prebuilt_alert` | `id`, `alert_price` | — | Set/remove alert |
| `remove_tracked_prebuilt` | `id` | — | Stop tracking |

### Apify Cloud Actor Scrapers

Requires `apify_api_token`. Calls run ~30–180 s each (actor cold-start + execution).

| Tool | Required | Optional | Description |
|------|----------|----------|-------------|
| `apify_currys` | `query` | `max_items` (default 20) | Live Currys.co.uk search — name, price, stock, URL |
| `apify_google_shopping` | `query` | `country_code` (default `GB`), `max_results` (default 40) | Google Shopping multi-merchant offers — cheapest price across the web |
| `apify_argos` | `query` | `max_items` (default 20) | Live Argos.co.uk search — name, price, stock, URL |
| `apify_idealo` | `query` | `max_items` (default 30) | idealo.co.uk price comparison — shipping & total prices per retailer |
| `apify_amazon` | `asin_or_url` | `country_code` (default `GB`) | Amazon product detail — price, rating, seller, brand, features |

### Keepa

Requires `keepa_api_key`.

| Tool | Required | Description |
|------|----------|-------------|
| `keepa_search` | `query` | Amazon UK products with full price history |
| `keepa_product` | `asin` | Full Keepa product detail |
| `keepa_used` | `asin` | Used/refurb history |

---

## 7. Notification Channels

Configure via `POST /api/config` or the Settings tab. Test via `POST /api/notifications/test`.

### Discord

Set `discord_webhook_url`. Create a webhook in your server: **Channel Settings → Integrations → Webhooks → New Webhook → Copy Webhook URL**.

### Slack

Set `slack_webhook_url`. Create via Slack's Incoming Webhooks app or via API.

### Telegram

1. Message `@BotFather` → `/newbot` to get your `telegram_bot_token`.
2. Start a chat with your bot or add it to a group.
3. Call `https://api.telegram.org/bot<TOKEN>/getUpdates` to find your `telegram_chat_id`.

### ntfy (recommended — no account needed)

1. Install the ntfy app (Android/iOS) or use the web at [ntfy.sh](https://ntfy.sh).
2. Set `ntfy_topic` to any unique string (e.g. `my-pc-alerts-abc123`).
3. Subscribe to `https://ntfy.sh/<your-topic>` in the app.
4. Optionally set `ntfy_server` to a self-hosted ntfy instance URL.

No API key needed for the public ntfy.sh server (rate-limited to 250 messages/day).

### Email (Resend)

1. Create a free account at [resend.com](https://resend.com).
2. Verify a domain or use Resend's shared sending domain.
3. Set `resend_api_key` and `alert_email`.

### Pushover

1. Register at [pushover.net](https://pushover.net) — $5 one-time per platform.
2. Create an application to get `pushover_app_token`.
3. Find your `pushover_user_key` on the dashboard.

### Gotify / Apprise

Self-hosted options. Set `gotify_server_url` + `gotify_app_token`, or `apprise_url` (supports 50+ providers via the Apprise URL scheme).

### Generic Webhook

For anything not covered above — n8n, Zapier, Make, Home Assistant, a script of your own. Set `generic_webhook_url` and every notification (`price_alert`, `price_drop`, `restock`, `test`, `saved_search`) is POSTed there as raw JSON, unlike the Discord/Slack senders which reshape the payload into those platforms' own message formats:

```json
{ "type": "price_drop", "componentName": "RTX 4070 SUPER", "price": 579.99, "currency": "GBP",
  "retailer": "Ebuyer", "dropAmount": 20.00, "dropPercent": 3.3, "url": "https://...", "timestamp": "2026-07-06T18:02:00Z" }
```

---

## 8. Scheduler & Auto-Refresh

The scheduler runs inside the web server process. Configure via `POST /api/scheduler`:

```json
{ "interval_minutes": 60, "notify_drop_percent": 5 }
```

- Set `interval_minutes: 0` to disable.
- Minimum interval: 1 minute.
- `notify_drop_percent` (default 5): only send a notification if a price dropped by at least this percentage.
- Per-component overrides: use `POST /api/components/:id/interval` to set a different refresh rate for specific items.
- Paused components (`paused: true`) are skipped by the scheduler.
- The scheduler status (active, next run time, interval) is shown in the sidebar of the dashboard.

On each scheduler tick:
1. Refresh all non-paused components.
2. Record new price rows.
3. Check for stock changes and log to `stock_history`.
4. Evaluate alert thresholds and price drop conditions.
5. Send notifications to all configured channels.

---

## 9. URL-Based Scraping

`track_url` accepts any product URL and uses a multi-stage extraction pipeline:

1. **JSON-LD** — `<script type="application/ld+json">` product schema (most reliable; used by Currys, JL, AO)
2. **Open Graph / meta tags** — `og:price:amount`, `product:price:amount`
3. **Saved scrape rule** — your per-domain CSS selectors (`/api/scrape-rules`)
4. **Generic CSS heuristics** — common price class patterns across known UK retailers
5. **Playwright** — full headless browser render with stealth patches (see §10); handles JS-rendered prices and cookie walls
6. **Byparr** — Cloudflare Turnstile / managed-challenge solver, only tried if Playwright's render also failed (see §10)
7. **AI extraction** — sends page HTML to Anthropic/OpenAI with a structured extraction prompt (requires `anthropic_api_key` or `openai_api_key`)

Each stage is only attempted if the previous returned no result. The Playwright stage uses whichever backend is configured in priority order (Novada → Camoufox → local Chromium).

**Setting a scrape rule** for a site that doesn't auto-extract:

```bash
POST /api/scrape-rules
{
  "domain": "scan.co.uk",
  "price_selector": ".price-now",
  "name_selector": "h1.product-title",
  "avail_selector": ".stock-info"
}
```

`price_regex` can extract a number from messy text: e.g. `"(\\d+\\.\\d{2})"`.

If a URL scrape fails, `last_scrape_failed` is set to 1 and the component shows a warning badge in the dashboard.

---

## 10. Browser Integration (Playwright / Novada / Camoufox / Byparr)

The scraper picks its browser backend using a priority chain evaluated at startup:

| Priority | Backend | Config key | When to use |
|----------|---------|-----------|------------|
| 1 | **Novada** (cloud) | `novada_browser_ws` | Hardest sites — Overclockers, Scan, Ebuyer; includes IP rotation + CAPTCHA solving |
| 2 | **Camoufox** (self-hosted) | `camofox_url` | Strong fingerprinting resistance without a cloud subscription |
| 3 | **Local Chromium** | *(none)* | General scraping with stealth patches applied |
| 4 | **Byparr** (self-hosted) | `byparr_url` | Last resort — Cloudflare Turnstile / managed challenges that stop all three browser tiers above |

Each of the first three uses the same stealth context layer described below. Byparr is a distinct HTTP challenge-solving service, not a browser Playwright connects to — see its own section below.

Both retailer search (`uk-retailers.ts`) and single-URL tracking (`url-scraper.ts`) escalate through this same chain: a plain `fetch()` is tried first since it's fast and works for a good share of sites, then the browser tiers, then Byparr, before giving up.

### Stealth hardening (applied to all backends)

Every browser context runs a stealth init script injected before any page JavaScript executes. It removes the most common headless-browser detection signals:

| Signal patched | What it does |
|----------------|-------------|
| `navigator.webdriver` | Set to `undefined` (clearest headless tell) |
| `navigator.plugins` / `mimeTypes` | Three realistic entries matching real Chrome |
| `navigator.languages` / `language` | `['en-GB', 'en']` (empty in vanilla headless) |
| `window.chrome` | Full mock: `runtime`, `app`, `loadTimes`, `csi` |
| `permissions.query('notifications')` | Returns `'denied'` (real Chrome behaviour) |
| `WebGLRenderingContext.getParameter` | Returns `"Intel Inc."` / `"Intel Iris OpenGL Engine"` |
| `HTMLCanvasElement.toDataURL` | ±1 pixel noise per context — unique fingerprint per session |
| `navigator.connection` | `{ effectiveType: '4g', rtt: 50, downlink: 10 }` |

**Per-context randomisation:** viewport (8 realistic sizes from 1280×720 to 2560×1440), `deviceScaleFactor` (1 or 1.5), 50–300 ms pre-navigation jitter.

**Full HTTP headers:** `Accept`, `Accept-Language`, `Sec-Ch-Ua-Platform`, `Sec-Fetch-*`, `Upgrade-Insecure-Requests` — matching a genuine browser request.

**UA pool:** Chrome 129–131 on Windows/Mac/Linux, Edge 131, Firefox 132, Safari 18 — updated to current versions.

**Launch flags (local Chromium):** `--disable-blink-features=AutomationControlled` removes `navigator.webdriver` at the browser level in addition to the JS patch.

### Local Chromium

Install the optional peer dependency:

```bash
npm install playwright-core
npx playwright install chromium
```

Set `PLAYWRIGHT_CHROMIUM_PATH` if Chromium is in a non-standard location (e.g. `/opt/pw-browsers/chromium`).

### Novada Browser API (CDP)

Novada provides a cloud-hosted anti-detect browser with residential proxy rotation and CAPTCHA solving.

1. Get a WebSocket endpoint from [novada.io](https://novada.io).
2. Set `novada_browser_ws` in config (e.g. `wss://browser.novada.io/...`).
3. Set `novada_api_key` if required by your plan.

Playwright connects via `chromium.connectOverCDP(wsEndpoint)`. The stealth init script is still applied on top of Novada's own hardening.

### Camoufox (self-hosted anti-detect Firefox)

Camoufox patches Firefox at the C++ level for fingerprint resistance, making JS-level detection far harder than with Chromium-based solutions.

```bash
# Install
pip install camoufox[geoip]
camoufox fetch

# Start the server (exposes a CDP WebSocket endpoint)
camoufox server --port 9377
```

Set `camofox_url` to the WebSocket URL (e.g. `ws://localhost:9377`). Playwright will attempt `chromium.connectOverCDP` first, then fall back to `firefox.connect` for non-CDP modes.

Docker alternative: `docker run -p 9377:9377 ghcr.io/daijro/camoufox:latest`

### Byparr (self-hosted Cloudflare Turnstile / managed-challenge solver)

Byparr is a Camoufox-backed, drop-in-compatible replacement for FlareSolverr's challenge-solving API — it navigates a real browser through a Cloudflare challenge and hands back the solved page's HTML and cookies.

```bash
docker run -d --name byparr -p 8191:8191 --restart unless-stopped ghcr.io/thephaseless/byparr
```

Set `byparr_url` to the server's address (e.g. `http://localhost:8191`, or `http://<nas-ip>:8191` if the app and Byparr run in separate containers). Any FlareSolverr-compatible server works at this config key — Byparr is the recommended one since it shares Camoufox's fingerprint resistance.

Byparr only runs when the browser tiers above return nothing — it's slower (a full challenge solve takes several seconds) and only worth the wait for sites that specifically fail with a Cloudflare Turnstile or "managed challenge" page rather than a plain 403.

### ChangeDetection.io (selector helper — not a scraping backend)

[ChangeDetection.io](https://github.com/dgtlmoon/changedetection.io) is a general-purpose page-monitoring tool with a point-and-click **Visual Selector** — a much faster way to find a product page's price element than opening DevTools and reading the markup by hand.

This app doesn't call its API or route any scraping through it — that would mean two systems independently deciding when a price last changed (this app's own scheduler, and ChangeDetection.io's). It's wired in purely as a helper tool:

```bash
docker run -d --name changedetection -p 5000:5000 --restart unless-stopped ghcr.io/dgtlmoon/changedetection.io
```

1. Set `changedetection_url` in Settings → Scraper (e.g. `http://<nas-ip>:5000`) — this only adds an "Open →" shortcut, nothing else reads it.
2. Open it, add the stubborn product page as a watch, and use its Visual Selector to click directly on the price.
3. Copy the CSS selector it finds and save it as a scrape rule for that domain:

```bash
POST /api/scrape-rules
{ "domain": "example.co.uk", "price_selector": ".the-selector-it-found" }
```

That rule then feeds into this app's own extraction chain (§9) the normal way — Byparr and Camoufox are backends `scrapeProductUrl()` calls automatically; ChangeDetection.io is a tool you use once, by hand, to figure out what to tell that chain.

**Running everything on one NAS**, a minimal `docker-compose.yml` alongside the app itself:

```yaml
services:
  camoufox:
    image: ghcr.io/daijro/camoufox:latest
    ports: ["9377:9377"]
    restart: unless-stopped
  byparr:
    image: ghcr.io/thephaseless/byparr
    ports: ["8191:8191"]
    restart: unless-stopped
  changedetection:
    image: ghcr.io/dgtlmoon/changedetection.io
    ports: ["5000:5000"]
    restart: unless-stopped
```

Then set `camofox_url=http://camoufox:9377`, `byparr_url=http://byparr:8191`, and `changedetection_url=http://changedetection:5000` (or the NAS's LAN IP if the app runs outside this compose network) in Settings → Scraper.

---

## 11. Export & Import

### Export

| Format | Endpoint | Description |
|--------|----------|-------------|
| Tracked components CSV | `GET /api/export?type=tracked_components` | All components with latest price |
| Price history CSV | `GET /api/export?type=price_history&id=N&days=90` | N days of price records |
| Price history JSON | `GET /api/export?type=price_history&id=N&format=json` | Same, JSON format |
| Build CSV | `GET /api/export?type=build&id=N` | Build + components |
| Full backup JSON | `GET /api/export/backup` | Complete DB state (credentials excluded) |

### Import

**CSV format** for `POST /api/import/csv`:

```csv
name,search_query,category,alert_price,notes
RTX 4080 Super,rtx 4080 super,gpu,700,
DDR5 32GB 6000MHz,corsair vengeance ddr5 32gb 6000,ram,,dual channel kit
```

**JSON format** for `POST /api/import/json`:

```json
[
  { "name": "RTX 4080 Super", "search_query": "rtx 4080 super", "category": "gpu" },
  { "name": "Ryzen 7 7800X3D", "search_query": "ryzen 7 7800x3d", "category": "cpu", "alert_price": 320 }
]
```

Duplicate detection is based on `search_query` — existing entries are skipped.

**Import PCPartPicker** via MCP:

```
import_pcpartpicker url="https://uk.pcpartpicker.com/list/XXXXXX" create_build=true track_components=true
```

---

## 12. Advisor Engine

The Advisor tab provides AI-free local recommendations using built-in benchmark databases (PassMark CPU/GPU scores) and price tier tables.

### Budget allocator (`/api/advisor/budget`)

Given a total budget and use-case, returns suggested per-category GBP allocations:

- **Use cases:** `gaming_1080p`, `gaming_1440p`, `gaming_4k`, `workstation`, `streaming`, `office`, `htpc`
- CPU and GPU rows include PassMark benchmark data for suggested components.

### Deal scores (`/api/advisor/deals`)

Calculates a deal score for every tracked component based on:
- Current best price vs 30-day average
- Current price vs all-time low
- Stock availability

### Benchmark compare (`/api/advisor/benchmark-compare`)

Compares any two CPU or GPU model names and returns:
- PassMark scores for each
- Which is faster and by what percentage

### Value finder (`/api/advisor/value`)

Finds best performance-per-pound in a budget range. Uses tier-based price estimates (`budget` ~£80, `entry` ~£130, `mid` ~£220, `mid-high` ~£340, `high` ~£520, `ultra` ~£850).

### Upgrade advisor (`/api/advisor/upgrade`)

Given your current CPU + GPU and a budget, recommends the most impactful upgrade for your use case.

### Build vs buy (`/api/advisor/build-vs-buy`)

Compares the cost of self-building (sum of tracked component prices) against pre-built systems for the same spec level.

### Compatibility check (`/api/advisor/compat`)

Checks for known compatibility issues between components (socket match, DDR5/DDR4, PCIe gen, M.2 slot count, etc.).

---

## 13. Deployment

### Environment variables summary

```bash
PORT=3456
DB_PATH=/data/pc-prices.db
EXPORT_DIR=/exports
PRICES_API_KEY=your_key
```

### Docker example

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY dist/ ./dist/
COPY public/ ./public/
VOLUME ["/app/data", "/app/exports"]
EXPOSE 3456
CMD ["node", "dist/web-standalone.js"]
```

### Reverse proxy (Nginx)

```nginx
location /pc-price/ {
    proxy_pass http://127.0.0.1:3456/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_cache_bypass $http_upgrade;
}
```

### systemd service

```ini
[Unit]
Description=UK PC Price Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/uk-pc-price-mcp
ExecStart=/usr/bin/node dist/web-standalone.js
Restart=on-failure
EnvironmentFile=/opt/uk-pc-price-mcp/.env

[Install]
WantedBy=multi-user.target
```

---

*Last updated: 2026-07-03*
