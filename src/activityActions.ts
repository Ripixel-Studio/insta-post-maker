/**
 * Activity tools for the AI Copilot: the same overlays the Activities panel
 * offers (src/activities.ts), so the Copilot can build a post *about a
 * workout* end-to-end — find the activity, then lay its pre-drawn numbers,
 * route, splits or PB stamp over the user's photo as ordinary, editable image
 * layers.
 */

import { editorActions, type EditorTool } from './actions';
import { addImageAsset } from './assets';
import {
  cardSummary,
  fetchImage,
  findActivity,
  listActivities,
  overlayBox,
  overlayPieces,
  type ActivityCard,
  type Tone,
} from './activities';

export interface Box {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

async function blobToLayer(blob: Blob, name: string, box: Box): Promise<string> {
  const asset = await addImageAsset(new File([blob], `${name}.png`, { type: blob.type || 'image/png' }));
  return editorActions.addImage(asset.id, { ...box, name });
}

/** What the model gets back from a load: the pieces it can place, by id. */
export interface LoadedActivity {
  activityId: string;
  title: string;
  summary: string;
  pieces: { piece: string; label: string; layout: boolean; tones: Tone[] }[];
  hasCard: boolean;
}

function describe(card: ActivityCard): LoadedActivity {
  return {
    activityId: card.id,
    title: card.title,
    summary: cardSummary(card),
    pieces: overlayPieces(card).map((p) => ({ piece: p.piece, label: p.label, layout: p.layout, tones: Object.keys(p.tones) as Tone[] })),
    hasCard: !!card.image,
  };
}

export const activityActions = {
  /** Recent activities (and every race) that have overlays, newest first. */
  async list(limit = 15) {
    const cards = await listActivities();
    return cards.slice(0, Math.max(1, Math.min(limit, 50))).map((c) => ({ activityId: c.id, title: c.title, summary: cardSummary(c), date: c.date }));
  },

  /** One activity's placeable overlays. */
  async load(ref: string): Promise<LoadedActivity> {
    return describe(await findActivity(ref));
  },

  /** Place one overlay piece (or layout) in a tone. Returns the new layer id. */
  async addOverlay(ref: string, piece: string, tone: Tone = 'light', box: Box = {}): Promise<string> {
    const card = await findActivity(ref);
    const p = overlayPieces(card).find((x) => x.piece === piece);
    if (!p) {
      throw new Error(`No overlay "${piece}" on ${card.id}. Available: ${overlayPieces(card).map((x) => x.piece).join(', ')}.`);
    }
    const o = p.tones[tone] ?? p.tones.light ?? p.tones.dark;
    if (!o) throw new Error(`Overlay "${piece}" has no image.`);
    const { design } = editorActions.getState();
    const placed = { ...overlayBox({ ...o, layout: p.layout }, design.width, design.height), ...box };
    return blobToLayer(await fetchImage(o.url), `${card.title} · ${p.label}`, placed);
  },

  /** Place the activity's full Story share card (with its own background). */
  async addCard(ref: string, box: Box = {}): Promise<string> {
    const card = await findActivity(ref);
    if (!card.image) throw new Error(`${card.id} has no share card.`);
    const { design } = editorActions.getState();
    const placed = { ...overlayBox({ w: 1080, h: 1920, layout: true }, design.width, design.height), ...box };
    return blobToLayer(await fetchImage(card.image), `${card.title} · card`, placed);
  },
};

/* --------------------------------------------------------------------------
 * Tool registry (same shape as EDITOR_TOOLS)
 * ------------------------------------------------------------------------ */

const str = (description: string) => ({ type: 'string' as const, description });
const num = (description: string) => ({ type: 'number' as const, description });
const boxProps = {
  x: num('Left edge in canvas px.'),
  y: num('Top edge in canvas px.'),
  width: num('Width in canvas px.'),
  height: num('Height in canvas px.'),
};

export const ACTIVITY_TOOLS: EditorTool[] = [
  {
    name: 'activity_list',
    description:
      "List the user's recent activities (and every race) that have ready-made overlays, newest first, with ids and one-line summaries.",
    parameters: {
      type: 'object',
      properties: { limit: num('How many (default 15, max 50).') },
    },
    run: (a) => activityActions.list(a.limit as number | undefined),
  },
  {
    name: 'activity_load',
    description:
      'Load one activity (id from activity_list, its slug, or its james.ripixel.co.uk/life page URL) and return the overlays that can be placed: layouts (layout-story, layout-square: the whole stats card with a transparent background, to cover a full-bleed photo) and pieces (title, stats, badge = the PB / vs-PB stamp, route, splits, chart, sets, prs, hr, sports, calendar…), each in a light and/or dark tone.',
    parameters: {
      type: 'object',
      properties: { activity: str('Activity id, slug or page URL.') },
      required: ['activity'],
    },
    run: (a) => activityActions.load(a.activity as string),
  },
  {
    name: 'activity_add_overlay',
    description:
      'Place one transparent overlay on the active page as an image layer. Use tone "light" (white with a shadow) on most photos and "dark" (ink with a white halo) on bright ones. Layouts fill the canvas; pieces are centred at their natural size unless you pass a box. Returns the layer id; refine with place_image. These are real numbers drawn by the site: never redraw them as text.',
    parameters: {
      type: 'object',
      properties: {
        activity: str('Activity id, slug or page URL.'),
        piece: str('A piece id from activity_load, e.g. "layout-story", "stats", "route".'),
        tone: { type: 'string', description: 'light | dark (default light).', enum: ['light', 'dark'] },
        ...boxProps,
      },
      required: ['activity', 'piece'],
    },
    run: (a) => {
      const { activity, piece, tone, ...box } = a;
      return activityActions.addOverlay(activity as string, piece as string, (tone as Tone) ?? 'light', box as Box);
    },
  },
  {
    name: 'activity_add_card',
    description:
      "Place the activity's finished Story share card (its own photo or colour background, not transparent) on the active page. Returns the layer id.",
    parameters: {
      type: 'object',
      properties: { activity: str('Activity id, slug or page URL.'), ...boxProps },
      required: ['activity'],
    },
    run: (a) => {
      const { activity, ...box } = a;
      return activityActions.addCard(activity as string, box as Box);
    },
  },
];
