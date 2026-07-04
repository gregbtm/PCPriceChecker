/**
 * CeX (Computer Exchange) UK — https://uk.webuy.com
 * Uses the public wss2.cex.uk.webuy.io JSON API (no key required).
 * Returns sell price (what CEX sells to you), cash price (CEX buys from you),
 * and exchange price (trade-in value).
 */

export interface CexProduct {
  boxId: string;
  boxName: string;
  categoryName: string;
  categoryFriendlyName: string;
  sellPrice: number;
  cashPrice: number;
  exchangePrice: number;
  ecomQuantityOnHand: number;
  outOfStock: boolean;
  webSellAllowed: boolean;
  url: string;
}

export interface CexSearchResult {
  products: CexProduct[];
  total: number;
  query: string;
}

const BASE = 'https://wss2.cex.uk.webuy.io/v3';

function toProduct(box: any): CexProduct {
  const boxId = String(box.boxId ?? '');
  return {
    boxId,
    boxName: String(box.boxName ?? ''),
    categoryName: String(box.categoryName ?? ''),
    categoryFriendlyName: String(box.categoryFriendlyName ?? box.categoryName ?? ''),
    sellPrice: Number(box.sellPrice ?? 0),
    cashPrice: Number(box.cashPrice ?? 0),
    exchangePrice: Number(box.exchangePrice ?? 0),
    ecomQuantityOnHand: Number(box.ecomQuantityOnHand ?? 0),
    outOfStock: Boolean(box.outOfStock),
    webSellAllowed: Boolean(box.webSellAllowed),
    url: `https://uk.webuy.com/product-detail/?id=${encodeURIComponent(boxId)}`,
  };
}

export async function searchCex(
  query: string,
  inStockOnly = false,
  limit = 25,
): Promise<CexSearchResult> {
  const params = new URLSearchParams({
    q: query,
    sortBy: 'relevance',
    sortOrder: 'asc',
    firstRecord: '1',
    count: String(Math.min(limit, 50)),
  });
  if (inStockOnly) {
    params.set('inStock', '1');
    params.set('inStockOnline', '1');
  }

  const res = await fetch(`${BASE}/boxes?${params}`, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) throw new Error(`CEX search HTTP ${res.status}`);
  const data = await res.json() as any;
  const boxes: any[] = data?.response?.data?.boxes ?? [];
  const total: number = data?.response?.data?.totalRecords ?? boxes.length;

  return { products: boxes.map(toProduct), total, query };
}

export async function getCexProduct(boxId: string): Promise<CexProduct | null> {
  const res = await fetch(`${BASE}/boxes/${encodeURIComponent(boxId)}/detail`, {
    headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const data = await res.json() as any;
  const detail = data?.response?.data?.boxDetails?.[0];
  return detail ? toProduct(detail) : null;
}

export function formatCexProduct(p: CexProduct): string {
  const stock = p.outOfStock
    ? '❌ Out of stock online'
    : `✅ In stock online (${p.ecomQuantityOnHand} available)`;
  const canBuy = p.webSellAllowed ? '' : ' (web purchase disabled)';
  return [
    `**${p.boxName}**`,
    `Box ID: ${p.boxId}`,
    `Category: ${p.categoryFriendlyName || p.categoryName}`,
    ``,
    `Buy from CeX: £${p.sellPrice.toFixed(2)}${canBuy}`,
    `Exchange (trade-in): £${p.exchangePrice.toFixed(2)}`,
    `Sell to CeX (cash): £${p.cashPrice.toFixed(2)}`,
    ``,
    `${stock}`,
    `URL: ${p.url}`,
  ].join('\n');
}
