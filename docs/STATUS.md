# Status against the plan (2026-10-06)

Checked item by item against `docs/IMPROVEMENT_PLAN.md`, `docs/HANDOFF.md`, `docs/CODEBASE_AUDIT.md` and `docs/RESEARCH_AND_VERIFICATION.md`. Words used as everywhere else: **Built** (code and tests merged), **Verified** (observed running against the real thing), **Unverified** (written and unit-tested, never run for real).

## Definition of done (plan section 8)

| Criterion | State | Evidence / gap |
|---|---|---|
| No paid keys: at least three UK retailers tracked end to end, alerts delivered | **Partly met.** Sources that return data from the owner's NAS: AWD-IT (direct), Novatech (through a changedetection.io browser watch, **Verified end to end**: 24 offers every pass from 02:47 to 08:16, research row 34), eBay UK (free developer keys, Verified). Scan, Overclockers, Box, Currys, CCL answer HTTP 403 and Ebuyer refuses connections, even through a real browser (research rows 23, 24, 30, 32). **Alert delivery has never been observed**: ntfy is not set up and nothing in stock has been under 350 GBP | Set ntfy, then `POST /api/notifications/test` |
| Out-of-stock or backorder never alerts | **Built, tested** | `alerts.test.ts`, `db.stock.test.ts`, `refresh.test.ts` (seeded DB) |
| Classifier accepts 64GB (2x32GB) DDR5 SODIMM non-ECC, rejects DDR4 SO-DIMM and desktop DIMM | **Built, tested** with real titles | `memory-classifier.test.ts` |
| A broken scraper gives a visible record and a notification | **Built, tested.** Dashboard panel and `/api/scrape-runs` are Verified on a seeded DB. The notification itself was never delivered (no ntfy) | `scrape-health.ts`, `web.test.ts` |
| Self-hosted Firecrawl passes its smoke test and recovers a JavaScript page | **Not met, and not needed.** Firecrawl was never run. The same goal (a JavaScript-rendered page) is met by changedetection.io's browser for Novatech | research rows 28-31 |
| changedetection.io spike documented and, if viable, integrated | **Met** (Verified on the owner's instance) | research rows 28-32, HANDOFF 9i, 9l |
| `npm test` passes in CI | **Met** | the TypeScript build job runs the tests on every PR |

## Plan items

All items are ticked in `docs/HANDOFF.md` section 5 except **P4-5 (n8n)**, which stays "built, never imported into n8n". Where an item is ticked but only unit-tested, the HANDOFF line says so:

| Verified on real systems | Built and unit-tested only |
|---|---|
| eBay Browse API tier; AWD-IT extraction; Novatech via changedetection.io; stock-aware alerts on seeded data; dashboard (headless Chromium on a seeded DB) | Firecrawl provider, Ollama option, SearXNG discovery, deploy overlays (YAML parses only), ntfy delivery, n8n workflows, retention on a real database, quiet hours on the NAS clock, delivery cost on live eBay shapes |

## Audit findings (docs/CODEBASE_AUDIT.md)

| Finding | State |
|---|---|
| A-01, A-02 stock-aware alerts, tri-state | Fixed |
| A-03, A-04, A-05 John Lewis price, misleading fallback, JSON-LD | Fixed |
| A-06, A-07 selector rules, self-healing | Fixed (cheerio, validated, throttled) |
| A-08 AI hard-wired to cloud | Fixed for OpenAI-compatible servers (Ollama); the Anthropic path stays optional |
| A-09 Apify | Partly fixed (abort and logging); remains optional |
| A-10, A-11 hidden failures, no key-less path | Fixed. **Found and fixed today:** the dashboard's per-component Refresh button still used the paid-API-only code, so it ignored every key-less source; it now uses the scheduler's path |
| A-12 outlier policy | Documented decision (flag, never hide) |
| A-13, A-14 retention, cooldowns | Fixed (configurable) |
| A-15 Keepa stock assumptions | Not changed; Keepa stays optional and off without a key |
| A-16 compatibility | Fixed for SO-DIMM, ECC, slots, capacity, mobile CPUs |
| A-17 docs inconsistencies | Fixed |
| A-18 tests and parser | Fixed |
| A-19 currency | Fixed |
| A-20, A-21 interval semantics, sequential scraping | Unchanged by design (polite scraping); manual refreshes are now serialised too |
| A-22 Currys endpoint | Unchanged; Currys answers 403 anyway |

## Known gaps worth knowing about

1. **Retailer access is limited by the retailers.** Cloudflare challenges block Scan, Overclockers, CCL and Currys; Ebuyer refuses connections; AWD-IT and Novatech forbid their search pages in robots.txt, so those two are read through their sitemaps and product pages (AWD-IT sitemap verified, Novatech's not, live pass pending). See research rows 35-37 and `docs/OPERATIONS.md`.
2. **Authentication is opt-in** (`app_token` / `APP_TOKEN`, 2026-10-08) and off by default; stored secrets are masked in `GET /api/config` either way. Until a token is set the dashboard and API are open to anything on the LAN.
3. **Alerts compare the item price, not price plus delivery**, unless `alert_on_total` is set (2026-10-08).
4. The old components (ids 1, 2, 3, 4, 6) should be paused by the owner.
