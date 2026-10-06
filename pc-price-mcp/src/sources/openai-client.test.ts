import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { openaiExtractPrice, llmConfigured, openaiBase, openaiModel } from './openai-client.js';

const KEYS = ['OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL'];
beforeEach(() => { for (const k of KEYS) delete process.env[k]; });
afterEach(() => { vi.unstubAllGlobals(); for (const k of KEYS) delete process.env[k]; });

const ok = (content: string) => vi.fn(async () => ({ ok: true, json: async () => ({ choices: [{ message: { content } }] }) }));

describe('P2-4 local LLM option', () => {
  it('is off with no key and no base URL, and calls nothing', async () => {
    const f = ok('{}'); vi.stubGlobal('fetch', f);
    expect(llmConfigured()).toBe(false);
    expect(await openaiExtractPrice('£10')).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it('defaults to OpenAI and gpt-4o-mini with a Bearer key', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    const f = ok('{"name":"x","price":492,"currency":"GBP","inStock":true}'); vi.stubGlobal('fetch', f);
    expect((await openaiExtractPrice('page'))?.price).toBe(492);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body as string).model).toBe('gpt-4o-mini');
  });
  it('an Ollama base URL needs no key, uses the named model, and sends no Authorization header', async () => {
    process.env.OPENAI_BASE_URL = 'http://nas:11434/v1/'; process.env.OPENAI_MODEL = 'llama3.1:8b';
    const f = ok('{"price":500,"currency":"GBP","inStock":false}'); vi.stubGlobal('fetch', f);
    expect(llmConfigured()).toBe(true);
    expect(openaiBase()).toBe('http://nas:11434/v1');
    expect(openaiModel()).toBe('llama3.1:8b');
    const r = await openaiExtractPrice('page');
    expect(r).toMatchObject({ price: 500, inStock: false });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://nas:11434/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(init.body as string).model).toBe('llama3.1:8b');
  });
});
