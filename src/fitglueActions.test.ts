import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./fitglueRender', () => ({
  renderChart: vi.fn(async () => new Blob(['chart'], { type: 'image/png' })),
  renderRoute: vi.fn(async () => new Blob(['route'], { type: 'image/png' })),
}));
vi.mock('./assets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./assets')>();
  const asset = { id: 'asset_fg', url: 'blob:x', width: 400, height: 200 };
  return { ...actual, addImageAsset: vi.fn(async () => asset), getAsset: vi.fn(() => asset) };
});

import { clearFitGlueCache, fitglueActions, FITGLUE_TOOLS } from './fitglueActions';
import { editorActions } from './actions';
import { buildCopilotTools, runCopilotTool, executeEditorTool } from './ai/copilot';
import { useEditor, emptyDesign } from './store';
import { DEFAULT_PRESET } from './presets';

/** A minimal showcase payload in the shape extractElements reads. */
const SHOWCASE = {
  title: 'Sunday long run',
  activityData: {
    sessions: [
      {
        totalDistance: 10020,
        totalElapsedTime: 2952,
        laps: [
          {
            records: Array.from({ length: 50 }, (_, i) => ({
              heartRate: 140 + (i % 10),
              positionLat: 52.9 + i * 0.001,
              positionLong: -0.95 + i * 0.001,
            })),
          },
        ],
      },
    ],
  },
  enrichments: { pace: { avgPaceSecondsPerKm: 294 }, heartRate: { avgBpm: 145, maxBpm: 162 } },
};

const PROFILE = {
  profile: {
    entries: [
      { showcaseId: 'abc123', title: 'Sunday long run', activityType: 'ACTIVITY_TYPE_RUNNING', distanceMeters: 10020, durationSeconds: 2952 },
      { showcaseId: 'def456', title: 'Easy spin', activityType: 'ACTIVITY_TYPE_CYCLING', distanceMeters: 25000 },
    ],
  },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => {
  useEditor.getState().loadDesign(emptyDesign(DEFAULT_PRESET));
  clearFitGlueCache();
});
afterEach(() => vi.unstubAllGlobals());

describe('fitglue tools', () => {
  it('are registered with the Copilot alongside the editor tools', () => {
    const names = buildCopilotTools().map((t) => t.name);
    for (const t of FITGLUE_TOOLS) expect(names).toContain(t.name);
    expect(names).toContain('fitglue_load_activity');
  });

  it('lists a handle\'s activities with summaries', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(jsonResponse(PROFILE));
    vi.stubGlobal('fetch', fetchSpy);
    const out = (await runCopilotTool('fitglue_list_activities', { handle: '@ripixel' })) as { activityId: string; summary: string }[];
    expect(fetchSpy.mock.calls[0][0]).toContain('/profile/ripixel');
    expect(out.map((o) => o.activityId)).toEqual(['abc123', 'def456']);
    expect(out[0].summary).toContain('10.0 km');
  });

  it('loads an activity and returns ids the model can act on', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(SHOWCASE)));
    const out = await fitglueActions.loadActivity('https://fitglue.tech/showcase/abc123');
    expect(out.activityId).toBe('abc123');
    expect(out.stats.map((s) => s.label)).toEqual(['Distance', 'Duration', 'Avg pace', 'Avg HR', 'Max HR']);
    expect(out.charts.map((c) => c.label)).toContain('Heart rate');
    expect(out.hasRoute).toBe(true);
  });

  it('refuses a profile handle where an activity is expected', async () => {
    await expect(fitglueActions.loadActivity('@ripixel')).rejects.toThrow(/fitglue_list_activities/);
  });

  it('demands a load before adding, naming the missing id', () => {
    expect(() => fitglueActions.addStat('nope', 'stat_1')).toThrow(/fitglue_load_activity/);
  });

  it('adds a stat as a real, editable text layer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(SHOWCASE)));
    const loaded = await fitglueActions.loadActivity('abc123');
    const dist = loaded.stats[0];
    const id = fitglueActions.addStat('abc123', dist.id, { fill: '#ffffff' });
    const layer = editorActions.getState().design.pages[0].layers.find((l) => l.id === id);
    expect(layer?.type).toBe('text');
    expect((layer as { text: string }).text).toBe('10.02 km');
  });

  it('adds a stats block of value + label pairs across the canvas', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(SHOWCASE)));
    const loaded = await fitglueActions.loadActivity('abc123');
    const ids = (await runCopilotTool('fitglue_add_stats_block', {
      activityId: 'abc123',
      statIds: loaded.stats.slice(0, 2).map((s) => s.id),
    })) as string[];
    expect(ids).toHaveLength(4);
    const layers = editorActions.getState().design.pages[0].layers;
    expect(layers).toHaveLength(4);
    const texts = layers.map((l) => (l as { text: string }).text);
    expect(texts).toEqual(['10.02 km', 'DISTANCE', '49:12', 'DURATION']);
    // Two columns: second value starts half-way across.
    const { design } = editorActions.getState();
    expect((layers[2] as { x: number }).x).toBe(design.width / 2);
  });

  it('rejects an unknown stat id, listing the real ones', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(SHOWCASE)));
    await fitglueActions.loadActivity('abc123');
    expect(() => fitglueActions.addStat('abc123', 'stat_zzz')).toThrow(/Available: stat_/);
  });

  it('renders a chart and the route into image layers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(SHOWCASE)));
    const loaded = await fitglueActions.loadActivity('abc123');
    const chartId = await fitglueActions.addChart('abc123', loaded.charts[0].id, { x: 10, y: 20 });
    const routeId = await fitglueActions.addRoute('abc123', { color: '#ff0000' });
    const layers = editorActions.getState().design.pages[0].layers;
    expect(layers.map((l) => l.id)).toEqual([chartId, routeId]);
    expect(layers.every((l) => l.type === 'image')).toBe(true);
  });

  it('surfaces tool errors to the model instead of throwing', async () => {
    const res = await executeEditorTool('fitglue_add_route', { activityId: 'missing' });
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/fitglue_load_activity/);
  });

  it('validates required args for fitglue tools like editor tools', () => {
    expect(() => runCopilotTool('fitglue_add_chart', { activityId: 'x' })).toThrow(/missing required argument\(s\): chartId/);
  });
});
