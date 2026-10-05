# Research and Verification Log

Compiled 2026-10-05. Method: web searches and page reads through Firecrawl (cloud) tools, GitHub API reads, official docs, PyPI and package pages. **No container, MCP server or retailer scraper from this repo was executed.** "Verified" means confirmed from the cited source, not from a hands-on run.

## 1. Target hardware (Minisforum N5 Air)

| Item | Value | Status | Source |
|------|-------|--------|--------|
| CPU | AMD Ryzen 7 255 (8C/16T), Radeon 780M | Verified | store.minisforum.com listing; localhake.com review; nascompares.com review (2026-03-23) |
| Memory | 2x DDR5 SO-DIMM, up to 96GB, up to 5600 MT/s, **non-ECC** | Verified | same sources; Best Buy listing says "Up to 96GB DDR5 Non-ECC at 5600MT/s" |
| Shipped state | Barebones: no RAM, no drives, 64GB eMMC-class OS drive | Verified | localhake.com review |
| Storage | 5x SATA bays, 3x NVMe, 10GbE + 5GbE, PCIe x16 slot (x4 electrical), OCuLink | Verified | localhake.com review |
| RAM location | Under the cooler shroud, three screws | Verified | localhake.com review |
| Drive-bay issue after RAM install | One commenter: bays vanished until the backplane connector was reseated | Single anecdote | comment on nascompares.com review |
| ECC | Not supported on N5 Air (supported on N5 Pro) | Verified | nascompares.com review |
| Official qualified-memory list | Not found | - | - |
| Warranty reputation | Some Reddit/YouTube comments report poor warranty handling | Anecdotal | YouTube/Reddit comments |

## 2. UK price snapshot and classifier fixtures

One retailer, one moment. Scan.co.uk search for `ddr5 so-dimm 64gb`, retrieved 2026-10-05, prices inc. VAT, delivery excluded. Use the **titles** as test fixtures.

| Listing title (verbatim from the page) | Price | Stock text seen | GBP per GB |
|----------------------------------------|-------|-----------------|-----------|
| `64GB (2x32GB) CORSAIR DDR5 Vengeance SODIMM, PC5-44800 (5600), Non-ECC Unbuffered, CAS 48, 1.1V., XMP 3.0` | 933.49 | "Due 8th Oct" (no in-stock text) | 14.59 |
| `64GB (2x32GB) CORSAIR DDR5 Vengeance SODIMM, PC5-41600 (5200), Non-ECC Unbuffered, CAS 44, 1.1V` | 893.99 | "In stock", "Get it Wednesday, 07 Oct" | 13.97 |
| `24GB (1x24GB) CORSAIR DDR5 Vengeance SODIMM, PC5-41600 (5200), Non-ECC Unbuffered, CAS 44, 1.1V` | 279.98 | In stock | 11.67 |
| `24GB (1x24GB) CORSAIR DDR5 Vengeance SODIMM, PC5-38400 (4800), Non-ECC Unbuffered, CAS 40, 1.1V` | 320.48 | In stock | 13.35 |
| `24GB (1x24GB) CORSAIR DDR5 Vengeance SODIMM, PC5-44800 (5600), Non-ECC Unbuffered, CAS 48, 1.1V` | 322.49 | In stock | 13.44 |
| `4GB (1x4GB) Samsung DDR4 SO-DIMM M471A5244CB0, PC4-19200 (2400), Non-ECC Unbuffered, CAS 17, 1.2V` | (not rendered) | (not rendered) | **negative case: DDR4** |
| `4GB (1x4GB) Corsair DDR4 SODIMM Value Select, PC4-17000 (2133), Non-ECC Unbuffered, CAS 15-15-15-36, 1.2V` | (not rendered) | (not rendered) | **negative case: DDR4** |

Observations:
- The page lists **16 results** for the query; only the first 7 were visible in the extracted text. The search returns non-matching items (DDR4, single 24GB sticks) alongside kits, so a classifier is required.
- Stock wording has at least three states ("In stock", dated "Due ...", unknown). See audit A-02.
- The title string uses both `SODIMM` and `SO-DIMM`, `PC5-44800 (5600)` and `5600MHz` forms (the same product also has a marketing title `CORSAIR Vengeance Black 64GB 5600MHz DDR5 SODIMM Memory for 14th Gen Intel S/HX refresh CPU`).
- An anecdotal 2025 comment (Nascompares review thread) says 64GB DDR5 cost about GBP 200 then and about GBP 800 now; consistent in magnitude with the GBP 894 to 933 above. Treat as unverified context only.
- The page was retrieved through a hosted scraper, not through this repo's `scanSearch` extractor. Whether `scanSearch`'s selectors (`li.product`, `data-product-title`, `data-buy-price`) still match is **Unverified**.

## 3. Data sources and UK suitability

| Source | UK suitable | Self-hostable | Status / notes |
|--------|-------------|---------------|----------------|
| PricesAPI.io | Yes (`country=gb`, GBP) in repo code | No | Verified in code; service behaviour not tested |
| Keepa | Yes (domain 2 = Amazon.co.uk) in repo code | No (paid) | Keepa Pro page: 29 EUR/month with quota; API plans billed separately per a secondary source (trendsmcp.ai, accessed 2026-09-08). Repo comment claiming a free 100 tokens/min tier is **Unverified/conflicting** |
| uk.camelcamelcamel.com | Yes (Amazon UK) | No (free hosted) | Verified the UK site exists; Amazon only |
| Apify community actors | Unknown | No | Unverified |
| ShopSavvy API | Unconfirmed | No (paid) | Help page says retailers and currency follow user location; API UK coverage not confirmed |
| PriceBuddy | Yes (any store via CSS/regex/JSONPath) | Yes | Verified from docs: availability tracking and back-in-stock alerts; checks 5 min to 24 h; notifications via ntfy, Gotify, Pushover, Telegram, Discord, Apprise, email; SeleniumBase headless Chrome for JS pages; optional AI assist (OpenAI, Anthropic, Gemini or local Ollama); a CLI that can expose an MCP |
| changedetection.io | Yes (any page) | Yes (Apache-2.0) | See section 5 |
| Firecrawl | Yes (any URL) | Yes (AGPL-3.0) | See section 4 |
| theluckystrike/price-tracker MCP | No | n/a | GitHub URL returned 404; listings say npm publish pending; logs manually supplied prices (does not scrape) |
| aravindtri/amazon-price-tracker-mcp | Unlikely | n/a | Wraps camelcamelcamel.com (US) - not verified in code |
| BestPrice.gr, Prisjakt, Amazon.com tools | No | n/a | Greece / Sweden / US |

## 4. Self-hosted Firecrawl (verified against official docs)

Sources: docs.firecrawl.dev/contributing/self-host; github.com/firecrawl/firecrawl `SELF_HOST.md` (last commit 2026-08-07); raw `docker-compose.yaml` at tag `v2.11.162`; docs.firecrawl.dev/mcp-server/local.

**Verified**
- Official guide pins release **`v2.11.162`**, starts the API at `http://localhost:3002`, and smoke-tests with `POST /v2/scrape` `{"url":"https://example.com","formats":["markdown"],"timeout":60000}`. `/v0/health/readiness` is only a heartbeat.
- Quickstart `.env`: `USE_DB_AUTHENTICATION=false`, `POSTGRES_USER=postgres`, `POSTGRES_PASSWORD=<32+ random chars>`, `POSTGRES_DB=postgres` (keep `postgres`; the bundled `pg_cron` targets it). With auth disabled no API key or `Authorization` header is needed. The API is **unauthenticated**; do not expose it publicly.
- Compose services at that tag: `api` (workers), `playwright-service`, `redis`, `rabbitmq`, `nuq-postgres`, plus `foundationdb` and a one-shot `foundationdb-init` (queue backend only used if `NUQ_BACKEND=fdb`). Only the API publishes a host port (3002). **No persistent volumes** for PostgreSQL, Redis or RabbitMQ.
- Compose resource **caps** (not minimums): `api` cpus 4.0 / mem 8G; `playwright-service` cpus 2.0 / mem 4G. Firecrawl states it publishes **no verified minimum host size**.
- Tuning env vars present: `NUM_WORKERS_PER_QUEUE` (default 8), `CRAWL_CONCURRENT_REQUESTS` (10), `MAX_CONCURRENT_JOBS` (5), `BROWSER_POOL_SIZE` (5).
- The stock compose **builds from source** (`build: apps/api`, `apps/playwright-service-ts`, `apps/nuq-postgres`); image lines (`ghcr.io/firecrawl/firecrawl`, `.../playwright-service:latest`, `.../nuq-postgres:latest`) are commented out. A third-party April 2026 guide used those ghcr images; availability of images for tag `v2.11.162` is **Unverified**.
- Included in the self-hosted default: scrape, crawl, map and **search** routes; fetch and Playwright engines. LLM-backed extraction needs an OpenAI-compatible endpoint or Ollama: env vars `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `MODEL_NAME`, `MODEL_EMBEDDING_NAME`, `OLLAMA_BASE_URL` exist in the compose.
- Search can be wired to SearXNG: `SEARXNG_ENDPOINT`, `SEARXNG_ENGINES`, `SEARXNG_CATEGORIES` exist in the compose. (**Closes earlier open question about SearXNG wiring: the env vars exist; end-to-end behaviour is still untested.**)
- **Not included:** Fire-engine and its advanced anti-bot behaviour; screenshots and page actions (both need Fire-engine); Agent, Browser, interact, feedback and specialised formats (cloud features).
- License AGPL-3.0 (per a third-party review; the repo license file was not read).

**Firecrawl MCP (`firecrawl-mcp`)**
- Verified from docs: requires Node.js 22+; docs pin `firecrawl-mcp@3.23.7`; `FIRECRAWL_API_URL` targets a self-hosted API; `FIRECRAWL_API_KEY` is optional **only when the self-hosted API does not require authentication**; `HTTP_STREAMABLE_SERVER=true` serves `http://localhost:3000/mcp` with `GET /health` returning `ok`; tool availability depends on what the deployment enables.

**Correction (this log's own earlier claim):** an earlier revision of the plan said the "8GB RAM and 4 vCPU" figure came from a third-party blog and removed it. That was **only partly right**: the official compose does set caps of 4 CPU / 8G for the API and 2 CPU / 4G for Playwright. They are caps, not documented minimum requirements, and total real usage is unmeasured.

**Still Unverified:** that the stack runs acceptably on the intended host; success rate against each target retailer (no Fire-engine anti-bot); behaviour of `/v2/scrape` `rawHtml` format on the self-hosted build for the pages of interest.

## 5. changedetection.io and its MCP

Sources: github.com/dgtlmoon/changedetection.io (about 34.8k stars; commits on 2026-10-01 touching "Restock & Price detection"); changedetection.io/docs/api_v1 (API 0.1.9, sample system version 0.50.10, license Apache 2.0).

**Verified from the API documentation**
- Auth: header `x-api-key` (key under Settings -> API). Base `/api/v1/`.
- Endpoints: list/create/get/update/delete watch, watch history, snapshot (`/watch/{uuid}/history/{timestamp|latest}`, optional `?html=1` returns the last fetched HTML; only the last two HTML files are kept), diff between snapshots, tags, notifications (Apprise URLs), search, import (plain-text list of URLs with query-parameter config), system info, and `/api/v1/full-spec` (live merged OpenAPI, no auth).
- `processor`: `restock_diff` or `text_json_diff` (default). `restock_diff` monitors availability and price using structured data (JSON-LD / schema.org microdata) and text heuristics. Config block `processor_config_restock_diff`: `in_stock_processing` (`in_stock_only` | `all_changes` | `off`), `follow_price_changes`, `price_change_min`, `price_change_max`, `price_change_threshold_percent`.
- Fetch backends: `html_requests`, `html_webdriver` (Playwright/Puppeteer), plugin/extra browsers; `browser_steps` supported; `track_ldjson_price_data` and read-only `has_ldjson_price_data` fields exist.
- Built-in LLM fields exist on watches (`llm_intent`, `llm_change_summary`, ...); backend/provider requirements were not examined. Keep disabled for self-sufficiency unless a local backend is confirmed.
- A GitHub issue title indicates price display is weaker for sites **without Schema.org microdata**; the Release notes mention fixes for decimal-comma prices and `restock.previous_price` behaviour.

**Verified gap:** the documented Watch JSON has **no current-price field** (only configuration and `has_ldjson_price_data`). How to read the extracted price (snapshot text, notification payload, or an undocumented field) is **Unverified** and is spike task P3-2.

**Community MCP `changedetection-mcp`**
- Verified: PyPI `changedetection-mcp` **0.1.0**, released 2026-05-17, MIT, Python >= 3.11, one maintainer, uploaded with twine (not Trusted Publishing), sdist 11.5 kB and wheel 11.0 kB with published SHA-256 hashes (sdist `4c9711631af1f2223af6c6133741ef414ddaac6698062d5dba8bbd75465f5b73`, wheel `abca7b9c17ce388acbc5f90065f141a63eed25cbedf7e23ad1347d90dac2d740`). GitHub `rusty4444/changedetection-mcp`: 9 commits, no tags/releases, 1 star, last commit 2026-05-31.
- Env: `CHANGEDETECTION_BASE_URL`, `CHANGEDETECTION_API_KEY`; optional `CHANGEDETECTION_MCP_ACTION_LIMIT_PER_WATCH` (default 3).
- Tools: `list_watches`, `get_watch`, `create_watch`, `update_watch`, `delete_watch`, `recheck_watch`, `get_watch_history`, `get_snapshot_diff`, `search_watches`, `list_tags`, `create_tag`, `get_system_info`. **No price or restock-specific tool.** `get_snapshot_diff` arms a per-watch fuse limiting follow-up mutating actions.
- Not verified: end-to-end behaviour against a live instance; compatibility with the latest changedetection.io release.
- Risk controls: pin version and hashes, run isolated, review the roughly 11 kB of source before use. Optional only: this repo's own integration should talk to the REST API directly.

## 6. Other tools evaluated

- **PriceBuddy** (self-hosted, docs at pricebuddy.jez.me): viable alternative/sidecar; the repo's `url-scraper.ts` already implements a similar fallback chain, so adopting PriceBuddy would mostly duplicate it.
- **Keepa MCP** (`keepa.com/mcp`): needs a paid API subscription per a secondary source.
- Rejected for UK/self-sufficiency: BestPrice.gr MCP, Prisjakt tools, Amazon.com tools, theluckystrike MCP, aravindtri MCP (see section 3).

## 7. Verification log

| # | Question | Result | Evidence | Remaining action |
|---|----------|--------|----------|------------------|
| 1 | Does Firecrawl MCP work with a self-hosted API and without a key? | **Verified** (key optional when auth disabled) | docs.firecrawl.dev/mcp-server/local | Smoke test on real stack |
| 2 | What does self-hosted Firecrawl lack? | **Verified** (no Fire-engine, no screenshots/actions, cloud-only features) | docs self-host page | - |
| 3 | Does `changedetection-mcp` exist and what does it do? | **Verified** (PyPI 0.1.0, tools listed) | PyPI, GitHub | Live test |
| 4 | Does changedetection.io support price/restock via API? | **Verified** (`restock_diff` + config via API) | API docs | - |
| 5 | Can the extracted price be read via API? | **Unverified** (no documented field) | API docs | Spike P3-2 |
| 6 | Does Firecrawl search support SearXNG? | **Partly verified** (env vars in official compose) | compose at v2.11.162 | End-to-end test |
| 7 | Does the repo's Keepa client target Amazon UK? | **Verified in code** (`domain=2`, `amazon.co.uk` URLs) | `keepa.ts` | Confirm domain numbering against Keepa docs |
| 8 | Does the repo's Apify Amazon call target the UK? | **Partly verified** (`countryCode: 'GB'`, `.co.uk` fallback URL) | `apify.ts` | Actor behaviour Unverified |
| 9 | Does PricesAPI path use GB? | **Verified in code** (`country='gb'`) | `pricesapi.ts` | Service behaviour untested |
| 10 | Is the scheduler key-less for components without URLs? | **Disproved** (PricesAPI only; errors swallowed) | `scheduler.ts` | Fix P0-9 |
| 11 | Do alerts consider stock? | **Disproved** (no stock filter in best-price queries) | `db.ts`, `scheduler.ts` | Fix P0-1 |
| 12 | Is the generic scraper PriceBuddy-like already? | **Verified** (JSON-LD, meta, rules, DOM, Playwright, Camofox, LLM, self-heal) | `url-scraper.ts` | - |
| 13 | Do prebuilt Firecrawl images exist for v2.11.162? | **Unverified** | compose comments only | Check GHCR tags |
| 14 | NAS headroom for Firecrawl | **Partly measured** (existing NAS: 32GB RAM, ~35% CPU load at sampling; free-memory and per-container usage not captured) | read-only hardware report | Measure on chosen host under load |
| 15 | Real retailer scraping success rate | **Unverified**; one hosted-scraper read of Scan returned usable product text and prices | Scan search page | Run repo extractors and Firecrawl tier against fixtures per retailer |
| 16 | Keepa free API tier | **Conflicting/Unverified** | code comment vs secondary source | Check Keepa API docs |
| 17 | Does Scan's markup match `scanSearch` selectors? | **Unverified** | - | Fixture test |

## 8. Sources (accessed 2026-10-05 unless noted)

- Minisforum N5 Air store listing: store.minisforum.com/products/minisforum-n5-air-ai-nas
- Localhake review: localhake.com/content/minisforum-n5-air-review
- NAS Compares review: nascompares.com/2026/03/23/minisforum-n5-air-nas-review/
- Firecrawl self-host docs: docs.firecrawl.dev/contributing/self-host
- Firecrawl SELF_HOST.md: github.com/firecrawl/firecrawl/blob/main/SELF_HOST.md
- Firecrawl compose at tag v2.11.162: raw.githubusercontent.com/firecrawl/firecrawl/v2.11.162/docker-compose.yaml
- Firecrawl MCP (local): docs.firecrawl.dev/mcp-server/local
- changedetection.io API docs: changedetection.io/docs/api_v1/index.html
- changedetection.io repo: github.com/dgtlmoon/changedetection.io
- changedetection-mcp: pypi.org/project/changedetection-mcp/ and github.com/rusty4444/changedetection-mcp
- PriceBuddy features: pricebuddy.jez.me/features.html
- Keepa Pro page: keepa.com (Pro, 29 EUR/month); Keepa alternatives article: trendsmcp.ai/blog/keepa-alternatives (accessed 2026-09-08 per the page)
- ShopSavvy currency/region help: shopsavvy.com/help/about-the-currency-shopsavvy-displays
- Scan.co.uk search page (price snapshot): scan.co.uk/search?q=ddr5+so-dimm+64gb
- Repository files read: see `docs/CODEBASE_AUDIT.md` header

## 9. Limits of this research

- Hosted (cloud) Firecrawl tools were used for research; behaviour of the self-hosted build can differ.
- Retail prices and stock change hourly; the snapshot is a single observation.
- Third-party claims (reviews, blogs, comments) are labelled as such and are not independently confirmed.
- Nothing here has been tested against the owner's hardware or network.
