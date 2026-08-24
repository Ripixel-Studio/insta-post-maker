/**
 * FitGlue tools for the AI Copilot.
 *
 * The manual "FitGlue import" panel lets a person paste an activity URL or a
 * @handle, then drop stats, charts, the route and photos onto the canvas. These
 * tools expose the same capability to the Copilot so it can build a post
 * *about a workout* end-to-end: find the activity, read its numbers, and place
 * stats/charts/route through the ordinary editor action layer — so everything
 * it adds is a normal, fully-editable layer.
 *
 * Same trust boundary as the panel: the only network calls are FitGlue's
 * public, unauthenticated showcase API (and the public photo URLs it lists).
 * No key, no account, nothing of the user's is sent anywhere.
 *
 * Loaded activities are cached in-memory by id for the life of the page so the
 * model can call `fitglue_load_activity` once and then reference stat/chart ids
 * from the reply without re-fetching.
 */

import { editorActions, type EditorTool } from './actions';
import { addImageAsset } from './assets';
import {
  entrySummary,
  extractElements,
  fetchProfile,
  fetchShowcase,
  parseInput,
  type ShowcaseElements,
} from './fitglue';
import { renderChart, renderRoute } from './fitglueRender';

/* --------------------------------------------------------------------------
 * Activity cache
 * ------------------------------------------------------------------------ */

const loaded = new Map<string, ShowcaseElements>();

/** Test/reset hook — forget every loaded activity. */
export function clearFitGlueCache(): void {
  loaded.clear();
}

function requireActivity(activityId: string): ShowcaseElements {
  const els = loaded.get(activityId);
  if (!els) {
    throw new Error(
      `No loaded FitGlue activity "${activityId}". Call fitglue_load_activity first` +
        (loaded.size ? ` (loaded: ${[...loaded.keys()].join(', ')}).` : '.'),
    );
  }
  return els;
}

/** What the model gets back from a load: everything it needs to pick elements
 * by id, without the raw series data (charts render on our side). */
export interface LoadedActivitySummary {
  activityId: string;
  title: string;
  subtitle: string;
  stats: { id: string; label: string; value: string }[];
  charts: { id: string; label: string }[];
  hasRoute: boolean;
  images: { id: string; label: string }[];
}

function summarise(activityId: string, els: ShowcaseElements): LoadedActivitySummary {
  return {
    activityId,
    title: els.title,
    subtitle: els.subtitle,
    stats: els.stats.map(({ id, label, value }) => ({ id, label, value })),
    charts: els.charts.map(({ id, label }) => ({ id, label })),
    hasRoute: !!els.route && els.route.length > 1,
    images: els.images.map(({ id, label }) => ({ id, label })),
  };
}

/* --------------------------------------------------------------------------
 * Operations (typed; the tool registry below wraps these)
 * ------------------------------------------------------------------------ */

export interface StatPlacement {
  x?: number;
  y?: number;
  width?: number;
  fontSize?: number;
  fill?: string;
  align?: 'left' | 'center' | 'right';
  fontFamily?: string;
}

export interface Box {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

async function blobToLayer(blob: Blob, name: string, box: Box): Promise<string> {
  const asset = await addImageAsset(new File([blob], name, { type: blob.type || 'image/png' }));
  return editorActions.addImage(asset.id, { ...box, name });
}

export const fitglueActions = {
  /** List a public handle's recent activities so the model can pick one. */
  async listActivities(handle: string) {
    const slug = handle.trim().replace(/^@/, '');
    if (!slug) throw new Error('A FitGlue handle is required, e.g. "@ripixel".');
    const entries = await fetchProfile(slug);
    return entries.map((e) => ({
      activityId: e.showcaseId,
      title: e.title,
      summary: entrySummary(e),
      startTime: e.startTime ?? null,
    }));
  },

  /** Fetch an activity showcase (by URL, id or slug) and cache its elements. */
  async loadActivity(idOrUrl: string): Promise<LoadedActivitySummary> {
    const parsed = parseInput(idOrUrl);
    if (!parsed) throw new Error(`"${idOrUrl}" is not a FitGlue activity URL or id.`);
    if (parsed.type === 'profile') {
      throw new Error(
        `"${idOrUrl}" is a profile handle — call fitglue_list_activities with it, then load one activity by id.`,
      );
    }
    const els = extractElements(await fetchShowcase(parsed.id));
    loaded.set(parsed.id, els);
    return summarise(parsed.id, els);
  },

  /** Add one stat's value as a text layer. Returns the layer id. */
  addStat(activityId: string, statId: string, opts: StatPlacement = {}): string {
    const els = requireActivity(activityId);
    const stat = els.stats.find((s) => s.id === statId);
    if (!stat) {
      throw new Error(
        `No stat "${statId}" on activity ${activityId}. Available: ${els.stats.map((s) => s.id).join(', ')}.`,
      );
    }
    const { design } = editorActions.getState();
    return editorActions.addText(stat.value, {
      name: stat.label,
      align: opts.align ?? 'center',
      fontSize: opts.fontSize ?? Math.round(design.width * 0.09),
      ...(opts.fill ? { fill: opts.fill } : {}),
      ...(opts.fontFamily ? { fontFamily: opts.fontFamily } : {}),
      ...(opts.x != null ? { x: opts.x } : {}),
      ...(opts.y != null ? { y: opts.y } : {}),
      ...(opts.width != null ? { width: opts.width } : {}),
    });
  },

  /**
   * Add a tidy value+label row for up to 4 stats (default: the first 3),
   * evenly spaced across the canvas near the bottom. Mirrors the manual
   * panel's "stats block". Returns the created layer ids.
   */
  addStatsBlock(
    activityId: string,
    opts: { statIds?: string[]; y?: number; fill?: string; labelFill?: string; fontFamily?: string } = {},
  ): string[] {
    const els = requireActivity(activityId);
    const picks = opts.statIds?.length
      ? opts.statIds.map((id) => {
          const s = els.stats.find((st) => st.id === id);
          if (!s) {
            throw new Error(
              `No stat "${id}" on activity ${activityId}. Available: ${els.stats.map((st) => st.id).join(', ')}.`,
            );
          }
          return s;
        })
      : els.stats.slice(0, 3);
    if (!picks.length) throw new Error(`Activity ${activityId} has no stats to place.`);
    if (picks.length > 4) throw new Error('A stats block holds at most 4 stats.');

    const { design } = editorActions.getState();
    const n = picks.length;
    const colW = design.width / n;
    const big = Math.round(design.width * 0.075);
    const small = Math.round(design.width * 0.03);
    const yVal = opts.y ?? Math.round(design.height * 0.8);
    const ids: string[] = [];
    picks.forEach((s, i) => {
      const x = i * colW;
      ids.push(
        editorActions.addText(s.value, {
          name: s.label,
          x,
          y: yVal,
          width: colW,
          align: 'center',
          fontSize: big,
          ...(opts.fill ? { fill: opts.fill } : {}),
          ...(opts.fontFamily ? { fontFamily: opts.fontFamily } : {}),
        }),
      );
      ids.push(
        editorActions.addText(s.label.toUpperCase(), {
          name: `${s.label} label`,
          x,
          y: yVal + big + 6,
          width: colW,
          align: 'center',
          fontSize: small,
          fill: opts.labelFill ?? '#cbd5e1',
          letterSpacing: 2,
          fontStyle: 'normal',
          ...(opts.fontFamily ? { fontFamily: opts.fontFamily } : {}),
        }),
      );
    });
    return ids;
  },

  /** Render one metric chart to an image and add it as an image layer. */
  async addChart(activityId: string, chartId: string, box: Box = {}): Promise<string> {
    const els = requireActivity(activityId);
    const chart = els.charts.find((c) => c.id === chartId);
    if (!chart) {
      throw new Error(
        `No chart "${chartId}" on activity ${activityId}. Available: ${els.charts.map((c) => c.id).join(', ') || 'none'}.`,
      );
    }
    const blob = await renderChart(chart.series, chart.color);
    return blobToLayer(blob, `${chart.label} chart`, box);
  },

  /** Render the GPS route trace to an image and add it as an image layer. */
  async addRoute(activityId: string, opts: Box & { color?: string } = {}): Promise<string> {
    const els = requireActivity(activityId);
    if (!els.route || els.route.length < 2) {
      throw new Error(`Activity ${activityId} has no GPS route.`);
    }
    const { color, ...box } = opts;
    const blob = await renderRoute(els.route, color ?? '#c084fc');
    return blobToLayer(blob, 'Route', box);
  },

  /** Bring one of the activity's photos in as an image layer. */
  async addPhoto(activityId: string, imageId: string, box: Box = {}): Promise<string> {
    const els = requireActivity(activityId);
    const img = els.images.find((i) => i.id === imageId);
    if (!img) {
      throw new Error(
        `No photo "${imageId}" on activity ${activityId}. Available: ${els.images.map((i) => i.id).join(', ') || 'none'}.`,
      );
    }
    let blob: Blob;
    try {
      const res = await fetch(img.url, { mode: 'cors' });
      if (!res.ok) throw new Error(String(res.status));
      blob = await res.blob();
    } catch (err) {
      throw new Error(
        `Could not load photo "${img.label}" (${err instanceof Error ? err.message : String(err)}). ` +
          'FitGlue photos need CORS enabled on their bucket; ask the user to upload the photo instead.',
        { cause: err },
      );
    }
    return blobToLayer(blob, img.label, box);
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

export const FITGLUE_TOOLS: EditorTool[] = [
  {
    name: 'fitglue_list_activities',
    description:
      "List a FitGlue user's recent public activities (most recent first) with ids and one-line summaries, so one can be chosen to load.",
    parameters: {
      type: 'object',
      properties: { handle: str('FitGlue handle, with or without the leading "@".') },
      required: ['handle'],
    },
    run: (a) => fitglueActions.listActivities(a.handle as string),
  },
  {
    name: 'fitglue_load_activity',
    description:
      'Load a FitGlue activity (showcase URL, id or slug) and return its title, subtitle, stats (id/label/value), available charts, whether it has a GPS route, and photos. Must be called before any other fitglue_add_* tool for that activity.',
    parameters: {
      type: 'object',
      properties: { activity: str('A fitglue.tech showcase URL, or the activity id/slug.') },
      required: ['activity'],
    },
    run: (a) => fitglueActions.loadActivity(a.activity as string),
  },
  {
    name: 'fitglue_add_stat',
    description:
      "Add one stat's value (e.g. \"10.02 km\") as a text layer on the active page. Returns the new layer id; use style_text/place_image-style tools to refine.",
    parameters: {
      type: 'object',
      properties: {
        activityId: str('Id returned by fitglue_load_activity.'),
        statId: str('A stat id from the loaded activity.'),
        x: num('Left edge in canvas px.'),
        y: num('Top edge in canvas px.'),
        width: num('Box width in canvas px.'),
        fontSize: num('Font size in canvas px (default ≈9% of canvas width).'),
        fill: str('Text colour, e.g. "#ffffff".'),
        align: { type: 'string', description: 'left | center | right.', enum: ['left', 'center', 'right'] },
        fontFamily: str('Font family (see list_fonts).'),
      },
      required: ['activityId', 'statId'],
    },
    run: (a) => {
      const { activityId, statId, ...opts } = a;
      return fitglueActions.addStat(activityId as string, statId as string, opts as StatPlacement);
    },
  },
  {
    name: 'fitglue_add_stats_block',
    description:
      'Add a tidy row of up to 4 stats (big value + small uppercase label each), evenly spaced across the active page near the bottom. Defaults to the first 3 stats. Returns the created layer ids.',
    parameters: {
      type: 'object',
      properties: {
        activityId: str('Id returned by fitglue_load_activity.'),
        statIds: { type: 'array', description: 'Stat ids to show, in order (1-4).', items: { type: 'string' } },
        y: num('Top of the value row in canvas px (default 80% down the canvas).'),
        fill: str('Value colour, e.g. "#ffffff".'),
        labelFill: str('Label colour (default "#cbd5e1").'),
        fontFamily: str('Font family (see list_fonts).'),
      },
      required: ['activityId'],
    },
    run: (a) => {
      const { activityId, ...opts } = a;
      return fitglueActions.addStatsBlock(activityId as string, opts as Parameters<typeof fitglueActions.addStatsBlock>[1]);
    },
  },
  {
    name: 'fitglue_add_chart',
    description:
      'Render one of the activity\'s metric charts (heart rate, elevation, speed, power, cadence) as a transparent image layer on the active page. Returns the new layer id.',
    parameters: {
      type: 'object',
      properties: {
        activityId: str('Id returned by fitglue_load_activity.'),
        chartId: str('A chart id from the loaded activity.'),
        ...boxProps,
      },
      required: ['activityId', 'chartId'],
    },
    run: (a) => {
      const { activityId, chartId, ...box } = a;
      return fitglueActions.addChart(activityId as string, chartId as string, box as Box);
    },
  },
  {
    name: 'fitglue_add_route',
    description:
      "Render the activity's GPS route trace as a transparent image layer on the active page. Returns the new layer id.",
    parameters: {
      type: 'object',
      properties: {
        activityId: str('Id returned by fitglue_load_activity.'),
        color: str('Line colour, e.g. "#c084fc".'),
        ...boxProps,
      },
      required: ['activityId'],
    },
    run: (a) => {
      const { activityId, ...opts } = a;
      return fitglueActions.addRoute(activityId as string, opts as Box & { color?: string });
    },
  },
  {
    name: 'fitglue_add_photo',
    description:
      "Add one of the activity's photos as an image layer on the active page. Returns the new layer id. May fail if the photo host blocks cross-origin loads.",
    parameters: {
      type: 'object',
      properties: {
        activityId: str('Id returned by fitglue_load_activity.'),
        imageId: str('A photo id from the loaded activity.'),
        ...boxProps,
      },
      required: ['activityId', 'imageId'],
    },
    run: (a) => {
      const { activityId, imageId, ...box } = a;
      return fitglueActions.addPhoto(activityId as string, imageId as string, box as Box);
    },
  },
];
