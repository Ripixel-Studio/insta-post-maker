import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiError } from './client';
import {
  STYLE_PROFILE_VERSION,
  STYLE_SYSTEM_PROMPT,
  buildStyleMessages,
  parseStyleProfile,
  reviveStyleProfile,
  styleProfileToPromptText,
  distillStyleProfile,
  type StyleImage,
  type StyleProfile,
} from './styleProfile';

function jsonResponse(body: unknown, init: { status?: number } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json' },
  });
}

const IMG: StyleImage = { media_type: 'image/jpeg', data: 'AAAA' };

const RAW = JSON.stringify({
  summary: 'Warm, minimal lifestyle posts.',
  palette: ['#f5e0c3', '#2b2b2b', 'not-a-color-but-kept-as-string'],
  typography: 'Bold condensed sans, all-caps headers.',
  composition: 'Centred subject, generous negative space.',
  mood: ['calm', 'premium'],
  motifs: ['thin rules', 'circular photo crops'],
  captionVoice: 'Short, confident, one emoji max.',
  recommendations: ['Keep text top-left', 'Use the cream background'],
});

function sample(): StyleProfile {
  return parseStyleProfile(RAW, { sampleCount: 3, createdAt: 111 });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildStyleMessages', () => {
  it('wraps each image in a base64 block after an intro line', () => {
    const msgs = buildStyleMessages([IMG, IMG]);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
    const content = msgs[0].content as unknown as Array<Record<string, unknown>>;
    expect(content[0]).toEqual({ type: 'text', text: expect.stringContaining('2 finished example posts') });
    expect(content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA' },
    });
    expect(content).toHaveLength(3); // intro + 2 images
  });

  it('uses the singular intro for one post', () => {
    const content = buildStyleMessages([IMG])[0].content as Array<{ text?: string }>;
    expect(content[0].text).toContain('1 finished example post');
  });
});

describe('parseStyleProfile', () => {
  it('parses a clean JSON reply and stamps version/meta', () => {
    const p = sample();
    expect(p.version).toBe(STYLE_PROFILE_VERSION);
    expect(p.sampleCount).toBe(3);
    expect(p.createdAt).toBe(111);
    expect(p.summary).toBe('Warm, minimal lifestyle posts.');
    expect(p.mood).toEqual(['calm', 'premium']);
    expect(p.recommendations).toHaveLength(2);
  });

  it('recovers JSON wrapped in markdown fences and stray prose', () => {
    const fenced = 'Sure! Here you go:\n```json\n' + RAW + '\n```\nHope that helps.';
    const p = parseStyleProfile(fenced, { sampleCount: 1, createdAt: 0 });
    expect(p.summary).toBe('Warm, minimal lifestyle posts.');
  });

  it('clamps arrays to six and drops non-strings', () => {
    const raw = JSON.stringify({
      summary: 'x',
      mood: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 42],
    });
    const p = parseStyleProfile(raw, { sampleCount: 1, createdAt: 0 });
    expect(p.mood).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(p.palette).toEqual([]); // missing → empty, not undefined
    expect(p.typography).toBe('');
  });

  it('rejects a reply with no summary', () => {
    expect(() => parseStyleProfile(JSON.stringify({ mood: ['x'] }), { sampleCount: 1, createdAt: 0 })).toThrow(
      AiError,
    );
  });

  it('rejects a non-JSON reply', () => {
    expect(() => parseStyleProfile('I could not analyse those.', { sampleCount: 1, createdAt: 0 })).toThrow(AiError);
  });
});

describe('reviveStyleProfile', () => {
  it('round-trips a stored profile', () => {
    const stored = JSON.stringify(sample());
    expect(reviveStyleProfile(stored)).toEqual(sample());
  });

  it('drops an incompatible version', () => {
    const stored = JSON.stringify({ ...sample(), version: 999 });
    expect(reviveStyleProfile(stored)).toBeNull();
  });

  it('drops malformed JSON', () => {
    expect(reviveStyleProfile('{not json')).toBeNull();
  });
});

describe('styleProfileToPromptText', () => {
  it('renders a compact, on-brand prompt fragment', () => {
    const text = styleProfileToPromptText(sample());
    expect(text).toContain('Warm, minimal lifestyle posts.');
    expect(text).toContain('#f5e0c3');
    expect(text).toContain('Caption voice:');
    expect(text.split('\n').length).toBeGreaterThan(3);
  });

  it('omits empty sections', () => {
    const bare = parseStyleProfile(JSON.stringify({ summary: 'just this' }), { sampleCount: 1, createdAt: 0 });
    const text = styleProfileToPromptText(bare);
    expect(text).toContain('just this');
    expect(text).not.toContain('Palette:');
    expect(text).not.toContain('Mood:');
  });
});

describe('distillStyleProfile', () => {
  it('sends the vision request and returns a parsed profile', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: RAW }] }));
    vi.stubGlobal('fetch', fetchSpy);

    const profile = await distillStyleProfile('sk-ant-x', [IMG, IMG], { now: 555 });
    expect(profile.summary).toBe('Warm, minimal lifestyle posts.');
    expect(profile.sampleCount).toBe(2);
    expect(profile.createdAt).toBe(555);

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.system).toBe(STYLE_SYSTEM_PROMPT);
    expect(body.messages[0].content).toHaveLength(3); // intro + 2 images
  });

  it('caps the number of posts sent to the model', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ content: [{ type: 'text', text: RAW }] }));
    vi.stubGlobal('fetch', fetchSpy);

    const many = Array.from({ length: 20 }, () => IMG);
    const profile = await distillStyleProfile('sk-ant-x', many, { now: 1 });
    expect(profile.sampleCount).toBe(8);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages[0].content).toHaveLength(9); // intro + 8 images
  });

  it('rejects an empty post list before touching the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(distillStyleProfile('sk-ant-x', [], {})).rejects.toBeInstanceOf(AiError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
