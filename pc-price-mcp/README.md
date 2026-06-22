# UK PC Component Price MCP Server

An MCP (Model Context Protocol) server for tracking PC component prices across UK retailers. Search for GPUs, CPUs, RAM, motherboards, and more — with price history tracking, alert thresholds, and eBay secondhand price monitoring.

## Features

- **Multi-retailer search** — Amazon UK, Scan, Ebuyer, Overclockers UK, and 40+ others via PricesAPI.io
- **Price history tracking** — SQLite-backed local database, track trends over time
- **Price alerts** — get notified when components drop below your target price
- **eBay secondhand prices** — scrapes pcprice.watch for used GPU median prices across 100+ countries
- **40+ GPU models** supported (RTX 50/40/30/20, RX 9000/7000, Intel Arc)
- **No cloud required** — everything runs locally

## Data Sources

| Source | What | Coverage |
|--------|------|----------|
| PricesAPI.io | New retail prices | 40+ retailers, GB + 40 countries |
| pcprice.watch | eBay secondhand GPU prices | 100+ eBay markets |

## Setup

### 1. Install dependencies

```bash
cd pc-price-mcp
npm install
npm run build
```

### 2. Get a PricesAPI.io key

Sign up at **https://pricesapi.io** (free, no credit card, 50,000 calls/month).

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

The MCP server will start automatically when Claude opens.

## Available Tools

| Tool | Description |
|------|-------------|
| `search_components` | Search UK prices — returns current offers across retailers |
| `track_component` | Add a component to your watchlist with optional price alert |
| `untrack_component` | Remove a component and delete its price history |
| `list_tracked` | Show all tracked components with latest prices |
| `set_price_alert` | Set or clear a GBP price alert threshold |
| `get_price_history` | View stored price history (raw or daily trend) |
| `get_latest_prices` | Latest price per retailer for a tracked component |
| `refresh_prices` | Fetch fresh prices and save to database |
| `check_price_alerts` | See which tracked components are below their alert price |
| `get_ebay_gpu_prices` | eBay UK secondhand GPU prices from pcprice.watch |
| `list_supported_gpus` | List all GPU models supported for eBay lookup |

## Example Usage

```
Search for an RTX 4080:
→ search_components { query: "RTX 4080 16GB", country: "gb" }

Track it and alert below £650:
→ track_component { name: "RTX 4080", search_query: "RTX 4080 16GB", category: "gpu", alert_price: 650 }

Check all alerts:
→ check_price_alerts

See price trend over 60 days:
→ get_price_history { id: 1, days: 60, show_trend: true }

Check eBay secondhand price:
→ get_ebay_gpu_prices { query: "RTX 4080", country: "gb" }
```

## Important Notes

- **Cold queries** (first search or cache expired) can take **30–90 seconds** — this is a PricesAPI.io limitation. Subsequent searches for the same component return in ~100ms.
- **eBay prices** from pcprice.watch reflect **used/secondhand** market — not new retail pricing.
- PCPartPicker UK (Scan, Overclockers UK, etc.) has no public API — those are covered via PricesAPI.io instead.
- Price data is stored locally in `./data/pc-prices.db` (SQLite).

## Development

```bash
npm run dev    # Run with tsx (no build step)
npm run build  # Compile TypeScript to dist/
npm start      # Run compiled output
```

Set `DB_PATH` environment variable to override the default database location.
