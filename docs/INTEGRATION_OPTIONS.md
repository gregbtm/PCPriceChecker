# Integration options: changedetection.io, Huginn and everything else (2026-10-08)

Question from the owner: what more can changedetection.io do, what about Huginn, and what other self-hosted, free or very cheap ways are there to get realistic prices and deals for computer parts, at extreme scope. Five research passes read the real pages (changedetection.io source, Huginn source and wiki, deal feeds and price history, the self-hosted extraction stack, and UK retailer access); this document is the synthesis, checked against our own code and the owner's rules: **self-hosted first, free or very cheap, polite, and no circumvention of bot protection** (so nothing below uses stealth, spoofing, proxy rotation, CAPTCHA solving or a Cloudflare bypass, and where a shop refuses us the only options are to ask it or to leave it).

Tags: **V** = a page or file was opened and read (by a research agent, or by me where marked "re-checked"); **U** = snippet, secondary source, estimate, or not opened. Agent environments are not the NAS: several shops answered the agents with 200 and the NAS with 403, so anything about reachability from the NAS is **U until measured there**.

## 0. The honest picture first

- **There is no 64GB kit under £600 anywhere found today.** In stock: eBay Fanxiang 64GB at £498.84 delivered (specifics say "ECC Memory": ask the seller), Scan Corsair **48GB (2x24GB) at £642.49** and Corsair 64GB at £893.99 and £933.49 (V, agent). Out of stock: Box £885.71 and £1,149.87, buykingston £1,039.89. Wired2Fire £600 on backorder. PriceSpy lows for named 64GB kits £817 to £1,090 (V). One PriceSpy £225 Kingston price is stale (no link, no stock, flat 3 months).
- **The market will not relax soon.** TrendForce's 4Q26 outlook has contract DRAM still up 10 to 15% quarter on quarter with the rise moderating; AMD's VP says DDR5 stays tight through 2026 to 2027 and normalises no earlier than 2028; Crucial left consumer sales in February 2026 (V, sources in the deal-feed pass). A free "relief is coming" signal exists (TrendForce's price page) but it carries no UK kit prices.
- **The biggest single gap is not a missing tool, it is Scan.** Scan has a 48GB kit in stock and our NAS gets HTTP 403 from it. Anything that lets us see Scan legitimately beats any new aggregator.

## 1. changedetection.io: what we are not yet using

Facts from its source on `master` (0.60.8; the owner runs 0.55.x, so every behaviour is **U on 0.55.x** until `/api/v1/full-spec` on the owner's instance confirms it).

| # | Idea | What it gives | Effort | NAS load | Rules | Verdict |
|---|---|---|---|---|---|---|
| C1 | **Read live state, not the latest snapshot.** Under the default `in_stock_only`, an in-stock to out-of-stock flip writes **no snapshot** (V, `worker.py`), so our reader can keep reporting "in stock" for a sold-out product. Create our watches with `in_stock_processing=all_changes` and read the watch's live `restock` object (`in_stock`, `price`, `currency`), which is committed on every check (V in source; present in `GET /watch/{uuid}` is U) | Removes a real stale-state bug in `readWatchForUrl` | S | 0 | fits | **Build now** (check on the owner's instance first) |
| C2 | **Distrust in-stock with no GBP price.** `presale`, `instoreonly`, `limitedavailability` count as in stock there, and a browser watch with no out-of-stock phrase reads "Possibly in stock" (V). Our own mapper already refuses `InStoreOnly`; do the same for these | Prevents a false alert from a snapshot | S | 0 | fits | **Build now** |
| C3 | **Watch-health feed**: surface each watch's `last_error`, `last_checked`, filter-failure count (V in API). Catches "more than one price found", blocked pages, broken selectors | A broken watch becomes visible in our health panel | S | 0 | fits | **Build now** |
| C4 | **Set an honest identity.** Its default User-Agent is a Chrome 87 string (V); `DEFAULT_SETTINGS_HEADERS_USERAGENT` overrides it. It has **no robots.txt handling** in the files read (U), so watches we create must be checked by us first (our code already does this for the Novatech watch) | Consistency with the polite-scraping rule | S (owner sets an env var) | 0 | fits | **Do** |
| C5 | **Cap the browser.** `MAX_CONCURRENT_CHROME_PROCESSES` defaults to 10 and Playwright memory can grow from ~200MB to several GB (V, wiki). Set it to 1 or 2 on a 32GB NAS running about 130 containers | Protects the NAS | S (owner) | saves RAM | fits | **Do** |
| C6 | **Politeness settings**: jitter, `time_schedule_limit` daytime windows, 30 to 60 minute intervals, 2 to 3 workers (V) | Fewer requests, fewer blocks | S (owner) | saves CPU | fits | **Do** |
| C7 | **JSON-endpoint watches**: `text_json_diff` with `jq:` filters and Conditions (`extracted_number`) on WooCommerce Store API, Magento GraphQL (V) | Avoids HTML and the multi-price error, for shops that publish an API | M | ~0 | fits where the shop allows it | **Maybe**: our own app already covers Wired2Fire this way |
| C8 | **Webhook push** (`posts://` with a templated body such as `{{restock.price}}`) so a change triggers an immediate re-read; needs `ALLOW_IANA_RESTRICTED_ADDRESSES=true` for LAN targets (V) | Faster than polling | S to M | 0 | fits | **Maybe** |
| C9 | **RSS of changes** (`/rss/tag/<tag>?token=`) as a human digest or audit log (V) | Extra visibility | S | 0 | fits | **Maybe** |
| C10 | Hosted plan ($8.99 a month, no GBP price shown), the LLM restock fallback, its proxy options, `stealth=1` | none for us | - | - | proxies and stealth **break the rules** | **Skip** |

## 2. Huginn

MIT licence, release v2026.10.04 (V). It was almost dormant through 2025 and is maintained again (a Renovate-heavy commit stream since March 2026); the 27 August 2026 release fixed four advisories including command injection (V). Rails app needing MySQL or Postgres, at least two containers in the single-process image; no RAM figures published (U). Its WebsiteAgent is **plain HTTP only**: JavaScript pages need a separate browserless container (V), where changedetection.io already has a browser. Its scheduling is fixed slots with **no per-host rate limiting** in the source read (V).

It can do the job (RssAgent, WebsiteAgent with CSS/JSONPath, TriggerAgent thresholds, PostAgent to ntfy or to our REST API; a scenario for "five product pages plus the HotUKDeals feed" is straightforward), but **everything it does is already covered** by changedetection.io (price and restock detection, filters, a JS fetcher, Apprise alerts), n8n (schedule, RSS, HTTP, CSS extraction) and our own app. **Verdict: skip.** It would add a Rails stack and a database to the NAS for no capability we lack.

## 3. Other self-hosted tools

| Tool | Licence, status | NAS cost | What it adds here | Verdict |
|---|---|---|---|---|
| n8n | fair-code, current (2.42.5, V); **already running** | 0 | glue: schedule, RSS, HTTP, IF; no JS rendering | keep as optional glue |
| Uptime Kuma | MIT (V) | tiny; may already run | keyword and JSON monitors for stock text; **push monitor as our dead-man's switch** (already supported by `heartbeat_url`) | use for the heartbeat; keyword monitors **maybe** |
| Healthchecks (self-hosted) | BSD-3 (V) | small | grace-time heartbeats | alternative to Kuma |
| Apprise, ntfy | BSD-2, Apache-2.0 (V) | none | delivery; ntfy already received our first alert | in use |
| Crawl4AI | Apache-2.0, 0.9.4 (V) | needs ≥4GB RAM and `--shm-size=1g` (V); **robots check defaults to off, stealth options exist** | on-demand renderer | **Skip for now**; changedetection's browser covers it; if ever used, set `check_robots_txt` and leave stealth off |
| Crawlee (TypeScript) | Apache-2.0 (V) | library | `Sitemap.load` and `RobotsTxtFile` utilities; set `sameDomainDelaySecs` and `maxRequestsPerMinute` (default unlimited, V) | **Maybe** as a source of ideas; our sitemap code already does this |
| Firecrawl self-host | AGPL-3.0 (V) | api 8GB cap, playwright 4GB cap, redis, rabbitmq, postgres (V caps, not usage) | none we lack | **Skip** (heaviest option) |
| Browserless | SSPL or paid for commercial (V) | no figures | none we lack | **Skip** |
| Scrapy + scrapy-playwright, ScrapeGraphAI, Katana, Colly | various (V) | a second runtime; ScrapeGraphAI runs an LLM per page | none we lack | **Skip** |
| RSSHub, RSS-Bridge, Miniflux, FreshRSS | AGPL/Unlicense/Apache (V) | small | no confirmed HotUKDeals route; we do not need a reader | **Skip** |
| Node-RED, Activepieces, Windmill, Kestra, Airflow, Automatisch | mixed; Automatisch looks abandoned (V) | 1 to 4GB+ for the heavy ones | redundant | **Skip** |
| Local LLM extraction (Ollama, Qwen2.5 1.5B ~1GB) | MIT/Apache | CPU contention, estimated 1 to 1.5 minutes per page on this CPU (**U**, no benchmark for the R1600) | rare fallback only | **Skip** until a source truly needs it |
| Hosted LLM as a rare fallback | pay per use | 0 | about £0.28 per 1,000 trimmed pages on a small model (agent's arithmetic, **U** on current pricing); 50 pages a day is under £1 a month | **Maybe, much later** |
| One-time LLM-written CSS selector per shop, then plain cheerio | - | 0 | cheapest "AI" route (Crawl4AI docs, V) | **Maybe** for a new shop |

## 4. Data sources that need no scraping of a refusing shop

| # | Source | What it gives | Access | Cost | Evidence | Verdict |
|---|---|---|---|---|---|---|
| S1 | **Inside-Tech** (WooCommerce Store API) | A small UK shop; DDR5 SO-DIMM singles up to 32GB (£428), **no 48/64GB kit today** | `GET inside-tech.co.uk/wp-json/wc/store/v1/products?search=SODIMM` | £0 | **Re-checked**: HTTP 200, 18 products | **Build**: one line in our existing Store API source; it will catch a kit if one appears |
| S2 | **buykingston.co.uk** | Kingston FURY Impact 64GB (£1,039.89, out of stock today) and Corsair 48GB and 96GB kits in its sitemap | robots `Allow: /`; sitemap with 15,727 URLs; JSON-LD price and availability | £0 | V (agent) | **Build**: add to our sitemap tier and the census |
| S3 | **HotUKDeals RSS** | Community-posted deals, 30 items per feed: `/rss/tag/computers`, `/rss/tag/electronics`, `/rss/new`, `/rss/hot`; **no per-search feed** (V: `/rss/search`, `/rss/tag/ddr5`, `/rss/tag/memory` are 404) | RSS; robots has no `/rss` rule but disallows `/search` and filter parameters | £0 | **Re-checked**: `/rss/tag/computers` 200, 30 items | **Build**: poll hourly, filter locally on ddr5, so-dimm, 2x32. **Also fix our existing MCP tool, which requests the robots-disallowed `/search?q=...&view=rss`** |
| S4 | **PriceSpy UK email alerts** | Free "price drop" or "only when in stock" alerts per product; prices today £817 to £1,090 for 64GB kits | You subscribe once; we read the **emails** over IMAP, so no traffic reaches PriceSpy. Their robots disallows `/search` and a search fetch got 403; terms not read (**U**) | £0 | V (alerts page) | **Build** after the owner provides a mailbox (new secret, IMAP) |
| S5 | **Scan "Notify me" and a Scan category page** | Scan stocks 48GB at £642.49 today; its category page lists 15 SO-DIMM items with in-stock or "notify me" state | Notify-me emails (account requirement **U**); the category page is a changedetection.io target **only if the NAS can reach it** | £0 | V (agent) | **Blocked by access, see section 5** |
| S6 | **Laptops Direct** | Four Kingston 64GB 2x32 pages exist, all "no longer available" today; stock fills in client-side | Product and category pages allowed by robots; the sitemap index is `sitemaps/sitemap-index.xml` | £0 | V (agent), category page **re-checked** 200 | **Maybe**: a changedetection watch on the four pages watching for "no longer available" to disappear |
| S7 | **Kelkoo publisher API** | A UK price-comparison feed | Search and Feeds endpoints documented; "no approval steps" on the marketing page; UK coverage, quotas and whether private use is allowed are **U** | £0 | partly V | **Maybe**: apply honestly, no promotion claim |
| S8 | **Awin feeds** | Scan (ID 15473) and Overclockers (28821) feeds | £5 refundable deposit; vetted; a private tool may not qualify; see `docs/AWIN.md` | £5 | V | **Owner's call** (low odds) |
| S9 | **TrendForce price page** | Daily DDR5 16Gb **chip** spot price and monthly contract prices as a market-direction signal | HTML only; robots disallows `/api/*` and search | £0 | V | **Maybe, low**: no UK kit prices; fragile parsing |
| S10 | **datacenterdisk.com** | US Amazon 64GB DDR5 SO-DIMM floor ($895, up 10% in two weeks) | RSS at `/feed.xml` | £0 | V (agent) | **Maybe, low**: direction only, US only, tracking started 22 September |
| S11 | Teqex (Magento GraphQL), CeX | Teqex: 32GB singles only; CeX unlikely to have a kit | open GraphQL (V); CeX terms not read | £0 | partly V | **Skip** |
| S12 | Amazon UK | The legitimate API needs Associates enrolment plus ≥10 qualifying sales in 30 days (V), which a personal tool will not meet | alerts from Keepa or CamelCamelCamel by email (**U**); Keepa's API has no free tier (**U**, about €49 a month) | £0 or paid | partly V | **Skip** the API; email alerts **maybe** later |
| S13 | Reddit (r/bapcsalesuk), OCUK forum RSS | Deals | Reddit anonymous `.json` reported shut and `.rss` reported 403 or 429 from datacentre addresses (**U**); OCUK forum RSS returns a "Verification required" challenge page (V) | - | - | **Skip**: do not work around |
| S14 | Facebook Marketplace, Gumtree | Used kits | both terms ban automated access (V quotes) | - | V | **Never**: manual saved searches only |
| S15 | Skinflint UK (HTTP 410), Google Shopping UK (price tracking not offered in the UK), PriceRunner (empty to the fetcher), idealo (unreadable) | - | - | - | V | **Skip** |

## 5. The blocked shops: what is legitimate

Scan, Overclockers, CCL, Box, LaptopOutlet and Currys refuse the NAS (the owner's `curl` got 403 from Box with both our identity and curl's default). The research agents, from a different address, got 200 from Scan, Box, Laptops Direct and buykingston, and a Cloudflare challenge on CCL, Overclockers and Currys. So for Scan and Box the cause is most likely the NAS's **address or reputation** (U), not the User-Agent. We do not disguise ourselves. Legitimate routes:

1. **Measure first, from the NAS.** A built-in reachability probe (robots.txt, sitemap and one product page per candidate shop, honest identity, one request each, recording the status and whether the answer is a Cloudflare challenge) turns "probably" into a table. Without it we are guessing which shops are even worth an email.
2. **Ask.** A short, honest email to a shop that refuses us ("a private price and stock alert for my own purchases, one request per hour, here is the User-Agent and address, could you allow it?"). A shop that says yes removes the block at its source. I can draft these; they must come from the owner.
3. **Use the shop's own alert channel.** Scan has a "Notify me when available" control on unavailable items (V markup; whether it needs an account is **U**). An email alert read over IMAP is a signal the shop chose to send.
4. **Use a feed the shop chose to publish** (Awin: Scan, Overclockers; section 4, S8).
5. **Accept it.** If a shop says no or does not answer, it stays on the "refused" list and is probed once a day.

## 6. Recommended build order

| Phase | Items | Cost | NAS load | Why first |
|---|---|---|---|---|
| **1: do now** | the reachability probe; Inside-Tech and buykingston sources; HotUKDeals tag-feed poller with a local filter, and the robots fix to our existing HotUKDeals tool; changedetection fixes C1 to C3 | £0 | none | each is small, rule-compliant and closes a measured gap |
| **2: needs the owner** | PriceSpy email alerts over IMAP (a dedicated mailbox and its credentials); apply to Kelkoo; honest emails to Scan and Box; set C4 to C6 on the changedetection container | £0 | none | each needs an account, a mailbox or an email only the owner can create or send |
| **3: only if phase 1 shows it is worth it** | extend the nightly catalogue census to every reachable sitemap with set-diff and known-answer canaries (tri-state OK / EMPTY / BLIND); TrendForce signal; Laptops Direct watch | £0 | tiny | the census already exists for AWD-IT and Novatech |
| **Not recommended** | Huginn, Firecrawl, Browserless, Scrapy, ScrapeGraphAI, RSSHub, Miniflux, any proxy or stealth feature, Reddit, forum RSS, Facebook, Gumtree | - | - | redundant, heavy, or against the rules |

One more idea that came out of the numbers: the eBay Fanxiang kit is about 45% below the cheapest prices PriceSpy shows for named 64GB kits (£7.69 a GB against about £13 to £16). Our "suspiciously cheap" flag uses a fixed £2 a GB floor, so it never fired. A **market-relative** flag (price per GB far below the median of everything else seen) would have said "check this seller" without waiting for a human to notice. That is a small build, and it needs no new source.

## 7. Decisions for the owner

1. Approve phase 1 (I would start with the probe, since it decides which emails are worth sending).
2. Phase 2: provide a mailbox for PriceSpy alerts (and say whether you are comfortable storing its IMAP login in the app's settings), and say whether you will send the "please allow us" emails (I will draft them).
3. Confirm you want me to leave Huginn and the heavy scraping stacks out.
4. Check `/api/v1/full-spec` on your changedetection.io (it is served without a key) so I can confirm what 0.55.x supports before I change how we read it.
