import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./assets', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./assets')>();
  const asset = { id: 'asset_ov', url: 'blob:x', width: 900, height: 400 };
  return { ...actual, addImageAsset: vi.fn(async () => asset), getAsset: vi.fn(() => asset) };
});

import { activityActions, ACTIVITY_TOOLS } from './activityActions';
import { clearActivityCache, findActivity, listActivities, MANIFEST_URL, overlayBox, overlayPieces, cardSummary } from './activities';
import { editorActions } from './actions';
import { buildCopilotTools, runCopilotTool, executeEditorTool } from './ai/copilot';
import { useEditor, emptyDesign } from './store';
import { DEFAULT_PRESET } from './presets';

const SITE = 'https://james.ripixel.co.uk';
const ov = (slug: string, piece: string, label: string, tone: 'light' | 'dark', w: number, h: number) => ({
  piece, label, tone, url: `${SITE}/life/share/activity/${slug}/overlay/${piece}-${tone}.png`, w, h,
});

/** The site's /life/share/index.json, trimmed to what this app reads. */
const MANIFEST = {
  schemaVersion: 1,
  generatedAt: '2026-11-20T00:00:00Z',
  siteUrl: SITE,
  cards: [
    {
      id: 'activity:newark-parkrun-44-2026-11-14', kind: 'activity', slug: 'newark-parkrun-44-2026-11-14', template: 'parkrun',
      title: 'Newark parkrun #44', label: 'parkrun', date: '2026-11-14T09:00:00Z', page: `${SITE}/life/activity/newark-parkrun-44-2026-11-14#share`,
      image: `${SITE}/life/share/activity/newark-parkrun-44-2026-11-14/story-photo-1.jpg`, race: false, pb: false, hash: 'x',
      overlays: [
        ov('newark-parkrun-44-2026-11-14', 'layout-story', 'Story layout', 'light', 1080, 1920),
        ov('newark-parkrun-44-2026-11-14', 'layout-story', 'Story layout', 'dark', 1080, 1920),
        ov('newark-parkrun-44-2026-11-14', 'stats', 'Numbers', 'light', 790, 360),
        ov('newark-parkrun-44-2026-11-14', 'stats', 'Numbers', 'dark', 790, 360),
        ov('newark-parkrun-44-2026-11-14', 'route', 'Route', 'light', 900, 620),
      ],
    },
    {
      id: 'roundup:month-08-2026', kind: 'roundup', slug: 'month-08-2026', template: 'roundup', title: 'August roundup', label: 'August roundup',
      date: '2026-09-01T00:00:00Z', page: '', image: '', race: false, pb: false, hash: 'y', overlays: [],
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** The site: the manifest, and a PNG for any other URL. */
function site() {
  const calls: string[] = [];
  const fetchSpy = vi.fn(async (url: string) => {
    calls.push(String(url));
    if (String(url) === MANIFEST_URL) return jsonResponse(MANIFEST);
    return new Response(new Blob(['png'], { type: 'image/png' }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchSpy);
  return calls;
}

beforeEach(() => {
  useEditor.getState().loadDesign(emptyDesign(DEFAULT_PRESET));
  clearActivityCache();
});
afterEach(() => vi.unstubAllGlobals());

describe('the site manifest', () => {
  it('lists only activities with overlays, fetched once', async () => {
    const calls = site();
    const list = await listActivities();
    expect(list.map((c) => c.slug)).toEqual(['newark-parkrun-44-2026-11-14']);
    await listActivities();
    expect(calls.filter((u) => u === MANIFEST_URL)).toHaveLength(1);
  });

  it('finds an activity by id, slug or page URL', async () => {
    site();
    for (const ref of ['activity:newark-parkrun-44-2026-11-14', 'newark-parkrun-44-2026-11-14', `${SITE}/life/activity/newark-parkrun-44-2026-11-14#share`]) {
      expect((await findActivity(ref)).title).toBe('Newark parkrun #44');
    }
    await expect(findActivity('nope')).rejects.toThrow(/activity_list/);
  });

  it('groups overlays by piece, layouts first, both tones', async () => {
    site();
    const pieces = overlayPieces(await findActivity('newark-parkrun-44-2026-11-14'));
    expect(pieces.map((p) => p.piece)).toEqual(['layout-story', 'stats', 'route']);
    expect(Object.keys(pieces[1].tones)).toEqual(['light', 'dark']);
    expect(pieces[0].layout).toBe(true);
    expect(cardSummary(await findActivity('newark-parkrun-44-2026-11-14'))).toMatch(/^Parkrun · .*14/);
  });

  it('a layout fills the canvas; a piece keeps its 1080-relative size, centred', () => {
    expect(overlayBox({ w: 1080, h: 1920, layout: true }, 1080, 1350)).toEqual({ x: 161, y: 0, width: 759, height: 1350 });
    expect(overlayBox({ w: 540, h: 200, layout: false }, 2160, 2700)).toEqual({ x: 540, y: 1150, width: 1080, height: 400 });
    expect(overlayBox({ w: 2000, h: 200, layout: false }, 1080, 1080).width).toBe(864);
  });
});

describe('activity tools', () => {
  it('are registered with the Copilot alongside the editor tools', () => {
    const names = buildCopilotTools().map((t) => t.name);
    for (const t of ACTIVITY_TOOLS) expect(names).toContain(t.name);
  });

  it('list and load give the model ids to act on', async () => {
    site();
    const list = (await runCopilotTool('activity_list', {})) as { activityId: string }[];
    expect(list.map((a) => a.activityId)).toEqual(['activity:newark-parkrun-44-2026-11-14']);
    const loaded = await activityActions.load(list[0].activityId);
    expect(loaded.pieces.map((p) => p.piece)).toEqual(['layout-story', 'stats', 'route']);
    expect(loaded.pieces.find((p) => p.piece === 'route')?.tones).toEqual(['light']);
    expect(loaded.hasCard).toBe(true);
  });

  it('places an overlay in the asked tone as an image layer from the site', async () => {
    const calls = site();
    const id = (await runCopilotTool('activity_add_overlay', { activity: 'newark-parkrun-44-2026-11-14', piece: 'stats', tone: 'dark' })) as string;
    const layer = editorActions.getState().design.pages[0].layers.find((l) => l.id === id);
    expect(layer?.type).toBe('image');
    expect(layer?.name).toBe('Newark parkrun #44 · Numbers');
    expect(calls).toContain(`${SITE}/life/share/activity/newark-parkrun-44-2026-11-14/overlay/stats-dark.png`);
  });

  it('falls back to the tone there is, and honours a box', async () => {
    const calls = site();
    const id = await activityActions.addOverlay('newark-parkrun-44-2026-11-14', 'route', 'dark', { x: 10, y: 20, width: 300 });
    expect(calls.some((u) => u.endsWith('/route-light.png'))).toBe(true);
    const layer = editorActions.getState().design.pages[0].layers.find((l) => l.id === id) as { x: number; y: number; width: number };
    expect([layer.x, layer.y, layer.width]).toEqual([10, 20, 300]);
  });

  it('places the whole share card', async () => {
    const calls = site();
    await activityActions.addCard('newark-parkrun-44-2026-11-14');
    expect(calls).toContain(MANIFEST.cards[0].image);
    expect(editorActions.getState().design.pages[0].layers).toHaveLength(1);
  });

  it('surfaces an unknown piece to the model, listing the real ones', async () => {
    site();
    const res = await executeEditorTool('activity_add_overlay', { activity: 'newark-parkrun-44-2026-11-14', piece: 'zzz' });
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/Available: layout-story, stats, route/);
  });

  it('validates required args like the editor tools', () => {
    expect(() => runCopilotTool('activity_add_overlay', { activity: 'x' })).toThrow(/missing required argument\(s\): piece/);
  });
});
