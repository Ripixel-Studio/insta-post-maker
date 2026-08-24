import { useRef, useState } from 'react';
import { useEditor } from '../store';
import { AiError } from '../ai/client';
import {
  distillStyleProfile,
  encodePostImage,
  MAX_SAMPLE_POSTS,
  type StyleProfile,
} from '../ai/styleProfile';

/** A picked example post awaiting distillation (thumbnail + source file). */
interface Sample {
  id: string;
  file: File;
  url: string;
}

let sampleCounter = 0;
function sampleId(): string {
  sampleCounter += 1;
  return `sample_${sampleCounter}`;
}

/**
 * "Style profile" — upload a few finished example posts and distil a reusable,
 * on-device style profile from them via a single Claude-vision pass. Gated
 * behind `<AiGate>` at the mount site, so it only appears once a key is set.
 */
export function StyleProfilePanel() {
  const profile = useEditor((s) => s.styleProfile);
  const setStyleProfile = useEditor((s) => s.setStyleProfile);
  const aiKey = useEditor((s) => s.aiKey);

  const [open, setOpen] = useState(false);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function clearSamples() {
    setSamples((prev) => {
      prev.forEach((s) => URL.revokeObjectURL(s.url));
      return [];
    });
  }

  function close() {
    setOpen(false);
    clearSamples();
    setBusy(false);
    setError(null);
  }

  function addFiles(list: FileList | null) {
    if (!list) return;
    setError(null);
    const picked = Array.from(list).filter((f) => f.type.startsWith('image/'));
    setSamples((prev) => {
      const room = MAX_SAMPLE_POSTS - prev.length;
      const next = picked.slice(0, Math.max(0, room)).map((file) => ({
        id: sampleId(),
        file,
        url: URL.createObjectURL(file),
      }));
      return [...prev, ...next];
    });
  }

  function removeSample(id: string) {
    setSamples((prev) => {
      const gone = prev.find((s) => s.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((s) => s.id !== id);
    });
  }

  async function distil() {
    if (samples.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const images = await Promise.all(samples.map((s) => encodePostImage(s.file)));
      const result = await distillStyleProfile(aiKey, images);
      setStyleProfile(result);
      clearSamples();
    } catch (err) {
      setError(err instanceof AiError ? err.message : 'Could not distil a style profile. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        className={`rounded-md px-2.5 py-1.5 text-sm ${
          profile
            ? 'bg-violet-500/20 text-violet-200 hover:bg-violet-500/30'
            : 'bg-white/5 text-zinc-300 hover:bg-white/10'
        }`}
        onClick={() => setOpen(true)}
        title="Distil a reusable style profile from your example posts"
      >
        ✦ Style profile
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={close}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1b1d22] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h2 className="text-base font-semibold text-white">Style profile</h2>
              <button className="text-zinc-400 hover:text-white" onClick={close}>
                ✕
              </button>
            </div>

            <div className="flex flex-col gap-4 overflow-y-auto p-4">
              <p className="text-sm text-zinc-400">
                Upload a few <strong className="text-zinc-300">finished posts you're happy with</strong>{' '}
                and Claude will distil the style they share — palette, typography, mood and caption
                voice — into a reusable profile stored{' '}
                <strong className="text-zinc-300">only on this device</strong>. Future AI suggestions
                can then stay on-brand.
              </p>

              {/* Existing profile */}
              {profile && (
                <ProfileView profile={profile} onRemove={() => setStyleProfile(null)} />
              )}

              {/* Sample picker */}
              <div className="flex flex-col gap-2">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">
                  {profile ? 'Re-distil from new posts' : 'Example posts'} · up to {MAX_SAMPLE_POSTS}
                </p>

                {samples.length > 0 && (
                  <div className="grid grid-cols-4 gap-2">
                    {samples.map((s) => (
                      <div key={s.id} className="group relative aspect-square">
                        <img
                          src={s.url}
                          alt=""
                          className="h-full w-full rounded-md object-cover"
                        />
                        <button
                          className="absolute right-1 top-1 rounded-full bg-black/70 px-1.5 text-xs text-white opacity-0 group-hover:opacity-100"
                          onClick={() => removeSample(s.id)}
                          title="Remove"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    className="rounded-md bg-white/5 px-3 py-1.5 text-sm text-zinc-200 hover:bg-white/10 disabled:opacity-50"
                    onClick={() => fileRef.current?.click()}
                    disabled={samples.length >= MAX_SAMPLE_POSTS || busy}
                  >
                    + Add posts
                  </button>
                  {samples.length > 0 && (
                    <button
                      className="text-xs text-zinc-400 hover:text-zinc-200"
                      onClick={clearSamples}
                      disabled={busy}
                    >
                      Clear
                    </button>
                  )}
                  <button
                    className="ml-auto rounded-md bg-violet-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-violet-400 disabled:opacity-50"
                    onClick={() => void distil()}
                    disabled={samples.length === 0 || busy}
                  >
                    {busy ? 'Distilling…' : profile ? 'Re-distil' : 'Distil style profile'}
                  </button>
                </div>

                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />

                {error && <p className="text-sm text-amber-400">{error}</p>}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ProfileView({ profile, onRemove }: { profile: StyleProfile; onRemove: () => void }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-violet-500/30 bg-violet-500/10 p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium text-violet-100">{profile.summary}</p>
        <button
          className="shrink-0 rounded-md bg-white/5 px-2 py-1 text-xs text-zinc-300 hover:bg-white/10"
          onClick={onRemove}
        >
          Remove
        </button>
      </div>

      {profile.palette.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {profile.palette.map((c) => (
            <span key={c} className="flex items-center gap-1 rounded bg-black/30 px-1.5 py-0.5 text-xs text-zinc-300">
              <span
                className="inline-block h-3 w-3 rounded-sm border border-white/20"
                style={{ background: c }}
              />
              {c}
            </span>
          ))}
        </div>
      )}

      <Field label="Typography" value={profile.typography} />
      <Field label="Composition" value={profile.composition} />
      <Chips label="Mood" items={profile.mood} />
      <Chips label="Motifs" items={profile.motifs} />
      <Field label="Caption voice" value={profile.captionVoice} />

      {profile.recommendations.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">Recommendations</p>
          <ul className="list-disc pl-4 text-zinc-300">
            {profile.recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[11px] text-zinc-500">
        Captured from {profile.sampleCount} {profile.sampleCount === 1 ? 'post' : 'posts'}.
      </p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <p className="mb-0.5 text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="text-zinc-300">{value}</p>
    </div>
  );
}

function Chips({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <div className="flex flex-wrap gap-1">
        {items.map((it) => (
          <span key={it} className="rounded bg-black/30 px-1.5 py-0.5 text-xs text-zinc-300">
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}
