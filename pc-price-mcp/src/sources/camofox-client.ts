/**
 * Optional camofox-browser REST client (github.com/jo-inc/camofox-browser).
 * Used as a Cloudflare-bypass step after vanilla Playwright fails.
 * Camofox patches Firefox at the C++ level — undetectable by JS-based bot checks.
 *
 * Run the server: npx @askjo/camofox-browser  (port 9377)
 * Configure via Settings → Scraper → Camofox Server URL.
 */

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function extractPrice(text: string): number | null {
  const m = text.replace(/,/g, '').match(/£\s*([\d]+(?:\.\d{1,2})?)/);
  const p = m ? parseFloat(m[1]) : NaN;
  return p > 0 && p < 50_000 ? p : null;
}

export async function scrapeWithCamofox(
  url: string,
  baseUrl: string,
): Promise<{ name?: string; price: number | null; currency: string; inStock: boolean } | null> {
  const base = baseUrl.replace(/\/$/, '');
  try {
    // 1. Open a new tab
    const tabRes = await fetch(`${base}/tabs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'pc-price-mcp', sessionKey: 'scrape', url }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tabRes.ok) return null;
    const tab = await tabRes.json() as { id: string };
    if (!tab?.id) return null;

    // 2. Wait for the page to render (Cloudflare challenge + JS execution)
    await sleep(4_000);

    // 3. Fetch the accessibility snapshot — text representation of the rendered DOM
    const snapRes = await fetch(`${base}/tabs/${tab.id}/snapshot`, {
      signal: AbortSignal.timeout(10_000),
    });

    let snapText = '';
    if (snapRes.ok) {
      const snapData = await snapRes.json().catch(() => null) as any;
      snapText = typeof snapData === 'string' ? snapData
        : (snapData?.snapshot ?? snapData?.content ?? snapData?.text ?? JSON.stringify(snapData ?? ''));
    }

    // 4. Fall back to raw HTML content endpoint if snapshot is empty
    if (!snapText) {
      const htmlRes = await fetch(`${base}/tabs/${tab.id}/content`, {
        signal: AbortSignal.timeout(8_000),
      });
      if (htmlRes.ok) snapText = await htmlRes.text();
    }

    // 5. Close tab (best-effort)
    fetch(`${base}/tabs/${tab.id}`, { method: 'DELETE' }).catch(() => {});

    if (!snapText) return null;

    const price = extractPrice(snapText);
    if (!price) return null;

    const nameMatch = snapText.match(/\[heading\]\s*([^\n\[]{5,200})/i)
      ?? snapText.match(/<h1[^>]*>([^<]{5,200})<\/h1>/i);
    const name = nameMatch?.[1]?.replace(/<[^>]+>/g, '').trim();
    const inStock = !/out.?of.?stock/i.test(snapText) && /(add to|in stock|basket|buy now)/i.test(snapText);

    return { name, price, currency: 'GBP', inStock };
  } catch {
    return null;
  }
}
