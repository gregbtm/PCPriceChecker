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
- [ ] P0-6 Real HTML parser for rules
- [ ] P0-7 Safe selector self-healing
- [x] P0-8 Scheduler failure visibility (`scrape_runs`, PR-D)
- [x] P0-9 No-paid-key scheduler path (PR-D; interim `matchesQuery` filter until P1-5)
- [ ] P0-10 Outlier policy
- [x] P0-11 Apify abort and logging (PR-D)
- [x] P0-12 Currency handling (PR-B; JSON-LD, meta, rules, DOM and Playwright reject non-GBP. Camofox and AI paths still report whatever they return, see audit A-19)

Phase 1 profile and classifier
- [ ] P1-1 Memory classifier
- [ ] P1-2 Hardware profile model
- [ ] P1-3 Kit/price-per-GB fields
- [ ] P1-4 Compatibility rules (SO-DIMM, ECC, capacity, mobile CPUs)
- [ ] P1-5 Wire classifier into scheduler/search
- [ ] P1-6 Dashboard/MCP price-per-GB display

Phase 2 providers
- [ ] P2-1 Provider interface
- [ ] P2-2 Firecrawl provider
- [ ] P2-3 Per-domain strategy memory
- [ ] P2-4 Local LLM (OpenAI-compatible base URL)
- [ ] P2-5 SearXNG discovery (optional)
- [ ] P2-6 Paid sources marked optional

Phase 3 changedetection.io
- [ ] P3-1 REST client
- [ ] P3-2 Spike: where to read the extracted price
- [ ] P3-3 Integration mode
- [ ] P3-4 JS-rendering watches
- [ ] P3-5 Document community MCP

Phase 4 alerting
- [ ] P4-1 Alert rules (in-stock based)
- [ ] P4-2 Configurable cooldowns, quiet hours, dedupe
- [ ] P4-3 Richer alert text
- [~] P4-4 Self-hosted ntfy (PR-D: `ntfy_token` Bearer support + test; docs not done)
- [~] P4-5 Optional n8n workflow (generic `webhook_url` channel + `docs/N8N.md` + example workflow JSON; the JSON is Unverified, never imported into n8n)

Phase 5 observability and data
- [~] P5-1 Health per source (PR-D: `scrape_runs`, `/api/health` `scrapers`, `/api/scrape-runs`; dashboard "needs attention" UI not done)
- [ ] P5-2 Retention/rollup
- [ ] P5-3 Delivered cost and VAT flag
- [ ] P5-4 Outlier policy implementation

Phase 6 deployment
- [ ] P6-1 Compose services (pinned, LAN-only, limited)
- [ ] P6-2 Host decision and measurement
- [ ] P6-3 Firecrawl image vs build-from-source check
- [ ] P6-4 README/compose reconciliation
- [ ] P6-5 Backup/restore notes

Phase 7 tests and docs
- [x] P7-1 Test runner and CI (Vitest, `npm test`, CI step; PR-A)
- [ ] P7-2 Fixtures and tests
- [ ] P7-3 Docs and `.env.example`

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
- **Health:** `/api/health` stays `status: ok` and adds `scrapers.failing` (sources with 3+ failures in a row); `/api/scrape-runs?component_id=&limit=` lists recent runs.

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
- **Anti-bot.** Without Fire-engine, some retailers may block self-hosted fetches; the existing Playwright/Camoufox tier remains the fallback.
- **Silent drift.** Retailer layouts change; P0-8 and P5-1 exist so failures are loud.
- **Public repo hygiene.** Fixtures must not contain personal data or credentials. Treat `.env`, the SQLite file and exports as private.
- **Backward compatibility.** The MCP tool names and REST routes are an interface; additions only.

## 12. Maintaining these documents

- When you verify or disprove something, update the status word in place and append a row to the verification log (research doc section 7) with date, method and source.
- When you finish a task, tick it in section 5 and note the PR.
- Keep the status vocabulary and the `A-nn` / `P-n-n` identifiers stable.
