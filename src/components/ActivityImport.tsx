import { useState } from 'react';
import { useEditor } from '../store';
import { addImageAsset } from '../assets';
import {
  cardSummary,
  fetchImage,
  listActivities,
  overlayBox,
  overlayPieces,
  type ActivityCard,
  type OverlayPiece,
  type Tone,
} from '../activities';

/** Checkerboards that show off a transparent overlay in each tone. */
const CHECKER: Record<Tone, string> = {
  light: 'repeating-conic-gradient(#3b4540 0 25%, #4a5650 0 50%) 0 0 / 16px 16px',
  dark: 'repeating-conic-gradient(#e8e4da 0 25%, #f6f3ec 0 50%) 0 0 / 16px 16px',
};

export function ActivityImport() {
  const addImageLayer = useEditor((s) => s.addImageLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const design = useEditor((s) => s.design);

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cards, setCards] = useState<ActivityCard[] | null>(null);
  const [card, setCard] = useState<ActivityCard | null>(null);
  const [tone, setTone] = useState<Tone>('light');

  async function show() {
    setOpen(true);
    if (cards) return;
    setError(null);
    setLoading(true);
    try {
      setCards(await listActivities());
    } catch (err) {
      console.error(err);
      setError('Could not load your activities from james.ripixel.co.uk.');
    } finally {
      setLoading(false);
    }
  }

  async function place(key: string, url: string, name: string, box: { x: number; y: number; width: number; height: number }) {
    setBusy(key);
    setError(null);
    try {
      const blob = await fetchImage(url);
      const asset = await addImageAsset(new File([blob], `${name}.png`, { type: blob.type || 'image/png' }));
      const id = addImageLayer(asset.id);
      updateLayer(id, { ...box, name });
    } catch (err) {
      console.error(err);
      setError(`Could not add "${name}".`);
    } finally {
      setBusy(null);
    }
  }

  function addPiece(p: OverlayPiece) {
    const o = p.tones[tone] ?? p.tones.light ?? p.tones.dark;
    if (!card || !o) return;
    void place(`${p.piece}-${o.tone}`, o.url, `${card.title} · ${p.label}`, overlayBox({ ...o, layout: p.layout }, design.width, design.height));
  }

  function addCard() {
    if (!card?.image) return;
    void place('card', card.image, `${card.title} · card`, overlayBox({ w: 1080, h: 1920, layout: true }, design.width, design.height));
  }

  const pieces = card ? overlayPieces(card) : [];
  const toneBtn = (t: Tone) =>
    `rounded-md px-2 py-1 text-xs font-semibold ${tone === t ? 'bg-violet-500 text-white' : 'bg-white/5 text-zinc-300 hover:bg-white/10'}`;

  return (
    <>
      <button
        className="rounded-md bg-white/5 px-3 py-1.5 text-sm font-semibold text-zinc-100 hover:bg-white/10"
        onClick={show}
        title="Lay your activity's stats, route and charts over a photo"
      >
        ⚡ Activities
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setOpen(false)}>
          <div
            className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1b1d22] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h2 className="text-base font-semibold text-white">{card ? card.title : 'Your activities'}</h2>
              <button className="text-zinc-400 hover:text-white" onClick={() => setOpen(false)} aria-label="Close">✕</button>
            </div>

            <div className="flex flex-col gap-3 overflow-y-auto p-4">
              {loading && <p className="text-sm text-zinc-400">Loading…</p>}
              {error && <p className="text-sm text-amber-400">{error}</p>}

              {!card && cards && (
                <>
                  {cards.length === 0 && <p className="text-sm text-zinc-400">No recent activities with overlays.</p>}
                  <div className="flex flex-col gap-1">
                    {cards.map((c) => (
                      <button
                        key={c.id}
                        className="flex items-center gap-3 rounded-md bg-white/5 px-2 py-2 text-left text-sm hover:bg-white/10"
                        onClick={() => setCard(c)}
                      >
                        {c.image && <img src={c.image} alt="" className="h-12 w-[27px] rounded object-cover" loading="lazy" />}
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-white">{c.title}</span>
                          <span className="block truncate text-xs text-zinc-400">{cardSummary(c)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </>
              )}

              {card && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button className="text-xs text-violet-300 hover:underline" onClick={() => setCard(null)}>
                      ← All activities
                    </button>
                    <span className="ml-auto text-[10px] uppercase tracking-wide text-zinc-500">Tone</span>
                    <button className={toneBtn('light')} onClick={() => setTone('light')} title="White with a shadow: most photos">Light</button>
                    <button className={toneBtn('dark')} onClick={() => setTone('dark')} title="Ink with a white halo: bright photos">Dark</button>
                  </div>
                  <p className="text-xs text-zinc-400">
                    Transparent overlays: tap one to lay it over your photo. Layouts cover the whole post; the rest are stickers.
                  </p>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {pieces.map((p) => {
                      const o = p.tones[tone] ?? p.tones.light ?? p.tones.dark;
                      if (!o) return null;
                      const key = `${p.piece}-${o.tone}`;
                      return (
                        <button
                          key={p.piece}
                          className="flex flex-col overflow-hidden rounded-md border border-white/10 text-left hover:border-violet-400 disabled:opacity-50"
                          onClick={() => addPiece(p)}
                          disabled={busy === key}
                        >
                          <span className="flex h-28 items-center justify-center p-2" style={{ background: CHECKER[o.tone] }}>
                            <img src={o.url} alt="" className="max-h-full max-w-full object-contain" loading="lazy" />
                          </span>
                          <span className="bg-white/5 px-2 py-1 text-xs font-semibold text-zinc-200">
                            {busy === key ? 'Adding…' : p.label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {card.image && (
                    <button className="self-start rounded-md bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10 disabled:opacity-50" onClick={addCard} disabled={busy === 'card'}>
                      {busy === 'card' ? 'Adding…' : '🖼 Whole share card (with its background)'}
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
