# Codebase Audit (2026-10-05)

Scope: static reading of `pc-price-mcp/` via the GitHub API on 2026-10-05. Nothing was executed. Files read in full: `package.json`, `docker-compose.yml`, `src/db.ts`, `src/scheduler.ts`, `src/sources/{keepa,apify,pricesapi,url-scraper,openai-client,uk-retailers}.ts`, `src/services/{compatibility,price-validator}.ts`, root `README.md`. Files **not** read: `src/index.ts` (about 213 KB, the MCP tools), `src/web.ts` (about 43 KB, REST), `notifications.ts`, `export.ts`, `deal-scorer.ts`, `build-advisor.ts`, `playwright-scraper.ts`, `camofox-client.ts`, other `sources/*`, `frontend/`, `public/`, Dockerfile. Findings about code in unread files are marked.

Evidence levels: **Verified** = read in the code; **Inferred** = follows from code but depends on live behaviour or unread files.

## 1. Repository layout (top level)

`.github/`, `.gitlab-ci.yml`, `.gitmodules`, `README.md`, `config.yml`, `content/`, `layouts/`, `netlify/`, `netlify.toml`, `pc-price-mcp/` (the application), `render.yaml`, `skills-lock.json`, `static/`, `themes/`, `vercel.json`. The Hugo-style folders (`content/`, `layouts/`, `themes/`, `static/`, `config.yml`) and the multiple deploy configs (Netlify, Vercel, Render, Fly in `pc-price-mcp/`, Railway) suggest a marketing/docs site plus several deploy targets; their role was not examined.

`pc-price-mcp/`: `Dockerfile`, `docker-compose.yml`, `stack.yml`, `fly.toml`, `railway.toml`, `DEPLOYMENT.md`, `DOCS.md`, `.env.example`, `package.json`, `tsconfig.json`, `src/`, `frontend/`, `public/`, `.claude/`.

## 2. How it works today

- **Runtime:** Node >= 18, TypeScript ES modules (imports use `.js` suffixes), `better-sqlite3` (WAL), Express 5, `@modelcontextprotocol/sdk`, `zod`; `playwright-core` is an optional dependency. **No HTML parser dependency and no test framework** (A-18).
- **Data model (`db.ts`):** `tracked_components` (name, category, search_query, alert_price, notes, source_url, paused, check_interval_minutes, last_scrape_failed, last_alerted_at, unit_quantity, unit_type), `price_records` (source, price, currency, retailer, url, in_stock, recorded_at, is_outlier, confidence, z_score), `component_urls`, `scrape_rules` (per domain: name/price/avail selector, price_attribute, price_regex), `stock_history`, `waitlist`, `saved_searches`, `builds`/`build_items`, `prebuilt_*`, `tags`, `config` (key/value). Migrations are `ALTER TABLE ADD COLUMN` guarded by `PRAGMA table_info`.
- **Scheduler (`scheduler.ts`):** a single `setInterval` (config `auto_refresh_interval_minutes`, bootstrapped from `SCHEDULER_INTERVAL_MINUTES`). For each unpaused component it scrapes `component_urls` (or `source_url`) through `scrapeProductUrl`; **if the component has no URLs it calls PricesAPI only**. It records stock changes, saves snapshots, then fires price-alert (24 h cooldown), price-drop (>= `notify_drop_percent`, default 5%, 6 h cooldown) and restock (waitlist) notifications.
- **Generic URL scraper (`url-scraper.ts`):** fetch HTML, then JSON-LD, Open Graph/meta, per-domain rules, DOM heuristics, Playwright, Camofox (stealth), then LLM extraction (Anthropic Haiku, then OpenAI `gpt-4o-mini`). Failed rules trigger an asynchronous LLM "self-heal" that writes new selectors to `scrape_rules`.
- **UK retailer scrapers (`uk-retailers.ts`):** direct, key-less scrapers for Scan, Overclockers, Ebuyer, CCL, Box, Novatech, Aria, AWD-IT, Corsair, NZXT, Cooler Master, Lian Li, Fractal, Thermaltake, Currys (undocumented JSON endpoint), Argos, John Lewis. Strategy: JSON-LD, then `__NEXT_DATA__`, then custom extractor, then regex product blocks, then "lowest price on page".
- **Other sources:** PricesAPI.io (`country=gb`), Keepa (domain `2` = Amazon.co.uk), Apify community actors (Currys, Google Shopping, Argos, Idealo, Amazon, PCPartPicker), eBay, AWIN, Bing, Reddit, HotUKDeals, CeX, PCPartPicker dataset/live.
- **Services:** `compatibility.ts` (static rules, desktop sockets), `price-validator.ts` (MAD z-score outliers), `deal-scorer.ts`, `build-advisor.ts` (not read).
- **Deployment:** `docker-compose.yml` runs the app image from GHCR plus Watchtower (polls every 5 minutes, auto-updates `:latest`), volume `pc_price_data`, healthcheck `GET /api/health`.

### What is already good (preserve)

Per-component URLs and intervals, pause, tags, unit pricing fields, stock-change history and waitlist, outlier columns, price stats and sparkline queries, export/import with secret stripping, optional stealth scraping, a PriceBuddy-style fallback chain with per-domain rules, a `getComponentsNeedingAttention` query, ntfy and other channels.

## 3. Findings

Each finding: ID, severity, evidence level, evidence, recommended fix (task ID in `docs/IMPROVEMENT_PLAN.md`).

### A-01 Best price and alerts ignore stock (High, Verified) — **Fixed in PR-A** (`getBestInStockOffer`, `services/alerts.ts`; reproduced first by `services/alerts.test.ts`)
`db.getLatestPricePerRetailer()` selects the latest row per retailer/source ordered by `price ASC` with **no `in_stock` filter**. `scheduler.ts` takes `getLatestPricePerRetailer(id)[0]` as `newBest` for the target-price alert and the price-drop alert, and `prevLatest[0]` as `prevBestPrice`. The same pattern is used by `getComponentsBelowAlertPrice`, `getBuildSummary`, `getRecentPriceDrops` (best row) and `getPriceStats` (`current_best` = `MIN(price)` over 48 h with no stock filter) and `getBatchDealRatios`. **Effect:** an out-of-stock listing at a low price triggers "deal" alerts for something that cannot be bought. During a RAM shortage this is the most damaging defect. Fix: P0-1.

### A-02 Stock is binary and defaults to "in stock" (High, Verified; live impact Inferred) — **Fixed in PR-A for `price_records`, the generic scraper and the UK retailer extractors** (`price_records.stock_state`, `services/stock-state.ts`). Still open: `pricesapi`/Keepa/other sources only expose a boolean, so they map to in_stock/out_of_stock/unknown; Scan's live HTML was not inspected, so the "Due 8th Oct" -> backorder behaviour is verified on the text only (**Partly verified**)
`url-scraper.ts`: `tryMeta`, `tryRules`, `tryDom`, and the Playwright evaluation all default `inStock` to `true` when no stock signal is found (`avail ? ... : true`, `availText ? ... : true`, literal `true`). `uk-retailers.ts`: JSON-LD uses `offer?.availability ? !includes('OutOfStock') : true`; the Scan extractor sets `inStock: !block.toLowerCase().includes('no stock')`; the generic block parser tests only for `out of stock` / `unavailable`. **Observed live (2026-10-05, Scan):** a 64GB kit showed "Due 8th Oct" instead of an in-stock message. A backorder state like this would be treated as in stock by the logic above (Inferred: live HTML not inspected). Fix: P0-2.

### A-03 John Lewis uses the "was" price (Medium, Verified) — **Fixed in PR-B** (`johnLewisPrice`)
`johnLewisSearch`: `const rawPrice = p.price?.was ?? p.price?.now ?? ...`. `was` is the pre-discount price and is preferred when present. Fix: P0-3.

### A-04 Misleading "Search results" fallback (Medium, Verified) — **Fixed in PR-B** (fallback removed, not quarantined)
`scrapeRetailer` last resort: if nothing is parsed, it emits one result named `Search results` priced at the **minimum GBP amount > 10 anywhere on the page**, which can be an accessory, delivery threshold or banner. If persisted it pollutes history and can fire alerts. Fix: P0-4.

### A-05 JSON-LD handling is narrow and duplicated (Medium, Verified) — **Fixed in PR-B** (`sources/structured-data.ts` replaces both copies)
Both `tryJsonLd` (`url-scraper.ts`) and `extractJsonLdProducts` (`uk-retailers.ts`) require `item['@type'] === 'Product'` exactly, read only `offers[0]`, read `offer.price` only (no `AggregateOffer.lowPrice`, no `priceSpecification`), and do not walk `@graph` or `@type` arrays. Currency defaults to GBP. Fix: P0-5.

### A-06 "Selector rules" are regex approximations; `price_attribute` unused (Medium, Verified) — **Fixed (cheerio selectors, price_attribute)**
`tryRules` extracts the first `.class`, `#id` or `[attr="v"]` token from the selector and matches it with a regular expression such as `class="[^"]*cls[^"]*"[^>]*>([^<]{1,300})<`. It cannot handle descendant/child combinators, pseudo-classes, or text split across nested tags (e.g. `<span>£<span>799</span>.99</span>`). `ScrapeRule.price_attribute` exists in the schema but is never read. Fix: P0-6 (real parser, e.g. cheerio/linkedom/node-html-parser).

### A-07 LLM self-healing is unsound and unvalidated (Medium, Verified) — **Fixed (structural excerpt, validated, throttled)**
`healSelectors` strips all tags (`replace(/<[^>]+>/g, ' ')`) and sends the first 4000 characters of plain text to the LLM, asking for CSS selectors. Plain text contains no structure, so selector proposals are guesses. The result is written straight to `scrape_rules` (overwriting an existing rule) with no check that it extracts a price from the page. It is invoked on every failing scrape (`healSelectors(...).catch(() => {})`), so it can run repeatedly. Fix: P0-7.

### A-08 AI features hard-wired to cloud endpoints (Medium, Verified) — **Fixed for OpenAI-compatible servers; see HANDOFF 9p**
`openai-client.ts` uses `https://api.openai.com/v1` (constant) and model `gpt-4o-mini`; `url-scraper.ts` calls `https://api.anthropic.com/v1/messages` with model `claude-haiku-4-5-20251001`. No base-URL override, so a local OpenAI-compatible server (Ollama) cannot be used. Both read keys only from `process.env` although comments say "env or stored in DB config" (Inferred: some startup code may copy DB config to env; in unread files). Fix: P2-4.

### A-09 Apify client leaks runs and swallows errors; depends on community actors (Medium, Verified) — **Partly fixed in PR-D** (abort on timeout, errors logged to stderr; actors still third-party and unverified)
`runApifyActor` polls up to `timeoutSecs`; on timeout it returns `status: 'RUNNING'` and **does not abort the actor run** (possible continued cost). `apifyFetch` returns `null` on any error. Actors used are third-party (`lulzasaur~pcpartpicker-scraper`, `sian.agency~currys-product-scraper`, `s-r~free-google-shopping-scraper...`, `ecomscrape~argos-product-search-scraper`, `studio-amba~idealo-scraper`, `alpha-scraper~amazon-product-details-scraper-single-rental`); their availability, pricing and output schemas are outside this repo's control and conflict with the self-sufficiency goal. The Amazon call passes `countryCode: 'GB'` (UK intent) but the actor's behaviour is Unverified. Fix: P0-11, P2-6.

### A-10 Scheduler hides failures (High, Verified) — **Fixed in PR-D** (`scrape_runs`, thrown errors recorded, repeated failures notify, skipped ticks counted)
`scheduledRefreshAll` wraps each component in `try { ... } catch { await sleep(2000) }` and the interval callback in `try {...} catch {}`. `markScrapeFailed` is only called when no snapshots were produced **without** an exception; a thrown error (e.g. `PRICES_API_KEY` missing, thrown by `getApiKey()`) is swallowed and does not mark the component failed. There is no failure notification and no per-source history. A `running` guard silently skips ticks when a run is still in progress. Fix: P0-8, P5-1.

### A-11 No key-less path for components without URLs (High, Verified) — **Fixed in PR-D** (direct UK retailer search tier; PricesAPI only when configured). Relevance is an interim token match, not the classifier
When a component has no `component_urls`/`source_url`, the scheduler calls `searchWithRetry` (PricesAPI) only. Keepa, direct UK retailers and Apify are not used by the scheduler (they are used by MCP/REST tools in unread files). Without `PRICES_API_KEY` such components never update, and the error is swallowed (A-10). Fix: P0-9.

### A-12 Outlier validation unused in the scheduler and risky for bargains (Medium, Verified) — **Policy documented: flag, never hide (HANDOFF 9j)**
`scheduler.ts` imports only `db`, `pricesapi`, `url-scraper`, `notifications`; it never calls `validatePrices`, so `is_outlier`/`confidence` stay at defaults for scheduled data (other call sites may exist in unread files). The MAD z-score (`> 3.5`) is computed across retailers at one instant: a genuinely cheap listing among several similar prices can be flagged as an outlier and excluded from "best price" (`is_outlier = 0` filters are used in most queries), and when MAD is 0 nothing is flagged. Fix: P0-10, P5-4.

### A-13 Unbounded history growth (Low, Verified) — **Fixed (price_retention_days)**
No pruning or rollup of `price_records`/`stock_history`. At an hourly interval with many retailers this grows steadily. Fix: P5-2.

### A-14 Hard-coded alert cooldowns (Low, Verified) — **Fixed (configurable cooldowns)**
`shouldSendAlert(id, 1440)` for target alerts and `360` for drops are literals in `scheduler.ts`. A rare, fast-moving RAM restock can be suppressed by a 24 h cooldown after an earlier alert. Fix: P4-2.

### A-15 Keepa stock and plan assumptions (Low/Medium, Verified code; plan Unverified)
`inStock: p.availabilityAmazon === 0` reflects Amazon-as-seller availability only, not marketplace offers (Inferred impact: false "out of stock" for third-party-sold RAM). The file header claims a "Free tier: 100 tokens/minute"; secondary sources indicate Keepa API access is a paid subscription (see research doc). Treat the claim as Unverified. `UK_DOMAIN = '2'` is correct for Amazon.co.uk (Verified in code; matches Keepa's documented domain numbering to the best of current knowledge, not re-checked against Keepa docs this session).

### A-16 Compatibility rules do not model SO-DIMM/ECC/capacity (Medium, Verified) — **Partly addressed in PR-E** for memory listings via `services/memory-classifier.ts` and the `n5-air-ram` profile; `compatibility.ts` itself (P1-4, mobile CPUs) is unchanged
`compatibility.ts` detects DDR generation, speed and capacity numbers from text but has no form-factor (SO-DIMM vs DIMM), ECC, slot-count or total-capacity checks, and its CPU/motherboard socket regexes cover desktop AM4/AM5/LGA1700/LGA1851 only, so Ryzen 7 255 resolves to `unknown`. Fix: P1-4.

### A-17 Documentation and deployment inconsistencies (Low, Verified) — **Fixed (docs/OPERATIONS.md)**
Root README quick start: image `ghcr.io/gregbtm/pc-price-checker:latest`, port 3000. Compose: image `ghcr.io/gregbtm/pc-price-mcp:latest`, default host port 38574, Watchtower auto-updating `:latest` every 5 minutes. `:latest` plus auto-update conflicts with a pin-versions policy. Fix: P6-4.

### A-18 No tests, no HTML parser (Medium, Verified) — **Fixed (Vitest, cheerio)**
`package.json` has no test script or test dependency and no `cheerio`/`jsdom`-style package; all scraping is regex-based. Retailer layout changes will break scrapers silently (A-10). Fix: P7-1, P7-2.

### A-19 Currency and price-parse assumptions (Low/Medium, Verified) — **Mostly fixed in PR-B** (`services/price-text.ts`: was/RRP/save prices skipped, symbol and ISO currency detected, non-GBP rejected; Camofox and AI extraction still trust the currency they return)
`tryRules`, `tryDom` and the Playwright path hard-code `currency: 'GBP'`. `parsePrice` takes the first number (optionally after `£`), so a `Was £x` price appearing first wins; accepted range is 0 to 50,000. Fix: P0-12.

### A-20 Interval semantics (Info, Verified)
Per-component `check_interval_minutes` is combined with the global tick as `Math.max(componentInterval, globalInterval)`, so a component cannot be checked more often than the global scheduler interval. Document or change.

### A-21 Sequential scraping with fixed sleeps (Info, Verified)
Components are processed sequentially with 2 to 3 s sleeps. With Playwright and many URLs, a run can exceed the interval; overlapping ticks are skipped silently (A-10).

### A-22 Currys endpoint is undocumented (Info, Verified code; behaviour Unverified)
`currysSearch` calls `https://api.currys.co.uk/catalog/products/search/v1...`. Whether it currently works or is permitted is unknown.

## 4. Unread areas worth a quick audit before large changes

`src/index.ts` (MCP tools: how search/refresh/track and `unit_quantity` are used, whether `validatePrices` is called, whether config is copied to env), `src/web.ts` (REST routes, auth on the dashboard), `notifications.ts` (channel handling, error handling), `playwright-scraper.ts` and `camofox-client.ts` (browser lifecycle, resource use), `Dockerfile` (is Playwright installed in the image?), `.github/` and `.gitlab-ci.yml` (which CI is active).

## 5. Extension points for the planned work

- **New source/provider:** add a module under `src/sources/`, export an async function returning normalised offers, register it in the scheduler chain and expose it through MCP/REST in `index.ts`/`web.ts`.
- **New DB fields:** add to `runMigrations` using the `PRAGMA table_info` pattern; extend `PriceSnapshot`, `savePriceSnapshots` and `PriceRecord` together.
- **New config key:** `db.getConfig`/`setConfig`; mirror in the Settings UI and `.env.example`; do not export keys matching the secret patterns.
- **New alert type:** extend `notifyAll` payload types in `notifications.ts` (not read; check its types first).
