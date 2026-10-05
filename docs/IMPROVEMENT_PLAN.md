# Improvement Plan: Deal-Aware UK RAM & NAS Hardware Tracking

_Drafted 2026-10-05. Based on a research session; the codebase `src/` was **not** audited line by line, so items marked "verify" need a quick check against the code first._

## 1. Why this plan exists

Driver: buying **64GB (2x32GB) DDR5 SO-DIMM** for a **Minisforum N5 Air AI NAS** during a period of very high RAM prices. The goal is to buy at a genuinely good price, not just the current lowest listing.

The project already covers much of this (PricesAPI.io, Keepa, Apify, eBay, ntfy and other alerts, SQLite history, MCP tools). This plan focuses on the gaps: compatibility-aware matching, UK Amazon coverage, a generic scraper fallback, and better alerting.

## 2. Target hardware profile (sourced from vendor listings and reviews)

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

## 3. Data source findings (UK suitability)

| Source | UK usable? | Notes |
|--------|-----------|-------|
| PricesAPI.io (existing) | Yes | Primary source; keep |
| Keepa (existing) | Yes for Amazon UK | Verify the code requests the **amazon.co.uk** domain; MCP/API is paid |
| uk.camelcamelcamel.com | Yes | Free Amazon UK history and email alerts; Amazon only |
| PriceBuddy (self-hosted) | Yes | Any store via CSS selector, regex or JSONPath; availability + back-in-stock alerts; ntfy/Gotify/Telegram/etc.; headless Chrome option; CLI exposes an MCP |
| changedetection.io | Probably | Generic page watcher with price/restock detection; not tested in research |
| Apify actors (existing) | Verify | Confirm Amazon/Currys/Argos actors target UK domains |
| ShopSavvy API | Unconfirmed | Region-specific retailers; UK API coverage not confirmed; paid |
| theluckystrike/price-tracker MCP | No | Repo URL returned 404, npm publish "pending", appears to log manually supplied prices rather than scrape |
| aravindtri/amazon-price-tracker-mcp | Unlikely | Wraps camelcamelcamel.com (US) |
| BestPrice.gr, Prisjakt, Amazon.com tools | No | Greece / Sweden / US only |

## 4. Work plan

### Phase 1: Compatibility-aware RAM tracking
- [ ] Add a **hardware profile** concept (e.g. `n5-air-ram`) holding type, form factor, ECC flag, max capacity, slot count, max speed.
- [ ] Add a **listing classifier** that accepts or rejects results by form factor (SO-DIMM vs DIMM), DDR generation, ECC, capacity and kit configuration (1x64 vs 2x32 vs 4x16), using title parsing.
- [ ] Normalise **price per GB** and **kit vs single stick** so 2x32GB kits compare fairly with 2x16GB alternatives.
- [ ] Track **in-stock status** alongside price; surface "cheapest *in stock*" rather than cheapest listed.
- [ ] Add a **compatibility check** result to `check_compatibility` for the N5 Air profile.

### Phase 2: Amazon UK coverage
- [ ] Verify Keepa and Apify Amazon calls target the UK marketplace; fix if not.
- [ ] Document a free fallback: UK CamelCamelCamel alerts for chosen ASINs.
- [ ] Store ASIN list per profile.

### Phase 3: Generic retailer fallback
- [ ] Add per-store **selector rules** (CSS / JSONPath) in config, PriceBuddy-style, for retailers PricesAPI misses (Scan, Overclockers, CCL, Ebuyer, Novatech, eBay UK).
- [ ] Option A: run **PriceBuddy** (or changedetection.io) as a sidecar in `docker-compose.yml` and ingest its data. Option B: port the selector-rule approach into the existing Playwright scraper. Decide after a spike.
- [ ] Optional: LLM-assisted selector repair when a store layout changes (local Ollama or API).

### Phase 4: Alerting and automation
- [ ] Support **absolute target price**, **% drop vs last check**, and **new all-time-low (N days)** thresholds per profile.
- [ ] Add **back-in-stock** alerts and **dedupe/quiet hours** to avoid repeat notifications.
- [ ] Document a **self-hosted ntfy** setup on the NAS.
- [ ] Optional n8n workflow: scheduled call to the REST API, route alerts to phone/email, log to a task tracker.

### Phase 5: Data quality and ops
- [ ] Outlier rejection for scraped prices (misparsed currency, bundle prices).
- [ ] Record **delivered cost** (shipping) and VAT-inclusive pricing consistently.
- [ ] Scraper health: "needs attention" list when a source fails repeatedly.
- [ ] Add tests for the classifier and price normalisation.
- [ ] Synology/NAS deployment notes in `DEPLOYMENT.md`.

### Phase 6: MCP and tooling hygiene
- [ ] Keep this repo's MCP as the single entry point; avoid adding unvetted third-party price MCPs.
- [ ] Confirm the GitHub MCP credentials used for repo automation are valid (a "401 Bad credentials" was seen on one connector during this session).

## 5. Open questions
1. Maximum price for 64GB, and the baseline price at the recent low (check price history first).
2. Preferred alert channel (self-hosted ntfy, email, other).
3. Retailer shortlist and whether eBay/used listings are acceptable for RAM.
4. Sidecar (PriceBuddy / changedetection.io) vs native selector rules.

## 6. Acceptance criteria
- Searching for the N5 Air profile returns only DDR5 SO-DIMM non-ECC kits.
- 2x32GB, 2x16GB and single-stick options are comparable on price per GB.
- An alert fires on a configured target price, % drop, or back-in-stock event, once, with a link.
- Amazon UK prices are confirmed as GBP from the UK marketplace.
- At least one retailer outside PricesAPI coverage is tracked via fallback rules.
