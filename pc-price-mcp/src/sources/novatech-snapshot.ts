/**
 * Novatech search results, read from a changedetection.io snapshot (the text of the page after a browser fetch).
 *
 * Novatech's search page is JavaScript-rendered, so a plain fetch finds no products (research rows 23-24), but a
 * changedetection.io `html_webdriver` watch on the search URL returns the rendered text (row 31). Each product
 * appears as: title, description, a stock line ("Only 5 left in stock £7.99 Next Day Delivery"), `Stock Code:`,
 * `Manf Code:`, then `£N inc vat`. The snapshot is text only, so there is no product link: callers use the search URL.
 */
import { parseStockText, type StockState } from '../services/stock-state.js';

export interface SnapshotListing { name: string; price: number; stockState: StockState; stockCode: string }

/**
 * Stock for one Novatech stock line. Only an explicit in-stock count counts as in stock. "Ordered Upon Request" and
 * "Dispatches within 1 - 3 Days" mean it is not on the shelf, so they stay unknown and can never alert.
 */
export function novatechStock(line: string): StockState {
  if (/dispatch(?:es)?\s+within|ordered\s+upon\s+request|special\s+order/i.test(line)) return /ordered/i.test(line) ? 'backorder' : 'unknown';
  if (/\bonly\s+\d+\s+left\s+in\s+stock\b|\b\d+\+?\s+in\s+stock\b|\bin\s+stock\b/i.test(line)) return 'in_stock';
  return parseStockText(line.replace(/£\s*[\d.,]+\s*next\s+day\s+delivery/i, ''));
}

export function parseNovatechSnapshot(text: string): SnapshotListing[] {
  const lines = text.split('\n').map(l => l.trim());
  const out: SnapshotListing[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    const m = /^Stock Code:\s*(\S+)/.exec(lines[i]);
    if (!m || seen.has(m[1])) continue;
    seen.add(m[1]);
    // Walk back over blank lines to the stock line, then description, then title.
    const back: string[] = [];
    for (let j = i - 1; j >= 0 && back.length < 3; j--) if (lines[j]) back.push(lines[j]);
    if (back.length < 3) continue;
    const [stockLine, , title] = back;
    let price: number | null = null;
    for (let j = i + 1; j < Math.min(lines.length, i + 8); j++) {
      const p = /^£\s*([\d,]+(?:\.\d+)?)\s+inc\s+vat/i.exec(lines[j]);
      if (p) { price = Number(p[1].replace(/,/g, '')); break; }
    }
    if (price == null || !(price > 0)) continue;
    out.push({ name: title, price, stockState: novatechStock(stockLine), stockCode: m[1] });
  }
  return out;
}
