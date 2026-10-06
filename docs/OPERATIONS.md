# Operations notes

For the self-hosted NAS deployment. Image: `ghcr.io/gregbtm/pc-price-mcp:latest`; the compose file maps host port `HOST_PORT` (default 38574) to the container's 3000, and Watchtower pulls new `:latest` images about every 5 minutes.

## Security
The REST API and dashboard have **no authentication**, and `GET /api/config` returns every stored setting unmasked (API keys and tokens included). Keep the port on the LAN; do not publish it. Keep changedetection.io and any Firecrawl instance LAN-only too.

## Settings
Settings live in the SQLite `config` table and are changed with `POST /api/config` and body `{"key":"...","value":"..."}` (empty value deletes the key). A value stored this way **overrides the container's environment** at startup. Keys: `ntfy_server`, `ntfy_topic`, `ntfy_token`, `webhook_url`, `webhook_secret`, `ebay_client_id`, `ebay_client_secret`, `changedetection_url`, `changedetection_api_key`, `changedetection_autocreate` (`false` stops the app creating Novatech watches), `quiet_hours` (e.g. `22:00-07:00`, local time, default none), `alert_cooldown_minutes` (1440), `drop_cooldown_minutes` (360), `price_retention_days` (365, 0 keeps everything), `daily_summary_hour` (8, `off` disables), `max_offer_age_hours` (48), `scheduler_retailers`, `suspicious_price_per_gb` (2). Per component: `PATCH /api/components/:id/alert` with `alert_price` and `consider_price`.

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

## Optional: changedetection-mcp
Claude can manage changedetection.io watches through the community MCP `changedetection-mcp` (PyPI 0.1.0, one maintainer, Python 3.11+; tools: list/get/create/update/delete/recheck watches, history, snapshot diff, tags, system info; **no price or restock tool**). It is for ad-hoc management only: this app talks to the changedetection.io REST API directly and does not depend on it. Install pinned (`pip install changedetection-mcp==0.1.0`, optionally `--require-hashes` with the hashes in `docs/RESEARCH_AND_VERIFICATION.md` section 5) and set `CHANGEDETECTION_BASE_URL` and `CHANGEDETECTION_API_KEY`. Not tested here against the owner's instance (research row 3: "Live test" outstanding).

## Notifications
Self-hosted ntfy setup and the 403 fix: `docs/NTFY.md`.
