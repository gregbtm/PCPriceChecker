# Improvement Plan: Deal-Aware UK RAM & NAS Hardware Tracking (Self-Sufficient)

_Drafted 2026-10-05, revised twice the same day. The second revision adds a verification pass (section 9) against official docs, PyPI and GitHub. Neither the Firecrawl stack nor the MCP servers were actually run during research, and `src/` of this repo was **not** audited line by line, so items marked "verify" still need a hands-on check._

## 1. Why this plan exists

Driver: buying **64GB (2x32GB) DDR5 SO-DIMM** for a **Minisforum N5 Air AI NAS** during a period of very high RAM prices. The goal is to buy at a genuinely good price, not just the current lowest listing.

The project already covers much of this (PricesAPI.io, Keepa, Apify, eBay, ntfy and other alerts, SQLite history, MCP tools). This plan focuses on the gaps: compatibility-aware matching, UK Amazon coverage, a generic scraper fallback, better alerting, and **removing dependence on paid third-party services**.

## 2. Guiding principle: self-sufficiency

Everything needed for tracking should be able to run on the home NAS with no paid account:

- **Core:** this repo (SQLite, REST API, MCP server, dashboard).
- **Scraping:** self-hosted **Firecrawl** (see 5.2) and the existing Playwright/Camoufox scraper.
- **Change and restock watching:** self-hosted **changedetection.io** (see 5.1).
- **Search/discovery:** Firecrawl's search route and/or a self-hosted **SearXNG** (verify wiring, see 9.4).
- **Alerts:** self-hosted **ntfy**.
- **Orchestration (optional):** self-hosted **n8n**.
- **Paid/hosted APIs (PricesAPI.io, Keepa, Apify, Novada):** demoted to **optional fallbacks**, never required for the core flow.

Trade-offs to accept (confirmed against official docs, see section 9):
- Self-hosted Firecrawl includes **no advanced anti-bot layer** (Fire-engine is a separate service, not included). Heavily protected retailers may still need the existing Camoufox/stealth Playwright path.
- Self-hosted Firecrawl has **no screenshots or page actions** in the default stack.
- The stack is multi-service (API and workers, Playwright, Redis, RabbitMQ, PostgreSQL, plus FoundationDB services for an optional queue backend). Firecrawl publishes **no verified minimum host size**, so NAS capacity must be tested, not assumed.
- The stock Compose file is **unauthenticated** and defines **no persistent volumes** for PostgreSQL, Redis or RabbitMQ. It is a trusted-LAN starting point only. Price history lives in this repo's SQLite database, so losing Firecrawl's internal state is acceptable, but add volumes anyway to avoid re-queueing.
- Firecrawl is **AGPL-3.0**. Fine for private self-hosting; revisit before any public or commercial service.
- Self-hosted retailer scraping is more fragile than a paid price API; layout changes break selectors, so health checks and failure alerts are required (Phase 5).

## 3. Target hardware profile (sourced from vendor listings and reviews)

| Item | Value |
|------|-------|
| Platform | Minisforum N5 Air, AMD Ryzen 7 255, barebones (ships with no RAM) |
| Memory type | DDR5 **SO-DIMM**, **non-ECC** (ECC is N5 Pro only) |
| Slots / max | 2 slots, 96GB max |
| Speed | Up to 5600 MT/s; slower kits (4800/5200) work, faster kits downclock |
| Wanted | Matched **2x32GB kit** (dual channel) = 64GB |
| Exclude | DDR4, desktop UDIMM, CAMM2, ECC/registered |
| Install note | Slots sit under the cooler shroud (3 screws). One owner reported drive bays vanishing after fitting RAM until the backplane connector was reseated. |
| Fallback option | 2x16GB now, upgrade later if 64GB stays overpriced |

No official qualified-memory list was found; mainstream brands (Crucial, Kingston, Samsung, Corsair, Micron) are the sensible choice.

## 4. Data source findings (UK suitability and self-hosting)

| Source | UK usable? | Self-hostable? | Notes |
|--------|-----------|----------------|-------|
| PricesAPI.io (existing) | Yes | No (hosted API) | Keep as optional fallback |
| Keepa (existing) | Yes for Amazon UK | No (paid) | Verify the code requests the **amazon.co.uk** domain |
| uk.camelcamelcamel.com | Yes | No (free hosted) | Free Amazon UK history and email alerts; Amazon only |
| **Firecrawl (self-hosted)** | Yes (scrapes any URL) | **Yes** (Docker Compose, AGPL-3.0) | Verified: MCP supports `FIRECRAWL_API_URL`; API key optional when auth is off |
| **changedetection.io** | Yes (any page) | **Yes** (Docker) | Price/restock features claimed by the project; not tested here |
| **rusty4444/changedetection-mcp** | n/a | **Yes** (PyPI 0.1.0, MIT) | Verified to exist; very young, single maintainer, no price-specific tools |
| PriceBuddy | Yes | **Yes** | Any store via CSS selector, regex or JSONPath; availability and back-in-stock alerts; CLI exposes an MCP |
| Apify actors (existing) | Verify | No | Confirm Amazon/Currys/Argos actors target UK domains |
| ShopSavvy API | Unconfirmed | No (paid) | UK API coverage not confirmed |
| theluckystrike/price-tracker MCP | No | n/a | Repo URL returned 404, npm publish "pending", logs manually supplied prices |
| aravindtri/amazon-price-tracker-mcp | Unlikely | n/a | Wraps camelcamelcamel.com (US) |
| BestPrice.gr, Prisjakt, Amazon.com tools | No | n/a | Greece / Sweden / US only |

## 5. Self-hosted components to add

### 5.1 changedetection.io and its MCP
- Run `dgtlmoon/changedetection.io` as a container on the NAS (data volume mounted, bound to the LAN, API key from Settings → API).
- Use it for: per-product-page **price watches**, **restock detection**, and "page changed" alerts on retailer listings and category pages.
- MCP: **`changedetection-mcp` 0.1.0** (PyPI, MIT, Python 3.11+). Config via `CHANGEDETECTION_BASE_URL` and `CHANGEDETECTION_API_KEY`.
  - Tools: `list_watches`, `get_watch`, `create_watch`, `update_watch`, `delete_watch`, `recheck_watch`, `get_watch_history`, `get_snapshot_diff`, `search_watches`, `list_tags`, `create_tag`, `get_system_info`.
  - Safety: `get_snapshot_diff` arms a per-watch limit on follow-up mutating actions (default 3; `CHANGEDETECTION_MCP_ACTION_LIMIT_PER_WATCH`). Keep it enabled.
  - Limitations: it manages **watches and diffs only**; it has **no price-series or price-extraction tool**. PCPriceChecker should therefore read price data from the changedetection.io **REST API** (verify the endpoint and field that exposes the extracted price) and use the MCP for management and ad-hoc questions.
  - Risk controls: pin the exact version and the published SHA-256 hashes (`pip install --require-hashes`), run it in an isolated venv or container, review the source (it is about 11 kB), and treat it as an unaudited community project (1 star, 9 commits, no GitHub releases, not published via Trusted Publishing).
- Integration options (decide after a spike): (a) PCPriceChecker polls the changedetection.io REST API and stores results in SQLite; (b) changedetection.io webhooks into PCPriceChecker; (c) both tools notify via ntfy independently.

### 5.2 Self-hosted Firecrawl and its MCP
- Run the official stack from a **pinned release tag** (docs verified against `v2.11.162`; re-check the target release's `docker-compose.yaml` before upgrading, as the Compose contract changes between releases).
- Minimal evaluation `.env`: `USE_DB_AUTHENTICATION=false`, a strong `POSTGRES_PASSWORD` (32+ random characters), `POSTGRES_USER=postgres`, `POSTGRES_DB=postgres` (keep `postgres` for this release because the bundled `pg_cron` targets it). Leave `NUQ_BACKEND` and `BULL_AUTH_KEY` unset. Do not commit `.env`.
- Start with `docker compose up --build -d`, then run the documented smoke test: `POST http://localhost:3002/v2/scrape` with `{"url":"https://example.com","formats":["markdown"],"timeout":60000}`. The `/v0/health/readiness` endpoint is only a heartbeat and does not prove scraping works.
- Keep the API on a trusted LAN only. If it must be reachable from elsewhere, add real authentication, TLS and network policy first.
- Add durable volumes for PostgreSQL, Redis and RabbitMQ; reduce resource limits to what the NAS can spare and test.
- LLM-backed extraction is **off** until an OpenAI-compatible provider or Ollama is configured; test that path separately.
- **Firecrawl MCP** (`firecrawl-mcp`, docs pin `3.23.7`, requires Node.js 22+): set `FIRECRAWL_API_URL` to the local API. `FIRECRAWL_API_KEY` is **optional only when the self-hosted API does not require authentication**. For clients such as n8n, run it with `HTTP_STREAMABLE_SERVER=true`; the endpoint is `http://localhost:3000/mcp` and `http://localhost:3000/health` returns `ok`. Tool availability depends on the services enabled in the deployment, so list the tools after connecting rather than assuming parity with the cloud.
- Self-hosted capability limits (from official docs): core **scrape, crawl, map and search** routes work; **screenshots and page actions** need Fire-engine; Agent, Browser, interact and specialised formats are cloud features.

### 5.3 Supporting services
- **SearXNG** for self-hosted web search/discovery (verify how self-hosted Firecrawl search is wired to it).
- **ntfy** self-hosted for push alerts.
- **n8n** (optional) to orchestrate scheduling and routing.
- **PriceBuddy** (optional) if its selector-rule model proves easier than raw scraping.

## 6. Work plan

### Phase 1: Compatibility-aware RAM tracking
- [ ] Add a **hardware profile** concept (e.g. `n5-air-ram`) holding type, form factor, ECC flag, max capacity, slot count, max speed.
- [ ] Add a **listing classifier** that accepts or rejects results by form factor (SO-DIMM vs DIMM), DDR generation, ECC, capacity and kit configuration (1x64 vs 2x32 vs 4x16), using title parsing.
- [ ] Normalise **price per GB** and **kit vs single stick** so 2x32GB kits compare fairly with 2x16GB alternatives.
- [ ] Track **in-stock status** alongside price; surface "cheapest *in stock*".
- [ ] Add a **compatibility check** result to `check_compatibility` for the N5 Air profile.

### Phase 2: Amazon UK coverage
- [ ] Verify Keepa and Apify Amazon calls target the UK marketplace; fix if not.
- [ ] Self-sufficient path: scrape UK Amazon product pages through self-hosted Firecrawl / changedetection.io; keep Keepa as optional history.
- [ ] Document a free fallback: UK CamelCamelCamel alerts for chosen ASINs.
- [ ] Store ASIN list per profile.

### Phase 3: Self-hosted scraping and watching stack
- [ ] Add `docker-compose` services for **changedetection.io** and **Firecrawl** (pinned versions, resource-limited, persistent volumes, LAN-only) alongside PCPriceChecker.
- [ ] Run the **Firecrawl smoke test** and a **changedetection.io price-watch test** on one real UK retailer page; record results in `DEPLOYMENT.md`.
- [ ] Define a **scraper provider interface** so sources are pluggable: Firecrawl (self-hosted), changedetection.io, Playwright/Camoufox, PricesAPI (optional), Apify (optional).
- [ ] Add per-store **selector rules** (CSS / JSONPath) for Scan, Overclockers, CCL, Ebuyer, Novatech and eBay UK.
- [ ] Wire both MCP servers into the documented MCP client config with pinned versions and hashes (Firecrawl MCP needs Node 22+; changedetection-mcp needs Python 3.11+).
- [ ] Confirm the changedetection.io REST API exposes the extracted price; if not, extract via Firecrawl or selector rules instead.
- [ ] Provider fallback order: self-hosted first, then optional paid APIs only if configured.
- [ ] Spike: compare PriceBuddy vs native selector rules; pick one.
- [ ] Optional: LLM-assisted selector repair when a store layout changes (local Ollama).

### Phase 4: Alerting and automation
- [ ] Support **absolute target price**, **% drop vs last check**, and **new all-time-low (N days)** thresholds per profile.
- [ ] Add **back-in-stock** alerts, **dedupe** and **quiet hours**.
- [ ] Document a **self-hosted ntfy** setup on the NAS.
- [ ] Optional n8n workflow: scheduled run, route alerts to phone/email, log to a task tracker.

### Phase 5: Data quality and ops
- [ ] Outlier rejection for scraped prices (misparsed currency, bundle prices).
- [ ] Record **delivered cost** (shipping) and VAT-inclusive pricing consistently.
- [ ] **Scraper health:** "needs attention" list and an alert when a source fails repeatedly or returns no price.
- [ ] Add tests for the classifier, price normalisation and provider fallback.
- [ ] Synology/NAS deployment notes in `DEPLOYMENT.md`, including resource limits and persistent volumes for the new services.
- [ ] Backup plan for SQLite and changedetection.io datastores; upgrade and rollback notes for pinned Firecrawl releases.

### Phase 6: MCP and tooling hygiene
- [ ] Keep this repo's MCP as the main entry point; add the Firecrawl and changedetection.io MCPs as supporting tools, not replacements.
- [ ] Review and pin versions of third-party MCPs; avoid unvetted price MCPs.
- [ ] Keep all MCP and service credentials in environment variables or the SQLite config, never committed.
- [ ] Confirm the GitHub MCP credentials used for repo automation are valid (a "401 Bad credentials" was seen on one connector during research).

## 7. Open questions
1. Maximum price for 64GB, and the baseline price at the recent low (check price history first).
2. Preferred alert channel (self-hosted ntfy, email, other).
3. Retailer shortlist and whether eBay/used listings are acceptable for RAM.
4. NAS headroom for the Firecrawl stack (RAM/CPU), or run it on another host.
5. Sidecar (PriceBuddy / changedetection.io) vs native selector rules as the primary watcher.
6. Does the changedetection.io REST API expose the extracted price field? (Decides how Phase 3 integrates.)

## 8. Acceptance criteria
- Searching for the N5 Air profile returns only DDR5 SO-DIMM non-ECC kits.
- 2x32GB, 2x16GB and single-stick options are comparable on price per GB.
- With **no paid API keys configured**, the stack still tracks at least three UK retailers and fires alerts.
- Self-hosted Firecrawl passes its smoke test and is reachable through its MCP server from the MCP client.
- changedetection.io is reachable through its MCP server and at least one price watch records history.
- An alert fires on a configured target price, % drop, or back-in-stock event, once, with a link.
- Amazon UK prices are confirmed as GBP from the UK marketplace.
- A failing scraper raises a visible alert rather than silently stale data.

## 9. Verification log (2026-10-05)

Method: read official documentation and package pages. No containers or MCP servers were run. "Verified" means confirmed from the cited source, not tested hands-on.

### 9.1 Firecrawl MCP with a self-hosted instance
- **Verified:** `FIRECRAWL_API_URL` points the MCP at a self-hosted API. `FIRECRAWL_API_KEY` is optional only when that API does not require authentication. Requires Node.js 22+. Docs pin `firecrawl-mcp@3.23.7`. Local HTTP transport via `HTTP_STREAMABLE_SERVER=true` serves `/mcp` and `/health` on port 3000. _Source: docs.firecrawl.dev/mcp-server/local_
- **Verified:** tool availability depends on the services enabled in the deployment. _Same source._

### 9.2 Self-hosted Firecrawl capabilities
- **Verified:** default stack = API, bundled Playwright with basic fetch fallback, Redis, RabbitMQ, PostgreSQL queue (plus FoundationDB services for an optional backend). Only the API is published, on port 3002. Authentication is off in the quickstart; no persistent volumes for PostgreSQL, Redis, RabbitMQ. _Sources: docs.firecrawl.dev/contributing/self-host; github.com/firecrawl/firecrawl SELF_HOST.md_
- **Verified:** core scrape, crawl, map and search routes work. Screenshots and page actions are not available without Fire-engine. Fire-engine and advanced anti-bot behaviour are not included. Agent, Browser, interact and specialised formats are cloud features. AI-backed features need a provider (OpenAI-compatible or Ollama). _Same sources._
- **Verified:** Firecrawl states it does **not** publish a verified minimum host size. **Correction:** an earlier draft of this plan quoted "about 8GB RAM and 4 vCPU"; that figure came from a third-party blog's Compose file, not official guidance, and has been removed.
- **Correction:** the same third-party Compose used `POSTGRES_DB=firecrawl`; official guidance for the verified release says to keep `POSTGRES_DB=postgres`.

### 9.3 changedetection-mcp
- **Verified:** published on PyPI as `changedetection-mcp` 0.1.0 (released 2026-05-17), MIT, Python 3.11+, one maintainer, not uploaded via Trusted Publishing; SHA-256 hashes are published for the sdist and wheel. GitHub: 9 commits, no tags/releases, last commit 2026-05-31, 1 star. _Sources: pypi.org/project/changedetection-mcp; github.com/rusty4444/changedetection-mcp_
- **Verified:** tool list and environment variables as in 5.1. No price-specific tool exists.
- **Not verified:** that it works end-to-end against a live instance, and its behaviour on the latest changedetection.io release.

### 9.4 Still unverified (do these during Phase 3)
- changedetection.io price and restock detection behaviour on UK retailer pages, and whether the REST API returns the extracted price.
- How self-hosted Firecrawl search is configured to use SearXNG.
- NAS resource headroom for the Firecrawl stack.
- Whether Keepa and Apify calls in this repo hit the UK marketplace.
- Actual success rate of self-hosted scraping against each target UK retailer.
