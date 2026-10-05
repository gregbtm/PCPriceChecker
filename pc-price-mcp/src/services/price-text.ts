/**
 * Price text parsing shared by the scrapers (audit A-19, tasks P0-3 / P0-12).
 *
 * - Reference prices ("Was £x", "RRP £x", "Save £x") are ignored; "Now £x" and plain prices are kept.
 * - The currency is reported when a symbol or ISO code is present, so callers can reject non-GBP
 *   prices instead of silently storing them as GBP.
 */
export interface ParsedPrice {
  price: number;
  /** ISO code when the text states one (symbol or code); null when it says nothing. */
  currency: string | null;
}

const SYMBOL_TO_ISO: Record<string, string> = { '£': 'GBP', '$': 'USD', '€': 'EUR' };

const REFERENCE_PRICE = /\b(?:was|rrp|save|saving|list\s+price|originally|msrp|rpp)\b[^\d£$€]*[£$€]?\s*\d[\d,]*(?:\.\d+)?/gi;

export function detectCurrency(text: string): string | null {
  const sym = text.match(/[£$€]/);
  if (sym) return SYMBOL_TO_ISO[sym[0]];
  const code = text.match(/\b(GBP|USD|EUR)\b/i);
  return code ? code[1].toUpperCase() : null;
}

/** GBP, or unstated (UK retailers often omit it). Anything else must not be stored as GBP. */
export function isAcceptableCurrency(currency: string | null | undefined): boolean {
  return currency == null || currency === '' || currency.toUpperCase() === 'GBP';
}

export function parsePriceText(text: string, regex?: string | null): ParsedPrice | null {
  const currency = detectCurrency(text);
  if (regex) {
    try {
      const m = text.match(new RegExp(regex));
      if (m?.[1]) {
        const p = parseFloat(m[1].replace(/,/g, ''));
        if (p > 0 && p < 50_000) return { price: p, currency };
      }
    } catch { /* bad regex: fall through to the generic parser */ }
  }
  // Drop reference prices, but only if something else is left to parse.
  const stripped = text.replace(REFERENCE_PRICE, ' ');
  const source = /\d/.test(stripped) ? stripped : text;
  // "899,00" is a decimal comma, not a thousands separator; "1,299" / "1,299.00" are thousands.
  const normalised = !source.includes('.') ? source.replace(/(\d),(\d{2})(?!\d)/, '$1.$2') : source;
  const m = normalised.replace(/,/g, '').match(/(\d+(?:\.\d{1,2})?)/);
  const p = m ? parseFloat(m[1]) : NaN;
  return p > 0 && p < 50_000 ? { price: p, currency } : null;
}
