import { useMemo, useRef, useState, useEffect } from 'react';
import { useEditor } from '../store';
import { AiError, DEFAULT_MODEL, type ClaudeMessage, type ContentBlock } from '../ai/client';
import {
  buildCopilotTools,
  buildCopilotSystemPrompt,
  buildResumeMessage,
  runCopilot,
  type CopilotEvent,
  type PendingInput,
} from '../ai/copilot';
import { encodePhotos, usablePhotoIds } from '../ai/vision';
import { editorActions } from '../actions';
import { PagePreview } from './PagePreview';

/** One rendered line of the conversation. Tool calls/results collapse into a
 * single compact chip so the transcript reads as a story, not a JSON dump. */
type Item =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'assistant'; text: string }
  | { id: number; kind: 'tool'; name: string; summary: string; isError: boolean }
  | { id: number; kind: 'question'; text: string };

/** Omit that distributes across a union, so each variant keeps its own fields. */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

let itemCounter = 0;
const nextItemId = () => (itemCounter += 1);

/** A short, human summary of a tool call for the transcript chip. */
function toolSummary(name: string, input: Record<string, unknown>): string {
  const first =
    (input.text as string) ??
    (input.preset as string) ??
    (input.layout as string) ??
    (input.color as string) ??
    (input.background as string) ??
    (input.assetId as string) ??
    '';
  const label = name.replace(/_/g, ' ');
  return first ? `${label} · ${String(first).slice(0, 40)}` : label;
}

/**
 * AI Post Copilot — a conversational panel that drives the real editor through
 * Claude's tool-use loop to build a multi-panel post from the user's photos,
 * then offers export. Gated behind `<AiGate>` at its mount site, so it only
 * appears once a Claude key is connected. No image generation: it only arranges
 * and styles photos the user uploaded.
 */
export function CopilotPanel() {
  const design = useEditor((s) => s.design);
  const tray = useEditor((s) => s.tray);
  const styleProfile = useEditor((s) => s.styleProfile);
  const aiKey = useEditor((s) => s.aiKey);

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingInput | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Conversation history (the API messages) and the photos already shown to the
  // model — kept in refs so they survive re-renders without re-encoding.
  const messagesRef = useRef<ClaudeMessage[]>([]);
  const sentPhotoIds = useRef<Set<string>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const tools = useMemo(() => buildCopilotTools(), []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [items, busy]);

  function addItem(item: DistributiveOmit<Item, 'id'>) {
    setItems((prev) => [...prev, { ...item, id: nextItemId() } as Item]);
  }

  function onEvent(e: CopilotEvent) {
    if (e.type === 'assistant_text') addItem({ kind: 'assistant', text: e.text });
    else if (e.type === 'tool_call')
      addItem({ kind: 'tool', name: e.name, summary: toolSummary(e.name, e.input), isError: false });
    else if (e.type === 'tool_result' && e.isError)
      addItem({ kind: 'tool', name: e.name, summary: `${e.name}: ${e.content}`, isError: true });
    else if (e.type === 'preview')
      addItem({ kind: 'tool', name: 'preview', summary: e.reason === 'requested' ? '👁 Asked to see the page' : '👁 Checked the page after that step', isError: false });
    else if (e.type === 'question') addItem({ kind: 'question', text: e.question });
  }

  /** Encode any newly-available photos into vision blocks, tagged with the
   * assetId the editor tools address them by. */
  async function newPhotoBlocks(): Promise<ContentBlock[]> {
    const ids = usablePhotoIds(design, tray).filter((id) => !sentPhotoIds.current.has(id));
    if (ids.length === 0) return [];
    const photos = await encodePhotos(ids);
    const blocks: ContentBlock[] = [];
    for (const p of photos) {
      sentPhotoIds.current.add(p.assetId);
      blocks.push({ type: 'text', text: `Photo assetId="${p.assetId}" — ${p.width}×${p.height}px:` });
      blocks.push({ type: 'image', source: { type: 'base64', media_type: p.image.media_type, data: p.image.data } });
    }
    return blocks;
  }

  async function drive() {
    setBusy(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const result = await runCopilot(messagesRef.current, {
        apiKey: aiKey,
        system: buildCopilotSystemPrompt(styleProfile),
        tools,
        model: DEFAULT_MODEL,
        signal: controller.signal,
        onEvent,
      });
      setPending(result.status === 'awaiting_input' ? result.pending : null);
    } catch (err) {
      setError(err instanceof AiError ? err.message : 'The Copilot hit a problem. Try again.');
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  async function submit() {
    const text = input.trim();
    if (!text || busy) return;
    setInput('');
    addItem({ kind: 'user', text });

    if (pending) {
      // Resume: the typed text answers the model's question.
      messagesRef.current.push(buildResumeMessage(pending, text));
      setPending(null);
    } else {
      // A normal turn: attach any new photos, then the message.
      const blocks = await newPhotoBlocks();
      blocks.push({ type: 'text', text });
      messagesRef.current.push({ role: 'user', content: blocks });
    }
    await drive();
  }

  function stop() {
    abortRef.current?.abort();
  }

  function reset() {
    stop();
    messagesRef.current = [];
    sentPhotoIds.current = new Set();
    setItems([]);
    setPending(null);
    setError(null);
    setInput('');
  }

  async function exportPanel() {
    try {
      await editorActions.downloadImage('insta-post.png');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Export failed.');
    }
  }

  const photoCount = usablePhotoIds(design, tray).length;

  return (
    <>
      <button
        className="rounded-md bg-violet-500/20 px-2.5 py-1.5 text-sm text-violet-200 hover:bg-violet-500/30"
        onClick={() => setOpen(true)}
        title="Let Claude build your post"
      >
        ✦ Copilot
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={() => setOpen(false)}>
          <aside
            className="flex h-full w-full max-w-md flex-col border-l border-white/10 bg-[#1b1d22] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-white">✦ AI Post Copilot</h2>
                <p className="text-[11px] text-zinc-500">
                  Builds your post from your photos — no image generation.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button className="text-xs text-zinc-400 hover:text-zinc-200" onClick={reset} title="Start over">
                  Reset
                </button>
                <button className="text-zinc-400 hover:text-white" onClick={() => setOpen(false)}>
                  ✕
                </button>
              </div>
            </div>

            {/* Live preview strip — the panels the Copilot is building */}
            <div className="flex items-center gap-2 overflow-x-auto border-b border-white/10 bg-black/20 px-4 py-2">
              {design.pages.map((page, i) => (
                <div key={page.id} className="shrink-0 overflow-hidden rounded border border-white/10" title={`Panel ${i + 1}`}>
                  <PagePreview
                    page={page}
                    shared={design.shared}
                    width={design.width}
                    height={design.height}
                    displayHeight={72}
                  />
                </div>
              ))}
              <button
                className="ml-auto shrink-0 rounded-md bg-white/5 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-white/10"
                onClick={() => void exportPanel()}
                title="Download the current panel as a PNG"
              >
                ⤓ Export panel
              </button>
            </div>

            {/* Transcript */}
            <div ref={scrollRef} className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
              {items.length === 0 && (
                <div className="rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-zinc-400">
                  <p className="mb-2 text-zinc-300">Hi! I'll build your Instagram post from your photos.</p>
                  <p>
                    {photoCount > 0
                      ? `I can see ${photoCount} uploaded photo${photoCount === 1 ? '' : 's'}. `
                      : 'Upload a few photos first (drag them in), then '}
                    tell me what you want — a vibe, a caption, how many panels — and I'll design it live.
                    I'll ask if I need a decision.
                  </p>
                </div>
              )}
              {items.map((it) => (
                <TranscriptItem key={it.id} item={it} />
              ))}
              {busy && <p className="text-sm text-zinc-500">Working…</p>}
              {error && <p className="text-sm text-amber-400">{error}</p>}
            </div>

            {/* Composer */}
            <div className="border-t border-white/10 p-3">
              {pending && (
                <p className="mb-2 text-xs text-violet-300">Answer the Copilot's question to continue.</p>
              )}
              <div className="flex items-end gap-2">
                <textarea
                  className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-violet-400"
                  placeholder={pending ? 'Your answer…' : 'Describe the post you want…'}
                  value={input}
                  rows={1}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void submit();
                    }
                  }}
                  disabled={busy}
                />
                {busy ? (
                  <button
                    className="rounded-md bg-white/5 px-3 py-2 text-sm text-zinc-200 hover:bg-white/10"
                    onClick={stop}
                  >
                    Stop
                  </button>
                ) : (
                  <button
                    className="rounded-md bg-violet-500 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-400 disabled:opacity-50"
                    onClick={() => void submit()}
                    disabled={!input.trim()}
                  >
                    Send
                  </button>
                )}
              </div>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

function TranscriptItem({ item }: { item: Item }) {
  if (item.kind === 'user') {
    return (
      <div className="self-end rounded-lg rounded-br-sm bg-violet-500/20 px-3 py-2 text-sm text-violet-100">
        {item.text}
      </div>
    );
  }
  if (item.kind === 'assistant') {
    return <div className="whitespace-pre-wrap text-sm text-zinc-200">{item.text}</div>;
  }
  if (item.kind === 'question') {
    return (
      <div className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-sm text-violet-100">
        <span className="mr-1">❔</span>
        {item.text}
      </div>
    );
  }
  // tool chip
  return (
    <div
      className={`inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] ${
        item.isError ? 'bg-amber-500/15 text-amber-300' : 'bg-white/5 text-zinc-400'
      }`}
    >
      <span>{item.isError ? '⚠' : '▷'}</span>
      {item.summary}
    </div>
  );
}
