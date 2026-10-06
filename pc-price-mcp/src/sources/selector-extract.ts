/**
 * Selector rules on a real HTML parser (P0-6, audit A-06) and the checks that make LLM-proposed
 * selectors safe to store (P0-7, audit A-07).
 *
 * Before: `tryRules` pulled the first `.class` / `#id` out of the selector and matched it with a regex, so
 * descendant selectors, nested tags (`<span>£<span>799</span>.99</span>`) and `price_attribute` never worked.
 * Now: cheerio runs the real CSS selector. A selector that does not parse is treated as "no match", never a throw.
 */
import * as cheerio from 'cheerio';
import { parsePriceText, isAcceptableCurrency } from '../services/price-text.js';
import { parseStockText, type StockState } from '../services/stock-state.js';

export interface RuleLike {
  price_selector: string | null;
  name_selector?: string | null;
  avail_selector?: string | null;
  price_attribute?: string | null;
  price_regex?: string | null;
}

export interface RuleExtraction { price: number; name?: string; stockState: StockState }

const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Text (or the named attribute) of the first element the selector matches; null on no match or a bad selector. */
export function selectValue($: cheerio.CheerioAPI, selector: string | null | undefined, attribute?: string | null): string | null {
  if (!selector) return null;
  try {
    const el = $(selector).first();
    if (el.length === 0) return null;
    const v = clean(attribute ? el.attr(attribute) : el.text());
    return v || null;
  } catch {
    return null;   // invalid selector
  }
}

export function extractWithRule(html: string, rule: RuleLike): RuleExtraction | null {
  const $ = cheerio.load(html);
  const priceText = selectValue($, rule.price_selector, rule.price_attribute);
  if (!priceText) return null;
  const parsed = parsePriceText(priceText, rule.price_regex);
  if (!parsed || !isAcceptableCurrency(parsed.currency)) return null;   // non-GBP is never stored as GBP (P0-12)
  const name = selectValue($, rule.name_selector) ?? undefined;
  const avail = selectValue($, rule.avail_selector);
  return { price: parsed.price, name, stockState: parseStockText(avail) };
}

// ── P0-7: self-healing that cannot save a guess ────────────────────────────

/**
 * A structural excerpt for the LLM: elements whose own text carries a £ price, with tag, id, class and the
 * data-/itemprop/content attributes that selectors use, plus the h1 and stock-looking elements. Replaces
 * the old tag-stripped first-4000-characters text, which contained no structure to select on.
 */
export function structuralExcerpt(html: string, maxItems = 40): string {
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  const lines: string[] = [];
  const describe = (el: cheerio.Cheerio<never>): string => {
    const node = el.get(0) as unknown as { tagName?: string; attribs?: Record<string, string> };
    const a = node.attribs ?? {};
    const attrs = Object.entries(a)
      .filter(([k]) => k === 'id' || k === 'class' || k === 'itemprop' || k === 'content' || k.startsWith('data-'))
      .map(([k, v]) => `${k}="${v.slice(0, 60)}"`).join(' ');
    return `<${node.tagName ?? '?'}${attrs ? ' ' + attrs : ''}> ${clean(el.text()).slice(0, 80)}`;
  };
  const seen = new Set<unknown>();
  const push = (el: cheerio.Cheerio<never>) => {
    const node = el.get(0);
    if (seen.has(node) || lines.length >= maxItems) return;
    seen.add(node);
    const parent = el.parent();
    const p = parent.length ? describe(parent as cheerio.Cheerio<never>).split('>')[0] + '>' : '';
    lines.push(`${p ? p + ' > ' : ''}${describe(el)}`);
  };
  $('h1').first().each((_, e) => push($(e) as cheerio.Cheerio<never>));
  $('*').each((_, e) => {
    const own = $(e).contents().filter((__, c) => c.type === 'text').text();
    if (/£\s*\d/.test(own) || $(e).attr('data-price-amount') || $(e).attr('itemprop') === 'price') push($(e) as cheerio.Cheerio<never>);
  });
  $('[class*="stock"], [class*="avail"]').slice(0, 5).each((_, e) => push($(e) as cheerio.Cheerio<never>));
  return lines.join('\n');
}

export interface Proposal {
  price_selector?: string | null; name_selector?: string | null; avail_selector?: string | null;
  price_attribute?: string | null; price_regex?: string | null;
}

/** A proposal is usable only if, on the very page it was proposed for, it extracts a plausible GBP price. */
export function validateProposal(html: string, p: Proposal): RuleExtraction | null {
  if (!p.price_selector) return null;
  const got = extractWithRule(html, { price_selector: p.price_selector, name_selector: p.name_selector,
    avail_selector: p.avail_selector, price_attribute: p.price_attribute, price_regex: p.price_regex });
  return got && got.price >= 1 && got.price < 100_000 ? got : null;
}

const HEAL_INTERVAL_MS = 6 * 3_600_000;
const lastHeal = new Map<string, number>();

/** At most one heal attempt per domain per interval (a failing page used to trigger the LLM on every scrape). */
export function healAllowed(domain: string, now = Date.now()): boolean {
  const last = lastHeal.get(domain);
  if (last != null && now - last < HEAL_INTERVAL_MS) return false;
  lastHeal.set(domain, now);
  return true;
}
export function resetHealThrottle(): void { lastHeal.clear(); }
