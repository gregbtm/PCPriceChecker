# Self-hosted ntfy setup

The app sends alerts to ntfy with `POST {ntfy_server}/{ntfy_topic}`. Nothing is sent until both are set.

## 1. Settings (config table; no restart needed)
```bash
curl -X POST http://NAS:38574/api/config -H 'Content-Type: application/json' -d '{"key":"ntfy_server","value":"https://ntfy.example.lan"}'
curl -X POST http://NAS:38574/api/config -H 'Content-Type: application/json' -d '{"key":"ntfy_topic","value":"pcpricechecker"}'
```
Use any topic name you will subscribe to. If the server is open, that is all.

## 2. If the server needs a login (HTTP 403)
A server with access control answers **403** to an anonymous publish, and the app then reports the channel as `false`. Create an access token on the server and give it to the app:
```bash
# on the ntfy server (documented ntfy commands; see docs.ntfy.sh/config for your version)
ntfy token add --label pcpricechecker <user>      # prints tk_...
ntfy access <user> pcpricechecker write-only      # the user may publish to this topic
```
```bash
curl -X POST http://NAS:38574/api/config -H 'Content-Type: application/json' -d '{"key":"ntfy_token","value":"tk_..."}'
```
The app sends it as `Authorization: Bearer tk_...` (covered by `apify-ntfy.test.ts`). The token is stored unmasked in the config table and `GET /api/config` returns it, so keep the app on your LAN.

## 3. Check it
```bash
curl -X POST http://NAS:38574/api/notifications/test      # {"ntfy":true,...} when delivered
curl -X POST http://NAS:38574/api/daily-summary/send      # {"sent":true}
```
Subscribe to the topic in the ntfy app or web UI to see the message. `"ntfy":false` means the publish failed: wrong `ntfy_server`/`ntfy_topic`, an unreachable host from the container, or 403 (needs a token). The container must be able to resolve and reach the ntfy host.

## What is sent
Price alert (in stock, at or below `alert_price`), "options" list (up to `consider_price`), price drop, restock, scraper failure (three failures in a row, once per source per 24 hours), and the daily summary (default 08:00). See `docs/OPERATIONS.md` for cooldowns and quiet hours.

**Unverified:** this has not been run against the owner's ntfy server. Their other homelab notes record an earlier `HTTP 403` from it, which is the token case above.
