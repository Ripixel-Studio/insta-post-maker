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
import { downloadBlob, exportPreview } from '../export';
import { useEditor } from '../store';
import { encodePostImage, type StyleImage } from './styleProfile';
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

export const PREVIEW_TOOL_NAME = 'preview_page';

/** Explicit "show me" — the loop also attaches a preview automatically after
 * any step that changed the canvas, so this is for a deliberate second look. */
export const PREVIEW_TOOL: AnthropicTool = {
  name: PREVIEW_TOOL_NAME,
  description:
    'Render the active page as an image so you can check the result of your edits (readability, overlap, off-canvas layers, photo tone). Call it once per finished panel and once before export — not after every edit.',
  input_schema: { type: 'object', properties: {} },
};

/** Every tool the Copilot may call: the editor action layer, the FitGlue
 * tools (workout stats/charts/route from a public showcase), `preview_page`
 * and `ask_user`. */
export function buildCopilotTools(): AnthropicTool[] {
  return [
    ...EDITOR_TOOLS.map(editorToolToAnthropic),
    ...FITGLUE_TOOLS.map(editorToolToAnthropic),
    PREVIEW_TOOL,
    ASK_USER_TOOL,
  ];
}

/** Tools that only read. Anything else changes what the user sees, so the
 * step that ran it gets a rendered preview attached. */
const READ_ONLY_TOOLS = new Set(['get_snapshot', 'fitglue_list_activities', 'fitglue_load_activity', PREVIEW_TOOL_NAME]);

export function changesCanvas(toolName: string): boolean {
  return !READ_ONLY_TOOLS.has(toolName);
}

/** Render the active page for the model. Null when the canvas isn't mounted
 * (tests, or the panel opened before the stage) — the loop then just sends
 * text results, as before. */
export async function renderPreviewImage(): Promise<StyleImage | null> {
  try {
    const blob = await exportPreview(useEditor.getState().design);
    return await encodePostImage(blob);
  } catch {
    return null;
  }
}

/** Run a tool from either registry by name; same validation as `runAction`. */
export function runCopilotTool(name: string, args: Record<string, unknown>): unknown {
  if (name === PREVIEW_TOOL_NAME) return 'Preview is attached by the Copilot loop.';
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
    '- Call get_snapshot before acting on existing layers/pages/cells to learn their ids',
    '  AND their positions. It returns every layer\'s box (x, y, width, height in canvas px,',
    '  origin top-left). Ids you invent will be rejected.',
    '- WORK IN BATCHES, THEN LOOK. Build a whole panel in one go — issue several tool calls',
    '  in the same turn (layout, photos, crops, stats, text) rather than one per turn. Then',
    '  call preview_page ONCE for that panel and study it: is every text readable and inside',
    '  the canvas, nothing overlapping or covering faces, do photos look natural (not dark,',
    '  not washed out, skin tones true)? Fix what is wrong, then move to the next panel. Do a',
    '  final preview_page of each page before offering export. Do not preview after every',
    '  single edit — it is slow. (A preview is also attached automatically after a run of',
    '  several edits.)',
    '- LEGIBILITY: text or stats over a photo need a gradient scrim under them — call',
    '  add_gradient_overlay (bottom-dark by default) BEFORE adding the text, or add_shape',
    '  for a solid plate. Never rely on the photo happening to be dark enough. If a preview',
    '  shows text that is hard to read, add or strengthen the overlay rather than moving on.',
    '- Placement: keep everything inside the canvas with a margin of at least 4% of the',
    '  width; never place text over a busy area or a face; align to a consistent grid.',
    '- Photos look best untouched. Do not apply filters or adjustments by default. If one',
    '  is genuinely needed, keep it subtle (|brightness| ≤ 0.15, |contrast| ≤ 15,',
    '  |saturation| ≤ 0.2), check the preview, and revert (preset "none" / values 0) if the',
    '  photo went dark, tinted or oversaturated.',
    '- The user\'s STYLE PROFILE (below, when present) is binding, not a suggestion. Its',
    '  "Text usage" line says exactly what text belongs: if it says stats and labels only,',
    '  add NO titles, captions, quotes or hashtags — not even one. Its "Never" list is',
    '  absolute.',
    '- Build panels as pages: add_page for each new panel; set_active_page to edit one.',
    '- Prefer ask_user over guessing when a choice materially changes the result. Ask one',
    '  crisp question at a time and wait. Do not ask about things you can just decide.',
    '- NEVER end your turn to describe what you are about to do — do it. Keep calling',
    '  tools until the post is complete or you genuinely need an answer (ask_user). A',
    '  reply with no tool call ends your turn and the user has to prompt you again.',
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
  | { type: 'preview'; reason: 'auto' | 'requested' }
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
  /** Injectable for tests; defaults to {@link renderPreviewImage}. Returning
   * null skips the preview for that step. */
  preview?: () => Promise<StyleImage | null>;
  /** Auto-attach a preview once this many canvas-changing calls have run
   * since the last preview (explicit preview_page resets the count). Previewing
   * after every single edit doubled the wall-clock of a build; batching keeps
   * the safety net without the drag. */
  previewEvery?: number;
}

export const DEFAULT_PREVIEW_EVERY = 5;

const DEFAULT_MAX_STEPS = 40;
/** Output budget per reply. Batching several tool calls per turn (each with a
 * JSON input) blew through the old 2048 — the reply was cut mid-call and the
 * loop saw "no tool use", i.e. the Copilot silently stopped. */
const DEFAULT_MAX_TOKENS = 8192;
/** How many times in a row we nudge a length-truncated reply to carry on. */
const MAX_CONTINUATIONS = 2;
export const STEP_CAP_NOTICE =
  '⏸ Paused after {n} steps to keep costs in check — say "continue" and I\'ll carry on.';

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
  const preview = deps.preview ?? renderPreviewImage;
  const previewEvery = Math.max(1, deps.previewEvery ?? DEFAULT_PREVIEW_EVERY);
  let editsSincePreview = 0;
  const maxSteps = deps.maxSteps ?? DEFAULT_MAX_STEPS;
  const emit = (e: CopilotEvent) => deps.onEvent?.(e);
  let continuations = 0;

  for (let step = 0; step < maxSteps; step++) {
    if (deps.signal?.aborted) return { status: 'done' };

    const reply = await send(deps.apiKey, messages, {
      model: deps.model,
      maxTokens: deps.maxTokens ?? DEFAULT_MAX_TOKENS,
      system: deps.system,
      tools: deps.tools,
      signal: deps.signal,
    });

    messages.push({ role: 'assistant', content: reply.content });

    const text = replyText(reply.content);
    if (text) emit({ type: 'assistant_text', text });

    const toolUses = reply.content.filter(isToolUse);
    if (toolUses.length === 0) {
      // Cut off by the output budget before it reached a tool call: that is
      // not the model choosing to stop. Nudge it on (bounded) instead of
      // handing a half-sentence back to the user as if the turn were over.
      if (reply.stopReason === 'max_tokens' && continuations < MAX_CONTINUATIONS) {
        continuations += 1;
        messages.push({
          role: 'user',
          content: 'Your reply was cut off by the length limit. Continue exactly where you stopped — call the next tool.',
        });
        continue;
      }
      return { status: 'done' };
    }
    continuations = 0;

    // Run editor tools now (the user sees the canvas change); defer ask_user.
    const ask = toolUses.find((t) => t.name === ASK_USER_TOOL_NAME);
    const editorUses = toolUses.filter((t) => t.name !== ASK_USER_TOOL_NAME);

    const toolResults: ToolResultBlock[] = [];
    let previewNeeded: 'auto' | 'requested' | null = null;
    for (const use of editorUses) {
      if (use.name === PREVIEW_TOOL_NAME) {
        previewNeeded = 'requested';
        toolResults.push({ type: 'tool_result', tool_use_id: use.id, content: 'Preview attached below.' });
        continue;
      }
      emit({ type: 'tool_call', id: use.id, name: use.name, input: use.input });
      const res = await execute(use.name, use.input);
      emit({ type: 'tool_result', id: use.id, name: use.name, content: res.content, isError: res.isError });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content: res.content,
        ...(res.isError ? { is_error: true } : {}),
      });
      if (!res.isError && changesCanvas(use.name)) editsSincePreview += 1;
    }
    if (!previewNeeded && editsSincePreview >= previewEvery) previewNeeded = 'auto';

    // The model must see what it did — but in batches. One preview per step at
    // most, attached to the last tool_result (its content may carry images).
    if (previewNeeded && toolResults.length) {
      editsSincePreview = 0;
      const img = await preview();
      if (img) {
        emit({ type: 'preview', reason: previewNeeded });
        const last = toolResults[toolResults.length - 1];
        const prior = typeof last.content === 'string' ? [{ type: 'text' as const, text: last.content }] : last.content;
        last.content = [
          ...prior,
          { type: 'text', text: 'Rendered preview of the active page after this step. Check it before continuing:' },
          { type: 'image', source: { type: 'base64', media_type: img.media_type, data: img.data } },
        ];
      }
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

  // Step cap reached with work possibly unfinished. Say so — a silent stop
  // looked like the Copilot giving up ("the chat just stops after a couple of
  // turns"). The history is consistent (last message is tool results), so a
  // plain "continue" from the user resumes it.
  emit({ type: 'assistant_text', text: STEP_CAP_NOTICE.replace('{n}', String(maxSteps)) });
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
