import { useState } from 'react';
import { useEditor } from '../store';
import { useAiEnabled } from '../ai/useAiEnabled';
import { storeKey, clearStoredKey } from '../ai/storage';
import { validateKey, looksLikeApiKey, AI_MODELS, DEFAULT_MODEL } from '../ai/client';

type Status =
  | { kind: 'idle' }
  | { kind: 'verifying' }
  | { kind: 'ok' }
  | { kind: 'warn'; message: string };

const CONSOLE_URL = 'https://console.anthropic.com/settings/keys';

/**
 * Settings entry point for bringing your own Claude API key. This button is
 * always visible (it's how you enable AI in the first place) — the *AI features*
 * themselves are what stay hidden until a key exists, via `<AiGate>`.
 */
export function AiSettings() {
  const enabled = useAiEnabled();
  const setAiKey = useEditor((s) => s.setAiKey);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [reveal, setReveal] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  function close() {
    setOpen(false);
    setDraft('');
    setReveal(false);
    setStatus({ kind: 'idle' });
  }

  async function save() {
    const key = draft.trim();
    if (!looksLikeApiKey(key)) {
      setStatus({ kind: 'warn', message: 'That does not look like an Anthropic key (they start with "sk-ant-").' });
      return;
    }
    // Store immediately so AI unlocks even offline; then verify in the
    // background and surface a warning if the key doesn't actually work.
    await storeKey(key);
    setAiKey(key);
    setDraft('');
    setStatus({ kind: 'verifying' });
    const result = await validateKey(key);
    setStatus(result.ok ? { kind: 'ok' } : { kind: 'warn', message: `Saved, but verification failed: ${result.error}` });
  }

  async function remove() {
    await clearStoredKey();
    setAiKey('');
    setStatus({ kind: 'idle' });
  }

  const defaultModelLabel = AI_MODELS.find((m) => m.id === DEFAULT_MODEL)?.label ?? DEFAULT_MODEL;

  return (
    <>
      <button
        className={`rounded-md px-2.5 py-1.5 text-sm ${
          enabled
            ? 'bg-violet-500/20 text-violet-200 hover:bg-violet-500/30'
            : 'bg-white/5 text-zinc-300 hover:bg-white/10'
        }`}
        onClick={() => setOpen(true)}
        title="Claude AI settings (bring your own key)"
      >
        {enabled ? '✦ AI on' : '✦ Connect AI'}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={close}>
          <div
            className="w-full max-w-md rounded-xl border border-white/10 bg-[#1b1d22] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-white">Claude AI — bring your own key</h2>
              <button className="text-zinc-400 hover:text-white" onClick={close}>
                ✕
              </button>
            </div>

            <p className="mb-3 text-sm text-zinc-400">
              AI features (like copy suggestions) call Claude directly from your browser using your
              own Anthropic key. The key is stored <strong className="text-zinc-300">only on this
              device</strong> and is never sent anywhere but Anthropic — this app has no server.
              Requests are billed to your Anthropic account. Default model:{' '}
              <span className="text-zinc-300">{defaultModelLabel}</span>.
            </p>

            {enabled ? (
              <div className="mb-3 rounded-lg border border-violet-500/30 bg-violet-500/10 p-3 text-sm">
                <p className="font-medium text-violet-200">A key is connected on this device.</p>
                <p className="mt-1 text-zinc-400">Replace it below, or remove it to hide all AI features.</p>
              </div>
            ) : (
              <p className="mb-3 text-sm text-zinc-500">
                No key yet — AI features stay hidden until you add one.
              </p>
            )}

            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              {enabled ? 'Replace key' : 'API key'}
            </label>
            <div className="flex gap-2">
              <input
                className="min-w-0 flex-1 rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 font-mono text-sm text-zinc-100 outline-none focus:border-violet-400"
                type={reveal ? 'text' : 'password'}
                placeholder="sk-ant-…"
                autoComplete="off"
                spellCheck={false}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setStatus({ kind: 'idle' });
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void save();
                }}
              />
              <button
                className="rounded-md bg-white/5 px-2.5 py-1.5 text-sm text-zinc-300 hover:bg-white/10"
                onClick={() => setReveal((r) => !r)}
                title={reveal ? 'Hide key' : 'Show key'}
                type="button"
              >
                {reveal ? '🙈' : '👁'}
              </button>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <button
                className="rounded-md bg-violet-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-400 disabled:opacity-50"
                onClick={() => void save()}
                disabled={!draft.trim() || status.kind === 'verifying'}
              >
                {status.kind === 'verifying' ? 'Verifying…' : 'Save & verify'}
              </button>
              {enabled && (
                <button
                  className="rounded-md bg-white/5 px-3 py-1.5 text-sm text-zinc-200 hover:bg-white/10"
                  onClick={() => void remove()}
                >
                  Remove key
                </button>
              )}
              <a
                className="ml-auto text-sm text-violet-300 hover:text-violet-200"
                href={CONSOLE_URL}
                target="_blank"
                rel="noreferrer"
              >
                Get a key ↗
              </a>
            </div>

            {status.kind === 'ok' && (
              <p className="mt-3 text-sm text-emerald-400">✓ Key verified and saved on this device.</p>
            )}
            {status.kind === 'warn' && (
              <p className="mt-3 text-sm text-amber-400">{status.message}</p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
