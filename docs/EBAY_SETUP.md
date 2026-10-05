# eBay UK as a price source (official API, free)

_Added 2026-10-05. Unverified items are marked. No eBay call has been made from this repo yet: the code is tested against a mocked API only._

## Why eBay
Plain scraping of the big UK retailers failed on the owner's NAS on 2026-10-05 (Scan answered 403 from the home IP; Ebuyer and CCL URLs 404, see `docs/RESEARCH_AND_VERIFICATION.md` row 18 and the notes after it). eBay's **Browse API** is the official, key-based route: no scraping, no anti-bot, used and new listings, UK marketplace.

## Setup
1. Create a free account at https://developer.ebay.com and create an application keyset. Use the **Production** keyset (the app calls `api.ebay.com`). The **App ID** is `EBAY_CLIENT_ID`; the **Cert ID** is `EBAY_CLIENT_SECRET`.
2. **Unverified, may apply:** eBay has required developers to either subscribe to its "Marketplace Account Deletion" notifications or apply for an exemption before a production keyset becomes usable. If the app logs `eBay OAuth failed HTTP 401` or the keyset shows as disabled, read eBay's developer portal for that requirement. This repo's app only reads public listings and stores no eBay user data, so the exemption route is the likely fit; the owner has to apply for it in eBay's portal.
3. Put the two values in the container environment (Portainer stack variables) or set them through the config API (`POST /api/config`, keys `ebay_client_id` and `ebay_client_secret`). Neither belongs in the repo.
4. Create the component with `profile_id: "n5-air-ram"`, query `ddr5 so-dimm 64gb`, alert price 350 (or the 48GB variant). Within one scheduler tick, `GET /api/scrape-runs` must show a row with `source: "ebay"`. `ok: 1` means the API call worked; `ok: 0` shows the exact error.

## What the app does with eBay results
- One search per component per tick (plus one OAuth token request, cached ~2 h): well inside the free 5,000 calls/day noted in `src/sources/ebay-browse.ts`.
- Requested with `buyingOptions:{FIXED_PRICE}` so auction bids are not treated as prices. **Unverified** against the live API: if eBay rejects the filter, the run fails visibly with the HTTP 400 text.
- Dropped client-side, because they cannot be bought as a price: auctions, "For parts or not working" (condition 7000), listings known to ship from outside the UK, and non-GBP prices.
- Kept and checked by the same profile classifier as every other source: 24GB singles, DDR4, desktop DIMMs and accessories are stored but never alert.
- Alert text carries these caveats when they apply:
  - `used_condition`: anything other than New / New other.
  - `seller_feedback_low`: seller below 98% positive.
  - `delivery_excluded`: always for eBay; the price is the item price only.
  - `suspiciously_cheap`: under GBP 2 per GB for a matching kit (config `suspicious_price_per_gb`). The alert is still sent, with a warning to check the seller and the listing; RAM scams are common in shortages.
- `ebay_allow_used` = `false` (config) restricts the search to new items.

## Known limits
- Relevance ranking: the search takes the first 100 best-match results and filters them; a rare kit outside that window is missed.
- Item price only; delivery cost, import costs and eBay's returns policy are not modelled (plan task P5-3).
- Amazon UK is still unavailable key-less (Keepa is paid).
