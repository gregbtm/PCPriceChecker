/**
 * PCPartPicker UK list importer.
 * Scrapes a shared PCPartPicker list URL to extract component names and create a build.
 * PCPartPicker ToS prohibits automated scraping — use for personal/reference purposes only.
 * URL format: https://uk.pcpartpicker.com/list/XXXXXX
 */

export interface PCPartPickerItem {
  category: string;
  name: string;
  price: number | null;
  quantity: number;
  partUrl: string | null;
}

export interface PCPartPickerList {
  title: string;
  items: PCPartPickerItem[];
  totalPrice: number | null;
  sourceUrl: string;
  scrapedAt: string;
  warning: string;
}

// Map PCPartPicker UI category names → our internal category strings
const CATEGORY_MAP: Record<string, string> = {
  'cpu': 'cpu', 'cpu cooler': 'cooling', 'motherboard': 'motherboard',
  'memory': 'ram', 'storage': 'storage', 'video card': 'gpu',
  'case': 'case', 'power supply': 'psu', 'operating system': 'other',
  'monitor': 'monitor', 'keyboard': 'other', 'mouse': 'other',
  'headphones': 'other', 'speakers': 'other', 'thermal compound': 'cooling',
  'case fan': 'cooling', 'fan controller': 'other', 'wireless network adapter': 'other',
  'sound card': 'other', 'ups system': 'other', 'external storage': 'storage',
};

export async function importPCPartPickerList(rawUrl: string): Promise<PCPartPickerList> {
  // Normalise to UK domain and ensure it's a list URL
  const url = rawUrl
    .replace('pcpartpicker.com', 'uk.pcpartpicker.com')
    .replace(/^http:/, 'https:');

  if (!url.includes('pcpartpicker.com')) {
    throw new Error('URL must be a pcpartpicker.com list URL');
  }

  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-GB,en;q=0.9',
    },
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) throw new Error(`PCPartPicker returned HTTP ${res.status}`);
  const html = await res.text();

  // ── Title ────────────────────────────────────────────────────────────────
  const titleMatch = html.match(/<title>([^<]+)<\/title>/);
  const title = (titleMatch?.[1] ?? 'Imported Build')
    .replace(/\s*[-|]?\s*PCPartPicker.*$/i, '').trim() || 'Imported Build';

  // ── Component rows ────────────────────────────────────────────────────────
  const items: PCPartPickerItem[] = [];

  // PCPartPicker renders build tables as <tr class="tr__product">
  for (const [, row] of html.matchAll(/<tr[^>]*class="[^"]*tr__product[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi)) {
    // Category cell
    const catCell = row.match(/class="[^"]*td__component[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const rawCat = catCell ? catCell[1].replace(/<[^>]+>/g, '').trim().toLowerCase() : '';
    const category = CATEGORY_MAP[rawCat] ?? 'other';

    // Product name — look for the "chosen" or "name" cell
    const nameCell = row.match(/class="[^"]*td__name[^"]*"[^>]*>([\s\S]*?)<\/td>/i)
      ?? row.match(/class="[^"]*chosen-name[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|td)>/i);
    const name = nameCell
      ? nameCell[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
      : '';
    if (name.length < 2) continue;

    // Price
    const priceCell = row.match(/class="[^"]*td__price[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    let price: number | null = null;
    if (priceCell) {
      const pm = priceCell[1].match(/£\s*([\d,]+\.?\d*)/);
      if (pm) price = parseFloat(pm[1].replace(/,/g, ''));
    }

    // Quantity
    const qtyCell = row.match(/class="[^"]*td__quanity[^"]*"[^>]*>([\s\S]*?)<\/td>/i)
      ?? row.match(/class="[^"]*quantity[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    const qty = qtyCell ? parseInt(qtyCell[1].replace(/<[^>]+>/g, '').trim()) || 1 : 1;

    // Part URL (pcpartpicker product page)
    const linkMatch = row.match(/href="(https:\/\/uk\.pcpartpicker\.com\/product\/[^"]+)"/i);

    items.push({ category, name, price, quantity: qty, partUrl: linkMatch?.[1] ?? null });
  }

  // ── Fallback: try JSON-LD ─────────────────────────────────────────────────
  if (items.length === 0) {
    const ldMatch = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    if (ldMatch) {
      try {
        const ld = JSON.parse(ldMatch[1]);
        if (Array.isArray(ld.itemListElement)) {
          for (const el of ld.itemListElement) {
            const name = el.name ?? el.item?.name ?? '';
            if (name.length > 2) {
              items.push({ category: 'other', name, price: null, quantity: 1, partUrl: el.url ?? null });
            }
          }
        }
      } catch { /* ignore */ }
    }
  }

  // ── Total price ───────────────────────────────────────────────────────────
  const totalMatch = html.match(/class="[^"]*td__total[^"]*"[^>]*>[\s\S]*?£\s*([\d,]+\.?\d*)/i)
    ?? html.match(/(?:estimated price|total)[^£]*£\s*([\d,]+\.?\d*)/i);
  const totalPrice = totalMatch ? parseFloat(totalMatch[1].replace(/,/g, '')) : null;

  return {
    title,
    items: items.filter(i => i.name.length > 1),
    totalPrice,
    sourceUrl: url,
    scrapedAt: new Date().toISOString(),
    warning: 'PCPartPicker prices may not match current UK retail — use refresh_prices after import to get live data.',
  };
}
