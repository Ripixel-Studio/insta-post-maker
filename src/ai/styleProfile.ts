/**
 * Style profile — distil a reusable, on-device description of a creator's
 * visual/editorial style from a handful of their finished example posts.
 *
 * The flow is: the user brings in a few images of posts they're happy with, we
 * run a single Claude-vision pass over them, and Claude returns a structured
 * JSON "style profile" (palette, typography, mood, caption voice, …). That
 * profile is stored locally (see `../store` + `../usePersistence`) and can be
 * injected into future AI prompts via {@link styleProfileToPromptText} so copy
 * and design suggestions come back on-brand.
 *
 * Nothing here holds state or touches the DOM except {@link encodePostImage}
 * (which needs a canvas). The prompt-building and parsing are pure so they can
 * be unit-tested with a mocked `fetch`.
 */
import {
  complete,
  AiError,
  DEFAULT_MODEL,
  type AiModelId,
  type ClaudeMessage,
  type ImageBlock,
} from './client';
import { nowMs } from '../persistence';

/** Bumped if the shape below changes incompatibly; stored profiles that don't
 * match are dropped rather than mis-read. */
export const STYLE_PROFILE_VERSION = 1;

/** Guard rails on how much we send in one vision pass. A "post" is often a
 * carousel of several panels, so a handful of posts is easily 20-40 images;
 * each is downscaled to ~1024px (~1.4k tokens), so 40 stays comfortably
 * inside the context window and under the API's per-request image limit. */
export const MAX_SAMPLE_POSTS = 40;
export const MIN_SAMPLE_POSTS = 1;

/** A base64-encoded image ready to hand to the Messages API. */
export interface StyleImage {
  media_type: string;
  data: string;
}

/**
 * The distilled, reusable style profile. Every string is a short human-readable
 * blurb; arrays are small keyword/colour lists. Kept deliberately flat so it
 * both renders as a simple panel and serialises cleanly into a prompt.
 */
export interface StyleProfile {
  version: number;
  /** ms epoch when distilled (so the panel can show "captured from N posts"). */
  createdAt: number;
  /** How many example posts fed the pass. */
  sampleCount: number;
  /** One or two sentences naming the overall aesthetic. */
  summary: string;
  /** Dominant colours, most-used first, as `#rrggbb`. */
  palette: string[];
  /** Typography tendencies: fonts, weights, casing, sizing. */
  typography: string;
  /** Layout / composition tendencies: focal points, spacing, balance. */
  composition: string;
  /** Mood / tone adjectives (e.g. "energetic", "minimal"). */
  mood: string[];
  /** Recurring visual motifs or graphic devices. */
  motifs: string[];
  /** The voice a caption should take to match these posts. */
  captionVoice: string;
  /** Actionable do's for producing a new post in this style. */
  recommendations: string[];
  /** How text is used across the posts — what kinds appear (stats, labels,
   * titles, captions, none) and where; empty when unknown. This is what lets
   * the Copilot NOT write a caption over a photo the creator never would. */
  textUsage: string;
  /** Things these posts never do (e.g. "text over faces", "heavy filters"). */
  avoid: string[];
}

export const STYLE_SYSTEM_PROMPT = [
  'You are a brand-design analyst. You are shown a set of finished Instagram posts',
  'from a single creator or brand. Several images may be panels of one carousel',
  'post — treat consecutive images that clearly belong together as one post and',
  'note how panels relate (cover, body, closer). Study them together and distil',
  'the *reusable* style they share so future posts can be made to match.',
  '',
  'Respond with ONLY a single JSON object (no prose, no markdown fences) with',
  'exactly these keys:',
  '  "summary": string        — 1-2 sentences naming the overall aesthetic',
  '  "palette": string[]      — up to 6 dominant colours as #rrggbb hex, most used first',
  '  "typography": string     — fonts, weights, casing and sizing tendencies',
  '  "composition": string    — layout, focal points, spacing and balance tendencies',
  '  "mood": string[]         — up to 6 mood/tone adjectives',
  '  "motifs": string[]       — up to 6 recurring visual motifs or graphic devices',
  '  "captionVoice": string   — the voice/tone a caption should take to match',
  '  "recommendations": string[] — up to 6 short, actionable do\'s for a new on-style post',
  '  "textUsage": string     — precisely what text appears and where (e.g. "only stat numbers',
  '                             with small uppercase labels, bottom third; no titles or captions',
  '                             on photos"), or "no text" if none',
  '  "avoid": string[]        — up to 6 things these posts never do (e.g. "heavy filters",',
  '                             "text over faces", "more than one font")',
  '',
  'Describe only what the posts actually show. Be literal about text: if the posts carry',
  'no captions or titles, say so — do not assume text belongs. Keep every string concise.',
].join('\n');

/** Build the single user message carrying the example images + instruction. */
export function buildStyleMessages(images: StyleImage[]): ClaudeMessage[] {
  const imageBlocks: ImageBlock[] = images.map((img) => ({
    type: 'image',
    source: { type: 'base64', media_type: img.media_type, data: img.data },
  }));
  const intro =
    images.length === 1
      ? 'Here is 1 finished example post. Distil its style profile.'
      : `Here are ${images.length} images from finished example posts (some may be panels of one carousel, in order). Distil the style profile they share.`;
  return [
    {
      role: 'user',
      content: [{ type: 'text', text: intro }, ...imageBlocks],
    },
  ];
}

/** Pull a JSON object out of a model reply that may or may not be fenced or
 * wrapped in stray prose. Returns the parsed value or throws {@link AiError}. */
function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through to brace-slice */
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      /* fall through */
    }
  }
  throw new AiError("Claude's reply wasn't valid style-profile JSON. Try again.");
}

function asStringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, max);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Validate and normalise a raw model reply into a {@link StyleProfile}. Lenient
 * on missing/oversized arrays (clamped/defaulted) but requires at least a
 * usable summary, so an empty or off-topic reply is rejected rather than stored.
 */
export function parseStyleProfile(
  raw: string,
  meta: { sampleCount: number; createdAt: number },
): StyleProfile {
  const obj = extractJson(raw);
  if (!obj || typeof obj !== 'object') {
    throw new AiError("Claude's reply wasn't valid style-profile JSON. Try again.");
  }
  const r = obj as Record<string, unknown>;
  const summary = asString(r.summary);
  if (!summary) {
    throw new AiError('Claude did not return a usable style summary. Try again with clearer posts.');
  }
  return {
    version: STYLE_PROFILE_VERSION,
    createdAt: meta.createdAt,
    sampleCount: meta.sampleCount,
    summary,
    palette: asStringList(r.palette, 6),
    typography: asString(r.typography),
    composition: asString(r.composition),
    mood: asStringList(r.mood, 6),
    motifs: asStringList(r.motifs, 6),
    captionVoice: asString(r.captionVoice),
    recommendations: asStringList(r.recommendations, 6),
    textUsage: asString(r.textUsage),
    avoid: asStringList(r.avoid, 6),
  };
}

export interface DistillOptions {
  model?: AiModelId;
  signal?: AbortSignal;
  /** Injectable clock for tests; defaults to the on-device wall clock. */
  now?: number;
}

/**
 * Run the vision pass end-to-end: send the example posts to Claude and return a
 * validated {@link StyleProfile}. Throws {@link AiError} on any failure.
 */
export async function distillStyleProfile(
  apiKey: string,
  images: StyleImage[],
  opts: DistillOptions = {},
): Promise<StyleProfile> {
  if (images.length < MIN_SAMPLE_POSTS) {
    throw new AiError('Add at least one example post to distil a style profile.');
  }
  const sample = images.slice(0, MAX_SAMPLE_POSTS);
  const raw = await complete(apiKey, buildStyleMessages(sample), {
    model: opts.model ?? DEFAULT_MODEL,
    system: STYLE_SYSTEM_PROMPT,
    maxTokens: 1500,
    signal: opts.signal,
  });
  return parseStyleProfile(raw, { sampleCount: sample.length, createdAt: opts.now ?? nowMs() });
}

/**
 * Render a stored profile as a compact prompt fragment other AI features can
 * prepend to their own system/user text so suggestions stay on-brand. This is
 * what makes the profile "reusable" beyond the panel that shows it.
 */
export function styleProfileToPromptText(profile: StyleProfile): string {
  const lines: string[] = ['The user has an established post style. Match it:'];
  if (profile.summary) lines.push(`- Aesthetic: ${profile.summary}`);
  if (profile.palette.length) lines.push(`- Palette: ${profile.palette.join(', ')}`);
  if (profile.typography) lines.push(`- Typography: ${profile.typography}`);
  if (profile.composition) lines.push(`- Composition: ${profile.composition}`);
  if (profile.mood.length) lines.push(`- Mood: ${profile.mood.join(', ')}`);
  if (profile.motifs.length) lines.push(`- Motifs: ${profile.motifs.join(', ')}`);
  if (profile.captionVoice) lines.push(`- Caption voice: ${profile.captionVoice}`);
  if (profile.recommendations.length) {
    lines.push(`- Do: ${profile.recommendations.join('; ')}`);
  }
  if (profile.textUsage) lines.push(`- Text usage (binding): ${profile.textUsage}`);
  if (profile.avoid.length) lines.push(`- Never: ${profile.avoid.join('; ')}`);
  return lines.join('\n');
}

/** Revive a persisted profile, discarding anything from an incompatible
 * version or shape. Returns null when there's nothing usable to restore. */
export function reviveStyleProfile(json: string): StyleProfile | null {
  try {
    const obj = JSON.parse(json) as Partial<StyleProfile>;
    if (!obj || obj.version !== STYLE_PROFILE_VERSION || typeof obj.summary !== 'string') {
      return null;
    }
    return {
      version: STYLE_PROFILE_VERSION,
      createdAt: typeof obj.createdAt === 'number' ? obj.createdAt : 0,
      sampleCount: typeof obj.sampleCount === 'number' ? obj.sampleCount : 0,
      summary: obj.summary,
      palette: asStringList(obj.palette, 6),
      typography: asString(obj.typography),
      composition: asString(obj.composition),
      mood: asStringList(obj.mood, 6),
      motifs: asStringList(obj.motifs, 6),
      captionVoice: asString(obj.captionVoice),
      recommendations: asStringList(obj.recommendations, 6),
      textUsage: asString(obj.textUsage),
      avoid: asStringList(obj.avoid, 6),
    };
  } catch {
    return null;
  }
}

/** Largest edge we send to the vision pass. Well under Anthropic's ~1568px
 * recommendation, keeping requests small while leaving style legible. */
const MAX_SAMPLE_EDGE = 1024;

function loadImageEl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new AiError('Could not read that image.'));
    img.src = url;
  });
}

/**
 * Downscale a picked image file and base64-encode it as JPEG for the vision
 * pass. DOM-dependent (needs a canvas), so it lives here but is exercised in the
 * browser rather than unit tests.
 */
export async function encodePostImage(file: Blob): Promise<StyleImage> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageEl(url);
    const longEdge = Math.max(img.naturalWidth, img.naturalHeight) || 1;
    const scale = Math.min(1, MAX_SAMPLE_EDGE / longEdge);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new AiError('Could not process that image.');
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { media_type: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1) };
  } finally {
    URL.revokeObjectURL(url);
  }
}
