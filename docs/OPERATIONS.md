# Operations notes

For the self-hosted NAS deployment. Image: `ghcr.io/gregbtm/pc-price-mcp:latest`; the compose file maps host port `HOST_PORT` (default 38574) to the container's 3000, and Watchtower pulls new `:latest` images about every 5 minutes.

## Security
The REST API and dashboard have **no authentication unless you set `app_token` / `APP_TOKEN`** (see "Access token" below); until then keep the port on the LAN and do not publish it. `GET /api/config` shows credential-shaped settings as a stub (`••••••••abcd`) either way. Keep changedetection.io and any Firecrawl instance LAN-only too.

## Settings
Settings live in the SQLite `config` table and are changed with `POST /api/config` and body `{"key":"...","value":"..."}` (empty value deletes the key). A value stored this way **overrides the container's environment** at startup. Keys: `ntfy_server`, `ntfy_topic`, `ntfy_token`, `webhook_url`, `webhook_secret`, `ebay_client_id`, `ebay_client_secret`, `changedetection_url`, `changedetection_api_key`, `changedetection_autocreate` (`false` stops the app creating Novatech watches), `quiet_hours` (e.g. `22:00-07:00`, local time, default none), `alert_cooldown_minutes` (1440), `drop_cooldown_minutes` (360), `price_retention_days` (365, 0 keeps everything), `daily_summary_hour` (8, `off` disables), `max_offer_age_hours` (48), `scheduler_retailers`, `suspicious_price_per_gb` (2). Per component: `PATCH /api/components/:id/alert` with `alert_price` and `consider_price`.

## Dashboard: Integrations tab
Everything below can be set from the dashboard's **Integrations** tab (sidebar menu): ntfy, alert behaviour (cooldowns, quiet hours, daily summary hour, retention), the n8n webhook and workflow downloads, changedetection.io (connection check, watches list, add or delete watches, optional Novatech page), the optional tiers, a scraper-health table with recent runs, and buttons to run a pass, test notifications and send the daily summary. Secrets are write-only there (a stored value shows as "set"). Per component, the bell button now sets the alert price, the "worth a look" price and the hardware profile, and the cart button lists the current qualifying offers.

## Source status and back-off
`GET /api/health` lists every source with a `status`: `ok`, `failing` (3 to 9 failures in a row; sends one notification per source per 24 hours), `blocked` (10 or more in a row), `idle` (has not run for 6 hours) or `disabled` (a retailer no longer in `scheduler_retailers`). `scrapers.failing` lists only `failing` sources. **Back-off:** a `search:*` source or PricesAPI that has failed 10 times in a row, or a product-page source (`url:<domain>`) that has failed 3 times in a row (it counts as `blocked` at that point), is tried once every 24 hours instead of every pass (no run is recorded for a skipped pass, and no politeness sleep happens); a success resets it. This stops hourly requests to retailers that refuse the server and a dead PricesAPI key. To stop trying a retailer entirely, set `scheduler_retailers` (for example `awdit,novatech,ebuyer`); to stop PricesAPI, remove the key (Integrations tab, or `POST /api/config {"key":"prices_api_key","value":null}` for the running process, and delete `PRICES_API_KEY` from the Portainer environment so it does not return after a restart).

## Checking scrape runs from a shell
```bash
APP=http://192.168.1.240:38574
curl -s $APP/api/scrape-runs?limit=30 | python3 -m json.tool          # newest first: source, ok, error, offers_found
curl -s "$APP/api/scrape-runs?limit=200" | python3 -c "import json,sys;[print(r['started_at'],r['source'],'ok' if r['ok'] else 'FAIL',r['offers_found'],(r['error'] or '')[:80]) for r in json.load(sys.stdin)]"
curl -s $APP/api/health | python3 -m json.tool                        # scrapers.sources: last success, failures in 24h, in a row
curl -s "$APP/api/scrape-runs?limit=200" | python3 -c "import json,sys;[print(r['started_at'],r['error']) for r in json.load(sys.stdin) if r['source']=='search:novatech']"
curl -s -X POST $APP/api/scheduler/run                                # start a pass now (202), then re-run the first command
```
`search:novatech` should show a "pending" failure on the first pass (the watch is being created) and offers on the next. A source with `ok: 1` and `offers_found: 0` is healthy but found nothing relevant.

## Checking that it works
- `GET /api/health` includes a `scrapers` section (last success per source).
- `GET /api/scrape-runs`: every source attempt; failing sources show `ok: 0` and the error. Three failures in a row notify once per source per 24 hours.
- `GET /api/ebay/status`: where the eBay keys came from and whether eBay accepts them (never prints them).
- `GET /api/changedetection/spike`: what the changedetection.io instance returns for its watches.
- `GET /api/debug/retailer-page?retailer=<id>`: what a retailer page contains, for diagnosing an extractor.
- `POST /api/scheduler/run` runs a pass now; `POST /api/daily-summary/send` sends the summary now; `POST /api/notifications/test` tests every channel.

## Backup and restore
**SQLite** (the volume `pc_price_data`, file `/data/pc-prices.db`, WAL mode). Do not copy the file while it is being written. Either stop the container first, or take a consistent copy:

```bash
docker exec pc-price-mcp sh -c 'node -e "const D=require(\"better-sqlite3\");new D(\"/data/pc-prices.db\").backup(\"/data/backup.db\").then(()=>console.log(\"ok\"))"'
docker cp pc-price-mcp:/data/backup.db ./pc-prices-$(date +%F).db
```

Restore: stop the container, replace `/data/pc-prices.db` (and delete any `-wal`/`-shm` files beside it), start it. Migrations are additive, so an older backup opens on a newer image. The backup call was run against a throwaway WAL database locally (2 rows copied, 2 read back, 2026-10-06). **Unverified**: it has not been run inside the container on the NAS (it assumes the container working directory is `/app`, where `better-sqlite3` is installed).

**changedetection.io** keeps everything in its `/datastore` volume (watches, history, settings). Back that volume up the same way (stop, copy, start); the API key is in its settings, not in this repo.

## Watchtower
`:latest` auto-update is the owner's choice (2026-10-05). To pin instead, set the image to a tag or digest and remove the `com.centurylinklabs.watchtower.enable` label.

## Known limits
Scan, Overclockers, Box, Currys and CCL return HTTP 403 from the NAS and Ebuyer refuses connections; none of that is worked around. Novatech product pages work through a changedetection.io watch; AWD-IT and eBay work directly. See `docs/RESEARCH_AND_VERIFICATION.md` rows 23-30.

## Retailers: robots.txt, sitemaps and what is blocked
The app does not request any address a site's robots.txt forbids (`services/robots.ts`; the refusal is recorded as a failure that names the rule). That removed the search pages of AWD-IT (no query strings), Novatech (`/search.html`), Overclockers and CCL (`/search`). For **AWD-IT and Novatech** the app now reads the retailer's own sitemap (cached 24 hours), picks product addresses whose slug fits the component's hardware profile, and reads those product pages (at most 12, 2 seconds apart). An empty match is healthy, not a failure. **Do not add sort or page-size parameters to Novatech addresses**: its robots.txt forbids the filter parameters `m, i, o, f, b, a, B, S, c, t`. If you want to watch a Novatech category page through changedetection.io anyway, set `novatech_search_url` to the plain category address (no parameters; `{q}` is replaced by the query if present); the app refuses an address robots.txt forbids. The earlier advice here to copy an address after choosing a sort order was wrong for that reason.

| Source | State (2026-10-07) |
|---|---|
| AWD-IT | sitemap + product pages (verified on the sitemap; live pass pending) |
| Novatech | sitemap + product pages (sitemap unverified: Novatech answers 403 from the build environment) |
| eBay UK | official API, working |
| Scan, Overclockers, CCL, Currys | Cloudflare bot challenge (HTTP 403), not worked around; Overclockers and CCL also forbid `/search`; Currys removed from the default list |
| Box | wrong search address (404) and `/catalogsearch/` is disallowed; blocked from the NAS |
| Ebuyer | connection refused at HTTP/2 level, cause unknown |
| Aria | closed since 2022 |
| PricesAPI | optional, metered: 10 credits per search with offers; free plan = 3,000 credits once. The app pauses it when credits run out (`403 CREDITS_EXCEEDED`) and searches each component at most once every 24 hours (`pricesapi_min_interval_hours`) |

## Optional: changedetection-mcp
Claude can manage changedetection.io watches through the community MCP `changedetection-mcp` (PyPI 0.1.0, one maintainer, Python 3.11+; tools: list/get/create/update/delete/recheck watches, history, snapshot diff, tags, system info; **no price or restock tool**). It is for ad-hoc management only: this app talks to the changedetection.io REST API directly and does not depend on it. Install pinned (`pip install changedetection-mcp==0.1.0`, optionally `--require-hashes` with the hashes in `docs/RESEARCH_AND_VERIFICATION.md` section 5) and set `CHANGEDETECTION_BASE_URL` and `CHANGEDETECTION_API_KEY`. Not tested here against the owner's instance (research row 3: "Live test" outstanding).

## Notifications
Self-hosted ntfy setup and the 403 fix: `docs/NTFY.md`.

## Optional tiers and where they stand
| Tier | Enable with | Status |
|---|---|---|
| changedetection.io (Novatech search, watched product URLs) | `changedetection_url`, `changedetection_api_key` | Working on the owner's instance (research rows 28-31) |
| Firecrawl (JavaScript rendering for a product URL) | `firecrawl_url` (+ `firecrawl_api_key` if set up) | Built and unit-tested, **never run against a real Firecrawl**. Nothing needs it today: Novatech works through changedetection.io, AWD-IT and eBay directly, and the other retailers refuse every fetch. See `pc-price-mcp/deploy/firecrawl.override.yml` |
| Local LLM (Ollama or any OpenAI-compatible server) | `openai_base_url` (e.g. `http://host:11434/v1`), `openai_model`; a key is optional | Off by default; used for AI price extraction and selector self-healing. Unit-tested with a stub, not with a real model |
| SearXNG discovery | `searxng_url` | `GET /api/discover?q=...&domains=a.co.uk,b.co.uk` suggests product pages; adds nothing by itself. Needs the `json` format enabled in SearXNG. Unit-tested only |
| PricesAPI, Keepa, Apify | their keys | Optional and off without a key; nothing depends on them. A stale `PRICES_API_KEY` only produces a failing `pricesapi` row |

**Per-domain strategy memory:** for a product URL the app remembers which provider (`direct` or `firecrawl`) last worked for the domain and tries it first; three failures in a row demote it. Stored in config rows `provider_strategy:<domain>`.

**Host decision (P6-2):** the owner chose the existing NAS (32GB RAM, ~130 containers). Nothing heavy is deployed by default. If Firecrawl is ever enabled, measure first (`docker stats`, DSM Resource Monitor) and lower `NUM_WORKERS_PER_QUEUE`, `BROWSER_POOL_SIZE` and `MAX_CONCURRENT_JOBS`, as the overlay does. Prebuilt Firecrawl images exist on GHCR (verified 2026-10-06: `firecrawl/firecrawl` latest and 2.10.1, `firecrawl/playwright-service` latest, `firecrawl/nuq-postgres` latest), so no source build is needed.

## Access token, politeness switches and reliability settings (2026-10-08)

| Setting (config table, or env var) | Default | What it does |
|---|---|---|
| `app_token` / `APP_TOKEN` | unset (open, LAN only) | When set, every `/api` call except `/api/health` needs it: `Authorization: Bearer <token>`, `X-API-Key: <token>`, or the cookie the dashboard's sign-in box sets (`POST /api/auth/login`). Stored secrets are shown as a stub (`••••••••abcd`) by `GET /api/config` whether or not a token is set; writing a stub back changes nothing. **If you lock yourself out**, remove the row: stop the container, `sqlite3 /data/<db> "DELETE FROM config WHERE key='app_token'"`, and unset `APP_TOKEN` in Portainer |
| `allow_bot_bypass` / `ALLOW_BOT_BYPASS` | off | Only the exact word `true` enables fingerprint patching, rotating browser identities, proxy rotation and the Camoufox/Novada backends. Leave it off: a site that refuses the app is recorded as `blocked by the site` and left alone |
| `scraper_user_agent` / `SCRAPER_USER_AGENT` | `PCPriceChecker (self-hosted price tracker; github.com/gregbtm/PCPriceChecker)` | The identity every plain request sends. Add a contact address if you like |
| `heartbeat_url` / `HEARTBEAT_URL` | unset | Pinged (GET) after every completed pass. Point it at an Uptime Kuma "Push" monitor or a healthchecks-style URL so something outside this app notices when it goes quiet |
| `pricesapi_enabled` | on | `false` stops every PricesAPI call and keeps the key; switch it back on (Integrations tab toggle) when your credits reset. Nothing is lost: the key stays stored |
| `deal_feeds_enabled` | on | `false` stops the hourly HotUKDeals tag-feed poll (about three requests an hour, robots.txt checked). When on, a community post that looks like a 48GB+ DDR5 SO-DIMM kit sends a "lead, not checked" notification. `POST /api/deal-feeds/poll` reads the feeds now; `/api/health` shows the last result |
| `alert_on_total` | off | `true` compares price plus known delivery with the alert and options limits |
| `options_cooldown_minutes` | 360 | Minimum gap between two "worth a look" lists |
| `ebay_mpn_every_hours` | 6 | How often the known part numbers are also searched on eBay (`0` every pass, `off`) |
| `verify_before_alert` | on | `false` stops the re-read of the cheapest eBay offers just before an alert (`GET /api/alerts/evidence` shows what was sent or held back and why) |

Checks from a shell (replace `$APP`):

```bash
curl -sS $APP/api/health | python3 -c "import json,sys;d=json.load(sys.stdin);print('alerts:',d['alerts']);print('catalogue:',d['catalogue']);print('failing:',d['scrapers']['failing'])"
curl -sS $APP/api/alerts/evidence?limit=10 | python3 -c "import json,sys;[print(e['created_at'],e['kind'],e['retailer'],e['price'],(e['evidence'] or {}).get('reason','')) for e in json.load(sys.stdin)]"
curl -sS $APP/api/components/7/known-pages
curl -sS "$APP/api/components/7/rejected?days=7" | python3 -c "import json,sys;d=json.load(sys.stdin);print(d['total'],'rejected');[print(v,k) for k,v in sorted(d['by_reason'].items(),key=lambda x:-x[1])];[print(x['price'],x['retailer'],x['listing_name'][:70],x['reasons']) for x in d['cheapest']];print('near misses (reasons are only \"not stated\"):');[print(x['price'],x['retailer'],x['listing_name'][:80]) for x in d['near_misses']];print('singles:');[print(x['price'],'x2 =',x['pair_price'],x['listing_name'][:70]) for x in d['singles']]"
```
(add `-H "Authorization: Bearer <token>"` once `app_token` is set)
