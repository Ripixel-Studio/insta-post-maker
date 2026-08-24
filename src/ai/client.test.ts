import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AiError,
  buildRequest,
  complete,
  createMessage,
  replyText,
  looksLikeApiKey,
  validateKey,
  DEFAULT_MODEL,
  type AnthropicTool,
} from './client';

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('looksLikeApiKey', () => {
  it('accepts a well-formed Anthropic key', () => {
    expect(looksLikeApiKey('sk-ant-api03-abcdefgh')).toBe(true);
    expect(looksLikeApiKey('  sk-ant-api03-abcdefgh  ')).toBe(true);
  });
  it('rejects obvious non-keys', () => {
    expect(looksLikeApiKey('')).toBe(false);
    expect(looksLikeApiKey('hello')).toBe(false);
    expect(looksLikeApiKey('sk-ant-')).toBe(false);
    expect(looksLikeApiKey('sk-openai-123456789')).toBe(false);
  });
});

describe('buildRequest', () => {
  it('sets the browser-access + auth headers and a JSON body', () => {
    const { url, init } = buildRequest('sk-ant-secret', [{ role: 'user', content: 'hi' }]);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('sk-ant-secret');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe(DEFAULT_MODEL);
    expect(body.max_tokens).toBe(1024);
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    // Optional fields omitted when not provided.
    expect(body.system).toBeUndefined();
    expect(body.temperature).toBeUndefined();
  });

  it('includes tools and tool_choice only when provided', () => {
    const tools: AnthropicTool[] = [
      { name: 'add_text', description: 'add text', input_schema: { type: 'object', properties: {} } },
    ];
    const { init } = buildRequest('sk-ant-x', [{ role: 'user', content: 'hi' }], {
      tools,
      toolChoice: { type: 'auto' },
    });
    const body = JSON.parse(init.body as string);
    expect(body.tools).toEqual(tools);
    expect(body.tool_choice).toEqual({ type: 'auto' });
  });

  it('passes through model / system / temperature / maxTokens overrides', () => {
    const { init } = buildRequest('sk-ant-x', [{ role: 'user', content: 'hi' }], {
      model: 'claude-opus-4-8',
      system: 'be terse',
      temperature: 0.2,
      maxTokens: 16,
    });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: 'claude-opus-4-8',
      system: 'be terse',
      temperature: 0.2,
      max_tokens: 16,
    });
  });
});

describe('complete', () => {
  it('joins the text blocks of a successful reply', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world' }] }),
      ),
    );
    await expect(complete('sk-ant-x', [{ role: 'user', content: 'hi' }])).resolves.toBe('Hello world');
  });

  it('maps a 401 to a friendly, key-free message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { type: 'authentication_error', message: 'invalid x-api-key' } }, { status: 401 }),
      ),
    );
    const err = await complete('sk-ant-bad', [{ role: 'user', content: 'hi' }]).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.status).toBe(401);
    expect(err.apiType).toBe('authentication_error');
    expect(err.message).toMatch(/rejected/i);
    expect(err.message).not.toContain('sk-ant-bad');
  });

  it('surfaces a network failure without leaking internals', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const err = await complete('sk-ant-x', [{ role: 'user', content: 'hi' }]).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.message).toMatch(/could not reach anthropic/i);
  });

  it('rejects an empty key before touching the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(complete('   ', [{ role: 'user', content: 'hi' }])).rejects.toBeInstanceOf(AiError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('createMessage', () => {
  it('returns the raw content blocks and stop reason of a tool-use reply', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          content: [
            { type: 'text', text: 'Adding a title.' },
            { type: 'tool_use', id: 'tu_1', name: 'add_text', input: { text: 'Hi' } },
          ],
          stop_reason: 'tool_use',
        }),
      ),
    );
    const res = await createMessage('sk-ant-x', [{ role: 'user', content: 'go' }]);
    expect(res.stopReason).toBe('tool_use');
    expect(res.content).toHaveLength(2);
    expect(res.content[1]).toMatchObject({ type: 'tool_use', name: 'add_text' });
    expect(replyText(res.content)).toBe('Adding a title.');
  });

  it('maps an API error to AiError just like complete', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: { type: 'authentication_error' } }, { status: 401 })),
    );
    const err = await createMessage('sk-ant-bad', [{ role: 'user', content: 'hi' }]).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.status).toBe(401);
  });
});

describe('validateKey', () => {
  it('fails a malformed key without a network call', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const result = await validateKey('nope');
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns ok for a working key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: 'ok' }] })),
    );
    await expect(validateKey('sk-ant-api03-abcdefgh')).resolves.toEqual({ ok: true });
  });

  it('returns the mapped error for a rejected key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ error: { type: 'authentication_error' } }, { status: 401 })),
    );
    const result = await validateKey('sk-ant-api03-abcdefgh');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/rejected/i);
  });
});
