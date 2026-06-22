import { useState } from 'react';
import { useEditor } from '../store';
import { exportAnimation, type AnimPreset } from '../motion';
import { downloadBlob } from '../export';
import { PRESETS } from '../presets';

export function AnimateMenu() {
  const design = useEditor((s) => s.design);
  const updateLayer = useEditor((s) => s.updateLayer);
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<AnimPreset>('reveal');
  const [seconds, setSeconds] = useState(4);
  const [busy, setBusy] = useState(false);

  const activePreset = PRESETS.find((p) => p.width === design.width && p.height === design.height);

  async function run() {
    setBusy(true);
    try {
      const { blob, ext } = await exportAnimation(design, { preset, seconds });
      downloadBlob(blob, `${activePreset?.id ?? 'design'}-${preset}.${ext}`);
      setOpen(false);
    } catch (err) {
      console.error(err);
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Layers shown top-first (paint order reversed), with their reveal step.
  const layersTopFirst = [...design.layers].reverse();

  return (
    <div className="relative">
      <button
        className="rounded-md bg-white/5 px-3 py-1.5 text-sm font-semibold text-zinc-100 hover:bg-white/10"
        onClick={() => setOpen((o) => !o)}
        title="Export an animated clip (MP4/WebM)"
      >
        🎬 Animate
      </button>

      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-72 rounded-lg border border-white/10 bg-[#1b1d22] p-3 shadow-2xl">
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">Style</p>
          <div className="mb-3 flex gap-1">
            {(['reveal', 'kenburns'] as AnimPreset[]).map((p) => (
              <button
                key={p}
                className={`flex-1 rounded-md px-2 py-1.5 text-sm ${
                  preset === p ? 'bg-violet-500 text-white' : 'bg-white/5 hover:bg-white/10'
                }`}
                onClick={() => setPreset(p)}
              >
                {p === 'reveal' ? 'Layer reveal' : 'Ken Burns'}
              </button>
            ))}
          </div>

          <label className="mb-3 block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
              Duration — {seconds}s
            </span>
            <input
              type="range"
              min={2}
              max={8}
              step={0.5}
              value={seconds}
              className="w-full accent-violet-500"
              onChange={(e) => setSeconds(Number(e.target.value))}
            />
          </label>

          {preset === 'reveal' && (
            <div className="mb-3">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Reveal steps
              </p>
              <p className="mb-2 text-xs text-zinc-500">
                Lower numbers appear first. Give layers the <em>same</em> number to reveal them
                together.
              </p>
              <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
                {layersTopFirst.map((layer, i) => {
                  // Default shown value mirrors the auto 1-based paint-order step.
                  const autoStep = design.layers.length - i;
                  return (
                    <div key={layer.id} className="flex items-center gap-2 text-sm">
                      <span className="flex-1 truncate text-zinc-300">{layer.name}</span>
                      <input
                        type="number"
                        min={1}
                        className="w-16 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-sm text-zinc-100 outline-none focus:border-violet-400"
                        value={layer.animStep ?? autoStep}
                        onChange={(e) =>
                          updateLayer(layer.id, { animStep: Math.max(1, Number(e.target.value)) })
                        }
                      />
                    </div>
                  );
                })}
                {design.layers.length === 0 && (
                  <p className="text-sm text-zinc-500">Add some layers first.</p>
                )}
              </div>
            </div>
          )}

          <button
            className="w-full rounded-md bg-violet-500 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-400 disabled:opacity-50"
            onClick={run}
            disabled={busy}
          >
            {busy ? 'Rendering…' : 'Export clip'}
          </button>
        </div>
      )}
    </div>
  );
}
