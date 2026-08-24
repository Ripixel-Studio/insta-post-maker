import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ASK_USER_TOOL_NAME,
  buildCopilotSystemPrompt,
  buildCopilotTools,
  buildResumeMessage,
  editorToolToAnthropic,
  executeEditorTool,
  runCopilot,
  type CopilotEvent,
} from './copilot';
import { EDITOR_TOOLS } from '../actions';
import { FITGLUE_TOOLS } from '../fitglueActions';
import { useEditor, emptyDesign } from '../store';
import { DEFAULT_PRESET } from '../presets';
import type { ClaudeMessage, MessageResponse, ToolUseBlock } from './client';
import type { StyleProfile } from './styleProfile';

beforeEach(() => {
  useEditor.getState().loadDesign(emptyDesign(DEFAULT_PRESET));
});

const PROFILE: StyleProfile = {
  version: 1,
  createdAt: 0,
  sampleCount: 3,
  summary: 'Bold neon gym aesthetic',
  palette: ['#000000', '#39ff14'],
  typography: 'Heavy condensed sans',
  composition: 'Centred subject',
  mood: ['energetic'],
  motifs: ['grain'],
  captionVoice: 'Punchy, second-person',
  recommendations: ['Big type'],
};

/** Build a fake `send` that returns a scripted sequence of model replies. */
function scriptedSend(replies: MessageResponse[]) {
  let i = 0;
  return vi.fn(async () => {
    if (i >= replies.length) throw new Error('scriptedSend ran out of replies');
    return replies[i++];
  });
}

const toolUse = (id: string, name: string, input: Record<string, unknown> = {}): ToolUseBlock => ({
  type: 'tool_use',
  id,
  name,
  input,
});

describe('tool conversion', () => {
  it('maps an editor tool to the Anthropic shape', () => {
    const t = EDITOR_TOOLS.find((x) => x.name === 'add_text')!;
    const a = editorToolToAnthropic(t);
    expect(a.name).toBe('add_text');
    expect(a.description).toBe(t.description);
    expect(a.input_schema.type).toBe('object');
    expect(a.input_schema.properties).toBe(t.parameters.properties);
    expect(a.input_schema.required).toEqual(t.parameters.required);
  });

  it('exposes every editor tool plus ask_user', () => {
    const tools = buildCopilotTools();
    expect(tools).toHaveLength(EDITOR_TOOLS.length + FITGLUE_TOOLS.length + 1);
    expect(tools.some((t) => t.name === ASK_USER_TOOL_NAME)).toBe(true);
    for (const t of EDITOR_TOOLS) expect(tools.some((x) => x.name === t.name)).toBe(true);
  });
});

describe('system prompt', () => {
  it('names the copilot and lists real ids, without a profile', () => {
    const p = buildCopilotSystemPrompt(null);
    expect(p).toMatch(/AI Post Copilot/);
    expect(p).toMatch(/story/); // a preset id
    expect(p).not.toMatch(/established post style/);
  });

  it('folds in the style profile when present', () => {
    const p = buildCopilotSystemPrompt(PROFILE);
    expect(p).toMatch(/Bold neon gym aesthetic/);
    expect(p).toMatch(/established post style/);
  });
});

describe('executeEditorTool', () => {
  it('runs a tool and returns its result as text', async () => {
    const res = await executeEditorTool('add_text', { text: 'Hello' });
    expect(res.isError).toBe(false);
    // add_text returns the new layer id
    const layer = useEditor.getState().design.pages[0].layers.find((l) => l.id === res.content);
    expect(layer).toBeDefined();
  });

  it('serialises object results (get_snapshot) as JSON', async () => {
    const res = await executeEditorTool('get_snapshot', {});
    expect(res.isError).toBe(false);
    expect(() => JSON.parse(res.content)).not.toThrow();
  });

  it('returns an error result (not a throw) on a bad call', async () => {
    const res = await executeEditorTool('set_preset', {}); // missing required arg
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/missing required argument/);
  });
});

describe('runCopilot', () => {
  const baseDeps = { apiKey: 'k', system: 's', tools: buildCopilotTools() };

  it('runs a build turn end-to-end and finishes', async () => {
    const send = scriptedSend([
      { content: [{ type: 'text', text: 'On it.' }, toolUse('t1', 'add_text', { text: 'Hi' })], stopReason: 'tool_use' },
      { content: [{ type: 'text', text: 'Done!' }], stopReason: 'end_turn' },
    ]);
    const execute = vi.fn(async (name: string) => ({ content: `ran ${name}`, isError: false }));
    const events: CopilotEvent[] = [];
    const messages: ClaudeMessage[] = [{ role: 'user', content: 'build it' }];

    const res = await runCopilot(messages, { ...baseDeps, send, execute, onEvent: (e) => events.push(e) });

    expect(res.status).toBe('done');
    expect(execute).toHaveBeenCalledWith('add_text', { text: 'Hi' });
    // user, assistant(tool_use), user(tool_result), assistant(end_turn)
    expect(messages).toHaveLength(4);
    expect(messages[2].role).toBe('user');
    expect((messages[2].content as { type: string }[])[0].type).toBe('tool_result');
    expect(events.filter((e) => e.type === 'assistant_text')).toHaveLength(2);
    expect(events.some((e) => e.type === 'tool_call' && e.name === 'add_text')).toBe(true);
  });

  it('pauses on ask_user and resumes with the answer', async () => {
    const send = scriptedSend([
      { content: [toolUse('a1', ASK_USER_TOOL_NAME, { question: 'Square or story?' })], stopReason: 'tool_use' },
    ]);
    const execute = vi.fn();
    const messages: ClaudeMessage[] = [{ role: 'user', content: 'make a post' }];

    const res = await runCopilot(messages, { ...baseDeps, send, execute });

    expect(execute).not.toHaveBeenCalled();
    expect(res.status).toBe('awaiting_input');
    if (res.status !== 'awaiting_input') return;
    expect(res.pending.question).toBe('Square or story?');
    expect(res.pending.askId).toBe('a1');

    const resume = buildResumeMessage(res.pending, 'Square');
    const content = resume.content as { type: string; tool_use_id: string; content: string }[];
    expect(content).toHaveLength(1);
    expect(content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'a1', content: 'Square' });
  });

  it('runs editor tools in the same turn as ask_user, deferring their results', async () => {
    const send = scriptedSend([
      {
        content: [toolUse('t1', 'add_text', { text: 'Hi' }), toolUse('a1', ASK_USER_TOOL_NAME, { question: 'Colour?' })],
        stopReason: 'tool_use',
      },
    ]);
    const execute = vi.fn(async () => ({ content: 'ok', isError: false }));
    const messages: ClaudeMessage[] = [{ role: 'user', content: 'go' }];

    const res = await runCopilot(messages, { ...baseDeps, send, execute });

    expect(execute).toHaveBeenCalledTimes(1);
    if (res.status !== 'awaiting_input') throw new Error('expected pause');
    expect(res.pending.toolResults).toHaveLength(1);
    const resume = buildResumeMessage(res.pending, 'Neon');
    expect((resume.content as unknown[]).length).toBe(2); // editor result + answer
  });

  it('flags a failed tool call as an error result to the model', async () => {
    const send = scriptedSend([
      { content: [toolUse('t1', 'add_text', {})], stopReason: 'tool_use' },
      { content: [{ type: 'text', text: 'fixed' }], stopReason: 'end_turn' },
    ]);
    const execute = vi.fn(async () => ({ content: 'boom', isError: true }));
    const messages: ClaudeMessage[] = [{ role: 'user', content: 'go' }];

    await runCopilot(messages, { ...baseDeps, send, execute });

    const toolResultTurn = messages[2].content as { is_error?: boolean }[];
    expect(toolResultTurn[0].is_error).toBe(true);
  });

  it('stops cleanly when the run is aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const send = scriptedSend([]);
    const res = await runCopilot([{ role: 'user', content: 'x' }], {
      ...baseDeps,
      send,
      signal: controller.signal,
    });
    expect(res.status).toBe('done');
    expect(send).not.toHaveBeenCalled();
  });
});
