/**
 * The AI Post Copilot — an in-browser Claude tool-use loop wired to the editor
 * action layer.
 *
 * The model is handed the editor's own tool registry (`EDITOR_TOOLS`) plus one
 * meta-tool, `ask_user`, and told to build a multi-panel Instagram post from the
 * user's uploaded photos. Each turn it either talks, calls editor tools (which
 * mutate the *real* store, so the canvas updates live and everything stays
 * fully editable) or asks the human a question and waits. There is no image
 * generation anywhere: the Copilot only arranges, crops, colours and captions
 * photos the user brought.
 *
 * This module is the pure orchestration core — network access and tool
 * execution are injectable — so the loop can be unit-tested with a scripted
 * model and a fake editor. The React panel in `../components/CopilotPanel` owns
 * the conversation state and photo/vision wiring and drives {@link runCopilot}.
 */
import {
  createMessage,
  replyText,
  type AiModelId,
  type AnthropicTool,
  type ClaudeMessage,
  type ContentBlock,
  type MessageResponse,
  type ToolResultBlock,
  type ToolUseBlock,
} from './client';
import { EDITOR_TOOLS, runAction, type EditorTool } from '../actions';
import { FITGLUE_TOOLS } from '../fitglueActions';
import { styleProfileToPromptText, type StyleProfile } from './styleProfile';
import { downloadBlob } from '../export';
import { PRESETS } from '../presets';
import { LAYOUTS } from '../collage';
import { FILTER_PRESETS } from '../filters';
import { FONTS } from '../fonts';

/** The human-in-the-loop tool. Not part of the editor action layer (it does
 * nothing to the document) — the loop intercepts it to pause for an answer. */
export const ASK_USER_TOOL_NAME = 'ask_user';

export const ASK_USER_TOOL: AnthropicTool = {
  name: ASK_USER_TOOL_NAME,
  description:
    'Ask the human one focused clarifying question and STOP until they answer. ' +
    'Use this whenever you need a decision, missing information, or approval before ' +
    'continuing — e.g. which photos to feature, the vibe/caption to aim for, or ' +
    'whether a draft looks right. Call it on its own, not alongside editor tools.',
  input_schema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'The question to put to the user.' },
    },
    required: ['question'],
  },
};

/** Convert an editor tool descriptor to the Anthropic tool shape. The editor's
 * `parameters` are already a minimal JSON Schema, so this is a straight remap. */
export function editorToolToAnthropic(tool: EditorTool): AnthropicTool {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: 'object',
      properties: tool.parameters.properties,
      required: tool.parameters.required,
    },
  };
}

/** Every tool the Copilot may call: the editor action layer, the FitGlue
 * tools (workout stats/charts/route from a public showcase) and `ask_user`. */
export function buildCopilotTools(): AnthropicTool[] {
  return [...EDITOR_TOOLS.map(editorToolToAnthropic), ...FITGLUE_TOOLS.map(editorToolToAnthropic), ASK_USER_TOOL];
}

/** Run a tool from either registry by name; same validation as `runAction`. */
export function runCopilotTool(name: string, args: Record<string, unknown>): unknown {
  const fg = FITGLUE_TOOLS.find((t) => t.name === name);
  if (!fg) return runAction(name, args);
  const missing = (fg.parameters.required ?? []).filter((k) => args[k] === undefined || args[k] === null);
  if (missing.length) throw new Error(`Tool "${name}" is missing required argument(s): ${missing.join(', ')}.`);
  return fg.run(args);
}

/** Build the system prompt, folding in the user's style profile (when present)
 * and the concrete ids the editor accepts, so the model needs fewer list-tool
 * round-trips to discover valid presets/layouts/filters/fonts. */
export function buildCopilotSystemPrompt(profile: StyleProfile | null): string {
  const parts: string[] = [
    'You are the AI Post Copilot inside "Insta Post Maker", a browser design tool for',
    'Instagram posts. You build a real, fully-editable design by CALLING TOOLS — every',
    'tool drives the actual editor the user is looking at, so they watch it come together.',
    '',
    'Your job: turn the photos the user has uploaded into a polished multi-panel',
    '(carousel) Instagram post — choosing layouts, cropping/adjusting photos, adding',
    'titles and captions, and setting backgrounds — then offer to export it.',
    '',
    'HARD RULES:',
    '- You CANNOT generate, paint, or invent imagery. Work only with the photos the user',
    "  uploaded; they are shown to you as images tagged with an assetId. Use those ids.",
    '- Call get_snapshot before acting on existing layers/pages/cells to learn their ids.',
    '  Ids you invent will be rejected.',
    '- Build panels as pages: add_page for each new panel; set_active_page to edit one.',
    '- Prefer ask_user over guessing when a choice materially changes the result. Ask one',
    '  crisp question at a time and wait. Do not ask about things you can just decide.',
    '- Keep the user informed in short, friendly prose between tool calls. When the post',
    '  is ready, tell them and offer export (export_png / export_carousel), or let them',
    '  export from the panel button.',
    '',
    'FITGLUE (workout posts): if the user mentions a run/ride/workout, a fitglue.tech link or',
    'an @handle, use the fitglue_* tools. fitglue_list_activities(handle) finds recent',
    'activities; fitglue_load_activity(url or id) returns the title, stats (with ids), charts,',
    'route and photos. Then place them: fitglue_add_stats_block for a tidy row of headline',
    'numbers, fitglue_add_stat for one big number, fitglue_add_chart / fitglue_add_route for',
    'transparent overlays (place them with place_image), and add_text with the returned title.',
    'These numbers are real data — never round, invent or "improve" them.',
    '',
    'Available presets: ' + PRESETS.map((p) => `${p.id} (${p.width}×${p.height})`).join(', ') + '.',
    'Collage layouts: ' + LAYOUTS.map((l) => l.id).join(', ') + '.',
    'Filter presets: ' + FILTER_PRESETS.map((f) => f.id).join(', ') + '.',
    'Fonts: ' + FONTS.map((f) => f.family).join(', ') + '.',
  ];
  if (profile) {
    parts.push('', styleProfileToPromptText(profile));
  }
  return parts.join('\n');
}

/* -------------------------------------------------------------------------- */
/* Tool execution                                                             */
/* -------------------------------------------------------------------------- */

/** The outcome of running one editor tool, ready to become a tool_result. */
export interface ToolExecResult {
  content: string;
  isError: boolean;
}

/** Run one editor tool against the live store and describe the result for the
 * model. Export tools return blobs — we download them and confirm in text,
 * since a binary can't ride back in a tool_result usefully. Errors are returned
 * (never thrown) as `is_error` results so the model can recover. */
export async function executeEditorTool(
  name: string,
  input: Record<string, unknown>,
): Promise<ToolExecResult> {
  try {
    const out = await Promise.resolve(runCopilotTool(name, input));
    if (out instanceof Blob) {
      downloadBlob(out, 'insta-post.png');
      return { content: 'Exported the post and downloaded it.', isError: false };
    }
    if (Array.isArray(out) && out.every((b) => b instanceof Blob)) {
      (out as Blob[]).forEach((b, i) => downloadBlob(b, `insta-post-slide-${i + 1}.png`));
      return { content: `Exported ${out.length} carousel slides and downloaded them.`, isError: false };
    }
    if (out === undefined || out === null) return { content: 'Done.', isError: false };
    return { content: typeof out === 'string' ? out : JSON.stringify(out), isError: false };
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}

/* -------------------------------------------------------------------------- */
/* The loop                                                                    */
/* -------------------------------------------------------------------------- */

/** Streamed as the loop progresses, so the panel can render the transcript. */
export type CopilotEvent =
  | { type: 'assistant_text'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; id: string; name: string; content: string; isError: boolean }
  | { type: 'question'; id: string; question: string };

/** State captured when the loop pauses on `ask_user`. The panel turns the
 * user's answer into a resume message via {@link buildResumeMessage}. */
export interface PendingInput {
  question: string;
  askId: string;
  /** tool_results for any editor tools the model ran in the same turn as the
   * question — they must be sent back together with the answer. */
  toolResults: ToolResultBlock[];
}

export type CopilotResult = { status: 'done' } | { status: 'awaiting_input'; pending: PendingInput };

export interface CopilotDeps {
  apiKey: string;
  system: string;
  tools: AnthropicTool[];
  model?: AiModelId;
  maxTokens?: number;
  /** Safety cap on tool round-trips before we force a stop. */
  maxSteps?: number;
  signal?: AbortSignal;
  onEvent?: (e: CopilotEvent) => void;
  /** Injectable for tests; defaults to the real Anthropic call. */
  send?: (apiKey: string, messages: ClaudeMessage[], opts: {
    model?: AiModelId;
    maxTokens?: number;
    system?: string;
    tools?: AnthropicTool[];
    signal?: AbortSignal;
  }) => Promise<MessageResponse>;
  /** Injectable for tests; defaults to {@link executeEditorTool}. */
  execute?: (name: string, input: Record<string, unknown>) => Promise<ToolExecResult>;
}

const DEFAULT_MAX_STEPS = 24;

const isToolUse = (b: ContentBlock): b is ToolUseBlock => b.type === 'tool_use';

/**
 * Drive the conversation forward. `messages` is mutated in place (assistant
 * replies and tool_result turns are appended) and shared with the caller, so
 * the caller keeps the full history. Runs until the model finishes its turn
 * ({@link CopilotResult} `done`) or asks the human a question (`awaiting_input`).
 * Throws {@link AiError} on a transport/API failure.
 */
export async function runCopilot(
  messages: ClaudeMessage[],
  deps: CopilotDeps,
): Promise<CopilotResult> {
  const send = deps.send ?? ((k, m, o) => createMessage(k, m, o));
  const execute = deps.execute ?? executeEditorTool;
  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
  const emit = (e: CopilotEvent) => deps.onEvent?.(e);

  for (let step = 0; step < maxSteps; step++) {
    if (deps.signal?.aborted) return { status: 'done' };

    const reply = await send(deps.apiKey, messages, {
      model: deps.model,
      maxTokens: deps.maxTokens ?? 2048,
      system: deps.system,
      tools: deps.tools,
      signal: deps.signal,
    });

    messages.push({ role: 'assistant', content: reply.content });

    const text = replyText(reply.content);
    if (text) emit({ type: 'assistant_text', text });

    const toolUses = reply.content.filter(isToolUse);
    if (toolUses.length === 0) return { status: 'done' };

    // Run editor tools now (the user sees the canvas change); defer ask_user.
    const ask = toolUses.find((t) => t.name === ASK_USER_TOOL_NAME);
    const editorUses = toolUses.filter((t) => t.name !== ASK_USER_TOOL_NAME);

    const toolResults: ToolResultBlock[] = [];
    for (const use of editorUses) {
      emit({ type: 'tool_call', id: use.id, name: use.name, input: use.input });
      const res = await execute(use.name, use.input);
      emit({ type: 'tool_result', id: use.id, name: use.name, content: res.content, isError: res.isError });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: res.content,
        ...(res.isError ? { is_error: true } : {}),
      });
    }

    if (ask) {
      const question = String((ask.input as { question?: unknown }).question ?? '').trim() ||
        'What would you like to do next?';
      emit({ type: 'question', id: ask.id, question });
      return { status: 'awaiting_input', pending: { question, askId: ask.id, toolResults } };
    }

    // Hand the tool results back and let the model continue.
    messages.push({ role: 'user', content: toolResults });
  }

  return { status: 'done' };
}

/** Assemble the user turn that resumes the loop after an `ask_user` pause: the
 * deferred editor tool_results plus the answer to the question. */
export function buildResumeMessage(pending: PendingInput, answer: string): ClaudeMessage {
  return {
    role: 'user',
    content: [
      ...pending.toolResults,
      {
        type: 'tool_result',
        tool_use_id: pending.askId,
        content: answer.trim() || '(the user did not answer; use your best judgement)',
      },
    ],
  };
}
