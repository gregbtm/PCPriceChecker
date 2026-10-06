# Scoped functional improvements (proposal, not built)

Ranked by value to the actual goal (a compatible, in-stock 64GB or 48GB SO-DIMM kit at a good price, alerted reliably). Effort: S under half a day, M about a day, L several days. Nothing here is started; each is independent.

| # | Improvement | Why | Effort | Notes / risk |
|---|---|---|---|---|
| 1 | **Optional access token for the dashboard and API** (`APP_TOKEN`; header or cookie) and **mask secrets in `GET /api/config`** | The dashboard now edits integration secrets and the API returns them unmasked. Biggest risk in the project | M | Breaking for any script that calls the API unless it sends the token; make it opt-in. The legacy React Settings tab reads `/api/config`, so it must move to `/api/integrations` first |
| 2 | **New-listing alerts for eBay** (poll sorted by newly listed, alert on an unseen matching listing) | A rare 64GB kit under 350 may appear and sell within hours; hourly price polling can miss it | M | eBay Browse supports `sort=newlyListed`; free tier is 5,000 calls/day, current use is a small fraction |
| 3 | **Alert on total cost (price plus delivery) as an option** (`alert_on_total=true`) | eBay delivery is now recorded; today the limit applies to the item price only | S | Unknown delivery counts as 0 unless flagged |
| 4 | **Manufacturer and affiliate feeds instead of scraping blocked retailers** (Awin product feeds, Kingston and Crucial UK stores) | Scan, Overclockers, CCL, Box and Currys block every fetch; Awin is free to join and has an existing module | M | Needs an Awin publisher account and advertiser approval; each retailer separately. Not a block workaround, a sanctioned feed |
| 5 | **Novatech category watch with price sort** | Fixes the 24-of-229 limit | S | Needs the category URL from the owner; the override already exists (`novatech_search_url`) |
| 6 | **MCP parity**: `track_component` accepts `consider_price`; new tools for offers, scraper health, watch creation | Claude sessions cannot use the new features today | S | Additive tool schema; needs the connector to be reconnected (known issue in the owner's other notes) |
| 7 | **"Held for review" state for suspiciously cheap listings** (alternative to flag-only) | Owner may prefer a human check before an alert fires on a too-good price | M | Changes alert semantics; ask first |
| 8 | **Best-in-stock price chart and market context** (30-day low and median in every alert) | Makes "is 492 good?" answerable at a glance | S-M | `getPurchasablePriceSummary` already exists; add to alert text and a dashboard chart |
| 9 | **Settings export and import** (config table, components, profiles) | Rebuild after a NAS failure | S | Must strip secrets or encrypt |
| 10 | **Playwright smoke test in CI** against a seeded database (the check done by hand for the dashboard) | Catches a broken dashboard build; Chromium is available in the CI image used here | M | Adds CI time |
| 11 | **Verify the n8n workflows** by importing them (needs an n8n API key or manual import) | They are the only unverified deliverable | S | Owner action or a key |
| 12 | **Firecrawl, if ever needed** (deploy overlay on a test host, measure RAM) | Only worth it if a JavaScript-only retailer that is not blocked turns up | M | Today nothing needs it |

Recommended order: 1, 5 (when the URL is known), 2, 3, 8, 6, then the rest.
