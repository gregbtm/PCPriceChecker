/**
 * Stock tri-state helpers (audit A-02, task P0-2).
 *
 * Only `in_stock` may ever trigger a price alert. `backorder` covers dated or
 * pre-order wording ("Due 8th Oct"); `unknown` means the page gave no usable
 * signal and must NOT be treated as available.
 */
export type StockState = 'in_stock' | 'out_of_stock' | 'backorder' | 'unknown';

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';
const DAYS = 'mon|tue|wed|thu|fri|sat|sun';

const BACKORDER = new RegExp(
  [
    'pre-?\\s?order',
    'back-?\\s?order',
    'coming\\s+soon',
    'awaiting\\s+(stock|delivery)',
    'expected\\s+(back\\s+)?(in|on|by|from|\\d|' + MONTHS + '|' + DAYS + '|soon)',
    'due\\s+(?:(?:in|back|on|by)\\s+)*(?:\\d|(?:' + MONTHS + '|' + DAYS + ')\\w*|soon|next|early|mid|late|w\\/c)',
    'available\\s+(?:to\\s+order\\s+)?(?:from|on|in)\\s+(?:\\d|' + MONTHS + ')',
    'restock(?:ing)?\\s+(?:on|in|due|expected)',
    'arriving\\s+(?:on|in|soon|\\d)',
  ].join('|'),
  'i',
);

const OUT_OF_STOCK = /out[\s-]?of[\s-]?stock|sold[\s-]?out|no\s+stock|not\s+(?:currently\s+)?in\s+stock|(?:currently\s+)?un-?available|not\s+available|discontinued|no\s+longer\s+available|notify\s+me|email\s+me\s+when/i;

const IN_STOCK = /\bin[\s-]?stock\b|\b(?:low|limited)\s+stock\b|add\s+to\s+(?:basket|cart|bag|trolley)|buy\s+now|ready\s+to\s+(?:ship|dispatch)|(?:dispatch(?:ed)?|ships?)\s+(?:today|within|same)|get\s+it\s+(?:by\s+)?(?:today|tomorrow|mon|tue|wed|thu|fri|sat|sun)|available\s+(?:now|to\s+buy)|\bavailable\b/i;

/** Classify free text found near a price (stock badge, button label, availability string). */
export function parseStockText(text: string | null | undefined): StockState {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return 'unknown';
  if (BACKORDER.test(t)) return 'backorder';
  if (OUT_OF_STOCK.test(t)) return 'out_of_stock';
  if (IN_STOCK.test(t)) return 'in_stock';
  return 'unknown';
}

/** Classify a schema.org availability value such as `https://schema.org/InStock`. */
export function stockStateFromAvailability(value: unknown): StockState {
  if (value == null || value === '') return 'unknown';
  const s = String(value).replace(/^https?:\/\/schema\.org\//i, '').trim();
  if (/^(BackOrder|PreOrder|PreSale)$/i.test(s)) return 'backorder';
  if (/^(OutOfStock|SoldOut|Discontinued)$/i.test(s)) return 'out_of_stock';
  if (/^(InStock|InStoreOnly|OnlineOnly|LimitedAvailability)$/i.test(s)) return 'in_stock';
  return parseStockText(s);
}

/** Map a boolean from sources that only expose a flag (APIs). `undefined`/`null` stays unknown. */
export function stockStateFromBoolean(value: boolean | null | undefined): StockState {
  if (value === true) return 'in_stock';
  if (value === false) return 'out_of_stock';
  return 'unknown';
}

export function isInStock(state: StockState): boolean {
  return state === 'in_stock';
}
