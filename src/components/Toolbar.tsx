import { useRef, useState } from 'react';
import { useEditor } from '../store';
import { PRESETS } from '../presets';
import { importFilesSmart } from '../bulkImport';
import {
  exportDesign,
  exportCarousel,
  downloadBlob,
  shareBlob,
  canShareFiles,
  type ExportFormat,
} from '../export';
import { canRecordVideo } from '../motion';
import { AnimateMenu } from './AnimateMenu';
import { ProjectsMenu } from './ProjectsMenu';
import { TemplatesMenu } from './TemplatesMenu';
import { FitGlueImport } from './FitGlueImport';
import { EmojiPicker } from './EmojiPicker';
import { AddMenu } from './AddMenu';
import { HelpOverlay } from './HelpOverlay';
import { LAYOUTS } from '../collage';
import { promptAddQrCode } from '../qr';

function btn(active = false) {
  return [
    'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
    active
      ? 'bg-violet-500 text-white'
      : 'bg-white/5 text-zinc-200 hover:bg-white/10',
  ].join(' ');
}

export function Toolbar() {
  const design = useEditor((s) => s.design);
  const magicResize = useEditor((s) => s.magicResize);
  const addTextLayer = useEditor((s) => s.addTextLayer);
  const addOverlayLayer = useEditor((s) => s.addOverlayLayer);
  const addShapeLayer = useEditor((s) => s.addShapeLayer);
  const applyLayout = useEditor((s) => s.applyLayout);
  const clearCollage = useEditor((s) => s.clearCollage);
  const drawMode = useEditor((s) => s.drawMode);
  const setDrawMode = useEditor((s) => s.setDrawMode);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);

  const fileRef = useRef<HTMLInputElement>(null);
  const [format, setFormat] = useState<ExportFormat>('png');
  const [multiplier, setMultiplier] = useState<1 | 2>(1);
  const [slides, setSlides] = useState(1);
  const [busy, setBusy] = useState(false);

  const activePreset = PRESETS.find(
    (p) => p.width === design.width && p.height === design.height,
  );

  // One photo drops straight onto the canvas; a multi-select batch is staged in
  // the image tray (see importFilesSmart).
  function handleFiles(files: FileList | null) {
    void importFilesSmart(files);
  }

  async function build() {
    const blob = await exportDesign(design, { format, multiplier });
    const name = `${activePreset?.id ?? 'design'}-${design.width}x${design.height}${
      multiplier === 2 ? '@2x' : ''
    }.${format === 'png' ? 'png' : 'jpg'}`;
    return { blob, name };
  }

  /** Render every page by switching the active page and waiting for a repaint. */
  async function exportAllPages() {
    const ext = format === 'png' ? 'png' : 'jpg';
    const { setActivePage, activePageIndex: original } = useEditor.getState();
    const total = useEditor.getState().design.pages.length;
    const nextFrame = () =>
      new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    for (let i = 0; i < total; i++) {
      setActivePage(i);
      await nextFrame();
      await new Promise((r) => setTimeout(r, 140)); // let images/fonts settle
      const blob = await exportDesign(useEditor.getState().design, { format, multiplier });
      downloadBlob(blob, `page-${i + 1}-of-${total}.${ext}`);
      await new Promise((r) => setTimeout(r, 150));
    }
    setActivePage(original);
  }

  async function handleExport() {
    setBusy(true);
    try {
      if (design.pages.length > 1) {
        await exportAllPages();
      } else if (slides > 1) {
        const blobs = await exportCarousel(design, { format, multiplier }, slides);
        const ext = format === 'png' ? 'png' : 'jpg';
        // Stagger downloads so the browser doesn't block the batch.
        blobs.forEach((blob, i) =>
          setTimeout(() => downloadBlob(blob, `carousel-${i + 1}-of-${slides}.${ext}`), i * 250),
        );
      } else {
        const { blob, name } = await build();
        downloadBlob(blob, name);
      }
    } catch (err) {
      console.error(err);
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleShare() {
    setBusy(true);
    try {
      const { blob, name } = await build();
      const shared = await shareBlob(blob, name);
      if (!shared) downloadBlob(blob, name);
    } catch (err) {
      console.error(err);
      alert((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-[#14161b] px-3 py-2">
      <span className="mr-1 hidden text-sm font-semibold tracking-tight text-violet-300 sm:inline">
        Insta Post Maker
      </span>

      <ProjectsMenu />
      <TemplatesMenu />
      <FitGlueImport />

      <div className="mx-1 hidden h-6 w-px bg-white/10 md:block" />

      {/* Canvas presets — desktop only (mobile uses Magic resize in the panel) */}
      <div className="hidden items-center gap-1 md:flex">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            className={btn(activePreset?.id === p.id)}
            onClick={() => magicResize(p.width, p.height)}
            title={`${p.width}×${p.height} — reflows your layers`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mx-1 hidden h-6 w-px bg-white/10 md:block" />

      {/* Add layers — inline on desktop, compact menu on mobile */}
      <div className="hidden items-center gap-2 md:flex">
        <button className={btn()} onClick={() => fileRef.current?.click()}>
          + Image
        </button>
        <button className={btn()} onClick={addTextLayer}>
          + Text
        </button>
        <button className={btn()} onClick={addOverlayLayer}>
          + Gradient
        </button>
        <button className={btn(drawMode)} onClick={() => setDrawMode(!drawMode)} title="Freehand pen">
          ✏️ Draw
        </button>
        <button className={btn()} onClick={() => void promptAddQrCode()} title="Add a QR code">
          ▦ QR
        </button>
        <select
          className="rounded-md bg-white/5 px-2 py-1.5 text-sm text-zinc-200 hover:bg-white/10"
          value=""
          onChange={(e) => {
            if (e.target.value) addShapeLayer(e.target.value as 'rect' | 'ellipse' | 'line');
            e.target.value = '';
          }}
          title="Add a shape"
        >
          <option value="">+ Shape</option>
          <option value="rect">Rectangle</option>
          <option value="ellipse">Ellipse</option>
          <option value="line">Line</option>
        </select>
        <select
          className="rounded-md bg-white/5 px-2 py-1.5 text-sm text-zinc-200 hover:bg-white/10"
          value=""
          onChange={(e) => {
            if (e.target.value === '__none') clearCollage();
            else {
              const tpl = LAYOUTS.find((l) => l.id === e.target.value);
              if (tpl) applyLayout(tpl.build());
            }
            e.target.value = '';
          }}
          title="Apply a collage layout"
        >
          <option value="">▦ Layout</option>
          {LAYOUTS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
          <option value="__none">✕ Remove layout</option>
        </select>
      </div>
      <AddMenu className="md:hidden" onAddImage={() => fileRef.current?.click()} />
      <EmojiPicker />
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <div className="mx-1 hidden h-6 w-px bg-white/10 md:block" />

      <button className={btn()} onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
        ↶
      </button>
      <button className={btn()} onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">
        ↷
      </button>

      {/* Export controls pushed to the right */}
      <div className="ml-auto flex items-center gap-2">
        <span className="hidden md:inline-flex">
          <HelpOverlay />
        </span>
        <select
          className="rounded-md bg-white/5 px-2 py-1.5 text-sm text-zinc-200"
          value={format}
          onChange={(e) => setFormat(e.target.value as ExportFormat)}
        >
          <option value="png">PNG</option>
          <option value="jpeg">JPEG</option>
        </select>
        <select
          className="hidden rounded-md bg-white/5 px-2 py-1.5 text-sm text-zinc-200 sm:block"
          value={multiplier}
          onChange={(e) => setMultiplier(Number(e.target.value) as 1 | 2)}
        >
          <option value={1}>@1x</option>
          <option value={2}>@2x</option>
        </select>
        <select
          className="hidden rounded-md bg-white/5 px-2 py-1.5 text-sm text-zinc-200 sm:block"
          value={slides}
          onChange={(e) => setSlides(Number(e.target.value))}
          title="Split into N carousel slides"
        >
          <option value={1}>1 slide</option>
          <option value={2}>2 slides</option>
          <option value={3}>3 slides</option>
          <option value={4}>4 slides</option>
        </select>
        <button
          className="rounded-md bg-violet-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-400 disabled:opacity-50"
          onClick={handleExport}
          disabled={busy}
        >
          {busy ? 'Working…' : 'Export'}
        </button>
        {canRecordVideo() && <AnimateMenu />}
        {canShareFiles() && (
          <button
            className="rounded-md bg-white/5 px-3 py-1.5 text-sm font-semibold text-zinc-100 hover:bg-white/10 disabled:opacity-50"
            onClick={handleShare}
            disabled={busy}
            title="Share the exported image (e.g. to Instagram)"
          >
            Share
          </button>
        )}
      </div>
    </header>
  );
}
