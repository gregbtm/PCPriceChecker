# Using n8n with PCPriceChecker

_Added 2026-10-05. Status words as elsewhere: **Verified** (done and observed), **Unverified** (written from docs or reasoning, not run)._

## Do not read or write n8n's database

Do not point the app at n8n's database tables. They are n8n's internal schema (it changes between versions), the app has no access to that database, and n8n's own docs steer integrations to webhooks and its API. Whether n8n's newer built-in data tables could help is **Unverified** and not needed for the two approaches below.

## 1. Push: the app posts to an n8n webhook (generic webhook channel)

**Verified by unit tests** (`src/notifications.test.ts`, mocked `fetch`); **not tested against a running n8n**.

Set two config values (REST `POST /api/config` with `{"key": "...", "value": "..."}`, or the `config` table):

| Key | Meaning |
|-----|---------|
| `webhook_url` | n8n Webhook node URL, for example `http://<nas-ip>:5678/webhook/pcpc` (use the **production** URL, not `/webhook-test/`) |
| `webhook_secret` | optional; sent as header `X-PCPC-Token`. In n8n create a **Header Auth** credential with name `X-PCPC-Token` and the same value |

The app POSTs JSON for every notification type (`price_alert`, `price_drop`, `restock`, `scrape_failure`, `saved_search`, `test`):

```json
{ "event": "price_alert", "ts": "2026-10-05T22:30:00.000Z",
  "type": "price_alert", "componentName": "64GB DDR5 SO-DIMM kit",
  "price": 340, "currency": "GBP", "retailer": "Ebuyer",
  "alertThreshold": 350, "url": "https://...", "message": null }
```

Fields present depend on the event (`dropAmount`/`dropPercent` for drops, `message` for scraper failures). Header `X-PCPC-Event` repeats the event name. Test it with `POST /api/notifications/test`; the response now includes `webhook: true|false`.

Importable example: `docs/n8n/pcpricechecker-webhook-to-ntfy.json` (Webhook with Header Auth, an `event == price_alert` check, then an HTTP Request to your ntfy topic). **Unverified**: hand-written and never imported into n8n; node versions may need adjusting. Replace `YOUR-NTFY-HOST/YOUR-TOPIC`. Remember the app already sends to ntfy directly; use n8n only for extra routing (for example a second channel, a spreadsheet log, or a Home Assistant action).

## 2. Pull: an n8n workflow polls the REST API

Use a **Schedule Trigger** followed by **HTTP Request** nodes (method GET, response format JSON). **Unverified** end to end; routes are **Verified** from `src/web.ts`.

| Route | Returns |
|-------|---------|
| `GET /api/alerts` | components whose best **in-stock** price is at or below their alert price |
| `GET /api/price-drops?min_percent=5` | recent in-stock price drops |
| `GET /api/stock-changes?hours=24` | stock transitions (in stock / not) |
| `GET /api/scrape-runs?limit=100` | recent scrape attempts per source (`ok`, `error`, `offers_found`) |
| `GET /api/health` | `scrapers.failing`: sources with 3+ failures in a row |
| `GET /api/components/:id/history?days=30` | price history for charts or a sheet |

Suggested polling workflows: (a) every morning, `GET /api/alerts` and `GET /api/health`, then post a digest if anything is below target or `scrapers.failing` is not empty; (b) hourly `GET /api/stock-changes?hours=1` to a chat channel; (c) daily append of `/api/components` best prices to a spreadsheet for a long-term chart.

## Security notes

- The REST API and dashboard have **no authentication** (**Verified**: no auth code in `web.ts`). Keep the app on the LAN. `GET /api/config` returns every stored setting, secrets included, so do not expose the port beyond your network or to untrusted containers.
- The webhook goes out to whatever URL is configured; the app does not restrict it, so only set it to a host you control.

## 3. Wiring it from the dashboard (added 2026-10-06)
Integrations tab > **n8n (webhook)**: enter the Webhook node URL and optional header token, **Save**, then **Send a test to n8n** (a `test` event reaches the workflow). The same card downloads three importable workflows generated for this app's address and your ntfy topic: `webhook-to-ntfy` (push), `health-digest` (daily 07:15, messages only when a source is failing) and `deals-digest` (daily 07:30, one message per component at or below its alert price). Import them in n8n via Workflows > Import from file, set the Header Auth credential on the webhook workflow, and activate them. **Unverified**: none has been imported into a running n8n. The owner's n8n answers on its public address, but importing needs an n8n API key or a manual import.
