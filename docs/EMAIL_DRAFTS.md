# Email drafts (2026-10-08)

Drafts only. **Nothing here has been sent, and nothing can be sent by this app**: each one must come from you, with your own details in the brackets. No personal data is stored in this repository, so every address, name and IP is a placeholder.

Use the reachability probe first (`POST /api/access/probe`, then `GET /api/access/probe` two minutes later; `docs/OPERATIONS.md`). Only write to a shop whose `verdict` is `refused`: a shop that answers us needs nothing, and a shop whose robots.txt disallows a page is already answered. See `docs/INTEGRATION_OPTIONS.md` section 5 for why we ask instead of working around a refusal.

Before sending any of them, check that what they say is still true: the identity string is the one in Settings (`scraper_user_agent`), and the hourly figure matches your refresh interval.

---

## 1. To a shop that refuses the NAS (Scan, Box, LaptopOutlet, Overclockers, CCL and so on)

Find the shop's contact address on its own site (customer service or a "contact us" form). I have not looked up any shop's address, so I am not guessing one.

> **Subject:** Request to allow a small personal price and stock check
>
> Hello,
>
> I am a customer looking to buy a 64GB (2x32GB) DDR5 SO-DIMM memory kit for a Minisforum N5 Air, and I run a small self-hosted tool that checks a handful of product pages for price and stock so that I hear when one comes back in.
>
> Requests from my connection currently get HTTP 403 from your site, so the tool cannot see your pages at all. It behaves like this:
> - It reads your robots.txt first and never requests a page it disallows.
> - It requests individual product pages (and your published sitemap), about once an hour, never in parallel, and does not retry after a refusal.
> - It identifies itself honestly: `[YOUR scraper_user_agent VALUE, e.g. PCPriceChecker (self-hosted price tracker; github.com/gregbtm/PCPriceChecker; contact: YOUR EMAIL)]`.
> - It comes from the address `[YOUR PUBLIC IP, or "a residential connection that may change"]`.
>
> Would you be willing to allow that traffic, or tell me if there is a feed or an approved way to do this? If you would rather I did not, I will stop and take your pages off the list.
>
> Thank you,
> [YOUR NAME]
> [YOUR CONTACT EMAIL]

Notes:
- A home connection's public address usually changes. Say so rather than giving a fixed address you cannot promise.
- If the shop says no, or does not answer, leave it on the refused list. The app tries it once a day and records the answer; it does not try to get round it.
- Scan also has a "Notify me when available" control on unavailable items. That is the shop's own channel and may be better than anything above; whether it needs an account is Unverified.

---

## 2. To Pepper (HotUKDeals) asking for API access

The page `hotukdeals.com/docs/api.html` documents the Pepper Public API v2 but gives no sign-up, key, rate limit or terms, and an honest unauthenticated request got HTTP 401 `signature_missing_parameter` (`docs/INTEGRATION_OPTIONS.md` section 8). I found no contact address for API access on that page, so find the right one on the site's own contact or help pages; I have not looked it up.

> **Subject:** Question about access to the Pepper Public API
>
> Hello,
>
> I found your API documentation at hotukdeals.com/docs/api.html. I would like to use `GET /thread/search` (and possibly `/comparison/search`) from a small private tool, once an hour at most, to be told when a deal for a particular kind of memory kit is posted. It is for my own use, not published or resold.
>
> A request to `/rest_api/v2/thread` currently returns 401 "There's an issue with your app (signature_missing_parameter)". Is the API available to individuals, and if so how do I register an app or get credentials? If it is not available, I will keep using the public RSS tag feeds (which my tool reads politely, once an hour, with robots.txt checked).
>
> Thank you,
> [YOUR NAME]

---

## 3. To the eBay seller of the Fanxiang 64GB (2x32GB) DDR5 SO-DIMM kit

Send this through eBay's "Ask a question" on the listing, so the answer is kept with the item. The listing's item specifics say "ECC Memory"; the Minisforum N5 Air takes non-ECC modules (`docs/RESEARCH_AND_VERIFICATION.md` section 1).

> Hello, before I buy: are these modules **non-ECC (unbuffered)** DDR5 SO-DIMM? The item specifics list "ECC Memory". I need standard non-ECC SO-DIMMs for a Minisforum N5 Air mini PC. Could you confirm the exact model or part number printed on the modules, and that the kit is two 32GB 5600MT/s sticks? Thank you.

Do not buy until the seller confirms non-ECC in writing.
