/**
 * OpenAI API client — alternative AI provider for:
 *   - Price extraction from raw page text (url-scraper fallback)
 *   - CSS selector self-healing when scrape rules fail
 *   - AI bootstrap: auto-generate selectors from a URL
 *
 * Requires OPENAI_API_KEY in env or stored in DB config.
 * Falls back gracefully if not configured.
 */

/**
 * Local LLM option (P2-4): OPENAI_BASE_URL points this at any OpenAI-compatible server, for example Ollama at
 * `http://host:11434/v1`, and OPENAI_MODEL names the model there (default `gpt-4o-mini`). A server on a custom base URL
 * needs no key. With neither a key nor a base URL, nothing is called (the default, off).
 */
const DEFAULT_BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';

export function openaiBase(): string {
  return (process.env.OPENAI_BASE_URL?.trim() || DEFAULT_BASE).replace(/\/+$/, '');
}
export function openaiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
}
export function llmConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY || !!process.env.OPENAI_BASE_URL?.trim();
}

function getApiKey(): string | null {
  return process.env.OPENAI_API_KEY ?? null;
}

async function chatComplete(_model: string, messages: { role: string; content: string }[], maxTokens = 300): Promise<string | null> {
  if (!llmConfigured()) return null;
  const apiKey = getApiKey();
  try {
    const res = await fetch(`${openaiBase()}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model: openaiModel(), messages, max_tokens: maxTokens, temperature: 0 }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = await res.json() as any;
    return data?.choices?.[0]?.message?.content ?? null;
  } catch { return null; }
}

export interface OpenAiExtracted {
  name?: string; price: number; currency: string; inStock: boolean | null;
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
    if (p?.price) return { name: p.name, price: Number(p.price), currency: p.currency ?? 'GBP', inStock: typeof p.inStock === 'boolean' ? p.inStock : null };
  } catch { /* ignore */ }
  return null;
}

export interface OpenAiSelectors {
  price_selector: string | null;
  name_selector: string | null;
  avail_selector: string | null;
  price_regex: string | null;
  price_attribute?: string | null;
}

export async function openaiHealSelectors(domain: string, pageText: string): Promise<OpenAiSelectors | null> {
  const raw = await chatComplete(
    'gpt-4o-mini',
    [{
      role: 'user',
      content: `Given this retail page HTML text for domain "${domain}", propose CSS selectors for extracting product data. Reply ONLY with JSON: {"price_selector":".price","name_selector":"h1","avail_selector":".stock","price_attribute":null,"price_regex":null}. price_attribute is an attribute to read instead of the text, e.g. data-price-amount. Use null for any you can't determine.\n\n${pageText.slice(0, 4000)}`,
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
