/**
 * The Copilot must know where things are, see what it did, and obey the
 * style profile's text rules. These tests pin the three mechanisms:
 * geometry in get_snapshot, clamped adjustments, and the rendered preview
 * that rides back to the model after every editing step.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { editorActions, runAction, clampFilters, focusCrop } from '../actions';
import { useEditor, emptyDesign } from '../store';
import { DEFAULT_PRESET } from '../presets';
import {
  ASK_USER_TOOL_NAME,
  PREVIEW_TOOL_NAME,
  buildCopilotSystemPrompt,
  buildCopilotTools,
  changesCanvas,
  runCopilot,
} from './copilot';
import { parseStyleProfile, styleProfileToPromptText } from './styleProfile';
import type { ClaudeMessage, MessageResponse, ToolResultBlock, ToolUseBlock } from './client';

beforeEach(() => {
  useEditor.getState().loadDesign(emptyDesign(DEFAULT_PRESET));
});

const toolUse = (id: string, name: string, input: Record<string, unknown> = {}): ToolUseBlock => ({
  type: 'tool_use', id, name, input,
});
const IMG = { media_type: 'image/jpeg', data: 'AAAA' };

function scripted(replies: MessageResponse[]) {
  let i = 0;
  return vi.fn(async () => replies[Math.min(i++, replies.length - 1)]);
}

describe('get_snapshot carries geometry', () => {
  it('reports each layer box, text and non-default adjustments', () => {
    const id = editorActions.addText('Hello there', { x: 40, y: 80, width: 300, fontSize: 48, fill: '#ff00aa' });
    const snap = editorActions.getSnapshot();
    const l = snap.pages[0].layers.find((x) => x.id === id)!;
    expect(l).toMatchObject({ type: 'text', x: 40, y: 80, width: 300, fontSize: 48, fill: '#ff00aa', text: 'Hello there' });
    expect(typeof l.height).toBe('number');
    expect(snap.canvas.width).toBe(1080);
  });

  it('only lists adjustments that differ from the defaults', () => {
    const id = editorActions.addImage('asset_x', { x: 0, y: 0, width: 100, height: 100 });
    expect(editorActions.getSnapshot().pages[0].layers[0].adjustments).toBeUndefined();
    editorActions.adjustImage(id, { brightness: -0.1 });
    expect(editorActions.getSnapshot().pages[0].layers[0].adjustments).toEqual({ brightness: -0.1 });
  });
});

describe('adjustments are clamped to their real ranges', () => {
  it('clampFilters bounds every channel and drops junk', () => {
    expect(clampFilters({ brightness: 50, contrast: -500, saturation: -3, blur: 100 })).toEqual({
      brightness: 1, contrast: -100, saturation: -1, blur: 40,
    });
    expect(clampFilters({ brightness: Number.NaN })).toEqual({});
  });

  it('adjust_image cannot black out a photo with an out-of-range value', () => {
    const id = editorActions.addImage('asset_x', { width: 10, height: 10 });
    runAction('adjust_image', { id, brightness: -80 });
    const layer = editorActions.getState().design.pages[0].layers[0] as { filters: { brightness: number } };
    expect(layer.filters.brightness).toBe(-1);
  });
});

describe('the Copilot sees its work', () => {
  it('registers preview_page and knows which tools change the canvas', () => {
    expect(buildCopilotTools().map((t) => t.name)).toContain(PREVIEW_TOOL_NAME);
    expect(changesCanvas('add_text')).toBe(true);
    expect(changesCanvas('fitglue_add_route')).toBe(true);
    expect(changesCanvas('get_snapshot')).toBe(false);
    expect(changesCanvas('fitglue_load_activity')).toBe(false);
  });

  it('attaches one rendered preview once enough edits have accumulated', async () => {
    const send = scripted([
      { content: [toolUse('t1', 'add_text', { text: 'Hi' }), toolUse('t2', 'add_text', { text: 'Yo' })], stopReason: 'tool_use' },
      { content: [{ type: 'text', text: 'Done!' }], stopReason: 'end_turn' },
    ]);
    const preview = vi.fn(async () => IMG);
    const execute = vi.fn(async () => ({ content: 'layer_1', isError: false }));
    const messages: ClaudeMessage[] = [{ role: 'user', content: 'build it' }];
    await runCopilot(messages, { apiKey: 'k', system: 's', tools: [], send, execute, preview, previewEvery: 2 });

    expect(preview).toHaveBeenCalledTimes(1);
    const results = messages[2].content as ToolResultBlock[];
    expect(results).toHaveLength(2);
    expect(results[0].content).toBe('layer_1'); // untouched
    const last = results[1].content as { type: string }[];
    expect(last.map((b) => b.type)).toEqual(['text', 'text', 'image']);
  });

  it('batches: no auto preview until previewEvery edits, then resets', async () => {
    const edit = (id: string) => toolUse(id, 'add_text', { text: id });
    const send = scripted([
      { content: [edit('a'), edit('b')], stopReason: 'tool_use' },          // 2 edits: no preview
      { content: [edit('c'), edit('d'), edit('e')], stopReason: 'tool_use' }, // 5 edits: preview, reset
      { content: [edit('f')], stopReason: 'tool_use' },                     // 1 edit: no preview
      { content: [{ type: 'text', text: 'Done' }], stopReason: 'end_turn' },
    ]);
    const preview = vi.fn(async () => IMG);
    const execute = vi.fn(async () => ({ content: 'ok', isError: false }));
    const messages: ClaudeMessage[] = [{ role: 'user', content: 'go' }];
    await runCopilot(messages, { apiKey: 'k', system: 's', tools: [], send, execute, preview });
    expect(preview).toHaveBeenCalledTimes(1);
    expect(typeof (messages[2].content as ToolResultBlock[])[1].content).toBe('string');
    expect(Array.isArray((messages[4].content as ToolResultBlock[])[2].content)).toBe(true);
    expect(typeof (messages[6].content as ToolResultBlock[])[0].content).toBe('string');
  });

  it('does not render a preview for read-only steps', async () => {
    const send = scripted([
      { content: [toolUse('t1', 'get_snapshot')], stopReason: 'tool_use' },
      { content: [{ type: 'text', text: 'Ok' }], stopReason: 'end_turn' },
    ]);
    const preview = vi.fn(async () => IMG);
    const execute = vi.fn(async () => ({ content: '{}', isError: false }));
    const messages: ClaudeMessage[] = [{ role: 'user', content: 'look' }];
    await runCopilot(messages, { apiKey: 'k', system: 's', tools: [], send, execute, preview });
    expect(preview).not.toHaveBeenCalled();
    expect((messages[2].content as ToolResultBlock[])[0].content).toBe('{}');
  });

  it('honours an explicit preview_page call without running an editor tool', async () => {
    const send = scripted([
      { content: [toolUse('p1', PREVIEW_TOOL_NAME)], stopReason: 'tool_use' },
      { content: [{ type: 'text', text: 'Looks fine.' }], stopReason: 'end_turn' },
    ]);
    const preview = vi.fn(async () => IMG);
    const execute = vi.fn(async () => ({ content: 'should not run', isError: false }));
    const messages: ClaudeMessage[] = [{ role: 'user', content: 'check' }];
    await runCopilot(messages, { apiKey: 'k', system: 's', tools: [], send, execute, preview });
    expect(execute).not.toHaveBeenCalled();
    expect(preview).toHaveBeenCalledTimes(1);
    const blocks = (messages[2].content as ToolResultBlock[])[0].content as { type: string }[];
    expect(blocks[blocks.length - 1].type).toBe('image');
  });

  it('falls back to text-only results when no preview can be rendered', async () => {
    const send = scripted([
      { content: [toolUse('t1', 'add_text', { text: 'Hi' })], stopReason: 'tool_use' },
      { content: [{ type: 'text', text: 'Done' }], stopReason: 'end_turn' },
    ]);
    const execute = vi.fn(async () => ({ content: 'layer_1', isError: false }));
    const messages: ClaudeMessage[] = [{ role: 'user', content: 'go' }];
    await runCopilot(messages, { apiKey: 'k', system: 's', tools: [], send, execute, preview: async () => null, previewEvery: 1 });
    expect((messages[2].content as ToolResultBlock[])[0].content).toBe('layer_1');
  });

  it('still defers ask_user when a preview is pending', async () => {
    const send = scripted([
      { content: [toolUse('t1', 'add_text', { text: 'Hi' }), toolUse('a1', ASK_USER_TOOL_NAME, { question: 'Colour?' })], stopReason: 'tool_use' },
    ]);
    const execute = vi.fn(async () => ({ content: 'ok', isError: false }));
    const messages: ClaudeMessage[] = [{ role: 'user', content: 'go' }];
    const res = await runCopilot(messages, { apiKey: 'k', system: 's', tools: [], send, execute, preview: async () => IMG, previewEvery: 1 });
    expect(res.status).toBe('awaiting_input');
    if (res.status === 'awaiting_input') {
      const blocks = res.pending.toolResults[0].content as { type: string }[];
      expect(blocks[blocks.length - 1].type).toBe('image');
    }
  });
});

describe('subject-aware framing', () => {
  it('focusCrop keeps the dest aspect, centres the subject and never cuts it', () => {
    // 2000×1000 source into a 1000×1000 (square) frame; subject on the right.
    const subject = { x: 0.7, y: 0.3, width: 0.1, height: 0.4 };
    const c = focusCrop(2000, 1000, 1000, 1000, subject, 0.5);
    expect(c.width / c.height).toBeCloseTo(0.5, 5);   // square in a 2:1 source = w:h 1:2 normalised
    expect(c.x).toBeLessThanOrEqual(subject.x);
    expect(c.x + c.width).toBeGreaterThanOrEqual(subject.x + subject.width);
    expect(c.y).toBeLessThanOrEqual(subject.y);
    expect(c.y + c.height).toBeGreaterThanOrEqual(subject.y + subject.height);
    expect(c.x + c.width / 2).toBeCloseTo(0.75, 1);   // centred on the subject
    expect(c.x + c.width).toBeLessThanOrEqual(1);
  });

  it('focusCrop tightness 1 fills the frame with the subject, 0 is the widest crop', () => {
    const subject = { x: 0.4, y: 0.4, width: 0.2, height: 0.2 };
    const tight = focusCrop(1000, 1000, 1000, 1000, subject, 1);
    const wide = focusCrop(1000, 1000, 1000, 1000, subject, 0);
    expect(tight.width).toBeCloseTo(0.22, 2);         // subject + 10% air
    expect(wide.width).toBe(1);
  });

  it('focusCrop clamps a subject at the very edge back inside the source', () => {
    const c = focusCrop(1000, 1000, 1000, 1000, { x: 0.95, y: 0, width: 0.05, height: 0.2 }, 0.5);
    expect(c.x + c.width).toBeLessThanOrEqual(1);
    expect(c.y).toBeGreaterThanOrEqual(0);
  });

  it('focus_image_on_subject applies the crop through the tool registry', () => {
    const id = editorActions.addImage('asset_x', { x: 0, y: 0, width: 500, height: 500 });
    const crop = runAction('focus_image_on_subject', { id, subject: { x: 0.6, y: 0.2, width: 0.2, height: 0.5 }, tightness: 0.8 }) as { x: number; width: number };
    const layer = editorActions.getState().design.pages[0].layers[0] as { crop?: { x: number; width: number } };
    expect(layer.crop).toEqual(crop);
    expect(crop.x).toBeLessThanOrEqual(0.6);
    expect(crop.x + crop.width).toBeGreaterThanOrEqual(0.8);
  });

  it('focus_cell_on_subject pans a cover-fitted cell to the subject', () => {
    runAction('new_canvas', { preset: 'square' });
    runAction('apply_layout', { layout: '2v' });
    const cellId = editorActions.collageCellIds()[0];
    expect(() => runAction('focus_cell_on_subject', { cellId, subject: { x: 0, y: 0, width: 1, height: 1 } })).toThrow(/no image yet/);
    runAction('set_collage_cell_image', { cellId, assetId: 'asset_missing' });
    // No registered asset → the cell rect is used as the photo size, so the
    // cover-fit window is the full source and pan stays centred at zoom 1…
    const flat = runAction('focus_cell_on_subject', { cellId, subject: { x: 0.8, y: 0.8, width: 0.1, height: 0.1 } }) as { offsetX: number; offsetY: number; zoom: number };
    expect(flat).toEqual({ zoom: 1, offsetX: 0.5, offsetY: 0.5 });
    // …while zooming in pans toward the subject (bottom-right → offsets > 0.5).
    const zoomed = runAction('focus_cell_on_subject', { cellId, subject: { x: 0.8, y: 0.8, width: 0.1, height: 0.1 }, zoom: 2 }) as { offsetX: number; offsetY: number; zoom: number };
    expect(zoomed.zoom).toBe(2);
    expect(zoomed.offsetX).toBeGreaterThan(0.5);
    expect(zoomed.offsetY).toBeGreaterThan(0.5);
    const cell = editorActions.getState().design.pages[0].collage!.cells.find((c) => c.id === cellId)!;
    expect(cell.zoom).toBe(2);
  });
});

describe('legibility helpers', () => {
  it('add_gradient_overlay defaults to a bottom-dark scrim over the lower half', () => {
    const id = runAction('add_gradient_overlay') as string;
    const l = editorActions.getState().design.pages[0].layers.find((x) => x.id === id) as {
      type: string; direction: string; stops: { offset: number; color: string }[]; x: number; y: number; width: number; height: number;
    };
    const { design } = editorActions.getState();
    expect(l.type).toBe('overlay');
    expect(l.direction).toBe('to-top');
    expect(l.stops[0].color).toBe('rgba(0,0,0,0.85)');
    expect(l.stops[1].color).toBe('rgba(0,0,0,0)');
    expect([l.x, l.y, l.width, l.height]).toEqual([0, design.height / 2, design.width, design.height / 2]);
    expect(editorActions.getSnapshot().pages[0].layers[0]).toMatchObject({ type: 'overlay', direction: 'to-top' });
  });

  it('is always anchored to the chosen edge, never floating', () => {
    const { design } = editorActions.getState();
    const W = design.width, H = design.height;
    const get = (id: string) => editorActions.getState().design.pages[0].layers.find((x) => x.id === id) as {
      direction: string; stops: { offset: number; color: string }[]; x: number; y: number; width: number; height: number; name: string;
    };
    const top = get(editorActions.addGradientOverlay({ edge: 'top', coverage: 0.3, color: '#123456', strength: 0.5 }));
    expect(top.direction).toBe('to-bottom');
    expect([top.x, top.y, top.width, top.height]).toEqual([0, 0, W, Math.round(H * 0.3)]);
    expect(top.stops[0].color).toBe('rgba(18,52,86,0.5)');
    expect(top.name).toBe('Top scrim');

    const right = get(editorActions.addGradientOverlay({ edge: 'right', coverage: 0.25 }));
    expect(right.direction).toBe('to-left');
    expect([right.x, right.width, right.y, right.height]).toEqual([Math.round(W * 0.75), Math.round(W * 0.25), 0, H]);

    // coverage is clamped so a scrim can never shrink to a sliver mid-frame
    const tiny = get(editorActions.addGradientOverlay({ edge: 'bottom', coverage: 0 }));
    expect(tiny.height).toBe(Math.round(H * 0.1));
    expect(tiny.y + tiny.height).toBe(H);
  });

  it('vignette is clear in the centre and dark at the edges', () => {
    const id = editorActions.addGradientOverlay({ edge: 'vignette' });
    const l = editorActions.getState().design.pages[0].layers.find((x) => x.id === id) as {
      direction: string; stops: { offset: number; color: string }[]; width: number; height: number;
    };
    const { design } = editorActions.getState();
    expect(l.direction).toBe('radial');
    expect([l.width, l.height]).toEqual([design.width, design.height]);
    expect(l.stops[0].color).toBe('rgba(0,0,0,0)');
    expect(l.stops[l.stops.length - 1].color).toBe('rgba(0,0,0,0.85)');
  });

  it('add_shape makes a plate with fill and opacity', () => {
    const id = runAction('add_shape', { shape: 'rect', fill: '#000000', opacity: 0.6, x: 10, y: 20, width: 200, height: 80, cornerRadius: 0 }) as string;
    const l = editorActions.getState().design.pages[0].layers.find((x) => x.id === id) as {
      type: string; shape: string; fill: string; opacity: number; cornerRadius: number; width: number;
    };
    expect(l).toMatchObject({ type: 'shape', shape: 'rect', fill: '#000000', opacity: 0.6, cornerRadius: 0, width: 200 });
    expect(editorActions.getSnapshot().pages[0].layers[0]).toMatchObject({ type: 'shape', shape: 'rect', fill: '#000000' });
  });
});

describe('the Copilot keeps going', () => {
  it('nudges a max_tokens-truncated reply to continue instead of stopping', async () => {
    const send = scripted([
      { content: [{ type: 'text', text: 'Now I will add the' }], stopReason: 'max_tokens' },
      { content: [toolUse('t1', 'add_text', { text: 'Title' })], stopReason: 'tool_use' },
      { content: [{ type: 'text', text: 'Done.' }], stopReason: 'end_turn' },
    ]);
    const execute = vi.fn(async () => ({ content: 'layer_1', isError: false }));
    const messages: ClaudeMessage[] = [{ role: 'user', content: 'go' }];
    const res = await runCopilot(messages, { apiKey: 'k', system: 's', tools: [], send, execute, preview: async () => null });
    expect(res.status).toBe('done');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(messages[2]).toMatchObject({ role: 'user' });
    expect(String(messages[2].content)).toMatch(/cut off/);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('gives up nudging after two truncated replies in a row', async () => {
    const send = scripted([{ content: [{ type: 'text', text: '…' }], stopReason: 'max_tokens' }]);
    const messages: ClaudeMessage[] = [{ role: 'user', content: 'go' }];
    await runCopilot(messages, { apiKey: 'k', system: 's', tools: [], send, execute: vi.fn(), preview: async () => null });
    expect(send).toHaveBeenCalledTimes(3); // original + 2 continuations
  });

  it('tells the user when the step cap pauses the build', async () => {
    const send = scripted([{ content: [toolUse('t', 'add_text', { text: 'x' })], stopReason: 'tool_use' }]);
    const execute = vi.fn(async () => ({ content: 'ok', isError: false }));
    const texts: string[] = [];
    const messages: ClaudeMessage[] = [{ role: 'user', content: 'go' }];
    await runCopilot(messages, {
      apiKey: 'k', system: 's', tools: [], send, execute, preview: async () => null, maxSteps: 3,
      onEvent: (e) => { if (e.type === 'assistant_text') texts.push(e.text); },
    });
    expect(execute).toHaveBeenCalledTimes(3);
    expect(texts[texts.length - 1]).toMatch(/Paused after 3 steps/);
    expect(messages[messages.length - 1].role).toBe('user'); // consistent: ends on tool results
  });
});

describe('the style profile is binding', () => {
  const RAW = JSON.stringify({
    summary: 'Clean athletic posts.',
    palette: ['#111111'],
    typography: 'Condensed sans.',
    composition: 'Photo full-bleed.',
    mood: ['bold'],
    motifs: [],
    captionVoice: '',
    recommendations: [],
    textUsage: 'Only stat numbers with small uppercase labels in the bottom third; no titles or captions.',
    avoid: ['text over faces', 'heavy filters'],
  });

  it('parses textUsage and avoid, and defaults them when absent', () => {
    const p = parseStyleProfile(RAW, { sampleCount: 4, createdAt: 1 });
    expect(p.textUsage).toMatch(/no titles or captions/);
    expect(p.avoid).toEqual(['text over faces', 'heavy filters']);
    const bare = parseStyleProfile(JSON.stringify({ summary: 'x' }), { sampleCount: 1, createdAt: 1 });
    expect(bare.textUsage).toBe('');
    expect(bare.avoid).toEqual([]);
  });

  it('puts the text rule and the never-list in front of the model', () => {
    const p = parseStyleProfile(RAW, { sampleCount: 4, createdAt: 1 });
    const text = styleProfileToPromptText(p);
    expect(text).toContain('Text usage (binding):');
    expect(text).toContain('Never: text over faces; heavy filters');
    const system = buildCopilotSystemPrompt(p);
    expect(system).toMatch(/STYLE PROFILE .* is binding/);
    expect(system).toMatch(/WORK IN BATCHES, THEN LOOK/);
    expect(system).toContain('Text usage (binding)');
  });
});
