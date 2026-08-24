import { useRef, useState } from 'react';
import { useEditor, activePage } from '../store';
import { importFilesToCanvas } from '../bulkImport';
import { LAYOUTS } from '../collage';
import { promptAddQrCode } from '../qr';
import { exportDesign, downloadBlob, shareBlob, canShareFiles } from '../export';
import { ProjectsMenu } from './ProjectsMenu';
import { TemplatesMenu } from './TemplatesMenu';
import { FitGlueImport } from './FitGlueImport';
import { AnimateMenu } from './AnimateMenu';
import { HelpOverlay } from './HelpOverlay';
import { AiSettings } from './AiSettings';
import { StyleProfilePanel } from './StyleProfilePanel';
import { AiGate } from '../ai/AiGate';
import { EmojiPicker } from './EmojiPicker';
import { PageBar } from './PageBar';
import { PRESETS } from '../presets';
import { canRecordVideo } from '../motion';

const pill = 'rounded-full bg-black/55 px-4 py-2 text-sm font-semibold text-white backdrop-blur active:bg-black/70 disabled:opacity-40';
const iconPill = 'flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-lg text-white backdrop-blur active:bg-black/70 disabled:opacity-40';

/** Slide-up bottom sheet for mobile menus. */
function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode }) {
  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/40" onClick={onClose} />}
      <div
        className={`fixed inset-x-0 bottom-0 z-40 flex max-h-[70vh] flex-col rounded-t-2xl border-t border-white/10 bg-[#14161b] shadow-2xl transition-transform duration-200 ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
          <span className="text-sm font-semibold text-zinc-200">{title}</span>
          <button className="rounded-md bg-white/5 px-3 py-1 text-sm" onClick={onClose}>Done</button>
        </div>
        <div className="flex flex-col gap-2 overflow-y-auto p-4">{children}</div>
      </div>
    </>
  );
}

export function MobileShell() {
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const selectedId = useEditor((s) => s.selectedId);
  const pageLayers = useEditor((s) => activePage(s).layers);
  const sharedLayers = useEditor((s) => s.design.shared);
  const duplicateLayer = useEditor((s) => s.duplicateLayer);
  const removeLayer = useEditor((s) => s.removeLayer);
  const moveLayer = useEditor((s) => s.moveLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const setSheetOpen = useEditor((s) => s.setSheetOpen);
  const addTextLayer = useEditor((s) => s.addTextLayer);
  const addOverlayLayer = useEditor((s) => s.addOverlayLayer);
  const addShapeLayer = useEditor((s) => s.addShapeLayer);
  const applyLayout = useEditor((s) => s.applyLayout);
  const importProgress = useEditor((s) => s.importProgress);
  const setDrawMode = useEditor((s) => s.setDrawMode);
  const magicResize = useEditor((s) => s.magicResize);
  const design = useEditor((s) => s.design);

  const [sheet, setSheet] = useState<'add' | 'pages' | 'more' | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const selected = [...pageLayers, ...sharedLayers].find((l) => l.id === selectedId);

  async function onAddImage(files: FileList | null) {
    setSheet(null);
    await importFilesToCanvas(files);
  }

  async function doExport(share: boolean) {
    setBusy(true);
    try {
      const { setActivePage, activePageIndex: orig } = useEditor.getState();
      const total = design.pages.length;
      const next = () => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
      for (let i = 0; i < total; i++) {
        if (total > 1) {
          setActivePage(i);
          await next();
          await new Promise((r) => setTimeout(r, 140));
        }
        const blob = await exportDesign(useEditor.getState().design, { format: 'png', multiplier: 1 });
        const name = total > 1 ? `page-${i + 1}-of-${total}.png` : 'post.png';
        if (share && (await shareBlob(blob, name))) {
          // shared
        } else {
          downloadBlob(blob, name);
        }
      }
      if (total > 1) setActivePage(orig);
    } catch (err) {
      console.error(err);
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const addItem = 'rounded-lg bg-white/5 px-3 py-3 text-sm font-medium hover:bg-white/10';

  return (
    <div className="md:hidden">
      {/* Top floating controls */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-start justify-between p-2"
        style={{ paddingTop: 'calc(0.5rem + env(safe-area-inset-top))' }}
      >
        <button className={`pointer-events-auto ${pill}`} onClick={() => setSheet('more')}>☰</button>
        {importProgress && importProgress.done < importProgress.total && (
          <span className="pointer-events-auto rounded-full bg-violet-500/90 px-3 py-2 text-xs font-semibold text-white backdrop-blur">
            Importing {importProgress.done}/{importProgress.total}…
          </span>
        )}
        <div className="pointer-events-auto flex gap-2">
          <button className={iconPill} onClick={undo} disabled={!canUndo}>↶</button>
          <button className={iconPill} onClick={redo} disabled={!canRedo}>↷</button>
          <button className={pill} disabled={busy} onClick={() => doExport(canShareFiles())}>
            {busy ? '…' : canShareFiles() ? 'Share' : 'Export'}
          </button>
        </div>
      </div>

      {/* Contextual selection mini-bar */}
      {selected && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[68px] z-30 flex justify-center">
          <div className="pointer-events-auto flex gap-1.5 rounded-full bg-black/55 px-2 py-1.5 backdrop-blur">
            <button className={iconPill} title="Duplicate" onClick={() => duplicateLayer(selected.id)}>⧉</button>
            <button className={iconPill} title="Forward" onClick={() => moveLayer(selected.id, 'up')}>↑</button>
            <button className={iconPill} title="Back" onClick={() => moveLayer(selected.id, 'down')}>↓</button>
            <button className={iconPill} title={selected.locked ? 'Unlock' : 'Lock'}
              onClick={() => updateLayer(selected.id, { locked: !selected.locked })}>
              {selected.locked ? '🔒' : '🔓'}
            </button>
            <button className={iconPill} title="Edit" onClick={() => setSheetOpen(true)}>✎</button>
            <button className={iconPill} title="Delete" onClick={() => removeLayer(selected.id)}>🗑</button>
          </div>
        </div>
      )}

      {/* Bottom floating bar */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 z-30 flex items-center justify-center gap-3 p-2"
        style={{ paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom))' }}
      >
        <button className={`pointer-events-auto ${pill}`} onClick={() => setSheet('add')}>＋ Add</button>
        <button className={`pointer-events-auto ${pill}`} onClick={() => setSheet('pages')}>▦ Pages</button>
        <button className={`pointer-events-auto ${pill}`} onClick={() => setSheetOpen(true)}>✎ Edit</button>
      </div>

      <input ref={fileRef} type="file" accept="image/*" multiple hidden
        onChange={(e) => { void onAddImage(e.target.files); e.target.value = ''; }} />

      {/* Add sheet */}
      <Sheet open={sheet === 'add'} onClose={() => setSheet(null)} title="Add">
        <div className="grid grid-cols-3 gap-2">
          <button className={addItem} onClick={() => fileRef.current?.click()}>🖼 Image</button>
          <button className={addItem} onClick={() => { addTextLayer(); setSheet(null); }}>🅣 Text</button>
          <span className={addItem}><EmojiPicker /></span>
          <button className={addItem} onClick={() => { addOverlayLayer(); setSheet(null); }}>🌗 Gradient</button>
          <button className={addItem} onClick={() => { addShapeLayer('rect'); setSheet(null); }}>▭ Rect</button>
          <button className={addItem} onClick={() => { addShapeLayer('ellipse'); setSheet(null); }}>◯ Ellipse</button>
          <button className={addItem} onClick={() => { addShapeLayer('line'); setSheet(null); }}>／ Line</button>
          <button className={addItem} onClick={() => { setDrawMode(true); setSheet(null); }}>✏️ Draw</button>
          <button className={addItem} onClick={() => { void promptAddQrCode(); setSheet(null); }}>▦ QR</button>
        </div>
        <p className="mt-1 text-[10px] uppercase tracking-wide text-zinc-500">Collage layout</p>
        <div className="flex flex-wrap gap-1.5">
          {LAYOUTS.map((l) => (
            <button key={l.id} className="rounded-md bg-white/5 px-2 py-1.5 text-sm hover:bg-white/10"
              onClick={() => { applyLayout(l.build()); setSheet(null); }}>
              {l.label}
            </button>
          ))}
        </div>
      </Sheet>

      {/* Pages sheet */}
      <Sheet open={sheet === 'pages'} onClose={() => setSheet(null)} title="Pages">
        <PageBar />
      </Sheet>

      {/* More sheet */}
      <Sheet open={sheet === 'more'} onClose={() => setSheet(null)} title="Menu">
        <div className="flex flex-wrap items-center gap-2">
          <ProjectsMenu />
          <TemplatesMenu />
          <FitGlueImport />
          {canRecordVideo() && <AnimateMenu />}
          <AiSettings />
          <AiGate>
            <StyleProfilePanel />
          </AiGate>
          <HelpOverlay />
        </div>
        <p className="mt-2 text-[10px] uppercase tracking-wide text-zinc-500">Resize (reflow)</p>
        <div className="grid grid-cols-2 gap-1.5">
          {PRESETS.map((p) => (
            <button key={p.id} className="rounded-md bg-white/5 px-2 py-1.5 text-sm hover:bg-white/10"
              onClick={() => magicResize(p.width, p.height)}>
              {p.label}
            </button>
          ))}
        </div>
      </Sheet>
    </div>
  );
}
