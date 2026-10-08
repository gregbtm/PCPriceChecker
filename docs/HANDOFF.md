# Hand-off: start here

_Prepared 2026-10-05. Everything an engineer or LLM needs to continue this work is in four files under `docs/`. This is the entry point._

## 1. Copy-paste prompt for the next LLM

> You are an expert TypeScript/Node engineer taking over the repository `gregbtm/PCPriceChecker` (application code in `pc-price-mcp/`: TypeScript ES modules, Node >= 18, SQLite via better-sqlite3, Express 5, `@modelcontextprotocol/sdk`).
>
> **Business goal.** The owner is buying 64GB (2x32GB) DDR5 SO-DIMM for a Minisforum N5 Air NAS while UK RAM prices are very high. They need alerts when a *compatible* kit is *actually in stock* at or below a target price, with price history for context, and they want the whole tracking pipeline to run **without any paid third-party service** (paid APIs and cloud LLMs may remain as optional fallbacks only).
>
> **Read in this order, completely, before changing anything:** `docs/HANDOFF.md` (this file), `docs/IMPROVEMENT_PLAN.md`, `docs/CODEBASE_AUDIT.md`, `docs/RESEARCH_AND_VERIFICATION.md`.
>
> **What to do.** Implement the plan in the PR order given in `docs/IMPROVEMENT_PLAN.md` section 6. Start by writing a failing test that reproduces audit finding A-01 (an out-of-stock listing cheaper than an in-stock one must not trigger a price alert), then fix it (task P0-1), then P0-2 (stock tri-state). Continue through Phase 0 before touching later phases.
>
> **Rules.** (1) Backward compatible: add columns, tools, endpoints and config keys; never rename or remove existing ones; use the existing `runMigrations` pattern in `db.ts`. (2) No secrets or personal data in the repo; keys live in env vars or the SQLite `config` table. (3) Self-hosted first; do not add paid dependencies. Keep Firecrawl and changedetection.io LAN-only. (4) The repo has no tests: add Vitest (or equivalent) and an `npm test` script, and build fixtures from the real listing titles in `docs/RESEARCH_AND_VERIFICATION.md` section 2. (5) Items marked **Unverified** in the docs are not facts: verify them hands-on and record the result in the verification log (section 7 of the research doc) with date, method and source. (6) Scrape politely: keep the existing throttling, do not increase request rates, respect site terms. (7) Run `npm run build` (type-check) and `npm test` before every commit.
>
> **How to work.** One small pull request per slice (PR-A to PR-H in the plan). Each PR description states: tasks covered (IDs), audit findings addressed (A-nn), tests added, how you verified, and anything left Unverified. Update the progress tracker in section 5 of this file and the verification log as you go. If you find that a statement in these docs is wrong, fix the doc in the same PR and mark it **Corrected**.
>
> **Ask the owner only** for the decisions listed in `docs/IMPROVEMENT_PLAN.md` section 7 (maximum price, alert channel, retailer shortlist, host for Firecrawl and changedetection.io, Watchtower `:latest` policy, whether the repo is public). Make reasonable defaults for everything else and document them.
>
> **Done means** the acceptance criteria in `docs/IMPROVEMENT_PLAN.md` section 8 pass: with no paid keys configured, at least three UK retailers are tracked and alerts are delivered; out-of-stock or backorder listings never trigger price alerts; the classifier accepts `64GB (2x32GB) DDR5 SODIMM ... Non-ECC` and rejects DDR4 SO-DIMM and desktop DIMM titles; failing scrapers produce visible failure records and notifications; tests pass in CI.

## 2. The four documents

| File | Contents |
|------|----------|
| `docs/HANDOFF.md` | This file: prompt, situation summary, progress tracker, environment notes, reference commands, stop-gap purchasing steps, decision log, glossary, risks |
| `docs/IMPROVEMENT_PLAN.md` | Goal, principles, hardware profile, target architecture, task IDs (P0 to P7), PR order, owner decisions, acceptance criteria |
| `docs/CODEBASE_AUDIT.md` | How the code works today, 22 findings (A-01 to A-22) with evidence and fixes, extension points, unread areas |
| `docs/RESEARCH_AND_VERIFICATION.md` | Hardware facts, 2026-10-05 UK price snapshot and fixtures, third-party tool facts, 17-row verification log, sources, limits |

Status words used everywhere: **Verified**, **Partly verified**, **Unverified**, **Corrected**, **Disproved**.

## 3. Situation summary

**The purchase.** The Minisforum N5 Air is a barebones 5-bay NAS with two DDR5 SO-DIMM slots (max 96GB, up to 5600 MT/s, non-ECC). The owner wants 64GB as a matched 2x32GB kit. On 2026-10-05 Scan.co.uk listed the only visible 2x32GB kits at GBP 893.99 (5200, in stock) and GBP 933.49 (5600, due 8 Oct). An anecdotal 2025 comment put the same capacity near GBP 200, so waiting for a dip may be worthwhile; the owner needs reliable alerts.

**The repo.** PCPriceChecker is already a substantial UK price tracker: SQLite history, REST API and dashboard, MCP server, direct scrapers for 17 UK retailers, a generic URL scraper with a PriceBuddy-style fallback chain, outlier columns, stock-change history, waitlist, and several notification channels. It is **not** a greenfield build.

**The risks that matter most (details in the audit).**
1. Best-price queries and alerts ignore stock, so an out-of-stock listing can fire a "deal" alert (A-01).
2. Stock is binary and defaults to in stock; backorder wording such as "Due 8th Oct" is likely treated as available (A-02).
3. The scheduler swallows errors and, for components without URLs, only uses PricesAPI, so without that key nothing updates and nobody is told (A-10, A-11).
4. Wrong-price bugs (John Lewis "was" price, a "lowest price on page" fallback) (A-03, A-04).
5. Extraction is regex-based with no HTML parser and no tests (A-05, A-06, A-18).

**Why self-hosted Firecrawl and changedetection.io are in the plan.** They give JS-rendering and restock/price watching without a paid service. Their limits are documented in the research doc (no Fire-engine anti-bot, unauthenticated default, build-from-source compose, no documented current-price field in changedetection.io's watch JSON).

## 4. First five actions

1. Add a test runner and reproduce A-01 with a seeded in-memory SQLite database.
2. Implement P0-1 (stock-aware best price) and P0-2 (stock tri-state, migration).
3. Build the shared JSON-LD module and real-parser selector rules with fixtures (P0-5, P0-6).
4. Add `scrape_runs` and failure alerts; add the no-paid-key scheduler path (P0-8, P0-9, P5-1).
5. Build the memory classifier from the Scan fixtures and the `n5-air-ram` profile (P1-1, P1-2).

## 5. Progress tracker (update as work lands)

Phase 0 correctness
- [x] P0-1 Stock-aware best price (PR-A)
- [x] P0-2 Stock tri-state and migration (PR-A)
- [x] P0-3 John Lewis price fix (PR-B)
- [x] P0-4 Remove "Search results" fallback (PR-B)
- [x] P0-5 Shared JSON-LD module (PR-B, `sources/structured-data.ts`)
- [x] P0-6 Real HTML parser (cheerio) for selector rules; `price_attribute` honoured (`sources/selector-extract.ts`)
- [x] P0-7 Safe self-healing: structural excerpt, proposals validated on the page, throttled per domain
- [x] P0-8 Scheduler failure visibility (`scrape_runs`, PR-D)
- [x] P0-9 No-paid-key scheduler path (PR-D; interim `matchesQuery` filter until P1-5)
- [x] P0-10 Outlier policy: flag, never hide (HANDOFF 9j; owner may overrule)
- [x] P0-11 Apify abort and logging (PR-D)
- [x] P0-12 Currency handling (PR-B; JSON-LD, meta, rules, DOM and Playwright reject non-GBP. Camofox and AI paths still report whatever they return, see audit A-19)

Phase 1 profile and classifier
- [x] P1-1 Memory classifier (PR-E, `services/memory-classifier.ts`)
- [x] P1-2 Hardware profile model (PR-E; `n5-air-ram`, `matchesProfile`)
- [x] P1-3 Kit/price-per-GB fields (PR-E; new `price_records` columns)
- [x] P1-4 Compatibility: SO-DIMM/DIMM, ECC, optional slot/capacity limits, mobile CPUs (Ryzen 7 255 class); a Ryzen 7840HS is no longer read as AM5
- [x] P1-5 Wire classifier into scheduler/search (PR-E; scheduler path only, the MCP `refresh_prices`/`track_component` fetch path does not classify yet)
- [x] P1-6 price per GB in alert text and on the dashboard best-price cell (`best_price_per_gb`)

Phase 2 providers
- [x] P2-1 Provider interface (`sources/providers.ts`; `direct` is the unchanged url-scraper chain)
- [x] P2-2 Firecrawl provider (rawHtml + our extractors; unit-tested, never run against a real Firecrawl)
- [x] P2-3 Per-domain strategy memory (`provider_strategy:<domain>`)
- [x] P2-4 Local LLM: `OPENAI_BASE_URL` / `OPENAI_MODEL` (Ollama), key optional, default off
- [x] P2-5 SearXNG discovery (`/api/discover`, suggestions only; unit-tested only)
- [x] P2-6 Paid sources optional and documented (docs/OPERATIONS.md table)

Phase 3 changedetection.io
- [x] P3-1 REST client (`sources/changedetection.ts`)
- [x] P3-2 Spike: price and stock are in the latest snapshot text (research row 28)
- [x] P3-3 Integration mode: poll the snapshot for component URLs that have a watch (`refresh.ts`)
- [x] P3-4 JS-rendering watches: `html_webdriver` runs (row 29); Novatech readable even without it, Ebuyer refused on both fetchers (row 30)
- [x] P3-5 Community MCP documented as optional (docs/OPERATIONS.md)

Phase 4 alerting
- [x] P4-1 Alert rules (in-stock based; two tiers, options list, PR-J)
- [x] P4-2 Configurable cooldowns, quiet hours (`quiet_hours`), offer/price-aware de-duplication (HANDOFF 9m)
- [x] P4-3 Richer alert text (listing, GBP/GB, caveats, other options; PR-J)
- [x] P4-4 Self-hosted ntfy documented (docs/NTFY.md); unverified against the owner's server
- [~] P4-5 Optional n8n workflow (generic `webhook_url` channel + `docs/N8N.md` + example workflow JSON; the JSON is Unverified, never imported into n8n)

Phase 5 observability and data
- [x] P5-1 Health per source: `scrape_runs`, `/api/health` `scrapers`, dashboard "Scraper health" panel
- [x] P5-2 Retention/rollup (`price_retention_days`, default 365)
- [x] P5-3 Delivered cost and VAT flag: `delivery_cost`, `vat_included` (eBay stated shipping; Novatech inc VAT)
- [x] P5-4 Outlier policy implementation (nothing to hide: scheduled path never excludes by outlier score)

Phase 6 deployment
- [x] P6-1 Optional overlays in `pc-price-mcp/deploy/` (Firecrawl, changedetection.io); untested
- [x] P6-2 Host: existing NAS (owner); how to measure documented; nothing heavy deployed by default
- [x] P6-3 Prebuilt Firecrawl images exist on GHCR (research row 33)
- [x] P6-4 Docs reconciled (README, compose header, DEPLOYMENT.md now say image pc-price-mcp, host port 38574)
- [x] P6-5 Backup/restore notes in docs/OPERATIONS.md (backup call verified locally, not on the NAS)

Phase 7 tests and docs
- [x] P7-1 Test runner and CI (Vitest, `npm test`, CI step; PR-A)
- [x] P7-2 Fixtures: real titles and captured pages (AWD-IT block, Novatech snapshot, Scan/eBay titles) drive the tests
- [x] P7-3 README, DEPLOYMENT.md, .env.example, docs/OPERATIONS.md updated for the new settings

## 6. Environment and tooling notes

**Build and run (Verified from `package.json` and compose).** `cd pc-price-mcp && npm install && npm run build`; `npm run dev` (tsx, MCP stdio), `npm run dev:web` / `npm run web` (dashboard), `npm start`. Compose: `pc-price-mcp/docker-compose.yml` (image `ghcr.io/gregbtm/pc-price-mcp:latest`, env file `.env`, host port `${HOST_PORT:-38574}`, `DB_PATH=/data/pc-prices.db`, `SCHEDULER_INTERVAL_MINUTES` default 60, healthcheck `/api/health`, Watchtower).

**Runtime versions.** App: Node >= 18. Firecrawl MCP: Node.js 22+. `changedetection-mcp`: Python >= 3.11.

**Environment variables seen in code (Verified).** `PRICES_API_KEY`, `KEEPA_API_KEY`, `APIFY_API_TOKEN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `CAMOFOX_URL`, `DB_PATH`, `SCHEDULER_INTERVAL_MINUTES`, `HOST_PORT`, `TZ`. **Config-table keys seen:** `auto_refresh_interval_minutes`, `default_country` (default `gb`), `notify_drop_percent` (default 5), `scrape_proxies`, `camofox_url`. Whether DB-stored keys are copied into `process.env` at startup is Unverified (code in unread files).

**Tooling used during research (may not exist for you).** GitHub reads/writes went through an MCP Hub GitHub connector; a separate GitHub MCP connector returned `401 Bad credentials` and was not used. Web research used hosted Firecrawl tools (cloud, not self-hosted). Nothing from this repo was executed. A read-only hardware report of the owner's existing NAS was taken (32GB RAM, about 35% CPU load at sampling); no identifiers are recorded here.

## 7. Reference commands (from official docs; replace placeholders; never commit real keys)

**changedetection.io (README):**
```
docker run -d --restart always -p "127.0.0.1:5000:5000" -v datastore-volume:/datastore --name changedetection.io dgtlmoon/changedetection.io
```
The loopback binding means other hosts or containers cannot reach it; change the port mapping to a LAN-only address if the app runs elsewhere. Get the API key under Settings -> API. Live API spec: `GET /api/v1/full-spec` (no auth).

**Create a restock/price watch (API docs):**
```
curl -X POST "http://localhost:5000/api/v1/watch" \
  -H "x-api-key: YOUR_API_KEY" -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/product/widget","processor":"restock_diff",
       "processor_config_restock_diff":{"in_stock_processing":"in_stock_only",
       "follow_price_changes":true,"price_change_threshold_percent":5}}'
```
Other useful calls: `GET /api/v1/watch/{uuid}`, `GET /api/v1/watch/{uuid}/history`, `GET /api/v1/watch/{uuid}/history/latest`, `GET /api/v1/watch/{uuid}/history/latest?html=1`.

**changedetection-mcp client config (package README):**
```
{"mcpServers":{"changedetection":{"command":"changedetection-mcp",
  "env":{"CHANGEDETECTION_BASE_URL":"http://localhost:5000",
         "CHANGEDETECTION_API_KEY":"your-api-key-here"}}}}
```
Install pinned: `pip install changedetection-mcp==0.1.0` (consider `--require-hashes` with the hashes in the research doc).

**Self-hosted Firecrawl (official guide, pinned release):**
```
git clone https://github.com/firecrawl/firecrawl.git && cd firecrawl && git checkout v2.11.162
cat > .env <<'EOF'
USE_DB_AUTHENTICATION=false
POSTGRES_USER=postgres
POSTGRES_PASSWORD=replace-with-at-least-32-random-characters
POSTGRES_DB=postgres
EOF
docker compose up --build -d
curl --fail-with-body -s --max-time 75 -X POST http://localhost:3002/v2/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com","formats":["markdown"],"timeout":60000}'
```
The compose builds images from source; see research doc section 4 for the image question and resource caps.

**Firecrawl MCP against the local API (docs):**
```
export FIRECRAWL_API_URL=http://<host>:3002
npx -y firecrawl-mcp@3.23.7
```
Omit `FIRECRAWL_API_KEY` only when the self-hosted API has authentication disabled. For HTTP clients: `HTTP_STREAMABLE_SERVER=true` serves `http://localhost:3000/mcp` and `/health`.

## 8. Stop-gap steps for the owner while the code is built

These are general guidance, not verified in this session unless stated.

1. **Free alerts:** create price alerts on `uk.camelcamelcamel.com` (site existence Verified) for Amazon UK listings of a 2x32GB DDR5 SO-DIMM kit; add keyword alerts on HotUKDeals and price alerts on PCPartPicker UK (general knowledge, Unverified here).
2. **What to buy:** DDR5 SO-DIMM (laptop-size), non-ECC, a matched 2x32GB kit, rated at or below 5600 MT/s (5200 or 4800 also work). Avoid DDR4, desktop DIMMs, CAMM2, ECC/registered modules. Do not buy non-binary 24GB sticks until compatibility is confirmed.
3. **Fallback:** 2x16GB now and upgrade later if 64GB stays near GBP 900.
4. **After fitting:** if drive bays disappear, reseat the backplane connector (one user report).
5. **Baseline:** record the price you see each time you check; the 2026-10-05 Scan prices are the first data points.

## 9. Decision log

| Decision | Reason | Where |
|----------|--------|-------|
| Extend the existing repo, do not rebuild or replace it | It already has tracking, history, MCP, scrapers, alerts | Plan section 1 |
| Fix correctness before adding features | Stock-blind alerts and silent failures undermine everything else | Plan Phase 0 |
| Do not adopt PriceBuddy as the main engine | The repo's `url-scraper.ts` already implements a similar fallback chain; adopting it would duplicate effort | Research section 6 |
| Firecrawl and changedetection.io as optional self-hosted tiers | Remove dependence on paid APIs while keeping JS-rendering and restock/price watching | Plan Phases 2 and 3 |
| Use changedetection.io's REST API, not its community MCP, for the integration | The MCP is young (0.1.0), single-maintainer, and has no price/restock tool | Research section 5 |
| Keep paid sources as optional fallbacks | Owner wants self-sufficiency, not feature loss | Plan principle 1 |
| Skip theluckystrike, aravindtri, BestPrice.gr, Prisjakt, Amazon.com tools, ShopSavvy API for now | Not UK-suitable, not verifiable, or paid with unconfirmed UK coverage | Research section 3 |
| Only `in_stock` can alert; `unknown` stock is treated as not purchasable | A missed alert on a page with no stock signal is recoverable (the row is still stored with `stock_state = unknown`; dashboards do not yet display the state, that is P1-6/P5-1 work); a false "buy now" alert is the failure the owner cares about. Revisit per retailer once its extractor has a reliable stock signal | PR-A, `services/stock-state.ts` |
| `getLatestPricePerRetailer` keeps its old default (all stock states); alerting uses new `getBestInStockOffer`; `getPriceStats(id, inStockOnly = true)` changes `current_best`/`prev_best_24h` to in-stock | Additive for dashboards that want history, safe default for anything that reports a purchasable price | PR-A, `db.ts` |
| n8n integration via webhook push and REST polling; never via n8n's database tables | n8n's schema is internal and unstable, and the app cannot reach that database | `docs/N8N.md` |
| Pin Firecrawl to `v2.11.162` initially | The official guide is verified against that tag; the compose contract changes between releases | Research section 4 |

## 9b. Owner decisions (answered 2026-10-05)

These close the questions in `docs/IMPROVEMENT_PLAN.md` section 7. They are the owner's words, not verified facts.

| Question | Answer | Implication |
|----------|--------|-------------|
| Maximum price for 64GB | **GBP 350** (alert target for the 2x32GB kit) | Far below the 2026-10-05 Scan prices (GBP 893.99 and 933.49, about GBP 14/GB). Expect no alert until the market falls; price history matters more than alerts for now. GBP 350 is about GBP 5.47/GB. |
| Fallbacks | **48GB (2x24GB) is acceptable** | Track it as a second component. N5 Air compatibility with 24GB modules is still **Unverified**, so the classifier must keep the `non_binary_unverified` flag. 2x16GB was not mentioned; treat as not approved. |
| Alert channel | **Self-hosted ntfy** | Default `ALERT_STYLE=ntfy`. Quiet hours not specified: none by default. |
| Retailers | Scan, Ebuyer, Amazon UK, eBay, Kingston, Currys, "and other similar popular UK sites" | Default shortlist: Scan, Ebuyer, Overclockers, CCL, Box, Novatech, Aria, AWD-IT, Currys, Kingston, plus Amazon UK and eBay. Amazon needs Keepa (paid) or a camelcamelcamel-style free route; eBay needs free eBay developer keys. Neither works key-less, so they are optional until configured. eBay listings are acceptable to the owner; new/used must be recorded per listing. |
| Hosting for Firecrawl and changedetection.io | **Existing NAS** | Measure before committing (plan P6-2): the NAS already runs many containers. Keep both LAN-only. |
| Watchtower | **Keep `:latest` auto-update** | The pin-versions principle is waived for the app image only; third-party images stay pinned. Consequence: every merge to `main` is deployed within about 5 minutes, so migrations must stay additive. |
| Repo public | **Yes** | No personal data, keys, or NAS identifiers in fixtures or docs. |

## 9c. Operating notes added in PR-D

- **Scraper failures:** every source attempt is a row in `scrape_runs`. After `scrape_failure_alert_after` (config key or `SCRAPE_FAILURE_ALERT_AFTER`, default 3) consecutive failures of one source for one component, a single `scrape_failure` notification lists the failing sources; repeats at most once per source per 24 h.
- **Key-less search tier:** components with no URLs are searched on the retailers in config `scheduler_retailers` (or `SCHEDULER_RETAILERS`, comma-separated ids). Default: `scan, overclockers, ebuyer, ccl, box, novatech, aria, awdit, currys`, one at a time with a 2 s gap (requests per component per tick: 9, previously 1 PricesAPI call). Kingston, Amazon UK and eBay have **no key-less scraper** yet.
- **Relevance:** a search result is stored only if its title contains every word of the component's `search_query` (SO-DIMM/SODIMM equivalent, `-word` excludes). Use a query like `ddr5 so-dimm 64gb`. Limit: a title that says `2x32GB` without `64GB` is missed. P1-5 replaces this.
- **Self-hosted ntfy with access control:** set config `ntfy_token` (or `NTFY_TOKEN`) and `ntfy_server`; the app sends `Authorization: Bearer`. Without it an ACL-protected topic answers 403.
- **`/api/scrape-runs` is `[]` when:** (1) no tracked component exists (the scheduler returns immediately), (2) the scheduler is inactive (`GET /api/scheduler` shows `active: false`; set `SCHEDULER_INTERVAL_MINUTES` or POST `/api/scheduler` with `{"interval_minutes": 60}`), or (3) the first pass has not happened yet. Before PR-G the first pass was a full interval after start (60 min by default, reset by every restart); now `web-standalone` also runs one pass about 30 s after start (disable with `SCHEDULER_RUN_ON_START=false`), and `POST /api/scheduler/run` starts a pass on demand (202 started, 409 if one is already running). Check `GET /api/scheduler` for `runCount`, `lastRunAt`, `currentlyRunning`.
- **Freshness:** an offer counts as purchasable only if it was observed within `max_offer_age_hours` (config, default 48). Found on the owner's NAS 2026-10-05: components last checked 2026-07-08 still reported a 3-month-old in-stock eBay listing (GBP 22.34) as their best price, which would have fired a bogus alert on the first run after the scheduler restarted. History views still show old rows.
- **Health:** `/api/health` stays `status: ok` and adds `scrapers.failing` (sources with 3+ failures in a row); `/api/scrape-runs?component_id=&limit=` lists recent runs.

## 9d. Profiles and the classifier (PR-E)

- Create the tracked item with `profile_id: "n5-air-ram"` (REST `POST /api/components` or the MCP `track_component` tool). Use a query such as `ddr5 so-dimm 64gb`; with a profile the classifier, not the query words, decides what fits.
- Listings that do not fit (24GB singles, DDR4, desktop DIMM, ECC, CAMM2, wrong capacity, 1-module) are **stored** with `profile_match = 0` for history, but never alert, never count as the best price and never trigger restock events. Accepted: 64GB as a 2-module kit, and 48GB (2x24GB) with the `non_binary_unverified` flag. Flags raised without rejecting: `will_downclock`, `kit_unconfirmed`, `ecc_unstated`, `speed_unstated`.
- Alert text now carries the listing title, GBP per GB and the flag warnings. A 48GB alert says plainly that 24GB modules are not confirmed to work in the N5 Air.
- **Bundles are rejected:** a title where "with / incl / including / plus" appears with nothing memory-related before it ("Minisforum Ar900i with Kingston Fury Impact 64gb ...", a real GBP 800 eBay listing the first version accepted) is a device sold with RAM, not a kit.
- The classifier never guesses: a title that does not say DDR4/DDR5 or SO-DIMM/DIMM is rejected with that reason.
- **Limit:** the MCP `track_component fetch_now` / `refresh_prices` path (index.ts) is separate from the scheduler and does not classify. Only the scheduler path, which is what produces alerts, is profile-aware.

## 9e. eBay tier and the scraping reality (2026-10-05)

- **Owner's NAS result (2026-10-05):** `/api/search/retailers?...&retailers=scan,ebuyer,ccl` returned Scan HTTP 403 (blocked from the home IP too), Ebuyer HTTP 404 and CCL Online HTTP 404. For CCL the code's domain `ccl.co.uk` is a WordPress corporate site whose `/search` is a genuine "Page Not Found" (reproduced from the sandbox); the shop is on `cclonline.com`, which answered the sandbox with a block page. Ebuyer's correct search URL could not be checked (its site refused the sandbox). No scraper URL was changed because the correct ones could not be verified.
- **Decision:** add the official eBay Browse API tier (`docs/EBAY_SETUP.md`) and keep manual alerts (`docs/MANUAL_ALERTS.md`) as the reliable fallback. Retailer scrapers stay in place; their failures are visible in `/api/scrape-runs`.
- eBay needs the owner's free developer keys; until they are set the tier is skipped silently (no failure records).

## 9f. First live scheduler pass (2026-10-06)

- Result table and what it means are in the verification log rows 19 to 21. In short: no retailer returned products from the NAS; AWD-IT (URL now fixed, real page parses) and Aria (closed 2022, removed) were explained; Scan/Overclockers/Box/Currys answer 403; Ebuyer, CCL and Novatech answer 404 and need their real search URLs, which can only be read from a browser on the owner's side (their sites block the sandbox).
- **eBay 401 `invalid_client`:** Basic auth with the App ID and Cert ID was rejected. Possible causes, none confirmed: the production keyset not yet enabled (eBay's account-deletion compliance step), App ID and Cert ID entered the wrong way round or with stray characters, or sandbox keys used against production. Test outside the app: `curl -s -u 'APP_ID:CERT_ID' -d 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope' https://api.ebay.com/identity/v1/oauth2/token` from the NAS terminal. A token back means the app's setup is wrong; `invalid_client` again means the keyset.
- **Stale `PRICES_API_KEY`:** `PricesAPI authentication failed` shows a key is set but invalid; remove it (or fix it) to stop that failing row.
- Failure notices are now deduplicated per source across components (a blocked retailer used to mean one notice per tracked component).

## 9g. Page diagnostic and result cap

- `GET /api/debug/retailer-page?retailer=<id>&q=<query>` fetches one retailer's search page as the scraper does and returns status, size, title, signals (JSON-LD blocks and products, `__NEXT_DATA__`, `window.__*__` state variables, count of GBP prices), up to 3 raw-HTML snippets around the first prices, and the first 400 characters of visible text. Read-only; only the built-in addresses in `SEARCH_URLS` can be fetched (ids: scan, overclockers, ebuyer, ccl, box, novatech, aria, awdit). It is how an extractor gets written for a site the sandbox cannot reach: no prices in the raw HTML means the page needs JS rendering, prices in snippets show the markup to target.
- **First real diagnostics, owner's NAS 2026-10-06:** Novatech `search.html?search=...`: status 200, 246 KB, one JSON-LD block with 0 products, **0 GBP prices** in the raw HTML. Ebuyer `searchresults?descriptionfilter=...`: status 200, 496 KB, two JSON-LD blocks with 0 products, **1 GBP price** (a "from £9.99" delivery banner). Neither server response contains product prices, so the product lists are loaded afterwards by JavaScript (or sit in markup without a pound sign; the `priceAttributes`, `jsonPricePairs`, `dataScripts` and `scriptHints` signals and `&needle=<word>` were added to tell these apart). No extractor can be written for these two from the raw page alone.
- Search results per retailer page are now kept up to 40 (were 8, which cut off the wanted listing on AWD-IT); `searchAllUkRetailers` still trims to 8 per retailer for display unless a larger limit is passed.

## 9h. Two-tier alerts, options list, 48GB fallback and daily summary (owner request 2026-10-06)

Owner decisions: keep **GBP 350** as the alert price; willing to go up to **GBP 500** but wants the cheapest and a list of options; 48GB (2x24GB) fallback accepted; daily summary wanted.

- **`consider_price`** (new column on `tracked_components`): offers above `alert_price` and up to `consider_price` send an `options` notice listing the cheapest (up to 5, cheapest first). Sent only when something new appears (an offer not in the previous list, or a cheaper best price) and at most once every 6 hours. If the best offer is at or below `alert_price`, the normal `price_alert` is sent instead, now with the other options listed under it.
- **Only purchasable offers are ever listed** (in stock, fits the profile, seen within `max_offer_age_hours`), with price per GB and short caveats (`used`, `+delivery`, `kit?`, `CHECK SELLER`, `24GB UNVERIFIED`).
- **Profile `n5-air-ram-48`**: accepts only 48GB (2x24GB), flagged `non_binary_unverified`. `n5-air-ram` is unchanged (64GB, and 48GB flagged). Use the 48 profile on the fallback component so a 64GB listing is not reported twice.
- **Daily summary**: one notification per local day after `daily_summary_hour` (config key or `DAILY_SUMMARY_HOUR`, default 8, `off` disables), sent at the end of a refresh pass so it uses fresh data. It covers every unpaused component that has a profile or a `consider_price`: cheapest now, distance from the alert price, up to 5 options, and 7-day low and median. If no channel delivers it, it is retried on the next pass. Time zone is the container's `TZ` (compose default `Europe/London`). `POST /api/daily-summary/send` sends one now.
- Set the prices with `PATCH /api/components/:id/alert` and `{"alert_price": 350, "consider_price": 500}`; `POST /api/components` also accepts `consider_price`.

## 10. Glossary

- **SO-DIMM:** small-outline memory module used in laptops and mini PCs; not interchangeable with desktop DIMMs.
- **UDIMM / DIMM:** full-size desktop memory.
- **CAMM2:** newer compression-mounted memory form factor; not compatible with SO-DIMM slots.
- **ECC:** error-correcting memory; the N5 Air does not support it.
- **Non-binary DDR5:** modules of 24GB or 48GB rather than powers of two.
- **MAD z-score:** median-absolute-deviation outlier score used in `price-validator.ts` (flag when above 3.5).
- **`restock_diff`:** changedetection.io processor that watches stock and price using structured data and text heuristics.
- **Fire-engine:** Firecrawl's separate advanced scraping/anti-bot service, not part of the self-hosted default.
- **NuQ:** Firecrawl's queue (PostgreSQL by default; FoundationDB optional).
- **Apprise:** notification library used by changedetection.io (and supported by PriceBuddy).

## 11. Risks and watch-outs

- **Responsible scraping.** The repo scrapes retailer sites, with optional stealth tooling (Camoufox, Novada). Keep request rates low, respect robots/terms where applicable, and do not add measures whose purpose is to defeat site protections beyond what is already there.
- **Firecrawl is AGPL-3.0 and unauthenticated by default.** Keep it on the private network. Revisit the licence before offering it as a service to others.
- **Resource use.** Firecrawl's stack is heavy; measure the chosen host and tune concurrency (`NUM_WORKERS_PER_QUEUE`, `BROWSER_POOL_SIZE`, `MAX_CONCURRENT_JOBS`).
- **Anti-bot (observed, not just feared).** On 2026-10-05 every UK retailer search page tried returned a Cloudflare challenge or refused the connection to a plain fetch from a datacenter IP (verification log row 18). Whether the NAS's home IP fares better is unknown until measured there. Self-hosted Firecrawl has no Fire-engine anti-bot, so it may hit the same wall; the existing Playwright/Camoufox tier is the fallback. Do not add measures whose purpose is to defeat site protections beyond what the repo already has; if retailers block automated access, prefer their official feeds/APIs, price-comparison sources, or the owner's manual alerts (section 8).
- **Silent drift.** Retailer layouts change; P0-8 and P5-1 exist so failures are loud.
- **Public repo hygiene.** Fixtures must not contain personal data or credentials. Treat `.env`, the SQLite file and exports as private.
- **Backward compatibility.** The MCP tool names and REST routes are an interface; additions only.

## 12. Maintaining these documents

- When you verify or disprove something, update the status word in place and append a row to the verification log (research doc section 7) with date, method and source.
- When you finish a task, tick it in section 5 and note the PR.
- Keep the status vocabulary and the `A-nn` / `P-n-n` identifiers stable.

## 9i. changedetection.io integration (2026-10-06)

Owner's instance: `https://changedetection.nasmatrix.app` (v0.55.8). Enable the tier by setting config keys `changedetection_url` and `changedetection_api_key` (or env `CHANGEDETECTION_URL`, `CHANGEDETECTION_API_KEY`); unset means off.

How it works: add a product URL to a component (component URLs) and create a `restock_diff` watch on the **same URL** in changedetection.io. On each refresh the app reads that watch's latest snapshot (`In Stock: True|False - Price: N`) instead of scraping the page; with no watch, or no usable reading, it falls back to direct scraping and records no failure. Currency is assumed GBP and only for `.uk` hosts (Unverified for others). `GET /api/changedetection/spike` shows what the instance returns, for checking.

Not done: creating watches from the app and webhook mode. Ebuyer product pages could not be fetched (HTTP/2 protocol error, row 30). The API key was shared in chat by the owner; rotate it in changedetection.io Settings if it should not stay in that transcript.

## 9j. Outlier policy, cooldowns, retention (2026-10-06)

**Outlier policy (P0-10, default chosen by me, owner has not been asked to rule on it):** a low price is flagged, never hidden. The scheduled refresh path does not call `validatePrices` at all, so the MAD z-score cannot exclude a genuine bargain from alerts or best price. Listings far below the per-GB floor (`suspicious_price_per_gb`, default 2) get the `suspiciously_cheap` flag and the alert says so. `validatePrices` is still used by the manual MCP tools only. If the owner prefers a held-for-review state, that is a new stock-like state and a separate PR.

**Cooldowns (P4-2):** config `alert_cooldown_minutes` (default 1440) and `drop_cooldown_minutes` (default 360). A missing, non-numeric or negative value falls back to the default. `0` removes the cooldown.

**Retention (P5-2):** config `price_retention_days` (default 365, `0` = keep everything). After a scheduled pass, rows older than that keep only the cheapest row per component, retailer and day; recent rows are untouched.

## 9k. Selector rules and self-healing (2026-10-06)

Selector rules now run real CSS selectors through cheerio, so descendant selectors, nested-tag prices and `price_attribute` (e.g. `data-price-amount`) work. Fixtures are the real AWD-IT product block. Self-healing (when a stored rule stops working) sends the LLM a structural excerpt (tag, id, class, data attributes, parent), saves a proposal only if it extracts a plausible GBP price from that same page, never overwrites a working rule with a guess, and tries at most once per domain per 6 hours. Unverified: how well real LLM proposals perform (no LLM key is configured, so only the validation and excerpt are tested).

## 9l. Novatech search through changedetection.io (2026-10-06)

With `changedetection_url` and `changedetection_api_key` set, the scheduler reads Novatech search results from a changedetection.io browser watch instead of the plain fetch that finds nothing. The app creates the watch itself the first time (title `PCPC: novatech "<query>"`; set config `changedetection_autocreate` to `false` to stop that), asks it to recheck on each pass and reads the previous snapshot, so the first pass records a "pending" failure and the next one has data. A snapshot older than `max_offer_age_hours`, or a watch with a fetch error, is recorded as a failure, never reused as fresh. Stock is conservative: only "Only N left in stock" counts as in stock; "Ordered Upon Request" is backorder and "Dispatches within..." is unknown. Prices are inc VAT. Alerts link to the search page (the snapshot has no product links). Scan, Overclockers, CCL, Box and Currys refuse the browser fetch too (research row 32). Unverified on the live app: the end-to-end pass; the SO-DIMM search itself returned no SO-DIMM kit on the day.

## 9m. Quiet hours and de-duplication (2026-10-06)

Config `quiet_hours` as `HH:MM-HH:MM` in the container's local time (TZ), e.g. `22:00-07:00` (wraps past midnight, end exclusive). Unset or unparseable means none. While quiet, no alert or daily summary is sent and no alert state is recorded, so a deal still true afterwards is sent on the first pass after. De-duplication: the cooldown stops repeats of the same deal; a different retailer/listing, or a price at least 1% below the last alerted price, is news and bypasses it. Alerts are still based on in-stock, profile-matching offers only.

## 9n. Delivery, VAT, price per GB and scraper health on the dashboard (2026-10-06)

New additive columns `price_records.delivery_cost` (GBP, 0 = free, null = unknown) and `vat_included`. eBay now records the cheapest stated delivery charge; when stated it replaces the `delivery_excluded` caveat, which stays when eBay gave none. Novatech prices are recorded as inc VAT. Offer lines show `+£X delivery = £total`, `free delivery` or `ex VAT` when known. **Alerts still compare the item price to your £350/£500 limits, not price plus delivery**: a deliberate choice (delivery is often unknown), so read the delivery note on an eBay alert. The dashboard best-price cell shows price per GB, delivery and short flags, and a "Scraper health" panel lists sources whose latest run failed (from `/api/health`). The frontend was rebuilt from `frontend/` (the build reproduces the committed assets exactly when nothing changes) and smoke-tested in headless Chromium against a seeded database: price per GB, delivery, flags and the health panel rendered with no page errors.

## 9o. Compatibility rules (2026-10-06)

`services/compatibility.ts` gained, additively: mobile/APU detection (`detectMobileCpu`: Ryzen 5 240 / 7 255 class, Ryzen 7040/8040 H/U/HS/HX, Ryzen AI, Core Ultra H/U), checked before the AM5 pattern (which used to read "Ryzen 7 7840HS" as a desktop chip); SO-DIMM in a desktop board and desktop DIMM with a mobile CPU are errors; DDR4 with a mobile (DDR5) CPU is an error; explicit ECC warns; optional `ramSlots` and `maxMemoryGb` inputs (for example from the `n5-air-ram` profile: 2 slots, 96GB, the 96GB figure is itself Unverified) raise slot and capacity errors only when supplied. Existing desktop rules and results are unchanged (tested). The MCP `check_compatibility` tool schema was not changed; the REST endpoint passes the new optional fields through.

## 9p. Provider chain, local LLM, SearXNG, optional overlays (2026-10-06)

`scheduler.ts` now scrapes component URLs through `scrapeViaChain` (providers `direct` then `firecrawl`, memory-ordered); with Firecrawl unconfigured the behaviour is the old chain exactly. Firecrawl is asked for `rawHtml` only and our own extractors run on it (`extractFromHtml`: JSON-LD, meta, stored rules, DOM). Local LLM: `openai_base_url`/`openai_model` (Ollama). SearXNG: `searxng_url` and `GET /api/discover`. Overlays are reference files under `pc-price-mcp/deploy/`. **All of this is unit-tested with stubs and has not run against a real Firecrawl, Ollama or SearXNG.**

## 9q. Dashboard Integrations tab, manual refresh fix, status and next steps (2026-10-06)

- **Bug fixed:** the dashboard's per-component Refresh (and "Refresh all", which ran every component in parallel) still called the old PricesAPI-only code, so it ignored retailers, eBay and watches and needed a paid key. `POST /api/components/:id/refresh` now uses the scheduler's `refreshComponent` path (`refreshOneNow`, serialised one at a time) and returns the scrape runs it made. "Refresh all" now starts one scheduler pass and polls it.
- **Integrations tab** in the dashboard (see `docs/OPERATIONS.md`): ntfy, alert behaviour, n8n (webhook, test, workflow downloads), changedetection.io (connection check, watches list/add/delete, Novatech page), optional tiers (Firecrawl, SearXNG, local LLM, eBay key check), scraper health with recent runs, run-now, test notifications, send summary. New routes: `GET /api/integrations` (no secrets, only whether one is set), `GET /api/n8n/workflows/:id`, `GET|POST|DELETE /api/changedetection/watches` (delete only for watches titled `PCPC...`), `PATCH /api/components/:id/profile`, `GET /api/components/:id/offers`. The alert modal sets the alert price, "worth a look" price and hardware profile; a cart button shows the offers an alert would use.
- **Novatech override:** config `novatech_search_url` (full URL, `{q}` replaced by the query) to watch a category page instead of the 24-result keyword search.
- **Tests:** `web.test.ts` starts the real server and checks no secret leaves `/api/integrations`, the workflow generator, the profile and offers routes, the refresh path and the watch-delete guard. The dashboard was driven in headless Chromium on a seeded database (tab, panels, modals, no page errors). Status against the plan: `docs/STATUS.md`. Proposed next work: `docs/NEXT.md`.

## 9r. First day of live data, and source back-off (2026-10-06)

The owner's pasted `/api/scrape-runs` and `/api/health` (research row 34) confirmed Novatech through changedetection.io end to end and showed three problems, now fixed: (1) five blocked retailers, PricesAPI (stale key) and Aria were attempted every pass, 77 failures each in 24 hours; they now back off to one try a day after 10 failures in a row (`scrape-health.ts`: `inBackoff`, `BLOCKED_AFTER`). (2) `/api/health` listed every long-blocked or removed source under `scrapers.failing`, which would have kept the "failing" signal permanently on; sources now carry a `status` (ok, failing, blocked, idle, disabled) and `failing` lists only recent failures. (3) The PricesAPI key can now be seen and removed on the Integrations tab. The dashboard shows a status column and a one-line note when sources are blocked.

## 9s. Why the blocked retailers fail, robots.txt compliance, PricesAPI quota (2026-10-07)

Investigated from the owner's request (research rows 35-37). (1) **PricesAPI:** exhausted credits are `403 CREDITS_EXCEEDED`; the client mapped every 401/403 to "authentication failed". It now throws typed errors (`PricesApiError`: auth, quota, rate, busy, server), pauses itself on quota (config `pricesapi_pause`, lifted by a new key or `resets_at`), notifies once, and is limited to one search per component per 24 h. A search with offers costs 10 credits; the old "50,000 free calls a month" comment was wrong (free plan: 3,000 credits, one time). (2) **The 403s are Cloudflare managed challenges** (Scan, Overclockers, CCL, Currys); not worked around. (3) **robots.txt:** the app had been requesting search pages that AWD-IT, Novatech, Overclockers and CCL forbid. A guard now refuses them with no request (`services/robots.ts`, real files as fixtures), applied to retailer searches, product-page scraping, watches and the dashboard's watch creation. (4) **Sitemap tier** (`sources/sitemap-discovery.ts`) replaces the disallowed search for AWD-IT and Novatech: sitemap, slug filtered by the memory classifier, then product pages. (5) `search-watch` no longer watches Novatech's search page by default (disallowed); it handles Novatech only when `novatech_search_url` names an allowed page. (6) Currys removed from the default retailer list (Cloudflare, and its scraper called a private JSON endpoint with a spoofed Referer). **Consequence to know:** the working Novatech search path stops until the sitemap tier is verified live on the NAS.

## 9t. First live sitemap pass (2026-10-07)

AWD-IT through its sitemap works on the NAS (2 offers for the 64GB component). Novatech returned `ok` with 0 offers because `slugText` read only the last URL segment, the manufacturer code; fixed to read every segment (research row 38). Novatech's `sitemap-products.xml` did load from the NAS. Whether Novatech lists any DDR5 SO-DIMM kit at all is still unknown: the earlier search listed none.

## 9u. Product evaluation and the first reliability build (2026-10-07)

The owner asked for an evaluation of the product and an ambitious build, searching GitHub and elsewhere. Two research passes (prior art; UK data sources) are summarised in `docs/PRODUCT_EVALUATION.md` with Verified/Unverified tags and a ranked roadmap (C = reliability, B = ambitious). Built: catalogue census with new-product alerts, block pages recorded as failures, heartbeat ping (PR 43); `InStoreOnly` fix and MPN/GTIN/brand extraction; a WooCommerce Store API source and `wired2fire` retailer id; a known-part-number catalogue (`src/data/memory-mpns.ts`) that overrides a misleading title or address in the classifier; five verified product pages (`src/data/known-pages.ts`) with `GET/POST /api/components/:id/known-pages` and an offers-modal button; a per-component `search_also` flag (migration, default 0) so pinned pages do not switch eBay and the searches off. Honest headline: the market floor seen today is £600 to £1,150 against a £350 target, and alert delivery has still never been observed.


## 9v. Market floor and alert-channel health (2026-10-07)

`marketView()` (services/offers.ts) reports the cheapest compatible listing in any stock state over 7 days and how far the alert price sits below it; shown in the offers modal, in `GET /api/components/:id/offers` (`market`) and as a line in the daily summary. `alertHealth()` (notifications.ts) reports `none | untested | ok | failing` from the config and the last delivery outcome (names only, never values); `GET /api/health` carries it as `alerts` and the dashboard shows a red banner unless it is `ok`. Checked in headless Chromium on a seeded database: banner visible, market block and the 30%-below-floor line rendered, known-pages panel rendered, no page errors.

## 9w. Scraping policy enforced in code (2026-10-08)

Found while auditing User-Agents for roadmap item C7: the repository contained stealth-browser tooling (fingerprint patching, rotating browser identities, proxy rotation, optional Camoufox and Novada anti-detect backends) that sat on the default product-page path after any plain-fetch failure, and the README advertised it. It was inert on the NAS (no Chromium in the image) but contradicted the owner's rule, and my own evaluation text had said otherwise. Fixed: `services/scrape-policy.ts` (`bypassAllowed()` default off, `scraperUserAgent()` honest by default, `looksBlocked()`); a refusal is recorded as `blocked by the site (HTTP n)` through the new `ScrapedProduct.failure` and not retried with a browser; all plain requests send the project's User-Agent. Research row 43.

## 9x. eBay part-number queries, total-cost alerts, options cooldown (2026-10-08)

- **C6, MPN-first eBay queries** (`services/ebay-queries.ts`): for a component with a profile, every known part number of the accepted capacities is searched on eBay as well as the keyword query, merged and de-duplicated by item, at most once every `ebay_mpn_every_hours` (default 6; `0` every pass; `off`). A seller whose title never says "SO-DIMM" is found by the part number and classified by the catalogue. About 16 calls per due pass against a 5,000 a day allowance. Unverified against live eBay: whether `q=<MPN>` returns the expected listings (the Browse API searches titles and item specifics, per its documentation).
- **Alert on total cost** (`alert_on_total=true`, default off): item price plus known delivery is compared with the alert and options limits; unknown delivery counts as 0 and the `delivery_excluded` flag still travels. The alert message states the total.
- **Options cooldown** (`options_cooldown_minutes`, default 360): lowered by the owner if a rare kit should be announced sooner. This replaces roadmap item B2 (a separate "newly listed" eBay poll): the keyword search already fetches up to 100 listings an hour, so a new listing is seen on the next pass; the real delay was the six-hour gap between lists.
- **C3 (known-page canary)** needs no new code: each known page is a `url:<domain>` source in `scrape_runs`, so a dead parser or a block shows as that source failing, with the new "blocked by the site" reason.
- Dashboard: Integrations tab gains `alert_on_total`, `options_cooldown_minutes`, `ebay_mpn_every_hours` (Alert behaviour) and a "Reliability and politeness" group (`heartbeat_url`, `scraper_user_agent`).
