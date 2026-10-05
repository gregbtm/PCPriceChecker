# Improvement Plan: Deal-Aware UK RAM and Hardware Tracking (Self-Sufficient)

_Last revised 2026-10-05 (fourth revision: cross-references to `HANDOFF.md`). This plan is written so that another engineer or LLM can pick it up cold._

## 0. How to use these documents

| File | Purpose | Read |
|------|---------|------|
| `docs/HANDOFF.md` | Entry point: copy-paste prompt, situation summary, progress tracker, reference commands, stop-gap steps, decision log, glossary, risks | First |
| `docs/IMPROVEMENT_PLAN.md` (this file) | Goal, principles, target design, task list with IDs, acceptance criteria | Second |
| `docs/CODEBASE_AUDIT.md` | What the code does today, with file references and **verified defects** (IDs `A-nn`) | Third |
| `docs/RESEARCH_AND_VERIFICATION.md` | Hardware spec, UK price snapshot, third-party tools, **verification log** (what was checked, how, what is still unknown) | Fourth |

Every claim is tagged **Verified** (read from code or an official source), **Partly verified**, **Unverified** (needs a hands-on check) or **Corrected** (an earlier statement that turned out wrong). Do not treat Unverified items as facts. Track task status in `HANDOFF.md` section 5.

## 1. Goal and context

The owner is buying **64GB (2x32GB) DDR5 SO-DIMM** for a **Minisforum N5 Air** NAS while UK RAM prices are very high. They want to buy at a genuinely good price: alerts when a *compatible* kit is *actually in stock* at or below a target, with price history for context.

The repo (`gregbtm/PCPriceChecker`, code in `pc-price-mcp/`) is already a capable UK PC price tracker (SQLite history, REST API, dashboard, MCP server, 17 direct UK retailer scrapers, a generic URL scraper with a multi-step fallback chain, alerts via ntfy and others). This plan does **not** replace it. It (1) fixes correctness defects that would cause wrong or missed alerts, (2) adds hardware-profile and compatibility-aware matching, (3) makes the whole pipeline runnable with **no paid third-party service**, and (4) adds observability so silent scraper failures cannot go unnoticed.

## 2. Principles and constraints

1. **Self-sufficiency.** The core flow must work with no paid API keys and no hosted AI. Paid or hosted sources (PricesAPI.io, Keepa, Apify actors, cloud LLMs) stay available as **optional fallbacks** only.
2. **Correctness before features.** Phase 0 fixes (stock-aware best price, stock tri-state, wrong-price bugs) come first; they affect every alert.
3. **Backward compatibility.** Do not rename or remove existing MCP tools, REST endpoints, DB columns or config keys. Add columns/tools; use the existing migration pattern (`runMigrations` in `db.ts`, `PRAGMA table_info` + `ALTER TABLE ... ADD COLUMN`).
4. **Fail loudly.** A scraper that returns nothing must be visible (health record, dashboard, alert), never silently stale.
5. **No secrets in the repo.** Keys live in env vars or the SQLite `config` table (the export already strips keys matching `%_key%`, `%_token%`, `%_secret%`, `%_password%`).
6. **Private network by default.** Self-hosted Firecrawl and changedetection.io are LAN-only; neither ships with real authentication in the documented quickstart.
7. **Pin versions.** Pin Firecrawl to a release tag and third-party MCP packages to exact versions (and hashes where published).
8. **Test with real fixtures.** The repo has **no automated tests** today (see audit A-18). Add a test runner and commit HTML/text fixtures from real retailer pages.

## 3. Target hardware profile (profile id suggestion: `n5-air-ram`)

| Constraint | Value | Status |
|-----------|-------|--------|
| Platform | Minisforum N5 Air, AMD Ryzen 7 255, ships barebones (no RAM) | Verified (vendor/review pages) |
| Memory type | DDR5 **SO-DIMM**, **non-ECC** (ECC is an N5 Pro feature) | Verified |
| Slots | 2 | Verified |
| Max total | 96GB | Verified (vendor) |
| Max speed | 5600 MT/s; slower kits work, faster kits downclock | Verified (vendor) / Partly verified (downclock behaviour is general DDR5 behaviour) |
| Target | Matched 2x32GB kit = 64GB | Owner requirement |
| Reject | DDR4, desktop UDIMM, CAMM2, ECC/registered, single sticks when a kit is required | Design decision |
| Non-binary modules (24GB / 48GB) | Listings exist (24GB SO-DIMMs seen at Scan). **Compatibility with the N5 Air is Unverified.** Treat 2x24GB (48GB) as an *optional, flagged* alternative, not a default match. | Unverified |
| Install note | Slots sit under the cooler shroud (3 screws). One owner reported drive bays disappearing after fitting RAM until the backplane connector was reseated. | Reported by one user |

## 4. Current vs target architecture

Current (Verified by reading code): see `docs/CODEBASE_AUDIT.md` section 2.

Target:

```
               +-------------------------------------------+
               |  PCPriceChecker (Node/TS, SQLite, REST/MCP) |
               |  profiles + classifier + alert engine       |
               +-------+----------------+------------------+
                       |                |
         provider chain (per URL/domain; first tier that yields a valid, in-stock-aware price wins)
   1. direct fetch + JSON-LD/meta/rules (existing, fixed)
   2. self-hosted Firecrawl  (JS-rendered pages -> html/markdown, local extractors)
   3. changedetection.io     (restock_diff watches, REST API)
   4. Playwright / Camoufox  (existing)
   5. OPTIONAL paid: PricesAPI, Keepa, Apify, cloud LLM
                       |
                 SQLite price_records (+ stock_state, kit attrs, scrape_runs)
                       |
        alert engine -> self-hosted ntfy (+ other existing channels)
```

Optional orchestration (n8n) and discovery (SearXNG via Firecrawl search) are additive, not required.

## 5. Work plan

Task IDs are stable references (`P0-1`, `P1-2` ...). `A-nn` refers to `docs/CODEBASE_AUDIT.md`. Suggested PR slicing is in section 6. Status is tracked in `docs/HANDOFF.md` section 5.

### Phase 0: Correctness fixes (do first)

| ID | Task | Audit | Files |
|----|------|-------|-------|
| P0-1 | **Stock-aware best price.** Add an `inStockOnly` option (default **true** for alerting) to `getLatestPricePerRetailer` (or a new `getBestInStockOffer`). Use it in `scheduler.ts` (price alert, drop detection, `prevBestPrice`), `db.getPriceStats().current_best`, `getComponentsBelowAlertPrice`, `getRecentPriceDrops`, `getBatchDealRatios`, `getBuildSummary`. Keep old behaviour available for dashboards via a flag. | A-01 | `db.ts`, `scheduler.ts`, `index.ts`, `web.ts` |
| P0-2 | **Stock tri-state.** Add `price_records.stock_state` (`in_stock` / `out_of_stock` / `backorder` / `unknown`), keep `in_stock` int for compatibility. Stop defaulting unknown to in-stock. Treat phrases such as "Due 8th Oct", "Pre-order", "Expected", "Back order" as `backorder`. | A-02 | `db.ts`, `sources/url-scraper.ts`, `sources/uk-retailers.ts`, `scheduler.ts`, `notifications.ts` |
| P0-3 | Fix John Lewis price selection (`was` preferred over `now`). | A-03 | `sources/uk-retailers.ts` |
| P0-4 | Remove or quarantine the "lowest price on page >= GBP 10" fallback in `scrapeRetailer`; never write it to history or alerts. | A-04 | `sources/uk-retailers.ts` |
| P0-5 | One shared, tested JSON-LD module handling `@graph`, `@type` arrays, `AggregateOffer.lowPrice`, multiple offers, availability URLs, currency; replace the two duplicated implementations. | A-05 | new `sources/structured-data.ts` |
| P0-6 | Replace regex pseudo-CSS in `tryRules` with a real HTML parser and real CSS selectors; honour `price_attribute`; add JSONPath if needed. | A-06 | `sources/url-scraper.ts`, `package.json` |
| P0-7 | Make selector self-healing safe: send structural HTML excerpts (not tag-stripped text), **validate** proposed selectors against the page before saving, throttle per domain. | A-07 | `sources/url-scraper.ts`, `openai-client.ts` |
| P0-8 | Surface scheduler failures: record every run per source in a new `scrape_runs` table; count thrown errors (e.g. missing API key) as failures; alert after N consecutive failures. | A-10 | `scheduler.ts`, `db.ts`, `notifications.ts` |
| P0-9 | Scheduler must have a **no-paid-key path** for components without URLs: component URLs, then direct UK retailer search, then optional PricesAPI. | A-11 | `scheduler.ts` |
| P0-10 | Decide and document outlier policy; do not let `validatePrices` hide a plausible genuine bargain (see A-12). | A-12 | `services/price-validator.ts`, `scheduler.ts` |
| P0-11 | Apify: abort runs on client timeout; log failures; mark as optional. | A-09 | `sources/apify.ts` |
| P0-12 | Currency handling: stop hard-coding GBP in rules/DOM/Playwright extractors; reject non-GBP prices unless converted. | A-19 | `sources/url-scraper.ts` |

Acceptance: unit tests for P0-1/2/3/4/5/6 using fixtures (see section 8). A seeded DB test shows an out-of-stock cheaper listing does **not** trigger a price alert.

### Phase 1: Hardware profile and listing classifier

| ID | Task |
|----|------|
| P1-1 | `services/memory-classifier.ts`: parse a product title/spec text into `{ddr: 4|5|null, formFactor: 'SODIMM'|'DIMM'|'CAMM2'|null, ecc: bool|null, modules: n, moduleGb: n, totalGb: n, speedMts: n|null, cl: n|null, voltage: n|null}`. Handle forms such as `64GB (2x32GB)`, `2x32GB`, `1x24GB`, `PC5-44800 (5600)`, `5600MHz`, `SODIMM`/`SO-DIMM`, `Non-ECC Unbuffered`, `CAS 48`, `1.1V`. Real sample titles are in `docs/RESEARCH_AND_VERIFICATION.md` section 2 and must become test fixtures, including negative cases (DDR4 SO-DIMM, desktop DIMM). |
| P1-2 | Hardware profile model (config or table): constraints from section 3. `matchesProfile(listing, profile)` returns `{match: bool, reasons: string[], flags: string[]}` where flags include `non_binary_unverified`. |
| P1-3 | Add `kit_total_gb`, `modules`, `price_per_gb` to price records (migration) or a `listing_attributes` table; expose through REST and MCP (new fields only). |
| P1-4 | Extend `services/compatibility.ts`: add form-factor (SO-DIMM vs DIMM), ECC, slot count, total-capacity cap, and recognise mobile/APU platforms such as Ryzen 7 255 (currently `unknown`). Keep existing desktop rules intact. |
| P1-5 | Wire the classifier into search results and the scheduler so non-matching listings are excluded from the profile's best price and alerts (but still stored). |
| P1-6 | Dashboard/MCP: show price per GB and "meets target" per listing. |

Use `unit_quantity` / `unit_type` (already in `tracked_components`, `setComponentUnitPricing`) where possible instead of inventing a parallel concept; verify how `index.ts` and `web.ts` currently use them first.

### Phase 2: Provider chain and self-hosted tiers

| ID | Task |
|----|------|
| P2-1 | Define a provider interface: `fetchOffer(target) -> {price, currency, stockState, name, url, method, rawRef?} | failure{reason}`. Existing code paths become providers without behaviour change. |
| P2-2 | **Firecrawl provider** (self-hosted): `POST {FIRECRAWL_API_URL}/v2/scrape` with `formats: ["rawHtml"]` (or `html`/`markdown`), then run the shared extractors locally. Do **not** depend on Firecrawl's LLM extraction. Config: `firecrawl_url` (default unset = tier disabled), optional API key. Timeout longer than the request `timeout`. |
| P2-3 | **Per-domain strategy memory**: remember which tier last succeeded for a domain and try it first; demote after repeated failures. |
| P2-4 | **Local LLM option**: make the OpenAI-compatible base URL and model configurable (`OPENAI_BASE_URL`, `OPENAI_MODEL`), so Ollama (`http://host:11434/v1`) works; keep the Anthropic path optional. Default remains off. |
| P2-5 | Optional: SearXNG-backed discovery via Firecrawl search (`SEARXNG_ENDPOINT`, `SEARXNG_ENGINES`, `SEARXNG_CATEGORIES` exist in the official compose). |
| P2-6 | Keep Keepa/PricesAPI/Apify behind `isConfigured()` checks and document them as optional. |

### Phase 3: changedetection.io integration

| ID | Task |
|----|------|
| P3-1 | Client for the changedetection.io REST API v1 (header `x-api-key`; endpoints under `/api/v1/`): create watch (`processor: "restock_diff"`, `processor_config_restock_diff`), list/get/recheck, history, snapshot. |
| P3-2 | **Spike (answers open question Q6):** create one real watch on a UK retailer product page and determine exactly where the extracted price and stock state can be read (watch JSON, snapshot text, or notification webhook). The documented Watch JSON exposes config thresholds and `has_ldjson_price_data`, but **no documented current-price field**. |
| P3-3 | Choose integration mode from the spike: poll snapshots, receive Apprise/webhook notifications, or both. Store results via the same `savePriceSnapshots` path. |
| P3-4 | Use `fetch_backend: html_webdriver` only for pages that need JS; note it requires a browser-capable deployment of changedetection.io. |
| P3-5 | Document the optional community MCP `changedetection-mcp` (see research doc) for ad-hoc management; the repo's own integration must not depend on it. |

### Phase 4: Alerting

| ID | Task |
|----|------|
| P4-1 | Alert rules per profile/component: absolute target, percentage drop, new lowest in N days, back-in-stock under max price. All based on **in-stock** offers (P0-1). |
| P4-2 | Make cooldowns configurable (today hard-coded 1440 min for target alerts and 360 min for drops in `scheduler.ts`); add quiet hours and de-duplication keyed on retailer+price. |
| P4-3 | Alert text includes retailer, price, price per GB, stock state, delivery estimate if known, link. |
| P4-4 | Document and test a **self-hosted ntfy** setup; keep other channels. |
| P4-5 | Optional n8n workflow (poll REST API, route notifications). |

### Phase 5: Observability and data hygiene

| ID | Task |
|----|------|
| P5-1 | `scrape_runs` table (component_id, source/tier, started_at, duration_ms, ok, error, offers_found); `/api/health` includes last-success age per source; dashboard "needs attention" uses it (builds on `getComponentsNeedingAttention`). |
| P5-2 | Retention/rollup for `price_records` (unbounded today, A-13): keep raw rows N days, then daily min/avg/max; configurable. |
| P5-3 | Record delivered cost (shipping) and VAT-inclusive flag where a source provides them. |
| P5-4 | Outlier policy implementation from P0-10. |

### Phase 6: Deployment and operations

| ID | Task |
|----|------|
| P6-1 | Add optional compose services/overlays for changedetection.io and Firecrawl with pinned versions, LAN-only ports, resource limits, persistent volumes. |
| P6-2 | **Host decision (owner):** an existing home NAS (32GB RAM, ~35% CPU load when sampled, runs many other containers) vs the new Minisforum N5 Air (8-core/16-thread Ryzen 7 255). Firecrawl's stock compose caps are API 4 CPU / 8G and Playwright 2 CPU / 4G (caps, not verified minimums) and it also runs Redis, RabbitMQ, PostgreSQL and FoundationDB services. Measure before committing; consider lowering `NUM_WORKERS_PER_QUEUE`, `BROWSER_POOL_SIZE`, `MAX_CONCURRENT_JOBS`. |
| P6-3 | Firecrawl's stock compose **builds from source** (`build: apps/api`, `apps/playwright-service-ts`, `apps/nuq-postgres`); image names exist as commented lines. Verify that prebuilt images for the pinned tag exist before choosing; otherwise budget build time and memory. |
| P6-4 | Reconcile docs: root README says image `ghcr.io/gregbtm/pc-price-checker` and port 3000, while `pc-price-mcp/docker-compose.yml` uses `ghcr.io/gregbtm/pc-price-mcp:latest` and default host port 38574 with Watchtower auto-updating `:latest` (A-17). |
| P6-5 | Backup/restore notes for the SQLite volume and the changedetection.io datastore. |

### Phase 7: Tests, docs, CI

| ID | Task |
|----|------|
| P7-1 | Add a test runner (e.g. Vitest) and `npm test`; wire into the existing CI (`.gitlab-ci.yml` and `.github/` both exist; check which is authoritative). |
| P7-2 | Fixtures: real retailer HTML/text snippets and listing titles (never credentials). Cover classifier, JSON-LD, rules, stock states, John Lewis price, alert logic with a seeded DB. |
| P7-3 | Update `README.md`, `pc-price-mcp/DOCS.md`, `DEPLOYMENT.md`, `.env.example` for every new setting. |

## 6. Suggested order and PR slicing

1. PR-A: P0-1, P0-2 (+migration, +tests). Highest value.
2. PR-B: P0-3, P0-4, P0-5, P0-12 (extraction correctness) with fixtures.
3. PR-C: P0-6, P0-7 (real HTML parser, safe self-healing).
4. PR-D: P0-8, P0-9, P0-11, P5-1 (visibility and no-key path).
5. PR-E: P1-1..P1-3, P1-5 (classifier and profile).
6. PR-F: P2-1..P2-4 (providers, Firecrawl, local LLM option).
7. PR-G: P3-1..P3-3 (changedetection.io after the spike).
8. PR-H: P4, P5-2..P5-4, P6, P7-3.

## 7. Decisions needed from the owner

1. Maximum acceptable price for 64GB, and whether 2x24GB (48GB) or 2x16GB are acceptable fallbacks.
2. Alert channel(s) (self-hosted ntfy recommended) and quiet hours.
3. Retailer shortlist; whether used/eBay listings are acceptable for RAM.
4. Where to host Firecrawl and changedetection.io (section P6-2).
5. Whether to keep Watchtower `:latest` auto-updates.
6. Whether the repo is public; if so, keep fixtures free of personal data.

## 8. Definition of done

- With **no paid API keys or hosted-LLM keys configured**, tracking at least three UK retailers works end to end and alerts are delivered.
- A cheaper **out-of-stock or backorder** listing never triggers a price alert (tested).
- The classifier accepts `64GB (2x32GB) DDR5 SODIMM ... Non-ECC` and rejects DDR4 SO-DIMM and desktop DIMM titles (tested with real titles).
- A broken scraper produces a visible failure record and a notification within the configured threshold.
- Self-hosted Firecrawl passes its documented smoke test; the Firecrawl tier recovers at least one JS-rendered page that direct fetch could not.
- The changedetection.io spike result is documented and, if viable, integrated.
- `npm test` passes in CI; docs updated.

## 9. Guardrails for the implementer

- Do not commit secrets, API keys, or personal data. Do not expose Firecrawl or changedetection.io beyond the LAN.
- Do not remove existing tools, endpoints, columns or config keys; add alongside.
- Do not trust Unverified items in the research doc; verify first and update the doc with the result.
- Prefer small PRs following section 6; run the type-check (`npm run build`) before each.
- When you verify something, append to the verification log in `docs/RESEARCH_AND_VERIFICATION.md` with date, method and source.

## 10. Hand-off prompt

The full copy-paste prompt lives in `docs/HANDOFF.md` section 1 (single source of truth). Short form: take over `gregbtm/PCPriceChecker`, read the four docs in the order listed in section 0, implement the plan in the PR order in section 6 starting with P0-1/P0-2, stay backward compatible, add tests, verify Unverified items and log results, and ask the owner only for the decisions in section 7.
