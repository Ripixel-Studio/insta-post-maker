/**
 * The Copilot must know where things are, see what it did, and obey the
 * style profile's text rules. These tests pin the three mechanisms:
 * geometry in get_snapshot, clamped adjustments, and the rendered preview
 * that rides back to the model after every editing step.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { editorActions, runAction, clampFilters } from '../actions';
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

  it('honours colour, strength, direction and box', () => {
    const id = editorActions.addGradientOverlay({ color: '#123456', strength: 0.5, direction: 'to-bottom', y: 0, height: 300 });
    const l = editorActions.getState().design.pages[0].layers.find((x) => x.id === id) as {
      direction: string; stops: { color: string }[]; y: number; height: number;
    };
    expect(l.direction).toBe('to-bottom');
    expect(l.stops[0].color).toBe('rgba(18,52,86,0.5)');
    expect([l.y, l.height]).toEqual([0, 300]);
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
