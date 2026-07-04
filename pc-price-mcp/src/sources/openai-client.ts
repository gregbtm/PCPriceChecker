/**
 * OpenAI API client — alternative AI provider for:
 *   - Price extraction from raw page text (url-scraper fallback)
 *   - CSS selector self-healing when scrape rules fail
 *   - AI bootstrap: auto-generate selectors from a URL
 *
 * Requires OPENAI_API_KEY in env or stored in DB config.
 * Falls back gracefully if not configured.
 */

const OPENAI_API_BASE = 'https://api.openai.com/v1';

function getApiKey(): string | null {
  return process.env.OPENAI_API_KEY ?? null;
}

async function chatComplete(model: string, messages: { role: string; content: string }[], maxTokens = 300): Promise<string | null> {
  const apiKey = getApiKey();
  if (!apiKey) return null;
  try {
    const res = await fetch(`${OPENAI_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0 }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    return data?.choices?.[0]?.message?.content ?? null;
  } catch { return null; }
}

export interface OpenAiExtracted {
  name?: string; price: number; currency: string; inStock: boolean;
}

export async function openaiExtractPrice(pageText: string): Promise<OpenAiExtracted | null> {
  const raw = await chatComplete(
    'gpt-4o-mini',
    [{
      role: 'user',
      content: `Extract product info from this retail page text. Reply ONLY with JSON: {"name":"...","price":123.45,"currency":"GBP","inStock":true}. Return null if no price found.\n\n${pageText.slice(0, 5000)}`,
    }],
    200,
  );
  if (!raw) return null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const p = JSON.parse(m[0]);
    if (p?.price) return { name: p.name, price: Number(p.price), currency: p.currency ?? 'GBP', inStock: p.inStock !== false };
  } catch { /* ignore */ }
  return null;
}

export interface OpenAiSelectors {
  price_selector: string | null;
  name_selector: string | null;
  avail_selector: string | null;
  price_regex: string | null;
}

export async function openaiHealSelectors(domain: string, pageText: string): Promise<OpenAiSelectors | null> {
  const raw = await chatComplete(
    'gpt-4o-mini',
    [{
      role: 'user',
      content: `Given this retail page HTML text for domain "${domain}", propose CSS selectors for extracting product data. Reply ONLY with JSON: {"price_selector":".price","name_selector":"h1","avail_selector":".stock","price_regex":null}. Use null for any you can't determine.\n\n${pageText.slice(0, 4000)}`,
    }],
    300,
  );
  if (!raw) return null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const p = JSON.parse(m[0]);
    if (p?.price_selector) return p as OpenAiSelectors;
  } catch { /* ignore */ }
  return null;
}

export async function openaiBootstrapSelectors(domain: string, pageText: string): Promise<OpenAiSelectors | null> {
  const raw = await chatComplete(
    'gpt-4o-mini',
    [{
      role: 'user',
      content: `You are analysing a UK retail product page for domain "${domain}". Given the stripped page text below, identify CSS selector patterns for the price, product name, and stock availability. Return ONLY JSON: {"price_selector":".price","name_selector":"h1","avail_selector":".stock-status","price_regex":null}. Set any field to null if not determinable.\n\n${pageText.slice(0, 4000)}`,
    }],
    300,
  );
  if (!raw) return null;
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const p = JSON.parse(m[0]);
    if (p?.price_selector) return p as OpenAiSelectors;
  } catch { /* ignore */ }
  return null;
}

export function isOpenAiConfigured(): boolean {
  return !!getApiKey();
}
