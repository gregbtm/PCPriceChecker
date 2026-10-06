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
| 10 | Is the scheduler key-less for components without URLs? | **Disproved** at audit time (PricesAPI only; errors swallowed). **Corrected 2026-10-05: fixed in PR-D**, tested with mocked retailers | `scheduler.ts`, `services/refresh.test.ts` | Live run on the NAS |
| 11 | Do alerts consider stock? | **Disproved** at audit time. **Corrected 2026-10-05: fixed in PR-A** (failing test first, then fix) | `db.ts`, `services/alerts.test.ts` | - |
| 12 | Is the generic scraper PriceBuddy-like already? | **Verified** (JSON-LD, meta, rules, DOM, Playwright, Camofox, LLM, self-heal) | `url-scraper.ts` | - |
| 13 | Do prebuilt Firecrawl images exist for v2.11.162? | **Unverified** | compose comments only | Check GHCR tags |
| 14 | NAS headroom for Firecrawl | **Partly measured** (existing NAS: 32GB RAM, ~35% CPU load at sampling; free-memory and per-container usage not captured) | read-only hardware report | Measure on chosen host under load |
| 15 | Real retailer scraping success rate | **Unverified**; one hosted-scraper read of Scan returned usable product text and prices | Scan search page | Run repo extractors and Firecrawl tier against fixtures per retailer |
| 16 | Keepa free API tier | **Conflicting/Unverified** | code comment vs secondary source | Check Keepa API docs |
| 17 | Does Scan's markup match `scanSearch` selectors? | **Unverified**: could not be checked from the sandbox (see row 18) | - | Run from the NAS, capture the HTML as a fixture |
| 18 | Do the repo's plain-HTTP retailer scrapers get real pages? | **Partly verified, negative, from one vantage point.** 2026-10-05, one `curl` GET per retailer search page for `ddr5 so-dimm 64gb`, browser-like User-Agent and `Accept-Language: en-GB`, from the cloud sandbox (datacenter IP): Scan 403 "Just a moment..." (Cloudflare challenge, 5.7 KB); CCL 403 same; Novatech 403 same; Currys 403 "Attention Required! \| Cloudflare"; Overclockers 403 (9.6 KB, no title); Ebuyer connection failed (curl code 000, no HTTP response). No product data and no JSON-LD in any response. No attempt was made to get past the challenges. | One request per site, no retries | **Unknown whether the NAS's home IP is treated the same.** Run `GET /api/search/retailers?q=ddr5%20so-dimm%2064gb&retailers=scan,ebuyer,ccl` on the NAS and read `/api/scrape-runs`; if blocked there too, plain fetch is not viable for those sites and the Firecrawl/Playwright/Camofox tier (PR-F) or a different source is required |
| 19 | What do the scrapers return on the owner's NAS (home IP)? | **Verified (observed output)**, 2026-10-06, first scheduler pass on the deployed image, `/api/scrape-runs`: Scan, Overclockers, Box, Currys HTTP **403** (blocked); Ebuyer, CCL, Novatech, Aria, AWD-IT HTTP **404** (the server answered, so those search URLs are wrong or stale); eBay `OAuth failed HTTP 401 invalid_client`; PricesAPI `authentication failed` (a stale `PRICES_API_KEY` is set). Zero retailer scrapers returned products. | owner-pasted `/api/scrape-runs` | Fix the 404 URLs that can be verified; get the eBay keyset working |
| 20 | Is AWD-IT's search URL right, and does the extractor read its page? | **Verified for AWD-IT only.** The site's own search form posts to `/catalogsearch/result/` (Magento, `q=`); the code's `/search?q=` was the 404. A real result block was captured 2026-10-06 and is now a test fixture. It showed **Kingston Fury 64GB (2x32GB) DDR5 5600MT/s CL40 SODIMM at GBP 919.99 inc. VAT, Out of stock**. The generic block parser reported stock `unknown` for it (it ends a block at the first `</div>`), so a Magento-specific extractor was added. In-stock markup has not been seen (synthetic test only). | `src/test/fixtures/awd-it-kingston-fury-64gb.html` | Capture an in-stock block when one exists |
| 21 | Is Aria still trading online? | **Verified (negative).** `aria.co.uk` shows "Aria PC - Message to our customers": the online retail site closed in August 2022. Removed from the default retailer list. | homepage text, 2026-10-06 | - |
| 22 | Correct search addresses for Ebuyer, CCL and Novatech? | **Partly verified.** The owner supplied the addresses their browser uses (2026-10-06): `ebuyer.com/searchresults?descriptionfilter=`, `cclonline.com/search?query=`, `novatech.co.uk/search.html?search=`. The code's old ones answered HTTP 404 from the NAS. The request URLs are tested; **whether the extractors parse these three sites' pages is Unverified** (no page was fetched: the sites block the sandbox, and the NAS result for the new URLs has not been seen). | owner-provided URLs | Run a pass on the NAS; read `/api/scrape-runs` and `/api/search/retailers?retailers=ebuyer,ccl,novatech` |
| 23 | What do Ebuyer, CCL, Novatech and AWD-IT return on the NAS with the corrected addresses? | **Verified (observed output)**, 2026-10-06 `/api/search/retailers`: **AWD-IT** parsed 8 products (PCs and monitors) with real stock states (`in_stock` for monitors, `out_of_stock` for PCs), the first confirmation of in-stock markup; the 64GB Kingston kit was not among them because results were capped at 8 (cap raised to 40). **Ebuyer** and **Novatech** returned a page but `No products parsed` (HTML received, no extractor match; JS rendering or an unknown layout). **CCL** `HTTP 403` from the NAS. | owner-pasted output | `GET /api/debug/retailer-page?retailer=ebuyer` and `novatech` to see what the raw pages contain |
| 24 | Do Ebuyer and Novatech put products in the HTML their servers send? | **Verified (observed output), negative.** 2026-10-06, `/api/debug/retailer-page` on the NAS: Novatech 246 KB, 0 JSON-LD products, 0 GBP prices; Ebuyer 496 KB, 0 JSON-LD products, 1 GBP price (delivery banner). Product prices are not in the raw HTML, so plain-fetch extraction cannot work for them as things stand; they are JS-rendered or load their results from a separate request. | owner-pasted diagnostics | Look for a data attribute, inline JSON or an API call (new signals and `needle`); otherwise they need a rendering tier (Firecrawl/Playwright) |
| 25 | Do the owner's eBay keys work in the app? | **Verified (observed output)**, 2026-10-06 `/api/ebay/status`: `source: environment`, `tokenOk: true`, ID 40 chars, secret 36 chars. The earlier `invalid_client` was a stored config-table value overriding the environment (cleared by the owner). | owner-pasted status | First real eBay search: read the `ebay` row in `/api/scrape-runs` |
| 26 | First real eBay search from the NAS? | **Verified (observed output)**, 2026-10-06 `/api/scrape-runs`: `ebay` `ok: 1` for every component (offers found: 83 for "Asus TUF GAMING", 39 for the Ryzen 9 9950X3D, 14 for "...Processor", 3 for the MSI board, 0 for the RTX 5080 query). `search:awdit` `ok: 1` (29 offers for "Asus TUF GAMING"). All other retailers as before: Scan/Overclockers/Box/Currys/CCL 403, Ebuyer/Novatech "No products parsed", PricesAPI "authentication failed" (stale key). The RAM component (id 7) showed `best_price` 79.99 from eBay UK in `/api/components`, which at that time was the cheapest stored row of any kind (no stock/profile/age filter), not an alert-eligible offer; the dashboard now shows the purchasable offer for profiled components. What eBay returned for the RAM search (titles, match flags) has not been seen yet: `/api/components/7/latest`. | owner-pasted output | `GET /api/components/7/latest` |
| 27 | What does eBay UK actually offer for the 64GB kit, and did the classifier get it right? | **Verified (observed output)**, 2026-10-06 `/api/components/7/latest` (eBay Browse API via the app, 100 results requested, fixed-price, UK, GBP). Listings classified as fitting the n5-air-ram profile (64GB, 2-module or unstated kit, DDR5 SO-DIMM) ranged **GBP 492.00 to 1,546.51** (7.69 to 24.16 GBP/GB); the cheapest were: Fanxiang 64GB (2x32GB) 5600 GBP 492.00; Corsair Vengeance 64GB 4800 GBP 511.60 (kit layout unstated); SK Hynix 2x32GB 5600 GBP 516.70 (used); Transcend 2x32GB GBP 537.10 (used); Micron GBP 567.70 (used); Corsair Vengeance 2x32GB DDR5-5600 GBP 639.09 (new); Kingston FURY Impact 2x32GB 5600 GBP 899.20 (used flag). Nothing under the owner's GBP 350 target; no alert fired (correct). Rejected correctly: a 32GB Ramaxel SO-DIMM, 128GB kits, a single-sided 8-32GB lot, AWD-IT desktop DIMM (Kingston Beast 64GB 6000, GBP 1,450.83) and PCs/monitors/graphics cards. **Wrongly accepted: \"Minisforum Ar900i with Kingston Fury Impact 64gb ... SODIMM\" at GBP 800, a mini PC sold with RAM** (fixed: bundle detection). Rejected because the title does not say SO-DIMM although the seller may have meant it: \"Kingston 64GB (2x32GB) BRAND NEW SEALED DDR5 5600MHz\" GBP 650 (conservative by design). | owner-pasted output | Watch eBay for new listings; revisit the target price |
| 28 | **Q6 / P3-2 spike:** where can changedetection.io's current price and stock be read? | **Verified (hands-on)**, 2026-10-06, live instance v0.55.8 (`/api/v1/systeminfo`), API key accepted. Created a `restock_diff` watch (`follow_price_changes: true`) on a real AWD-IT product page and rechecked it. The watch JSON has **no current-price field** (only config and `has_ldjson_price_data: None`), as documented. **The price and stock are in the latest snapshot text**, `GET /api/v1/watch/{uuid}/history/latest` returned exactly `In Stock: False - Price: 919.99` (no currency symbol). So: poll the snapshot. | live API calls | Webhook mode not tried (poll chosen); currency is assumed GBP for `.uk` hosts only |
| 29 | Does the `html_webdriver` fetcher work on this instance? | **Partly verified**, 2026-10-06: a watch created with `fetch_backend: html_webdriver` on the same AWD-IT page completed with `last_error: false` and the same snapshot. That shows a browser backend is configured and runs; it was **not** tested on Ebuyer or Novatech (no product-page URL to hand), so whether it recovers their JS-rendered prices is **Unverified**. | live API calls | Create watches on a real Ebuyer and Novatech product URL with `fetch_backend: html_webdriver` and read the snapshot |
| 30 | Does changedetection.io recover Ebuyer and Novatech product pages? | **Verified (hands-on)**, 2026-10-06, owner-supplied product URLs, `restock_diff` watches on the owner's instance. **Novatech works with the plain `system` fetcher too** (no browser needed): snapshot `In Stock: False - Price: 839.99` for a KLEVV 64GB (2x32GB) 6000MHz kit; the `html_webdriver` watch gave the same. **Ebuyer fails with both fetchers**: `Page.goto: net::ERR_HTTP2_PROTOCOL_ERROR`, no snapshot. That is a connection-level refusal, most likely bot protection; **not** worked around (project rule). The earlier 'Ebuyer/Novatech return no products' (rows 23-24) was about search pages; Novatech product pages are readable through a watch. | live API calls | Treat Ebuyer as unavailable; use Novatech product-page watches for kits found on its search page |
| 31 | Can a changedetection.io browser watch on Novatech's **search** page give products, prices and stock? | **Verified (hands-on)**, 2026-10-06: an `html_webdriver` watch on `novatech.co.uk/search.html?search=ddr5+so-dimm+64gb` returned the rendered page text (29.6 KB). Each product has title, description, a stock line (`Only 5 left in stock`, `Ordered Upon Request`, `Dispatches within 1 - 3 Days`), `Stock Code`, and `£N inc vat` / `£N ex vat`. **No product links** in the text, so alerts link to the search page. The search for 'ddr5 so-dimm 64gb' returned desktop DIMM kits and USB sticks, no SO-DIMM kit. | live API calls | Real excerpt kept as a fixture; parser tested against it |
| 32 | Does the browser fetcher get past the sites that returned HTTP 403 from the NAS? | **Verified (hands-on), negative**, 2026-10-06: `html_webdriver` watches on the search pages of Scan, Overclockers, CCL, Box and Currys all ended with `Error - 403 (Access denied) received`. Not worked around (project rule); the test watches were deleted. | live API calls | Treat those five as unavailable unless a retailer feed or affiliate API is used |

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
