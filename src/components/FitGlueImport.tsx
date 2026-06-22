import { useState } from 'react';
import { useEditor } from '../store';
import { addImageAsset } from '../assets';
import {
  parseInput,
  fetchShowcase,
  fetchProfile,
  extractElements,
  entrySummary,
  type ShowcaseElements,
  type ProfileEntry,
  type StatItem,
  type ChartItem,
  type ImageItem,
} from '../fitglue';
import { renderChart, renderRoute } from '../fitglueRender';

export function FitGlueImport() {
  const addTextElement = useEditor((s) => s.addTextElement);
  const addImageLayer = useEditor((s) => s.addImageLayer);
  const design = useEditor((s) => s.design);

  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [json, setJson] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [els, setEls] = useState<ShowcaseElements | null>(null);
  const [entries, setEntries] = useState<ProfileEntry[] | null>(null);

  async function load() {
    setError(null);
    const parsed = parseInput(url);
    if (!parsed) {
      setError('Enter a showcase URL, a slug, or @handle.');
      return;
    }
    setLoading(true);
    try {
      if (parsed.type === 'profile') {
        const list = await fetchProfile(parsed.slug);
        setEntries(list);
        setEls(null);
        if (list.length === 0) setError('No public activities found for that handle.');
      } else {
        const data = await fetchShowcase(parsed.id);
        setEls(extractElements(data));
        setEntries(null);
      }
    } catch (err) {
      console.error(err);
      setError(
        'Could not fetch (often CORS until FitGlue redeploys). Paste the showcase JSON below instead.',
      );
      setShowPaste(true);
    } finally {
      setLoading(false);
    }
  }

  async function openEntry(e: ProfileEntry) {
    setError(null);
    setLoading(true);
    try {
      const data = await fetchShowcase(e.showcaseId);
      setEls(extractElements(data));
    } catch (err) {
      console.error(err);
      setError('Could not load that activity.');
    } finally {
      setLoading(false);
    }
  }

  function loadJson() {
    setError(null);
    try {
      setEls(extractElements(JSON.parse(json)));
    } catch {
      setError('That JSON could not be parsed.');
    }
  }

  async function addImageBlob(label: string, blob: Blob, name: string) {
    setBusy(label);
    try {
      const asset = await addImageAsset(new File([blob], name, { type: blob.type || 'image/png' }));
      addImageLayer(asset.id);
    } finally {
      setBusy(null);
    }
  }

  const addStat = (s: StatItem) =>
    addTextElement(s.value, {
      name: s.label,
      align: 'center',
      fontSize: Math.round(design.width * 0.09),
    });

  async function addChart(c: ChartItem) {
    setBusy(c.id);
    try {
      const blob = await renderChart(c.series, c.color);
      await addImageBlob(c.id, blob, `${c.metric}.png`);
    } finally {
      setBusy(null);
    }
  }

  async function addRoute() {
    if (!els?.route) return;
    setBusy('route');
    try {
      const blob = await renderRoute(els.route, '#c084fc');
      await addImageBlob('route', blob, 'route.png');
    } finally {
      setBusy(null);
    }
  }

  async function addRemoteImage(img: ImageItem) {
    setBusy(img.id);
    try {
      const res = await fetch(img.url, { mode: 'cors' });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      await addImageBlob(img.id, blob, `${img.label}.png`);
    } catch (err) {
      console.error(err);
      alert(
        `Could not load "${img.label}". The FitGlue storage bucket needs CORS enabled to bring photos in.`,
      );
    } finally {
      setBusy(null);
    }
  }

  const chip =
    'rounded-md bg-white/5 px-2 py-1.5 text-left text-sm hover:bg-white/10 disabled:opacity-50';

  return (
    <>
      <button
        className="rounded-md bg-white/5 px-3 py-1.5 text-sm font-semibold text-zinc-100 hover:bg-white/10"
        onClick={() => setOpen(true)}
        title="Import stats & graphics from a FitGlue showcase"
      >
        ⚡ FitGlue
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1b1d22] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <h2 className="text-base font-semibold text-white">Import from FitGlue</h2>
              <button className="text-zinc-400 hover:text-white" onClick={() => setOpen(false)}>✕</button>
            </div>

            <div className="flex flex-col gap-3 overflow-y-auto p-4">
              <div className="flex gap-2">
                <input
                  className="flex-1 rounded-md border border-white/10 bg-white/5 px-2 py-2 text-sm text-zinc-100 outline-none focus:border-violet-400"
                  placeholder="@you  ·  or a full activity URL"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && load()}
                />
                <button
                  className="rounded-md bg-violet-500 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-400 disabled:opacity-50"
                  onClick={load}
                  disabled={loading}
                >
                  {loading ? '…' : 'Load'}
                </button>
              </div>

              <button className="self-start text-xs text-zinc-400 underline"
                onClick={() => setShowPaste((v) => !v)}>
                {showPaste ? 'Hide' : 'Paste JSON instead'}
              </button>
              {showPaste && (
                <div className="flex flex-col gap-2">
                  <textarea
                    className="h-24 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-xs text-zinc-100 outline-none focus:border-violet-400"
                    placeholder="Paste the JSON from /api/public/showcase/…"
                    value={json}
                    onChange={(e) => setJson(e.target.value)}
                  />
                  <button className="self-start rounded-md bg-white/5 px-3 py-1.5 text-sm hover:bg-white/10"
                    onClick={loadJson}>
                    Parse JSON
                  </button>
                </div>
              )}

              {error && <p className="text-sm text-amber-400">{error}</p>}

              {/* Activity picker (after entering a @handle). */}
              {entries && !els && (
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
                    Pick an activity
                  </p>
                  <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
                    {entries.map((e) => (
                      <button
                        key={e.showcaseId}
                        className="flex items-center gap-3 rounded-md bg-white/5 px-2 py-2 text-left text-sm hover:bg-white/10"
                        onClick={() => openEntry(e)}
                      >
                        {e.routeThumbnailUrl && (
                          <img src={e.routeThumbnailUrl} alt="" className="h-8 w-8 rounded object-cover" />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate font-semibold text-white">{e.title}</span>
                          <span className="block truncate text-xs text-zinc-400">{entrySummary(e)}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {els && (
                <div className="flex flex-col gap-4">
                  {entries && (
                    <button className="self-start text-xs text-violet-300 hover:underline"
                      onClick={() => setEls(null)}>
                      ← Back to activities
                    </button>
                  )}
                  {/* Title */}
                  <div>
                    <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">Headline</p>
                    <div className="flex flex-wrap gap-1.5">
                      <button className={chip} onClick={() =>
                        addTextElement(els.title, { name: 'Title', fontSize: Math.round(design.width * 0.12) })}>
                        {els.title}
                      </button>
                      {els.subtitle && (
                        <button className={chip} onClick={() =>
                          addTextElement(els.subtitle, { name: 'Subtitle', fontSize: Math.round(design.width * 0.05), fill: '#d4d4d8' })}>
                          {els.subtitle}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Stats */}
                  {els.stats.length > 0 && (
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">Stats (add as text)</p>
                      <div className="grid grid-cols-2 gap-1.5">
                        {els.stats.map((s) => (
                          <button key={s.id} className={chip} onClick={() => addStat(s)}>
                            <span className="text-zinc-400">{s.label}: </span>
                            <span className="font-semibold text-white">{s.value}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Charts */}
                  {els.charts.length > 0 && (
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">Charts (transparent graphic)</p>
                      <div className="flex flex-wrap gap-1.5">
                        {els.charts.map((c) => (
                          <button key={c.id} className={chip} disabled={busy === c.id} onClick={() => addChart(c)}>
                            {busy === c.id ? 'Rendering…' : `📈 ${c.label}`}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Route */}
                  {els.route && (
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">Route</p>
                      <button className={chip} disabled={busy === 'route'} onClick={addRoute}>
                        {busy === 'route' ? 'Rendering…' : '🗺 Route map'}
                      </button>
                    </div>
                  )}

                  {/* Images */}
                  {els.images.length > 0 && (
                    <div>
                      <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">Photos & images</p>
                      <div className="flex flex-wrap gap-1.5">
                        {els.images.map((img) => (
                          <button key={img.id} className={chip} disabled={busy === img.id} onClick={() => addRemoteImage(img)}>
                            {busy === img.id ? 'Loading…' : `🖼 ${img.label}`}
                          </button>
                        ))}
                      </div>
                    </div>
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
