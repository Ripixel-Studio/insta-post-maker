import { useRef, useState } from 'react';
import { useEditor } from '../store';
import { PRESETS } from '../presets';
import { addImageAsset } from '../assets';
import {
  exportDesign,
  downloadBlob,
  shareBlob,
  canShareFiles,
  type ExportFormat,
} from '../export';
import { ProjectsMenu } from './ProjectsMenu';
import { HelpOverlay } from './HelpOverlay';
import { LAYOUTS } from '../collage';

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
  const setPreset = useEditor((s) => s.setPreset);
  const addImageLayer = useEditor((s) => s.addImageLayer);
  const addTextLayer = useEditor((s) => s.addTextLayer);
  const addOverlayLayer = useEditor((s) => s.addOverlayLayer);
  const addShapeLayer = useEditor((s) => s.addShapeLayer);
  const applyLayout = useEditor((s) => s.applyLayout);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);

  const fileRef = useRef<HTMLInputElement>(null);
  const [format, setFormat] = useState<ExportFormat>('png');
  const [multiplier, setMultiplier] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);

  const activePreset = PRESETS.find(
    (p) => p.width === design.width && p.height === design.height,
  );

  async function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const asset = await addImageAsset(file);
        addImageLayer(asset.id);
      } catch (err) {
        console.error('Failed to load image', err);
      }
    }
  }

  async function build() {
    const blob = await exportDesign(design, { format, multiplier });
    const name = `${activePreset?.id ?? 'design'}-${design.width}x${design.height}${
      multiplier === 2 ? '@2x' : ''
    }.${format === 'png' ? 'png' : 'jpg'}`;
    return { blob, name };
  }

  async function handleExport() {
    setBusy(true);
    try {
      const { blob, name } = await build();
      downloadBlob(blob, name);
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
    <header className="flex flex-wrap items-center gap-2 border-b border-white/10 bg-[#14161b] px-4 py-2">
      <span className="mr-1 text-sm font-semibold tracking-tight text-violet-300">
        Insta Post Maker
      </span>

      <ProjectsMenu />

      <div className="mx-1 h-6 w-px bg-white/10" />

      {/* Canvas presets */}
      <div className="flex items-center gap-1">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            className={btn(activePreset?.id === p.id)}
            onClick={() => setPreset(p)}
            title={`${p.width}×${p.height}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="mx-1 h-6 w-px bg-white/10" />

      {/* Add layers */}
      <button className={btn()} onClick={() => fileRef.current?.click()}>
        + Image
      </button>
      <button className={btn()} onClick={addTextLayer}>
        + Text
      </button>
      <button className={btn()} onClick={addOverlayLayer}>
        + Gradient
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
          const tpl = LAYOUTS.find((l) => l.id === e.target.value);
          if (tpl) applyLayout(tpl.build());
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
      </select>
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

      <div className="mx-1 h-6 w-px bg-white/10" />

      <button className={btn()} onClick={undo} disabled={!canUndo} title="Undo (⌘Z)">
        Undo
      </button>
      <button className={btn()} onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">
        Redo
      </button>

      {/* Export controls pushed to the right */}
      <div className="ml-auto flex items-center gap-2">
        <HelpOverlay />
        <select
          className="rounded-md bg-white/5 px-2 py-1.5 text-sm text-zinc-200"
          value={format}
          onChange={(e) => setFormat(e.target.value as ExportFormat)}
        >
          <option value="png">PNG</option>
          <option value="jpeg">JPEG</option>
        </select>
        <select
          className="rounded-md bg-white/5 px-2 py-1.5 text-sm text-zinc-200"
          value={multiplier}
          onChange={(e) => setMultiplier(Number(e.target.value) as 1 | 2)}
        >
          <option value={1}>@1x</option>
          <option value={2}>@2x</option>
        </select>
        <button
          className="rounded-md bg-violet-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-400 disabled:opacity-50"
          onClick={handleExport}
          disabled={busy}
        >
          {busy ? 'Working…' : 'Export'}
        </button>
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
