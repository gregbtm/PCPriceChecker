# PC Price Checker

**UK PC component price tracker with a web dashboard and Claude MCP server.**

Track GPU, CPU, RAM, storage, and pre-built PC prices across 40+ UK retailers. Get price-drop alerts, view history charts, and ask Claude natural-language questions about your watchlist — all from a single self-hosted tool.

---

## What it does

- **Live price search** across 40+ UK retailers via PricesAPI.io (Scan, Ebuyer, Overclockers, CCL, Novatech, Amazon UK, Argos, Currys, John Lewis, and more)
- **Price history tracking** — SQLite-backed snapshots with 30-day trend charts and all-time low / high stats
- **Price-drop alerts** — set a threshold per component; get notified via Discord, Slack, Telegram, ntfy, Pushover, or email
- **Pre-built PC tracking** — monitor gaming desktops and workstations across 15 UK system builders
- **Build planner** — budget advisor, build vs. buy calculator, compatibility checker, deal scorer
- **eBay secondhand prices** — scrape sold listings for 100+ GPU/CPU models
- **PCPartPicker integration** — import lists, search 66,000+ component specs, browse by category
- **Amazon data** — Keepa price history, PA API product data, or Apify scraper fallback
- **Apify cloud scrapers** — Currys, Google Shopping, Argos, Idealo, Amazon (no bot detection issues)
- **Stealth browser scraper** — Playwright with fingerprint hardening; supports Camoufox and Novada as priority backends
- **Auto-refresh scheduler** — background refresh at any interval you choose
- **Export / import** — CSV and JSON export of price history, builds, and tracked components

---

## Architecture

```
┌─────────────────────────────────┐
│  Claude (MCP client)            │  ← Ask natural-language questions
│  or Web Browser                 │  ← Use the dashboard UI
└────────────┬────────────────────┘
             │ stdio / HTTP
┌────────────▼────────────────────┐
│  MCP Server + REST API          │  src/index.ts + src/web.ts
│  50+ tools · 70+ REST endpoints │
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────┐
│  SQLite database (better-sqlite3)│  price history, builds, config
└────────────┬────────────────────┘
             │
┌────────────▼────────────────────┐
│  Data sources                   │
│  · PricesAPI.io                 │
│  · eBay Browse API              │
│  · Keepa / Amazon PA API        │
│  · AWIN affiliate feed          │
│  · PCPartPicker dataset         │
│  · Bing Shopping                │
│  · Reddit (r/buildapc, deals)   │
│  · HotUKDeals                   │
│  · CeX (secondhand)             │
│  · Apify actors (5 retailers)   │
│  · Playwright stealth scraper   │
└─────────────────────────────────┘
```

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+ · TypeScript |
| MCP server | `@modelcontextprotocol/sdk` · stdio transport |
| REST API | Express 5 |
| Database | SQLite via `better-sqlite3` · WAL mode |
| Web UI | Alpine.js v3 · daisyUI v5 · Tailwind CSS · Chart.js |
| Browser scraping | Playwright · Camoufox · Novada CDP |
| Notifications | Discord · Slack · Telegram · ntfy · Pushover · Email (Resend) |
| Cloud scraping | Apify platform actors |

---

## Quick start

### Docker (recommended)

```bash
docker run -d \
  -p 3000:3000 \
  -v ./data:/app/data \
  -e PRICES_API_KEY=your_key_here \
  ghcr.io/gregbtm/pc-price-checker:latest
```

Open `http://localhost:3000` — add a component, prices load immediately.

### From source

```bash
git clone https://github.com/gregbtm/PCPriceChecker
cd PCPriceChecker/pc-price-mcp
npm install
npm run build
PRICES_API_KEY=your_key node dist/index.js
```

---

## Configuration

All configuration is stored in SQLite and can be set through the web UI (Settings tab) or via the `configure_api_keys` MCP tool. No restart required.

| Key | Required | Description |
|-----|----------|-------------|
| `prices_api_key` | **Yes** | PricesAPI.io key — free tier covers 50k calls/month |
| `apify_api_token` | No | Unlocks Currys, Argos, Google Shopping, Idealo, Amazon scrapers |
| `keepa_api_key` | No | Amazon price history (Keepa) |
| `ebay_client_id` / `ebay_client_secret` | No | eBay Browse API |
| `amazon_access_key` / `amazon_secret_key` / `amazon_associate_tag` | No | Amazon PA API |
| `discord_webhook_url` | No | Price-drop notifications |
| `slack_webhook_url` | No | Price-drop notifications |
| `telegram_bot_token` / `telegram_chat_id` | No | Telegram alerts |
| `ntfy_topic` | No | ntfy push (no account needed) |
| `novada_browser_ws` | No | Novada cloud anti-detect browser (priority 1 scraper) |
| `camofox_url` | No | Camoufox self-hosted Firefox (priority 2 scraper) |

Get a free PricesAPI key at [pricesapi.io](https://pricesapi.io).

---

## MCP setup (Claude Desktop / Claude Code)

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pc-price-checker": {
      "command": "node",
      "args": ["/path/to/pc-price-mcp/dist/index.js"],
      "env": {
        "PRICES_API_KEY": "your_key_here"
      }
    }
  }
}
```

Then ask Claude things like:

- *"Track an RTX 5080 and alert me if it drops below £900"*
- *"What's the best value GPU under £400 right now?"*
- *"Design a 1440p gaming build under £1,200 and track all the parts"*
- *"Show me eBay secondhand prices for a used RTX 4090"*
- *"Compare the RTX 5070 Ti Super vs RX 9070 XT — performance per pound"*

---

## MCP tools (50+)

| Category | Tools |
|----------|-------|
| Search | `search_components`, `search_uk_retailers`, `search_prebuilt_pcs` |
| Tracking | `track_component`, `untrack_component`, `list_tracked`, `set_price_alert` |
| Prices | `get_latest_prices`, `get_price_history`, `refresh_prices`, `get_price_drops` |
| eBay | `ebay_gpu_prices`, `ebay_component_prices` |
| PCPartPicker | `pcpartpicker_specs`, `pcpartpicker_browse`, `import_pcpartpicker` |
| Builds | `create_build`, `add_to_build`, `compare_components`, `budget_builder` |
| Advisor | `build_vs_buy`, `upgrade_advisor`, `benchmark_lookup`, `check_compatibility` |
| Apify | `apify_currys`, `apify_google_shopping`, `apify_argos`, `apify_idealo`, `apify_amazon` |
| Alerts | `check_price_alerts`, `add_to_waitlist`, `check_stock_changes` |
| Config | `configure_api_keys`, `configure_notifications`, `configure_scheduler` |

Full tool reference: [`pc-price-mcp/DOCS.md`](./pc-price-mcp/DOCS.md)

---

## Notification channels

| Channel | Setup |
|---------|-------|
| Discord | Create a webhook in Channel Settings → Integrations |
| Slack | Create an Incoming Webhook app |
| Telegram | Create a bot via `@BotFather`, get your `chat_id` |
| **ntfy** | Just set a topic — no account needed for ntfy.sh (recommended) |
| Pushover | Get app and user keys from pushover.net |
| Email | Resend API key + verified sending domain |

---

## Anti-bot scraping

The Playwright scraper uses a three-tier priority chain:

1. **Novada** (cloud anti-detect, set `novada_browser_ws`) — best for heavily-protected sites
2. **Camoufox** (self-hosted Firefox, set `camofox_url`) — real Firefox profile, no automation flags
3. **Local Chromium** — built-in stealth layer (removes `navigator.webdriver`, spoofs plugins, mimeTypes, WebGL renderer, canvas noise, randomised viewport/timing)

---

## License

MIT
