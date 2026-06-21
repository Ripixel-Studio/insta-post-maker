import { useRef, useState } from 'react';
import { useEditor } from '../store';
import { FONTS, uploadFont } from '../fonts';
import { FILTER_PRESETS } from '../filters';
import { PRESETS } from '../presets';
import { addImageAsset } from '../assets';
import { cutoutAsset } from '../bgRemoval';
import { bakeOutline } from '../sticker';
import { ColorField } from './ColorField';
import type { MaskShape } from '../types';
import type {
  Layer,
  ImageLayer,
  TextLayer,
  OverlayLayer,
  ShapeLayer,
  GradientDirection,
} from '../types';

const BLEND_MODES: GlobalCompositeOperation[] = [
  'source-over',
  'multiply',
  'screen',
  'overlay',
  'darken',
  'lighten',
  'color-dodge',
  'soft-light',
  'hard-light',
  'difference',
  'exclusion',
];

const inputCls =
  'w-full rounded-md border border-white/10 bg-white/5 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-violet-400';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">
        {label}
      </span>
      {children}
    </label>
  );
}

function Slider({
  label,
  min,
  max,
  step,
  value,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        className="w-full accent-violet-500"
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </Field>
  );
}

/* ----------------------------- Layers list ----------------------------- */

function LayersList() {
  const layers = useEditor((s) => s.design.layers);
  const selectedId = useEditor((s) => s.selectedId);
  const select = useEditor((s) => s.select);
  const moveLayer = useEditor((s) => s.moveLayer);
  const removeLayer = useEditor((s) => s.removeLayer);
  const updateLayer = useEditor((s) => s.updateLayer);

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Layers
      </h3>
      {layers.length === 0 && (
        <p className="text-sm text-zinc-500">No layers yet. Add an image, text or gradient.</p>
      )}
      <ul className="flex flex-col gap-1">
        {[...layers].reverse().map((layer) => (
          <li
            key={layer.id}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              layer.id === selectedId ? 'bg-violet-500/20 text-white' : 'hover:bg-white/5'
            }`}
          >
            <button
              className="opacity-60 hover:opacity-100"
              title={layer.visible ? 'Hide' : 'Show'}
              onClick={() => updateLayer(layer.id, { visible: !layer.visible })}
            >
              {layer.visible ? '👁' : '🙈'}
            </button>
            <button className="flex-1 truncate text-left" onClick={() => select(layer.id)}>
              {layer.name}
            </button>
            <button className="opacity-60 hover:opacity-100" title="Bring forward"
              onClick={() => moveLayer(layer.id, 'up')}>↑</button>
            <button className="opacity-60 hover:opacity-100" title="Send backward"
              onClick={() => moveLayer(layer.id, 'down')}>↓</button>
            <button className="opacity-60 hover:opacity-100" title="Delete"
              onClick={() => removeLayer(layer.id)}>✕</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ----------------------------- Common props ----------------------------- */

function CommonProps({ layer }: { layer: Layer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const flipLayer = useEditor((s) => s.flipLayer);
  return (
    <>
      <Slider
        label={`Opacity — ${Math.round(layer.opacity * 100)}%`}
        min={0}
        max={1}
        step={0.01}
        value={layer.opacity}
        onChange={(v) => updateLayer(layer.id, { opacity: v })}
      />
      <Field label="Blend mode">
        <select
          className={inputCls}
          value={layer.blendMode}
          onChange={(e) =>
            updateLayer(layer.id, { blendMode: e.target.value as GlobalCompositeOperation })
          }
        >
          {BLEND_MODES.map((m) => (
            <option key={m} value={m}>
              {m === 'source-over' ? 'normal' : m}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Flip & lock">
        <div className="flex gap-1">
          <button className="flex-1 rounded-md bg-white/5 px-2 py-1.5 text-sm hover:bg-white/10"
            onClick={() => flipLayer(layer.id, 'x')}>Flip H</button>
          <button className="flex-1 rounded-md bg-white/5 px-2 py-1.5 text-sm hover:bg-white/10"
            onClick={() => flipLayer(layer.id, 'y')}>Flip V</button>
          <button
            className={`flex-1 rounded-md px-2 py-1.5 text-sm ${
              layer.locked ? 'bg-violet-500 text-white' : 'bg-white/5 hover:bg-white/10'
            }`}
            onClick={() => updateLayer(layer.id, { locked: !layer.locked })}
          >
            {layer.locked ? 'Locked' : 'Lock'}
          </button>
        </div>
      </Field>
    </>
  );
}

/* ------------------------------- Image ------------------------------- */

function ImageProps({ layer }: { layer: ImageLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const addImageLayer = useEditor((s) => s.addImageLayer);
  const setCropTarget = useEditor((s) => s.setCropTarget);
  const [bgProgress, setBgProgress] = useState<number | null>(null);
  const [stickerBusy, setStickerBusy] = useState(false);
  const f = layer.filters;
  const isSticker = !!layer.baseAssetId;
  const setFilter = (patch: Partial<ImageLayer['filters']>) =>
    updateLayer(layer.id, { filters: { ...f, ...patch } });

  async function removeBg() {
    setBgProgress(0);
    try {
      const newId = await cutoutAsset(layer.assetId, (r) => setBgProgress(r));
      if (newId) updateLayer(layer.id, { assetId: newId });
    } catch (err) {
      console.error(err);
      alert('Background removal failed. It needs a connection the first time.');
    } finally {
      setBgProgress(null);
    }
  }

  // Lift the subject out as a new sticker layer you can place over anything.
  async function makeSticker() {
    setBgProgress(0);
    try {
      const cutId = await cutoutAsset(layer.assetId, (r) => setBgProgress(r));
      if (cutId) {
        const newLayerId = addImageLayer(cutId);
        updateLayer(newLayerId, {
          name: 'Sticker',
          baseAssetId: cutId,
          outline: { enabled: false, color: '#ffffff', width: 16 },
        });
      }
    } catch (err) {
      console.error(err);
      alert('Cutout failed. It needs a connection the first time.');
    } finally {
      setBgProgress(null);
    }
  }

  async function setOutline(next: { enabled: boolean; color: string; width: number }) {
    if (!layer.baseAssetId) return;
    setStickerBusy(true);
    try {
      if (!next.enabled) {
        updateLayer(layer.id, { assetId: layer.baseAssetId, outline: next });
        return;
      }
      const baked = await bakeOutline(layer.baseAssetId, next.color, next.width);
      if (baked) updateLayer(layer.id, { assetId: baked, outline: next });
    } finally {
      setStickerBusy(false);
    }
  }

  const outline = layer.outline ?? { enabled: false, color: '#ffffff', width: 16 };

  return (
    <>
      <Field label="Crop">
        <div className="flex gap-1">
          <button
            className="flex-1 rounded-md bg-white/5 px-2 py-1.5 text-sm hover:bg-white/10"
            onClick={() => setCropTarget(layer.id)}
          >
            ✂ Crop image
          </button>
          {layer.crop && (
            <button
              className="rounded-md bg-white/5 px-2 py-1.5 text-sm hover:bg-white/10"
              onClick={() => updateLayer(layer.id, { crop: undefined })}
              title="Remove crop"
            >
              Reset
            </button>
          )}
        </div>
      </Field>

      <Field label="Cut out subject">
        <div className="flex gap-1">
          <button
            className="flex-1 rounded-md bg-white/5 px-2 py-1.5 text-sm hover:bg-white/10 disabled:opacity-60"
            onClick={makeSticker}
            disabled={bgProgress !== null}
          >
            {bgProgress !== null ? `Working… ${Math.round(bgProgress * 100)}%` : '🩹 Make sticker'}
          </button>
          <button
            className="flex-1 rounded-md bg-white/5 px-2 py-1.5 text-sm hover:bg-white/10 disabled:opacity-60"
            onClick={removeBg}
            disabled={bgProgress !== null}
            title="Remove the background in place"
          >
            🪄 Remove bg
          </button>
        </div>
      </Field>

      {isSticker && (
        <>
          <div className="mb-2 mt-1 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Sticker outline
            </span>
            <input
              type="checkbox"
              className="accent-violet-500"
              checked={outline.enabled}
              disabled={stickerBusy}
              onChange={(e) => setOutline({ ...outline, enabled: e.target.checked })}
            />
          </div>
          {outline.enabled && (
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field label="Color">
                  <ColorField value={outline.color} onChange={(c) => setOutline({ ...outline, color: c })} />
                </Field>
              </div>
              <Field label="Width">
                <input type="number" className={inputCls} value={outline.width}
                  onChange={(e) => setOutline({ ...outline, width: Math.max(1, Number(e.target.value)) })} />
              </Field>
            </div>
          )}
          {stickerBusy && <p className="text-xs text-zinc-500">Baking outline…</p>}
        </>
      )}

      <Field label="Mask shape">
        <select className={inputCls} value={layer.mask ?? 'none'}
          onChange={(e) => updateLayer(layer.id, { mask: e.target.value as MaskShape })}>
          {(['none', 'circle', 'rounded', 'triangle', 'star', 'heart'] as MaskShape[]).map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </Field>

      <Field label="Filter preset">
        <div className="grid grid-cols-3 gap-1">
          {FILTER_PRESETS.map((p) => (
            <button
              key={p.id}
              className="rounded-md bg-white/5 px-1 py-1.5 text-xs hover:bg-white/10"
              onClick={() => updateLayer(layer.id, { filters: { ...p.values } })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>

      <Slider label={`Brightness — ${f.brightness.toFixed(2)}`} min={-1} max={1} step={0.01}
        value={f.brightness} onChange={(v) => setFilter({ brightness: v })} />
      <Slider label={`Contrast — ${f.contrast}`} min={-100} max={100} step={1}
        value={f.contrast} onChange={(v) => setFilter({ contrast: v })} />
      <Slider label={`Saturation — ${f.saturation.toFixed(2)}`} min={-1} max={1} step={0.01}
        value={f.saturation} onChange={(v) => setFilter({ saturation: v })} />
      <Slider label={`Blur — ${f.blur}px`} min={0} max={40} step={1}
        value={f.blur} onChange={(v) => setFilter({ blur: v })} />
    </>
  );
}

/* -------------------------------- Text -------------------------------- */

function TextProps({ layer }: { layer: TextLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const customFonts = useEditor((s) => s.customFonts);
  const addCustomFont = useEditor((s) => s.addCustomFont);
  const fontFileRef = useRef<HTMLInputElement>(null);
  const patch = (p: Partial<TextLayer>) => updateLayer(layer.id, p);

  async function onFontFile(file: File | undefined) {
    if (!file) return;
    try {
      const family = await uploadFont(file);
      addCustomFont(family);
      patch({ fontFamily: family });
    } catch (err) {
      console.error(err);
      alert('Could not load that font file.');
    }
  }

  return (
    <>
      <Field label="Text">
        <textarea className={inputCls} rows={2} value={layer.text}
          onChange={(e) => patch({ text: e.target.value })} />
      </Field>
      <Field label="Font">
        <div className="flex gap-1">
          <select className={inputCls} value={layer.fontFamily}
            onChange={(e) => patch({ fontFamily: e.target.value })}>
            {FONTS.map((ft) => <option key={ft.family} value={ft.family}>{ft.family}</option>)}
            {customFonts.length > 0 && (
              <optgroup label="Your fonts">
                {customFonts.map((f) => <option key={f} value={f}>{f}</option>)}
              </optgroup>
            )}
          </select>
          <button
            className="rounded-md bg-white/5 px-2 py-1.5 text-sm hover:bg-white/10"
            title="Upload a font file (.ttf/.otf/.woff2)"
            onClick={() => fontFileRef.current?.click()}
          >
            ⬆
          </button>
          <input ref={fontFileRef} type="file" accept=".ttf,.otf,.woff,.woff2,font/*" hidden
            onChange={(e) => { void onFontFile(e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      </Field>
      <div className="flex gap-2">
        <Field label="Size">
          <input type="number" className={inputCls} value={layer.fontSize}
            onChange={(e) => patch({ fontSize: Number(e.target.value) })} />
        </Field>
        <Field label="Color">
          <ColorField value={layer.fill} onChange={(c) => patch({ fill: c })} />
        </Field>
      </div>
      <Field label="Align">
        <div className="flex gap-1">
          {(['left', 'center', 'right'] as const).map((a) => (
            <button key={a}
              className={`flex-1 rounded-md px-2 py-1.5 text-sm ${
                layer.align === a ? 'bg-violet-500 text-white' : 'bg-white/5'
              }`}
              onClick={() => patch({ align: a })}>{a}</button>
          ))}
        </div>
      </Field>
      <Field label="Style">
        <div className="flex gap-1">
          {(['normal', 'bold', 'italic', 'italic bold'] as const).map((st) => (
            <button key={st}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs ${
                layer.fontStyle === st ? 'bg-violet-500 text-white' : 'bg-white/5'
              }`}
              onClick={() => patch({ fontStyle: st })}>{st}</button>
          ))}
        </div>
      </Field>
      <Slider label={`Line height — ${layer.lineHeight.toFixed(2)}`} min={0.7} max={3} step={0.05}
        value={layer.lineHeight} onChange={(v) => patch({ lineHeight: v })} />
      <Slider label={`Letter spacing — ${layer.letterSpacing}`} min={-10} max={40} step={1}
        value={layer.letterSpacing} onChange={(v) => patch({ letterSpacing: v })} />

      {/* Shadow */}
      <div className="mb-2 mt-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Shadow</span>
        <input type="checkbox" className="accent-violet-500" checked={layer.shadow.enabled}
          onChange={(e) => patch({ shadow: { ...layer.shadow, enabled: e.target.checked } })} />
      </div>
      {layer.shadow.enabled && (
        <div className="flex gap-2">
          <Field label="Color">
            <input type="color" className="h-9 w-full rounded-md bg-white/5"
              value={layer.shadow.color.startsWith('#') ? layer.shadow.color : '#000000'}
              onChange={(e) => patch({ shadow: { ...layer.shadow, color: e.target.value } })} />
          </Field>
          <Field label="Blur">
            <input type="number" className={inputCls} value={layer.shadow.blur}
              onChange={(e) => patch({ shadow: { ...layer.shadow, blur: Number(e.target.value) } })} />
          </Field>
        </div>
      )}

      {/* Background pill */}
      <div className="mb-2 mt-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Background</span>
        <input type="checkbox" className="accent-violet-500" checked={layer.background.enabled}
          onChange={(e) => patch({ background: { ...layer.background, enabled: e.target.checked } })} />
      </div>
      {layer.background.enabled && (
        <>
          <div className="flex gap-2">
            <Field label="Color">
              <input type="color" className="h-9 w-full rounded-md bg-white/5"
                value={layer.background.color.startsWith('#') ? layer.background.color : '#000000'}
                onChange={(e) => patch({ background: { ...layer.background, color: e.target.value } })} />
            </Field>
            <Field label="Radius">
              <input type="number" className={inputCls} value={layer.background.cornerRadius}
                onChange={(e) => patch({ background: { ...layer.background, cornerRadius: Number(e.target.value) } })} />
            </Field>
          </div>
          <Slider label={`Padding — ${layer.background.padding}px`} min={0} max={80} step={1}
            value={layer.background.padding}
            onChange={(v) => patch({ background: { ...layer.background, padding: v } })} />
        </>
      )}
    </>
  );
}

/* ------------------------------- Overlay ------------------------------- */

function OverlayProps({ layer }: { layer: OverlayLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const directions: GradientDirection[] = ['to-top', 'to-bottom', 'to-left', 'to-right', 'radial'];
  const setStop = (i: number, color: string) => {
    const stops = layer.stops.map((s, idx) => (idx === i ? { ...s, color } : s));
    updateLayer(layer.id, { stops });
  };
  return (
    <>
      <Field label="Direction">
        <select className={inputCls} value={layer.direction}
          onChange={(e) => updateLayer(layer.id, { direction: e.target.value as GradientDirection })}>
          {directions.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
      </Field>
      <Field label="Gradient stops">
        <div className="flex flex-col gap-2">
          {layer.stops.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="color" className="h-8 w-12 rounded bg-white/5"
                value={s.color.startsWith('#') ? s.color : '#000000'}
                onChange={(e) => setStop(i, e.target.value)} />
              <span className="text-xs text-zinc-400">offset {s.offset}</span>
            </div>
          ))}
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          The default black→transparent scrim boosts text legibility over photos.
        </p>
      </Field>
    </>
  );
}

/* -------------------------------- Shape -------------------------------- */

function ShapeProps({ layer }: { layer: ShapeLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const patch = (p: Partial<ShapeLayer>) => updateLayer(layer.id, p);
  return (
    <>
      {layer.shape !== 'line' && (
        <>
          <Field label="Fill">
            <ColorField value={layer.fill} onChange={(c) => patch({ fill: c })} />
          </Field>
          {layer.shape === 'rect' && (
            <Field label="Corner radius">
              <input type="number" className={inputCls} value={layer.cornerRadius}
                onChange={(e) => patch({ cornerRadius: Number(e.target.value) })} />
            </Field>
          )}
        </>
      )}
      <Field label={layer.shape === 'line' ? 'Color' : 'Stroke'}>
        <ColorField
          value={layer.shape === 'line' ? layer.fill : layer.stroke}
          onChange={(c) => patch(layer.shape === 'line' ? { fill: c } : { stroke: c })}
        />
      </Field>
      <Field label={layer.shape === 'line' ? 'Thickness' : 'Stroke width'}>
        <input type="number" className={inputCls} value={layer.strokeWidth}
          onChange={(e) => patch({ strokeWidth: Number(e.target.value) })} />
      </Field>
    </>
  );
}

/* ------------------------------- Collage ------------------------------- */

function CellPanel({ cellId }: { cellId: string }) {
  const design = useEditor((s) => s.design);
  const updateCell = useEditor((s) => s.updateCell);
  const fileRef = useRef<HTMLInputElement>(null);
  const cell = design.collage?.cells.find((c) => c.id === cellId);
  if (!cell) return null;

  async function replace(file: File | undefined) {
    if (!file || !file.type.startsWith('image/')) return;
    const asset = await addImageAsset(file);
    updateCell(cellId, { assetId: asset.id, zoom: 1, offsetX: 0.5, offsetY: 0.5 });
  }

  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold text-white">Collage cell</h3>
      <div className="mb-3 flex gap-1">
        <button
          className="flex-1 rounded-md bg-white/5 px-2 py-1.5 text-sm hover:bg-white/10"
          onClick={() => fileRef.current?.click()}
        >
          {cell.assetId ? 'Replace photo' : 'Add photo'}
        </button>
        {cell.assetId && (
          <button
            className="rounded-md bg-white/5 px-2 py-1.5 text-sm hover:bg-white/10"
            onClick={() => updateCell(cellId, { assetId: undefined })}
          >
            Clear
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void replace(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {cell.assetId && (
        <>
          <Slider label={`Zoom — ${cell.zoom.toFixed(2)}×`} min={1} max={4} step={0.01}
            value={cell.zoom} onChange={(v) => updateCell(cellId, { zoom: v })} />
          <p className="text-sm text-zinc-500">Drag the photo inside its cell to reposition it.</p>
        </>
      )}
    </div>
  );
}

function LayoutPanel() {
  const collage = useEditor((s) => s.design.collage);
  const updateCollage = useEditor((s) => s.updateCollage);
  const clearCollage = useEditor((s) => s.clearCollage);
  if (!collage) return null;
  return (
    <div className="border-t border-white/10 pt-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Layout</h3>
      <Slider label={`Gap — ${collage.gap}px`} min={0} max={80} step={1}
        value={collage.gap} onChange={(v) => updateCollage({ gap: v })} />
      <p className="mb-2 text-sm text-zinc-500">Drag the gutters between cells to resize them.</p>
      <button
        className="w-full rounded-md bg-white/5 px-2 py-1.5 text-sm hover:bg-white/10"
        onClick={clearCollage}
      >
        Remove layout
      </button>
    </div>
  );
}

/* ----------------------------- Canvas panel ----------------------------- */

function CanvasProps() {
  const design = useEditor((s) => s.design);
  const setBackground = useEditor((s) => s.setBackground);
  const setCanvasSize = useEditor((s) => s.setCanvasSize);
  const magicResize = useEditor((s) => s.magicResize);
  const activePreset = PRESETS.find(
    (p) => p.width === design.width && p.height === design.height,
  );
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Canvas</h3>
      <Field label="Background">
        <ColorField value={design.background} onChange={setBackground} />
      </Field>
      <Field label="Size (px)">
        <div className="flex items-center gap-2">
          <input type="number" className={inputCls} value={design.width}
            onChange={(e) => setCanvasSize(Number(e.target.value), design.height)} />
          <span className="text-zinc-500">×</span>
          <input type="number" className={inputCls} value={design.height}
            onChange={(e) => setCanvasSize(design.width, Number(e.target.value))} />
        </div>
      </Field>
      <Field label="Magic resize (reflow to)">
        <div className="grid grid-cols-2 gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              className={`rounded-md px-2 py-1.5 text-xs ${
                activePreset?.id === p.id ? 'bg-violet-500 text-white' : 'bg-white/5 hover:bg-white/10'
              }`}
              onClick={() => magicResize(p.width, p.height)}
              title={`${p.width}×${p.height}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Field>
      <p className="text-sm text-zinc-500">
        {activePreset ? `${activePreset.label} preset` : 'Custom size'}. Select a layer to edit it.
      </p>
    </div>
  );
}

/* ------------------------------- Panel ------------------------------- */

export function PropertiesPanel() {
  const selectedId = useEditor((s) => s.selectedId);
  const selectedCellId = useEditor((s) => s.selectedCellId);
  const design = useEditor((s) => s.design);
  const removeLayer = useEditor((s) => s.removeLayer);
  const duplicateLayer = useEditor((s) => s.duplicateLayer);
  const layer = design.layers.find((l) => l.id === selectedId) ?? null;

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-white/10 bg-[#14161b] p-4">
      {selectedCellId && <CellPanel cellId={selectedCellId} />}

      {!layer && !selectedCellId && (
        <>
          <CanvasProps />
          <LayoutPanel />
        </>
      )}

      {layer && (
        <div>
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="truncate text-sm font-semibold text-white">{layer.name}</h3>
            <div className="flex gap-1">
              <button className="rounded-md bg-white/5 px-2 py-1 text-xs hover:bg-white/10"
                title="Duplicate (⌘D)" onClick={() => duplicateLayer(layer.id)}>⧉</button>
              <button className="rounded-md bg-white/5 px-2 py-1 text-xs hover:bg-white/10"
                title="Delete" onClick={() => removeLayer(layer.id)}>🗑</button>
            </div>
          </div>
          <CommonProps layer={layer} />
          {layer.type === 'image' && <ImageProps layer={layer as ImageLayer} />}
          {layer.type === 'text' && <TextProps layer={layer as TextLayer} />}
          {layer.type === 'overlay' && <OverlayProps layer={layer as OverlayLayer} />}
          {layer.type === 'shape' && <ShapeProps layer={layer as ShapeLayer} />}
        </div>
      )}

      <div className="mt-auto border-t border-white/10 pt-4">
        <LayersList />
      </div>
    </aside>
  );
}
