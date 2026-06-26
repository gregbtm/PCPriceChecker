# UK PC Component Price MCP Server

An MCP (Model Context Protocol) server for tracking PC component prices across UK retailers. Search, track price history, set alerts, compare used vs new prices, and plan builds — all locally with zero cloud dependency.

## Features

- **Multi-retailer search** — Amazon UK, Scan, Ebuyer, Overclockers UK, and 40+ others via PricesAPI.io
- **Direct UK retailer scraping** — Scan, Overclockers UK, Ebuyer scraped in parallel (no API key needed)
- **Price history tracking** — SQLite-backed, persists across sessions
- **Price intelligence** — all-time low/high, 7/30-day averages, 24h change detection
- **Price drop alerts** — get notified when components hit your target GBP price
- **eBay secondhand prices** — pcprice.watch scraper for used GPU median prices across 100+ countries
- **Build planner** — group tracked components into named builds, track total cost over time
- **40+ GPU models** supported for eBay lookup (RTX 50/40/30/20, RX 9000/7000, Intel Arc)

## Data Sources

| Source | Coverage | Notes |
|--------|----------|-------|
| PricesAPI.io | 40+ retailers, GB + 40 countries | Requires free API key; cold queries 30–90s |
| Scan.co.uk | Direct scrape | No key needed; best-effort |
| Overclockers UK | Direct scrape | No key needed; best-effort |
| Ebuyer | Direct scrape | No key needed; best-effort |
| pcprice.watch | eBay secondhand, 100+ countries | GPU median prices; used market only |

## Setup

### 1. Install dependencies

```bash
cd pc-price-mcp
npm install
npm run build
```

### 2. Get a free PricesAPI.io key

Sign up at **https://pricesapi.io** (free, no credit card, 50,000 calls/month).

> You can use `search_uk_retailers` without any API key. The key is only needed for `search_components` and `refresh_prices`.

### 3. Configure Claude Desktop

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "uk-pc-price": {
      "command": "node",
      "args": ["/absolute/path/to/pc-price-mcp/dist/index.js"],
      "env": {
        "PRICES_API_KEY": "your_pricesapi_key_here"
      }
    }
  }
}
```

**Config file locations:**
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

### 4. Restart Claude Desktop

## Available Tools (20 total)

### Search
| Tool | Description | API Key? |
|------|-------------|----------|
| `search_components` | 40+ retailer search via PricesAPI.io | ✅ Required |
| `search_uk_retailers` | Scrape Scan, Overclockers UK, Ebuyer in parallel | ❌ None |

### Tracking
| Tool | Description |
|------|-------------|
| `track_component` | Add to watchlist; optionally fetch initial prices |
| `untrack_component` | Remove from watchlist (deletes price history) |
| `list_tracked` | Show all components with best price and alert status |
| `set_price_alert` | Set/remove a GBP alert threshold |

### Price Data & Intelligence
| Tool | Description |
|------|-------------|
| `get_latest_prices` | Latest price per retailer, sorted cheapest first |
| `get_price_history` | Raw records or daily min/avg/max trend table |
| `get_price_stats` | All-time low/high, 7/30-day averages, 24h change |
| `refresh_prices` | Fetch fresh prices and save to DB (shows change vs previous) |
| `check_price_alerts` | Show components at or below their alert price |
| `get_price_drops` | Components where price dropped in last 24h |

### eBay Secondhand
| Tool | Description |
|------|-------------|
| `get_ebay_gpu_prices` | eBay median GPU price via pcprice.watch |
| `list_supported_gpus` | All GPU models supported for eBay lookup |

### Build Planner
| Tool | Description |
|------|-------------|
| `create_build` | Create a named PC build |
| `list_builds` | Show all builds with component count and total cost |
| `get_build` | Full build breakdown: components, prices, total |
| `add_to_build` | Add a tracked component to a build |
| `remove_from_build` | Remove a component from a build |
| `delete_build` | Delete a build (tracked components are kept) |

## Example Workflow

```
# 1. Search and track an RTX 4080
→ search_uk_retailers { query: "RTX 4080 16GB" }
→ track_component { name: "RTX 4080", search_query: "RTX 4080 16GB", category: "gpu", alert_price: 650 }

# 2. Check what it sells for used on eBay
→ get_ebay_gpu_prices { query: "RTX 4080", country: "gb" }

# 3. Plan a full build
→ create_build { name: "Gaming Rig 2024", description: "1440p gaming build" }
→ add_to_build { build_id: 1, component_id: 1 }  # RTX 4080
→ add_to_build { build_id: 1, component_id: 2 }  # CPU (tracked separately)
→ get_build { id: 1 }

# 4. Monitor prices
→ refresh_prices           # update all tracked components
→ get_price_drops          # see what dropped in last 24h
→ check_price_alerts       # see if anything hit your target
→ get_price_stats { id: 1 }  # full statistics for RTX 4080
```

## Notes

- **Cold queries** (first search or cache expired) take **30–90 seconds** on PricesAPI.io. Cached repeats return in ~100ms.
- **Direct retailer scrapers** (Scan, Overclockers, Ebuyer) work best-effort — these sites use JavaScript rendering, so JSON-LD structured data is extracted where available, with HTML fallbacks.
- **eBay prices** from pcprice.watch are secondhand/resale only.
- Price data is stored locally in `./data/pc-prices.db` (SQLite, auto-created on first run).
- Set `DB_PATH` environment variable to override the database location.

## Development

```bash
npm run dev    # Run with tsx (no build step needed)
npm run build  # Compile TypeScript to dist/
npm start      # Run compiled output
```
