import { readFileSync } from 'fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as db from '../db.js';
import { parseHukdFeed, type HukdDeal } from '../sources/hotukdeals.js';
import { isTargetDeal, pollDealFeeds, loadDealFeedStatus, windowGaps, POLL_EVERY_MS, MAX_AGE_MS } from './deal-feed.js';

// Real HotUKDeals feed items, captured 2026-10-08 from /rss/tag/ram and /rss/tag/computers (trimmed to the first few items).
const RAM = parseHukdFeed(readFileSync(new URL('../test/fixtures/hotukdeals-rss-tag-ram.xml', import.meta.url), 'utf8'));
const COMPUTERS = parseHukdFeed(readFileSync(new URL('../test/fixtures/hotukdeals-rss-tag-computers.xml', import.meta.url), 'utf8'));

// Constructed, NOT captured: no 64GB SO-DIMM kit deal was live when the fixtures were taken.
const deal = (title: string, over: Partial<HukdDeal> = {}): HukdDeal => ({
  title, url: `https://www.hotukdeals.com/deals/${encodeURIComponent(title)}`, merchant: 'Scan', price: 589, currency: 'GBP',
  description: '', publishedAt: '2026-10-08T12:00:00.000Z', category: 'Electronics', permalink: '', imageUrl: null, isFreebie: false,
  guid: `guid:${title}`, ...over,
});
const NOW = new Date('2026-10-08T13:00:00.000Z');

beforeEach(() => db.getDb().exec('DELETE FROM config;'));

describe('parsing real feed items', () => {
  it('reads title, merchant, price and guid from a real /rss/tag/ram item', () => {
    expect(RAM.length).toBe(8);
    const crucial = RAM.find(d => /Crucial Pro DDR5 RAM 32GB/.test(d.title))!;
    expect(crucial.merchant).toBe('Amazon');
    expect(crucial.price).toBe(399.99);              // from <pepper:merchant price="£399.99"/>
    expect(crucial.guid).toMatch(/^https:\/\/www\.hotukdeals\.com\/deals\//);
    expect(COMPUTERS.every(d => d.guid && d.title)).toBe(true);
  });
});

describe('isTargetDeal', () => {
  it('matches a 64GB and a 48GB DDR5 SO-DIMM kit', () => {
    expect(isTargetDeal(deal('Kingston FURY Impact 64GB (2x32GB) 5600MT/s DDR5 SODIMM @ Scan'))).toBe(true);
    expect(isTargetDeal(deal('Corsair Vengeance 48GB (2x24GB) DDR5-5600 laptop memory'))).toBe(true);
  });

  it('rejects everything in the real fixtures (none is a 48GB+ DDR5 SO-DIMM kit)', () => {
    for (const d of [...RAM, ...COMPUTERS]) expect(isTargetDeal(d), d.title).toBe(false);
  });

  it('rejects desktop RAM, DDR4, singles below 48GB, CAMM2 and devices sold with memory', () => {
    expect(isTargetDeal(deal('Corsair Vengeance 64GB (2x32GB) DDR5 6000MT/s DIMM'))).toBe(false);
    expect(isTargetDeal(deal('Corsair Vengeance 64GB (2x32GB) DDR5 6000MT/s'))).toBe(false);              // no SO-DIMM word
    expect(isTargetDeal(deal('Kingston 64GB (2x32GB) DDR4 3200 SODIMM'))).toBe(false);
    expect(isTargetDeal(deal('Crucial 32GB DDR5-5600 SODIMM'))).toBe(false);
    expect(isTargetDeal(deal('Crucial 64GB DDR5 CAMM2 7500MT/s SODIMM'))).toBe(false);
    expect(isTargetDeal(deal('GMKtec M7 Mini PC Ryzen 7, 64GB DDR5 SO-DIMM, 1TB SSD'))).toBe(false);
    expect(isTargetDeal(deal('Lenovo Legion Laptop 64GB DDR5 SODIMM RTX 5070'))).toBe(false);
  });

  it('does not let a description saying "up to 64GB" turn a laptop into a kit', () => {
    expect(isTargetDeal(deal('Lenovo ThinkPad E16 Laptop', { description: 'Upgradable to 64GB DDR5 SODIMM' }))).toBe(false);
  });

  it('takes the capacity from the description when the title omits it', () => {
    expect(isTargetDeal(deal('Kingston FURY Impact DDR5 SODIMM kit', { description: '64GB (2x32GB) 5600MT/s DDR5' }))).toBe(true);
  });
});

describe('pollDealFeeds', () => {
  const target = deal('Kingston FURY Impact 64GB (2x32GB) 5600MT/s DDR5 SODIMM @ Scan');
  const feeds = (deals: HukdDeal[], failures: string[] = []) => vi.fn(async () => ({ deals, failures }));

  it('notifies once for a matching post, marked unverified, and not again on the next poll', async () => {
    const notify = vi.fn();
    const r = await pollDealFeeds({ fetchFeeds: feeds([target, ...RAM]), notify: notify as never, now: () => NOW });
    expect(r.polled).toBe(true);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0]).toMatchObject({ type: 'new_product', retailer: 'Scan', price: 589, url: target.url });
    expect(notify.mock.calls[0][0].message).toMatch(/not checked/i);

    const later = new Date(NOW.getTime() + POLL_EVERY_MS + 1);
    await pollDealFeeds({ fetchFeeds: feeds([target]), notify: notify as never, now: () => later });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('is gated to about once an hour', async () => {
    const f = feeds([]);
    await pollDealFeeds({ fetchFeeds: f, notify: vi.fn() as never, now: () => NOW });
    const soon = await pollDealFeeds({ fetchFeeds: f, notify: vi.fn() as never, now: () => new Date(NOW.getTime() + 10 * 60_000) });
    expect(soon.polled).toBe(false);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('does not announce a post older than 72 hours (the first run must not replay old deals)', async () => {
    const old = deal('Kingston FURY Impact 64GB (2x32GB) DDR5 SODIMM old', { publishedAt: new Date(NOW.getTime() - MAX_AGE_MS - 60_000).toISOString() });
    const notify = vi.fn();
    await pollDealFeeds({ fetchFeeds: feeds([old]), notify: notify as never, now: () => NOW });
    expect(notify).not.toHaveBeenCalled();
  });

  it('records a status line, and an all-feeds failure is a failure, not "no deals"', async () => {
    await pollDealFeeds({ fetchFeeds: feeds([], ['ram: HTTP 403', 'computers: HTTP 403']), notify: vi.fn() as never, now: () => NOW });
    expect(loadDealFeedStatus()).toMatchObject({ ok: false, items: 0 });
    expect(loadDealFeedStatus()!.error).toMatch(/HTTP 403/);

    db.getDb().exec('DELETE FROM config;');
    await pollDealFeeds({ fetchFeeds: feeds(RAM, ['electronics: HTTP 500']), notify: vi.fn() as never, now: () => NOW });
    expect(loadDealFeedStatus()).toMatchObject({ ok: true, items: RAM.length });   // partial: still ok, error text kept
    expect(loadDealFeedStatus()!.error).toMatch(/electronics/);
  });

  it('does nothing when switched off, unless forced', async () => {
    db.setConfig('deal_feeds_enabled', 'false');
    const f = feeds([target]);
    expect((await pollDealFeeds({ fetchFeeds: f, notify: vi.fn() as never, now: () => NOW })).polled).toBe(false);
    expect(f).not.toHaveBeenCalled();
    expect((await pollDealFeeds({ fetchFeeds: f, notify: vi.fn() as never, now: () => NOW }, true)).polled).toBe(true);
  });
});

describe('feed window gaps (a feed shows only its newest ~30 items)', () => {
  it('windowGaps: no overlap with the previous poll is a gap; any overlap, a first poll or a silent feed is not', () => {
    expect(windowGaps({ ram: ['a', 'b'] }, { ram: ['c', 'd'] })).toEqual(['ram']);
    expect(windowGaps({ ram: ['a', 'b'] }, { ram: ['b', 'c'] })).toEqual([]);
    expect(windowGaps({}, { ram: ['c'] })).toEqual([]);                       // first poll: nothing to compare with
    expect(windowGaps({ ram: ['a'] }, {})).toEqual([]);                       // the feed did not answer this time
    expect(windowGaps({ ram: ['a'] }, { ram: [] })).toEqual([]);              // an empty window proves nothing
    expect(windowGaps({ ram: ['a'], computers: ['x'] }, { ram: ['a'], computers: ['y'] })).toEqual(['computers']);
  });

  it('pollDealFeeds reports the gap in its status, and a failed feed keeps its earlier window', async () => {
    const poll = (byFeed: Record<string, string[]>, minutesLater: number, failures: string[] = []) =>
      pollDealFeeds({ fetchFeeds: vi.fn(async () => ({ deals: [], failures, byFeed })), notify: vi.fn() as never, now: () => new Date(NOW.getTime() + minutesLater * 60_000) });
    await poll({ ram: ['a', 'b'], computers: ['x', 'y'] }, 0);
    expect(loadDealFeedStatus()?.gaps).toBeUndefined();
    await poll({ computers: ['y', 'z'] }, 60, ['ram: HTTP 500']);                // ram silent, computers overlaps
    expect(loadDealFeedStatus()?.gaps).toBeUndefined();
    await poll({ ram: ['q'], computers: ['m', 'n'] }, 120);                      // ram: nothing shared with the stored [a,b]; computers: nothing shared with [y,z]
    expect(loadDealFeedStatus()?.gaps?.sort()).toEqual(['computers', 'ram']);
  });
});
