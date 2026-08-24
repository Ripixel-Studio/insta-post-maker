/**
 * Minimal browser-side wrapper around the Anthropic (Claude) Messages API.
 *
 * This app has no backend, so AI is strictly bring-your-own-key: the caller's
 * key is sent directly from the browser to Anthropic. That requires the
 * `anthropic-dangerous-direct-browser-access` header (Anthropic gates
 * browser-origin requests behind it). The key never touches a server of ours —
 * there are none. Storage of the key lives in `./storage.ts`; this module is
 * pure HTTP and holds no state, so it can be unit-tested with a mocked `fetch`.
 */

const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

/** Models offered in the settings UI. Kept small and current; the balanced
 * Sonnet is the default. Ids track Anthropic's public Messages API. */
export const AI_MODELS = [
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5 — balanced (default)' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8 — most capable' },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 — fastest' },
] as const;

export type AiModelId = (typeof AI_MODELS)[number]['id'];

export const DEFAULT_MODEL: AiModelId = 'claude-sonnet-5';

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ImageBlock {
  type: 'image';
  source: { type: 'base64'; media_type: string; data: string };
}

export type ContentBlock = TextBlock | ImageBlock;

export interface ClaudeMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

export interface CompleteOptions {
  model?: AiModelId;
  /** Hard cap on the response length. Required by the API; defaults sensibly. */
  maxTokens?: number;
  system?: string;
  temperature?: number;
  signal?: AbortSignal;
}

/** Thrown for any non-2xx response (or a network failure). `message` is safe to
 * surface to the user; it never contains the API key. */
export class AiError extends Error {
  status?: number;
  /** Anthropic error `type`, e.g. `authentication_error`, when available. */
  apiType?: string;
  constructor(message: string, opts: { status?: number; apiType?: string } = {}) {
    super(message);
    this.name = 'AiError';
    this.status = opts.status;
    this.apiType = opts.apiType;
  }
}

/** Cheap client-side sanity check — not authentication. Anthropic keys are
 * prefixed `sk-ant-`; we only use this to catch obvious paste mistakes. */
export function looksLikeApiKey(key: string): boolean {
  return /^sk-ant-\S{8,}$/.test(key.trim());
}

/** Build the request without sending it. Exported so tests can assert the
 * headers/body without a network round-trip. */
export function buildRequest(
  apiKey: string,
  messages: ClaudeMessage[],
  opts: CompleteOptions = {},
): { url: string; init: RequestInit } {
  const body = {
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? 1024,
    messages,
    ...(opts.system ? { system: opts.system } : {}),
    ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
  };
  return {
    url: ENDPOINT,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey.trim(),
        'anthropic-version': ANTHROPIC_VERSION,
        // Required for calling the API straight from a browser origin.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify(body),
      signal: opts.signal,
    },
  };
}

/** Map an Anthropic error payload / HTTP status to a friendly message. */
function describeError(status: number, payload: unknown): string {
  const apiMessage =
    payload && typeof payload === 'object' && 'error' in payload
      ? (payload as { error?: { message?: string } }).error?.message
      : undefined;
  if (status === 401 || status === 403) {
    return 'That API key was rejected. Check it was copied in full and is still active.';
  }
  if (status === 429) {
    return 'Rate limit or quota reached on your Anthropic account. Try again shortly.';
  }
  if (status >= 500) {
    return 'Anthropic had a server error. Try again in a moment.';
  }
  return apiMessage || `Request failed (HTTP ${status}).`;
}

/**
 * Send a conversation to Claude and return the concatenated text of the reply.
 * Throws {@link AiError} on any failure.
 */
export async function complete(
  apiKey: string,
  messages: ClaudeMessage[],
  opts: CompleteOptions = {},
): Promise<string> {
  if (!apiKey.trim()) throw new AiError('No API key set.');
  const { url, init } = buildRequest(apiKey, messages, opts);

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new AiError('Request cancelled.');
    }
    throw new AiError('Could not reach Anthropic. Check your connection.');
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    payload = undefined;
  }

  if (!res.ok) {
    const apiType =
      payload && typeof payload === 'object' && 'error' in payload
        ? (payload as { error?: { type?: string } }).error?.type
        : undefined;
    throw new AiError(describeError(res.status, payload), { status: res.status, apiType });
  }

  const content = (payload as { content?: ContentBlock[] })?.content ?? [];
  return content
    .filter((b): b is TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
}

/**
 * Verify a key works by making the smallest possible request. Returns a plain
 * result object (never throws) so callers can render inline status.
 */
export async function validateKey(apiKey: string): Promise<{ ok: boolean; error?: string }> {
  const key = apiKey.trim();
  if (!key) return { ok: false, error: 'Enter a key first.' };
  if (!looksLikeApiKey(key)) {
    return { ok: false, error: 'That does not look like an Anthropic key (they start with "sk-ant-").' };
  }
  try {
    await complete(key, [{ role: 'user', content: 'ping' }], { maxTokens: 1 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof AiError ? err.message : 'Verification failed.' };
  }
}
