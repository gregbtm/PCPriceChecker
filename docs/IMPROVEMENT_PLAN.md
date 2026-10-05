# Improvement Plan: Deal-Aware UK RAM & NAS Hardware Tracking (Self-Sufficient)

_Drafted 2026-10-05, revised same day. Based on a research session; the codebase `src/` was **not** audited line by line, so items marked "verify" need a quick check against the code first._

## 1. Why this plan exists

Driver: buying **64GB (2x32GB) DDR5 SO-DIMM** for a **Minisforum N5 Air AI NAS** during a period of very high RAM prices. The goal is to buy at a genuinely good price, not just the current lowest listing.

The project already covers much of this (PricesAPI.io, Keepa, Apify, eBay, ntfy and other alerts, SQLite history, MCP tools). This plan focuses on the gaps: compatibility-aware matching, UK Amazon coverage, a generic scraper fallback, better alerting, and **removing dependence on paid third-party services**.

## 2. Guiding principle: self-sufficiency

Everything needed for tracking should be able to run on the home NAS with no paid account:

- **Core:** this repo (SQLite, REST API, MCP server, dashboard).
- **Scraping:** self-hosted **Firecrawl** (see 5.2) and the existing Playwright/Camoufox scraper.
- **Change and restock watching:** self-hosted **changedetection.io** (see 5.1).
- **Search/discovery:** self-hosted **SearXNG** (Firecrawl can use it via `SEARXNG_ENDPOINT`).
- **Alerts:** self-hosted **ntfy**.
- **Orchestration (optional):** self-hosted **n8n**.
- **Paid/hosted APIs (PricesAPI.io, Keepa, Apify, Novada):** demoted to **optional fallbacks**, never required for the core flow.

Honest trade-offs to accept:
- Self-hosted Firecrawl has **no built-in anti-bot layer**, so heavily protected retailers may still need the existing Camoufox/stealth Playwright path.
- Self-hosted Firecrawl is a multi-container stack (API, Playwright, Redis, RabbitMQ, Postgres); its reference compose is sized for about 8GB RAM and 4 vCPU, so limits must be reduced to fit the NAS.
- Firecrawl is **AGPL-3.0** (fine for personal self-hosting; revisit before any public/commercial service).
- Self-hosted retailer scraping is more fragile than a paid price API; layout changes will break selectors, so health checks and alerts on scraper failure are required (Phase 5).

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
| **Firecrawl (self-hosted)** | Yes (scrapes any URL) | **Yes** (Docker Compose, AGPL-3.0) | MCP server supports a custom `FIRECRAWL_API_URL` |
| **changedetection.io** | Yes (any page) | **Yes** (Docker, Apache-2.0) | Price and restock detection; REST API |
| **rusty4444/changedetection-mcp** | n/a | **Yes** (pip, MIT) | Third-party MCP for changedetection.io; vet before use |
| PriceBuddy | Yes | **Yes** | Any store via CSS selector, regex or JSONPath; availability and back-in-stock alerts; CLI exposes an MCP |
| Apify actors (existing) | Verify | No | Confirm Amazon/Currys/Argos actors target UK domains |
| ShopSavvy API | Unconfirmed | No (paid) | UK API coverage not confirmed |
| theluckystrike/price-tracker MCP | No | n/a | Repo URL returned 404, npm publish "pending", logs manually supplied prices |
| aravindtri/amazon-price-tracker-mcp | Unlikely | n/a | Wraps camelcamelcamel.com (US) |
| BestPrice.gr, Prisjakt, Amazon.com tools | No | n/a | Greece / Sweden / US only |

## 5. Self-hosted components to add

### 5.1 changedetection.io and its MCP
- Run `dgtlmoon/changedetection.io` as a container on the NAS (data volume mounted, bound to the LAN).
- Use it for: per-product-page **price watches**, **restock detection**, and "page changed" alerts on retailer listings and category pages.
- Connect an MCP: **`rusty4444/changedetection-mcp`** (MIT, `pip install changedetection-mcp`). It needs the changedetection.io base URL (e.g. `http://localhost:5000`) and its API key. The upstream project has an open feature request for an official MCP, so this is a community project: review the code and pin a version before relying on it.
- Integration options (decide after a spike): (a) PCPriceChecker polls the changedetection.io REST API and stores results in SQLite; (b) changedetection.io webhooks into PCPriceChecker; (c) both tools notify via ntfy independently.

### 5.2 Self-hosted Firecrawl and its MCP
- Run the Firecrawl stack from `ghcr.io/firecrawl/firecrawl` with its Playwright service, Redis, RabbitMQ and Postgres via Docker Compose; reduce CPU and memory limits for the NAS.
- Keep `USE_DB_AUTHENTICATION=false` for a private LAN-only instance; do not expose it publicly. Optionally set `SEARXNG_ENDPOINT` to a local SearXNG and `OLLAMA_BASE_URL` for local LLM extraction.
- Point the **Firecrawl MCP server** (e.g. the `mcp/firecrawl` Docker image or the npm package) at the local instance with `FIRECRAWL_API_URL=http://<nas>:3002`. Verify whether an API key is still required when auth is disabled.
- Use it for: scraping retailer product pages to markdown/JSON, structured price extraction, and discovery crawls.
- Note: the cloud Firecrawl service offers extras (managed anti-bot, extra data providers) that the self-hosted build does not; confirm which endpoints and formats work locally before depending on them.

### 5.3 Supporting services
- **SearXNG** for self-hosted web search/discovery.
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
- [ ] Add `docker-compose` services for **changedetection.io** and **Firecrawl** (resource-limited for the NAS) alongside PCPriceChecker.
- [ ] Define a **scraper provider interface** in the code so sources are pluggable: PricesAPI (optional), Firecrawl (self-hosted), changedetection.io, Playwright/Camoufox, Apify (optional).
- [ ] Add per-store **selector rules** (CSS / JSONPath) for Scan, Overclockers, CCL, Ebuyer, Novatech and eBay UK.
- [ ] Wire both MCP servers (Firecrawl MCP, changedetection MCP) into the documented Claude/MCP client config.
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
- [ ] Backup plan for SQLite and changedetection.io datastores.

### Phase 6: MCP and tooling hygiene
- [ ] Keep this repo's MCP as the main entry point; add the Firecrawl and changedetection.io MCPs as supporting tools, not replacements.
- [ ] Review and pin versions of third-party MCPs; avoid unvetted price MCPs.
- [ ] Keep all MCP and service credentials in environment variables or the SQLite config, never committed.
- [ ] Confirm the GitHub MCP credentials used for repo automation are valid (a "401 Bad credentials" was seen on one connector during research).

## 7. Open questions
1. Maximum price for 64GB, and the baseline price at the recent low (check price history first).
2. Preferred alert channel (self-hosted ntfy, email, other).
3. Retailer shortlist and whether eBay/used listings are acceptable for RAM.
4. NAS headroom for the Firecrawl stack (RAM/CPU) and whether to run it on the NAS or another host.
5. Sidecar (PriceBuddy / changedetection.io) vs native selector rules as the primary watcher.

## 8. Acceptance criteria
- Searching for the N5 Air profile returns only DDR5 SO-DIMM non-ECC kits.
- 2x32GB, 2x16GB and single-stick options are comparable on price per GB.
- With **no paid API keys configured**, the stack still tracks at least three UK retailers and fires alerts.
- Self-hosted Firecrawl and changedetection.io are reachable through their MCP servers from the MCP client.
- An alert fires on a configured target price, % drop, or back-in-stock event, once, with a link.
- Amazon UK prices are confirmed as GBP from the UK marketplace.
- A failing scraper raises a visible alert rather than silently stale data.
