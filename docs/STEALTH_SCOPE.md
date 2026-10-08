# Scope: a stealth-browser sidecar for shops that refuse the NAS (2026-10-08)

**Status: scoped, not built, not run.** Nothing here has been tried on the NAS. Words as elsewhere: **Verified** (observed), **Unverified** (read or estimated, never run).

## 1. The decision, recorded

On 2026-10-08 the owner chose to use PriceStalker's stealth browser, accepting the evasion that comes with it. That **changes the owner rule of 2026-10-06** ("scrape politely, never add measures to defeat a site's protections") for the shops the owner names, and only those. Until the build below lands, the running code, `README.md` and `docs/PRODUCT_EVALUATION.md` still describe the old rule and are still correct for it: the bypass tooling is off (`allow_bot_bypass`, default off).

## 2. What exactly we would use

Only PriceStalker's **`scraper` service**, not the app. The app (Express, React, Postgres) would duplicate our database and discard what makes this project useful here (the memory-kit classifier, the stock tri-state, verify-before-alert, the evidence ledger).

| Fact | Value | Evidence |
|---|---|---|
| What it is | A 1,171-line Express service wrapping Puppeteer with `puppeteer-extra-plugin-stealth` and an ad blocker | Read, 2026-10-08 |
| Contract | `POST /scrape {url, options}` returns `{html, screenshotBase64}`; options include `userAgent`, `proxyUrl`, `referrer`, `waitUntil`, `waitForSelector`, `delay`; `GET /health` | Read (`scraper/src/api/routes.ts`, `types.ts`) |
| Behaviour on a challenge | Waits 8 s up to twice for "Just a moment" / "Are you a robot" pages to resolve, then returns whatever page it has. No CAPTCHA solving | Read (`ScraperService.ts`) |
| Limits | 3 browsers, 4 pages each, recycled after 50 scrapes, closed after 5 idle minutes; **fixed in code, not settings** | Read (`SessionManager.ts`) |
| Licence | MIT | Read |
| Image | `ghcr.io/mikeknight85/pricestalker-scraper`; tag `stable` = `2.0.0` = digest `sha256:f561a8a7d6818da27a5e71e7553908781b36eab8a55faf2d75244abe5ba7dbc3`; linux/amd64 and linux/arm64 | **Verified** on GHCR, 2026-10-08. The DS923+ is amd64 |
| Image size, RAM in use | not known | **Unverified**. Expect about 0.5 to 1.5 GB of RAM while a scrape runs and none when idle (an estimate) |
| Maintenance risk | the stealth plugin pin is `^2.11.2`; stealth plugins age badly as detectors adapt | judgement |

## 3. Why a sidecar and not what we already have

The repo already holds bypass code (fingerprint patching, rotating User-Agents, proxy rotation, Camofox and Novada backends), gated off by `allow_bot_bypass` in PR 46. It is not a one-switch job: **our published image has no Chromium** (`ENABLE_PLAYWRIGHT` defaults to false), so the in-process browser tier cannot run in production, and Camofox and Novada each need their own service anyway. A sidecar gives the browser a container of its own and keeps our Alpine image slim.

## 4. Design (stage S1, one pull request)

A new tier, after the plain fetch has been refused, in `scrapeProductUrl`. **All** of these must hold, or it does nothing:
1. `allow_bot_bypass` is `true`;
2. the URL's domain is in a new list `bypass_domains` (config, comma separated, **empty by default**): the evasion is per shop and named by the owner;
3. `browser_scraper_url` is set (the sidecar, for example `http://pcpc-scraper:5100`);
4. the site's robots.txt allows the address (already enforced before any request);
5. at most one browser request per URL per refresh pass, one at a time, at least 2 s apart.

The returned HTML goes through the **existing** extractors (JSON-LD, meta tags, stored rules, DOM), so there is no new parsing. A reply that still looks blocked is recorded as blocked and backs off after 3 failures with one probe a day, as today. **No escalation**: no proxy, no second identity. `/api/health` and the known-pages panel say which pages were read through the browser and what came back. Tests: a fake sidecar, and the real refusal bodies we have (Box's 403, the "Just a moment..." page) as fixtures.

## 5. Boundaries I propose (the owner confirms or changes each)

| Stays out | Why |
|---|---|
| Any shop not in `bypass_domains` | the old rule still applies everywhere else |
| Ignoring robots.txt | a different rule from the identity one, and it limits which pages are touched |
| CAPTCHA solving, logins, accounts, cookie harvesting | a step beyond reading a public page |
| Proxy rotation and rented residential proxies | costs money and is a further escalation; can be a later, separate decision |
| Faster polling | the same hourly rhythm as today |
| The HotUKDeals app-API signature | that is forging an official app's authentication, not getting past bot detection |

## 6. Gate first: a spike (stage S0, owner, about 30 minutes, no code changes)

**This may not work, and the evidence says so.** Research rows 23, 24, 30 and 32 recorded Box and other shops refusing the NAS even through a real browser, and row 45 recorded Box refusing curl's default identity too. A stealth browser fixes a *fingerprint* problem. If the refusal is about the NAS's **address or its connection's reputation**, nothing in the sidecar changes it. So run the cheap experiment before any build, and read the reachability probe table (`GET /api/access/probe`) first: shops that already answer need none of this.

```bash
# on the NAS: one throwaway container, localhost only, pinned by digest
sudo docker run -d --name pcpc-scraper-spike --init --shm-size=2g --memory=2g \
  --tmpfs /tmp:rw,size=1g -p 127.0.0.1:5100:5100 \
  ghcr.io/mikeknight85/pricestalker-scraper@sha256:f561a8a7d6818da27a5e71e7553908781b36eab8a55faf2d75244abe5ba7dbc3
sleep 20; curl -s http://127.0.0.1:5100/health

# one request per page (robots.txt allows these product pages); prints only what matters
for u in "https://box.co.uk/kf556s40ibk2-64-kingston-technology-fury-impact" \
         "https://www.laptopoutlet.co.uk/kingston-impact-kf556s40ibk2-64.html"; do
  echo "== $u"
  curl -s -m 120 -X POST http://127.0.0.1:5100/scrape -H 'Content-Type: application/json' \
    -d "{\"url\":\"$u\"}" -o "$HOME/spike.json" -w "http %{http_code}, %{size_download} bytes\n"
  grep -c 'application/ld+json' "$HOME/spike.json"
  grep -o -i 'just a moment\|access denied\|are you a robot\|verify you are human' "$HOME/spike.json" | head -2
done

sudo docker rm -f pcpc-scraper-spike     # remove it afterwards
```

**Go** if at least one refused shop returns a page with its `application/ld+json` price block on three tries spread over a day. **No-go** if every page is a wall or a 403: stop, build nothing, and use the legitimate routes (the allow-requests in `docs/EMAIL_DRAFTS.md`, shop alert emails, PriceSpy alerts). The spike costs nothing but the image pull.

## 7. Stages, effort and cost

| Stage | Work | Who | Effort |
|---|---|---|---|
| S0 | the spike above | owner runs, I read the output | 30 minutes |
| S1 | the tier, `bypass_domains` and `browser_scraper_url` settings, health, tests | me | one pull request, about half a day |
| S2 | the sidecar as a GitOps stack in `matrix-homelab` (private network only, pinned digest) and the doc corrections | me, then owner redeploys | small |
| S3, only if S1 works | HTML listing or category pages through the sidecar for discovery (not sitemaps: a 6 MB sitemap is a poor fit for a browser) | me | later |

Money: nothing. NAS load: Chromium while a scrape runs, then nothing after 5 idle minutes; at about five pages an hour this is small.

## 8. Risks, plainly

- **Terms and being blocked.** Getting past a shop's bot protection very likely breaches its terms of use. The practical risk is that the shop blocks the NAS's address, **which is also the address you would buy from**. Mitigation: only named product pages, hourly, one at a time, stop at the first refusal. This is not legal advice.
- **A third-party image running Chromium on your LAN.** Pin by digest, publish no port, put it on a private Docker network shared only with `pc-price-mcp`, no Docker socket, no host network. Its API has no authentication, so anything on that network can drive its browser.
- **It will decay.** Detectors adapt. We measure success per shop (the source status) rather than assume it, and the tier stays behind the off switch.
- **Chromium memory** on a 32 GB NAS running about 130 containers: a cap of 2 GB in the compose stack.
