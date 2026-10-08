# Awin product feeds: what it would take, and whether to try (2026-10-08)

Owner decision 2026-10-08: "yes, tell me what I need to do". Read this before applying. Everything marked **Verified** was read on the page named; **Unverified** was not.

## What Awin is, and why it may not fit

Awin is an affiliate network: a publisher promotes a merchant's products and is paid commission. A product feed is a merchant's catalogue (price, stock, part number) offered to approved publishers **so they can promote it**. A private price monitor with no public site is not promotion, and Awin does not say whether it qualifies.

| Fact | State |
|---|---|
| Joining needs a **£5 deposit**, added to your publisher account and refunded when you reach your first payment threshold; if you are rejected you can ask for a refund, which is not automatic | **Verified**, [Awin application process](https://www.awin.com/gb/compliance-and-regulations/application-process-and-joining-fee) |
| The form asks for the URLs, websites or social pages you will use to promote advertisers, and how your promotions work; every application is checked by hand and cross-checked, including for multiple accounts; Awin aims for 24 hours | **Verified**, same page |
| That page **does not address** a non-public promotional method | **Verified** (it is silent) |
| Scan's programme (Awin ID **15473**) runs "a thorough vetting process to ensure all affiliates are relevant to the programme", asks applicants to outline their intended activity, may end a relationship that conflicts with its brand guidelines, and **does not mention product feeds** | **Verified**, [Scan affiliate page](https://www.scan.co.uk/affiliate-program) |
| Overclockers' programme (Awin ID 28821) | ID seen on the merchant's own page by the research agent; the terms page was too long to read here, **Unverified** |
| Awin's newer "enhanced" feeds carry `availability` (in stock, out of stock, preorder, backorder), `mpn` and `ean`; the older CSV's exact stock column is not confirmed | **Unverified** beyond [Awin's column descriptions index](https://developer.awin.com/docs/enhanced-feeds-column-descriptions); a real downloaded header row settles it |

**My honest read:** the chance that Awin and Scan approve a private tool is real but modest, and an approval would not by itself give you Scan's feed (each merchant decides). It costs £5 up front and some time, and nothing else in this project depends on it. If you would rather not, skip it; the sources already built cover eBay, Wired2Fire, Box, LaptopOutlet and AWD-IT.

## If you want to try, in this order

1. **Ask before you pay.** Use the compliance contact route on [Awin's application page](https://www.awin.com/gb/compliance-and-regulations/application-process-and-joining-fee) and ask one plain question: "Can a private, personal price and stock monitoring tool with no public website hold a publisher account and download a merchant's product feed? If yes, how should I describe the promotional method on the form?" Do not invent a website or a promotion. (The page names a partner compliance team but I could not verify a specific email address, so use the route the page gives.)
2. **Only if the answer is yes:** create the publisher account (one account only; Awin looks for duplicates), pay the £5, and describe the use truthfully.
3. **Apply to the merchants' programmes** (Scan 15473, Overclockers 28821) with the same honest description, and ask each whether it shares a product feed with approved publishers.
4. **When a feed is available:** download one, and send me only the header row and five product rows (no account details, no download key). I will build the ingestor against the real columns instead of guessing. `src/sources/awin.ts` exists but has never run against Awin and should not be trusted until then.

## Not worth doing

Applying with a made-up blog, opening a second account after a rejection, or using a feed to scrape past a block. Each is the kind of workaround this project does not do, and the first two would also get the account closed.
