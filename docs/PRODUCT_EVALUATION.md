# Product evaluation and roadmap (2026-10-07)

Written after a survey of open-source prior art and of UK data sources, both done this session by reading the pages themselves. Tags as everywhere else: **Verified** (opened or run this session, evidence named), **Unverified** (search snippet, secondary report, or not run for real). Nothing here changes what the code does; the build list at the end says what was built from it.

## 1. What the product is today

A self-hosted UK price and stock watcher for one job: tell the owner when a compatible, in-stock 64GB (2x32GB) DDR5 SO-DIMM kit (48GB as fallback) is for sale at an acceptable price, for a Minisforum N5 Air. Docker, SQLite, no paid services.

**Strengths (each backed by tests or live runs):**

- **It refuses to guess.** A tri-state stock model (only `in_stock` can alert), a memory classifier that leaves a field empty rather than invent it, and a hardware profile that explains every rejection. Most price trackers alert on "a price changed"; this one alerts on "a purchasable, compatible kit".
- **It is polite and says so.** robots.txt is read and obeyed on every path (RFC 9309 rules), failing sources back off to one probe a day, nothing is disguised, and blocked retailers are reported as blocked, not worked around.
- **It can see its own health.** Per-source run history, a status column, failure notices, and as of today a catalogue census and a dead-man's-switch ping.
- **Several independent ways in**: eBay API, retailer sitemaps and product pages, changedetection.io browser watches, a WooCommerce JSON source, and a catalogue of known part numbers.
- 331 automated tests, most on real captured data.

**Weaknesses, most serious first:**

1. **Alert delivery has never been observed.** No notification channel is set up (ntfy login is lost). Everything else is moot until one real message arrives. *Owner action, two minutes with Discord or Telegram.*
2. **The price target is far below the market.** Verified this session: Wired2Fire £600.00 (backorder), Box and LaptopOutlet £885.71 to £1,149.87 (all out of stock, read through the app's own extractor), PriceSpy lows for named 64GB kits £821 to £933 (from the research agent's reading of PriceSpy; the page was not re-read here), eBay UK £498.84 delivered for a Fanxiang kit (the app's own output). The £350 alert will not fire until the market moves; the £500 "worth a look" tier currently holds exactly one offer. This is a market fact, not a bug, but the product should make it visible (see C1).
3. **"Zero results" can still mean "could not see".** Box's sitemap (6,803 addresses) lists none of the four 64GB kit pages that answer HTTP 200 with a price (Verified). So a sitemap that lacks a kit does not prove the retailer does not sell it. This also weakens the Novatech conclusion: its sitemap holds 4,673 addresses and one SO-DIMM (DDR4); that is what Novatech *lists*, not necessarily what it *sells*.
4. **The best-stocked retailers are closed to us.** Scan, Overclockers, CCL, Currys sit behind Cloudflare challenges; Ebuyer needs JavaScript. We do not defeat protections. The sanctioned route (Awin feeds) needs an honest affiliate application.
5. **No access control** on the dashboard or API (`GET /api/config` returns stored secrets). LAN-only today.
6. **Scrape politeness inconsistency (found today, not yet fixed):** `uk-retailers.ts` sends a Chrome-style User-Agent (`SHARED_HEADERS`). The newer sources send an honest one. The older scrapers should identify themselves too.

## 2. Prior art: what to borrow, what to avoid

Survey by opening repository pages and feeds (GitHub API was blocked). Stars and dates are as the agent read them; "Unverified" where only a snippet was seen.

| Project | What is worth taking | Verdict |
|---|---|---|
| **changedetection.io `restock_diff`** (Apache-2.0, 34.8k stars, active; processor.py read) | Cross-check metadata against rendered text ("lie detected"); refuse to report when several distinct prices are found; alert only on out-to-in transitions with min/max bounds. **Trap:** its in-stock test is a substring match that counts `instoreonly` and `presale` as in stock | Borrow ideas. **Found the same bug here** and fixed it today (`InStoreOnly`). |
| **extruct / price-parser / zyte-parsers** (BSD/Apache, Python) | Structured-data extraction (JSON-LD, microdata, OpenGraph), GTIN detection, price parsing | Port the approach, not the code. Today: `mpn`, `gtin`, `brand` are now read from JSON-LD. |
| **schema.org `ItemAvailability`** (12 values, page read) | An explicit mapping, never a substring match | Done: `InStoreOnly` is `unknown`, `Reserved` out of stock, `MadeToOrder` backorder. |
| **PriceBuddy** (GPL-3.0 with modifications, ~1.4k stars) | Per-store editable scrape strategy; availability states; unit price (maps to £/GB); alert channels | Ideas only (licence). Per-store editable strategy is roadmap B4. |
| **cex-uk-prices** (MIT, tiny) | A polite-client template: 1 req/s, named User-Agent, no retry, treats a 403 as the answer | Confirms our stance. CeX's own robots.txt disallows `/search*?stext=`, so we skip CeX. |
| **PriceGhost** (MIT, 1.1k stars) | Four extractors with the user arbitrating disagreements; jitter between products | Borrow the arbitration idea (B3). Its stealth plugin is exactly what we do not do. |
| **Open Icecat** | Spec enrichment by brand + MPN, free tier | Unverified coverage (reseller-gated sheets). Parked; the MPN catalogue covers our narrow need. |
| **urlwatch** (BSD-3, 3.1k stars) | Conditional requests, filter chain | Idea: conditional GET for sitemaps (small saving). |
| **streetmerchant, PCPartPicker scrapers** | none | **Discard**: proxy/evasion tooling, USD-only, GPL. |
| **Awin feeds, Kelkoo** | A sanctioned bulk source of price, availability and MPN | Awin: Scan 15473, Overclockers 28821 confirmed on the merchants' own affiliate pages (Verified); signup needs a refundable £5 deposit (Verified); feed schema for these two is Unverified; retailers vet applicants. Apply only with an honest description. |

## 3. UK data sources, ranked by usefulness to this goal

| # | Source | State |
|---|---|---|
| 1 | **eBay UK Browse API** | In use, Verified (the £498.84 offer). Most likely place for a sub-£500 kit. |
| 2 | **Wired2Fire** WooCommerce Store API | **Built today.** Verified live: `https://wired2fire.co.uk/wp-json/wc/store/v1/products?search=so-dimm` returns the 64GB kit at £600.00 with `is_in_stock: true` **and** `is_on_backorder: true`; the code reports backorder, which never alerts. robots.txt does not forbid it (fixture captured). |
| 3 | **Box and LaptopOutlet** product pages (same data) | **Built today** as "known pages". Verified: HTTP 200, JSON-LD with price, availability, and now MPN and brand, through the app's own extractor. Their robots.txt allows product pages and forbids `/catalogsearch/`. |
| 4 | **AWD-IT** | In use. Its Crucial 64GB page currently reads "Coming Soon", no price, no JSON-LD (Verified). |
| 5 | **buykingston.co.uk** (authorised Kingston reseller) | Not built. Reported (agent): robots allows all, no JSON-LD, price in page text. Unverified here. |
| 6 | **PriceSpy UK email alerts** | Not built. PriceSpy offers free price-drop and in-stock alerts (agent read the page). Polite design: set alerts on the MPN product pages and ingest the emails over IMAP; do not crawl PriceSpy. Terms not located (Unverified). |
| 7 | **HotUKDeals tag RSS** | Valid RSS but returned desktop RAM and Amazon deals; no keyword feed. A weak safety net. `robots.txt` forbids ClaudeBot and anthropic-ai agents; our own app identifies as itself. |
| 8 | **Awin feeds** | See section 2. Owner decision. |
| 9 | **Amazon UK** | PA-API 5 is deprecated (Verified from Amazon's notice); the replacement needs affiliate sales. No free route. |
| 10 | Crucial direct, Mr Memory, Memorycow, Comms Express, Stone, Corsair UK | Closed to us (403) or no longer selling (Micron exited Crucial consumer; Verified from its release). |

## 4. Roadmap

Scope tags: S under half a day, M about a day, L several days.

**C. Reliability: make the answer trustworthy (do these first)**

| # | Item | Why | Size |
|---|---|---|---|
| C1 | **Market-floor context**: show the cheapest price seen for any compatible kit (any stock state) beside the alert threshold, in the offers modal and in the daily summary, with a plain "target is N% below the market floor" line | The owner needs to see at a glance that £350 vs £600+ is a market gap, and when it narrows | S |
| C2 | **Alert-channel health**: dashboard banner when no channel is configured or the last delivery failed; `GET /api/health` reports it; daily summary includes it | Weakness 1 must be impossible to miss | S |
| C3 | **Known-page canary**: a daily check that every known page still answers 200 with a parseable price, reported in health | A parser or page that silently dies is the original failure class | S |
| C4 | **Verify-before-alert**: re-fetch the exact listing (eBay `getItem`, or the product page) just before sending, and abort the alert if price, stock or compatibility no longer hold | Removes stale-alert false positives | M |
| C5 | **eBay item specifics** (`getItem` aspects: Type, Form Factor, ECC, Capacity) to resolve `ecc_unstated` from seller data, not the title | Unverified response shape; needs one run with the owner's keys | M |
| C6 | **MPN-first eBay queries**: search each catalogue part number as well as the keyword query | Finds listings whose titles omit "SO-DIMM"; cheap (a handful of calls a day, free quota is 5,000) | S |
| C7 | **Honest User-Agent on the older retailer scrapers** (weakness 6) | Consistency with the stated politeness policy | S |

**B. Ambitious: where this becomes more than a scraper**

| # | Item | Idea | Size |
|---|---|---|---|
| B1 | **Assembled kits**: pair two identical single 32GB (or 24GB) modules from one seller into a virtual 64GB (48GB) kit with the combined price | Singles are listed separately and often cheaper per GB; Box shows KVR56S46BD8-32 at £485.99 each (agent, Verified), so today it would not help, but the market moves. Identical module, same seller, quantity 2 | M |
| B2 | **New-listing watch for eBay** (`sort=newlyListed`, alert on an unseen matching listing) | A rare cheap kit can sell within hours of listing | M |
| B3 | **Source arbitration and confidence**: when two sources disagree about price or stock, show both and flag it; score every offer by source reliability, freshness and classification certainty | Borrowed from PriceGhost and changedetection's "lie detection" | M |
| B4 | **Per-store strategy editor** in the dashboard (URL pattern, extractor, selectors) | Borrowed from PriceBuddy; today a new shop needs code | L |
| B5 | **PriceSpy email ingestion** over IMAP | Sanctioned bulk coverage of shops we cannot read, using the aggregator's own alert feature | M |
| B6 | **Awin feed ingestor** (only after an honest application is approved) | One daily file gives price, stock and MPN for Scan and Overclockers | L |
| B7 | **Evidence ledger**: store the raw JSON-LD or API snippet behind each alert | Every alert becomes auditable after the fact | S |
| B8 | **MCP parity** (offers, health, known pages via Claude) and n8n workflow verification | Ask Claude "what is the best offer now" | S to M |
| B9 | **Access token for dashboard and API, and secret masking** | Weakness 5 | M |

**What we will not build:** anything that disguises the client, defeats a challenge page, rotates proxies, or spoofs a browser (streetmerchant-style tooling); crawling PriceSpy, idealo or HotUKDeals search; CeX search.

## 5. Built from this evaluation today

| Item | Evidence |
|---|---|
| Catalogue census and new-product alert from sitemaps; block pages recorded as failures; heartbeat ping (PR 43, merged) | `catalogue-watch.test.ts`, `heartbeat.test.ts`, sitemap challenge test |
| `InStoreOnly` no longer counts as in stock; MPN, GTIN and brand read from JSON-LD | `stock-state.test.ts`, `structured-data.test.ts`; same bug found in changedetection.io's own processor |
| Wired2Fire source via the WooCommerce Store API, backorder never alerts | `woocommerce-store.test.ts` on the real response and real robots.txt |
| Known-MPN catalogue; a part number overrides a misleading title or address (Box's DDR5 kit address says "ddr4") | `memory-mpns.test.ts`; Box page opened and its address checked |
| Known pages (5 pages) with an "Add" button in the offers modal; `search_also` keeps eBay and the searches running beside pinned pages | `web.test.ts`, `refresh.test.ts` |

## 6. Decisions for the owner

1. **Alert price.** At the observed market floor (£600 to £1,150, one eBay kit at £498.84), what do you want the £350 alert and £500 options tier to be? Keep them as aspirational thresholds, or move them to catch a real dip?
2. **Notification channel** now (Discord or Telegram take two minutes), so the first real alert can be observed.
3. **Awin**: apply with an honest description of the use, or skip.
4. **Pause the old components** (ids 1, 2, 3, 4, 6) and remove the stale `PRICES_API_KEY` from Portainer.
