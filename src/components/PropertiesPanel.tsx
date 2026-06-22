import { useRef, useState } from 'react';
import { useEditor, activePage } from '../store';
import { FONTS, uploadFont, ensureFont } from '../fonts';
import { FILTER_PRESETS } from '../filters';
import { PRESETS } from '../presets';
import { addImageAsset, getAsset } from '../assets';
import { cutoutAsset, portraitBlur } from '../bgRemoval';
import { bakeOutline } from '../sticker';
import { ColorField } from './ColorField';
import { GradientEditor } from './GradientEditor';
import type { MaskShape, GradientFill, DrawLayer, TextShadow } from '../types';

const DEFAULT_SHADOW: TextShadow = {
  enabled: true,
  color: 'rgba(0,0,0,0.5)',
  blur: 14,
  offsetX: 0,
  offsetY: 8,
};

/** Drop-shadow controls shared by images, shapes and drawings. */
function ShadowSection({
  shadow,
  onChange,
}: {
  shadow?: TextShadow;
  onChange: (s: TextShadow) => void;
}) {
  const sh = shadow ?? { ...DEFAULT_SHADOW, enabled: false };
  return (
    <>
      <div className="mb-2 mt-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Shadow</span>
        <input type="checkbox" className="accent-violet-500" checked={sh.enabled}
          onChange={(e) => onChange({ ...sh, enabled: e.target.checked })} />
      </div>
      {sh.enabled && (
        <>
          <Field label="Shadow colour">
            <ColorField value={sh.color} onChange={(c) => onChange({ ...sh, color: c })} />
          </Field>
          <Slider label={`Blur — ${sh.blur}`} min={0} max={80} step={1}
            value={sh.blur} onChange={(v) => onChange({ ...sh, blur: v })} />
          <div className="flex gap-2">
            <Field label="Offset X">
              <input type="number" className={inputCls} value={sh.offsetX}
                onChange={(e) => onChange({ ...sh, offsetX: Number(e.target.value) })} />
            </Field>
            <Field label="Offset Y">
              <input type="number" className={inputCls} value={sh.offsetY}
                onChange={(e) => onChange({ ...sh, offsetY: Number(e.target.value) })} />
            </Field>
          </div>
        </>
      )}
    </>
  );
}

/** Solid/gradient fill control shared by text and shapes. */
function FillEditor({
  fill,
  fillKind,
  gradient,
  onChange,
}: {
  fill: string;
  fillKind?: 'solid' | 'gradient';
  gradient?: GradientFill;
  onChange: (patch: { fill?: string; fillKind?: 'solid' | 'gradient'; gradient?: GradientFill }) => void;
}) {
  const kind = fillKind ?? 'solid';
  const grad: GradientFill = gradient ?? {
    stops: [
      { offset: 0, color: fill || '#ffffff' },
      { offset: 1, color: '#7c3aed' },
    ],
    angle: 90,
  };
  return (
    <>
      <div className="mb-1 flex gap-1">
        {(['solid', 'gradient'] as const).map((k) => (
          <button
            key={k}
            className={`flex-1 rounded-md px-2 py-1 text-xs ${
              kind === k ? 'bg-violet-500 text-white' : 'bg-white/5 hover:bg-white/10'
            }`}
            onClick={() => onChange(k === 'gradient' ? { fillKind: 'gradient', gradient: grad } : { fillKind: 'solid' })}
          >
            {k}
          </button>
        ))}
      </div>
      {kind === 'gradient' ? (
        <GradientEditor value={grad} onChange={(g) => onChange({ fillKind: 'gradient', gradient: g })} />
      ) : (
        <ColorField value={fill} onChange={(c) => onChange({ fill: c })} />
      )}
    </>
  );
}
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
  const pageLayers = useEditor((s) => activePage(s).layers);
  const sharedLayers = useEditor((s) => s.design.shared);
  const selectedId = useEditor((s) => s.selectedId);
  const select = useEditor((s) => s.select);
  const moveLayer = useEditor((s) => s.moveLayer);
  const reorderLayer = useEditor((s) => s.reorderLayer);
  const removeLayer = useEditor((s) => s.removeLayer);
  const updateLayer = useEditor((s) => s.updateLayer);
  const toggleShared = useEditor((s) => s.toggleShared);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const dragRef = useRef<string | null>(null);

  // Pointer-based drag handle: works for both mouse and touch (unlike native
  // HTML5 drag-and-drop, which doesn't fire on touchscreens).
  const handleMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const el = document
      .elementFromPoint(e.clientX, e.clientY)
      ?.closest('[data-layer-id]');
    const id = el?.getAttribute('data-layer-id');
    if (id && id !== overId) setOverId(id);
  };
  const handleUp = (e: React.PointerEvent) => {
    if (dragRef.current && overId && overId !== dragRef.current) {
      reorderLayer(dragRef.current, overId);
    }
    dragRef.current = null;
    setDragId(null);
    setOverId(null);
    (e.target as Element).releasePointerCapture?.(e.pointerId);
  };

  const renderRow = (layer: Layer, shared: boolean) => (
    <li
      key={layer.id}
      data-layer-id={layer.id}
      className={`flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm ${
        layer.id === selectedId ? 'bg-violet-500/20 text-white' : 'hover:bg-white/5'
      } ${overId === layer.id && dragId !== layer.id ? 'ring-1 ring-violet-400' : ''} ${
        dragId === layer.id ? 'opacity-50' : ''
      }`}
    >
      <span
        className="cursor-grab touch-none select-none px-0.5 opacity-40"
        title="Drag to reorder"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = layer.id;
          setDragId(layer.id);
        }}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
      >
        ⠿
      </span>
      <button
        className="opacity-60 hover:opacity-100"
        title={layer.locked ? 'Unlock' : 'Lock'}
        onClick={() => updateLayer(layer.id, { locked: !layer.locked })}
      >
        {layer.locked ? '🔒' : '🔓'}
      </button>
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
      <button
        className={`hover:opacity-100 ${shared ? 'opacity-100' : 'opacity-40'}`}
        title={shared ? 'On every page — make page-only' : 'Show on every page'}
        onClick={() => toggleShared(layer.id)}
      >
        📌
      </button>
      <button className="opacity-60 hover:opacity-100" title="Bring forward"
        onClick={() => moveLayer(layer.id, 'up')}>↑</button>
      <button className="opacity-60 hover:opacity-100" title="Send backward"
        onClick={() => moveLayer(layer.id, 'down')}>↓</button>
      <button className="opacity-60 hover:opacity-100" title="Delete"
        onClick={() => removeLayer(layer.id)}>✕</button>
    </li>
  );

  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Layers
      </h3>
      {pageLayers.length === 0 && sharedLayers.length === 0 && (
        <p className="text-sm text-zinc-500">No layers yet. Add an image, text or gradient.</p>
      )}
      <ul className="flex flex-col gap-1">
        {[...pageLayers].reverse().map((layer) => renderRow(layer, false))}
      </ul>
      {sharedLayers.length > 0 && (
        <>
          <p className="mb-1 mt-3 text-[10px] uppercase tracking-wide text-zinc-500">
            Shared (all pages)
          </p>
          <ul className="flex flex-col gap-1">
            {[...sharedLayers].reverse().map((layer) => renderRow(layer, true))}
          </ul>
        </>
      )}
    </div>
  );
}

/* ----------------------------- Common props ----------------------------- */

function CommonProps({ layer }: { layer: Layer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const flipLayer = useEditor((s) => s.flipLayer);
  const design = useEditor((s) => s.design);
  const centerH = () => updateLayer(layer.id, { x: (design.width - layer.width) / 2 });
  const centerV = () => updateLayer(layer.id, { y: (design.height - layer.height) / 2 });
  return (
    <>
      <Field label="Center on canvas">
        <div className="flex gap-1">
          <button className="flex-1 rounded-md bg-white/5 px-2 py-1.5 text-sm hover:bg-white/10"
            onClick={centerH}>↔ Horizontal</button>
          <button className="flex-1 rounded-md bg-white/5 px-2 py-1.5 text-sm hover:bg-white/10"
            onClick={centerV}>↕ Vertical</button>
        </div>
      </Field>
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
      <Slider label={`Skew X — ${layer.skewX.toFixed(2)}`} min={-1} max={1} step={0.01}
        value={layer.skewX} onChange={(v) => updateLayer(layer.id, { skewX: v })} />
      <Slider label={`Skew Y — ${layer.skewY.toFixed(2)}`} min={-1} max={1} step={0.01}
        value={layer.skewY} onChange={(v) => updateLayer(layer.id, { skewY: v })} />
      {(layer.skewX !== 0 || layer.skewY !== 0) && (
        <button className="mb-3 w-full rounded-md bg-white/5 px-2 py-1 text-xs hover:bg-white/10"
          onClick={() => updateLayer(layer.id, { skewX: 0, skewY: 0 })}>
          Reset skew
        </button>
      )}
    </>
  );
}

/* ------------------------------- Image ------------------------------- */

function ImageProps({ layer }: { layer: ImageLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  const addImageLayer = useEditor((s) => s.addImageLayer);
  const setCropTarget = useEditor((s) => s.setCropTarget);
  const setEraseTarget = useEditor((s) => s.setEraseTarget);
  const design = useEditor((s) => s.design);
  const [bgProgress, setBgProgress] = useState<number | null>(null);
  const [stickerBusy, setStickerBusy] = useState(false);
  const [blurStrength, setBlurStrength] = useState(18);

  async function applyPortraitBlur() {
    setBgProgress(0);
    try {
      const newId = await portraitBlur(layer.assetId, blurStrength, (r) => setBgProgress(r));
      if (newId) updateLayer(layer.id, { assetId: newId });
    } catch (err) {
      console.error(err);
      alert('Portrait blur failed. It needs a connection the first time.');
    } finally {
      setBgProgress(null);
    }
  }
  const f = layer.filters;
  const isSticker = !!layer.baseAssetId;
  const setFilter = (patch: Partial<ImageLayer['filters']>) =>
    updateLayer(layer.id, { filters: { ...f, ...patch } });

  // Scale the image to cover the whole canvas (no distortion), centre-cropping
  // the overflow via the crop rect.
  function fillCanvas() {
    const asset = getAsset(layer.assetId);
    const cw = design.width;
    const ch = design.height;
    const sw = asset?.width ?? cw;
    const sh = asset?.height ?? ch;
    const canvasAspect = cw / ch;
    const srcAspect = sw / sh;
    const crop =
      srcAspect > canvasAspect
        ? { x: (1 - canvasAspect / srcAspect) / 2, y: 0, width: canvasAspect / srcAspect, height: 1 }
        : { x: 0, y: (1 - srcAspect / canvasAspect) / 2, width: 1, height: srcAspect / canvasAspect };
    updateLayer(layer.id, { x: 0, y: 0, width: cw, height: ch, rotation: 0, crop });
  }

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
        // Align the sticker exactly over the image that generated it (same box,
        // rotation, flip and crop) so layering lines up pixel-for-pixel.
        updateLayer(newLayerId, {
          name: 'Sticker',
          baseAssetId: cutId,
          sourceAssetId: layer.assetId,
          outline: { enabled: false, color: '#ffffff', width: 16 },
          x: layer.x,
          y: layer.y,
          width: layer.width,
          height: layer.height,
          rotation: layer.rotation,
          flipX: layer.flipX,
          flipY: layer.flipY,
          crop: layer.crop,
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
      <Field label="Crop & fit">
        <div className="flex gap-1">
          <button
            className="flex-1 rounded-md bg-white/5 px-2 py-1.5 text-sm hover:bg-white/10"
            onClick={() => setCropTarget(layer.id)}
          >
            ✂ Crop
          </button>
          <button
            className="flex-1 rounded-md bg-white/5 px-2 py-1.5 text-sm hover:bg-white/10"
            onClick={fillCanvas}
            title="Scale to cover the whole canvas"
          >
            ⛶ Fill canvas
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
        <button
          className="mt-1 w-full rounded-md bg-white/5 px-2 py-1.5 text-sm hover:bg-white/10"
          onClick={() => setEraseTarget(layer.id)}
          title="Paint to erase parts of the image (great for cleaning up cutouts)"
        >
          🧽 Erase / refine
        </button>
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

      <Field label={`Portrait blur — ${blurStrength}`}>
        <input type="range" min={4} max={50} step={1} value={blurStrength}
          className="w-full accent-violet-500"
          onChange={(e) => setBlurStrength(Number(e.target.value))} />
        <button
          className="mt-1 w-full rounded-md bg-white/5 px-2 py-1.5 text-sm hover:bg-white/10 disabled:opacity-60"
          onClick={applyPortraitBlur}
          disabled={bgProgress !== null}
          title="Keep the subject sharp and blur the background (fake depth of field)"
        >
          {bgProgress !== null ? `Working… ${Math.round(bgProgress * 100)}%` : '📷 Apply portrait blur'}
        </button>
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

      <ShadowSection shadow={layer.shadow} onChange={(s) => updateLayer(layer.id, { shadow: s })} />
    </>
  );
}

/* -------------------------------- Text -------------------------------- */

type TextBg = TextLayer['background'];

/** Background-shape presets (Instagram-style). */
function applyBgPreset(layer: TextLayer, key: string): TextBg {
  const bg = layer.background;
  const pad = bg.padding || 16;
  const r = Math.round(layer.fontSize * 0.3);
  switch (key) {
    case 'none':
      return { ...bg, enabled: false };
    case 'square':
      return { ...bg, enabled: true, mode: 'box', cornerRadius: 0, padding: pad };
    case 'rounded':
      return { ...bg, enabled: true, mode: 'box', cornerRadius: r, padding: pad };
    case 'pill':
      return { ...bg, enabled: true, mode: 'box', cornerRadius: 9999, padding: bg.padding || 22 };
    case 'highlight':
      return { ...bg, enabled: true, mode: 'highlight', cornerRadius: r, padding: bg.padding || 14 };
    default:
      return bg;
  }
}
const BG_PRESETS = [
  { key: 'none', label: 'None' },
  { key: 'square', label: 'Square' },
  { key: 'rounded', label: 'Round' },
  { key: 'pill', label: 'Pill' },
  { key: 'highlight', label: 'Mark' },
];

/** One-tap text styles. */
const TEXT_STYLES: { key: string; label: string; apply: (l: TextLayer) => Partial<TextLayer> }[] = [
  {
    key: 'classic',
    label: 'Classic',
    apply: (l) => ({
      fontFamily: 'Inter',
      fontStyle: 'bold',
      fill: '#ffffff',
      fillKind: 'solid',
      background: { ...l.background, enabled: false },
      shadow: { ...l.shadow, enabled: false },
    }),
  },
  {
    key: 'highlight',
    label: 'Highlight',
    apply: (l) => ({
      fontFamily: 'Anton',
      fontStyle: 'normal',
      fill: '#111111',
      fillKind: 'solid',
      background: { enabled: true, mode: 'highlight', color: '#ffffff', cornerRadius: Math.round(l.fontSize * 0.3), padding: 14 },
    }),
  },
  {
    key: 'neon',
    label: 'Neon',
    apply: (l) => ({
      fontFamily: 'Righteous',
      fill: '#39ff14',
      fillKind: 'solid',
      background: { ...l.background, enabled: false },
      shadow: { enabled: true, color: '#39ff14', blur: 26, offsetX: 0, offsetY: 0 },
    }),
  },
  {
    key: 'marker',
    label: 'Marker',
    apply: (l) => ({
      fontFamily: 'Permanent Marker',
      fontStyle: 'normal',
      fill: '#ffffff',
      background: { ...l.background, enabled: false },
      shadow: { enabled: true, color: 'rgba(0,0,0,0.5)', blur: 6, offsetX: 0, offsetY: 2 },
    }),
  },
  {
    key: 'script',
    label: 'Script',
    apply: (l) => ({
      fontFamily: 'Pacifico',
      fontStyle: 'normal',
      fill: '#ffffff',
      background: { ...l.background, enabled: false },
    }),
  },
];

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
      <Field label="Quick style">
        <div className="flex flex-wrap gap-1">
          {TEXT_STYLES.map((s) => (
            <button key={s.key}
              className="rounded-md bg-white/5 px-2 py-1 text-xs hover:bg-white/10"
              onClick={() => {
                const p = s.apply(layer);
                if (p.fontFamily) ensureFont(p.fontFamily);
                patch(p);
              }}>
              {s.label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Font">
        <div className="flex gap-1">
          <select className={inputCls} value={layer.fontFamily}
            onChange={(e) => { ensureFont(e.target.value); patch({ fontFamily: e.target.value }); }}>
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
      <Field label="Size">
        <input type="number" className={inputCls} value={layer.fontSize}
          onChange={(e) => patch({ fontSize: Number(e.target.value) })} />
      </Field>
      <Field label="Fill">
        <FillEditor fill={layer.fill} fillKind={layer.fillKind} gradient={layer.gradient}
          onChange={patch} />
      </Field>
      <Field label={`Outline — ${layer.strokeWidth ?? 0}px`}>
        <input type="range" min={0} max={24} step={1} value={layer.strokeWidth ?? 0}
          className="w-full accent-violet-500"
          onChange={(e) => patch({ strokeWidth: Number(e.target.value) })} />
        {(layer.strokeWidth ?? 0) > 0 && (
          <div className="mt-1">
            <ColorField value={layer.stroke ?? '#000000'} onChange={(c) => patch({ stroke: c })} />
          </div>
        )}
      </Field>
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
        <>
          <Field label="Shadow color">
            <ColorField value={layer.shadow.color}
              onChange={(c) => patch({ shadow: { ...layer.shadow, color: c } })} />
          </Field>
          <Field label="Shadow blur">
            <input type="number" className={inputCls} value={layer.shadow.blur}
              onChange={(e) => patch({ shadow: { ...layer.shadow, blur: Number(e.target.value) } })} />
          </Field>
        </>
      )}

      {/* Background shape */}
      <Field label="Background">
        <div className="grid grid-cols-5 gap-1">
          {BG_PRESETS.map((opt) => {
            const bg = layer.background;
            const mode = bg.mode ?? 'box';
            const active =
              (opt.key === 'none' && !bg.enabled) ||
              (bg.enabled && opt.key === 'square' && mode === 'box' && bg.cornerRadius === 0) ||
              (bg.enabled && opt.key === 'rounded' && mode === 'box' && bg.cornerRadius > 0 && bg.cornerRadius < 1000) ||
              (bg.enabled && opt.key === 'pill' && mode === 'box' && bg.cornerRadius >= 1000) ||
              (bg.enabled && opt.key === 'highlight' && mode === 'highlight');
            return (
              <button key={opt.key}
                className={`rounded-md px-1 py-1.5 text-xs ${active ? 'bg-violet-500 text-white' : 'bg-white/5 hover:bg-white/10'}`}
                onClick={() => patch({ background: applyBgPreset(layer, opt.key) })}>
                {opt.label}
              </button>
            );
          })}
        </div>
      </Field>
      {layer.background.enabled && (
        <>
          <Field label="Background color">
            <ColorField value={layer.background.color}
              onChange={(c) => patch({ background: { ...layer.background, color: c } })} />
          </Field>
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
        <div className="flex flex-col gap-3">
          {layer.stops.map((s, i) => (
            <div key={i}>
              <span className="mb-1 block text-[10px] uppercase tracking-wide text-zinc-500">
                Stop {i + 1} (offset {s.offset})
              </span>
              <ColorField value={s.color} onChange={(c) => setStop(i, c)} />
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
            <FillEditor fill={layer.fill} fillKind={layer.fillKind} gradient={layer.gradient}
              onChange={patch} />
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
      <ShadowSection shadow={layer.shadow} onChange={(s) => patch({ shadow: s })} />
    </>
  );
}

/* ------------------------------- Collage ------------------------------- */

function CellPanel({ cellId }: { cellId: string }) {
  const collage = useEditor((s) => activePage(s).collage);
  const updateCell = useEditor((s) => s.updateCell);
  const clearCollage = useEditor((s) => s.clearCollage);
  const fileRef = useRef<HTMLInputElement>(null);
  const cell = collage?.cells.find((c) => c.id === cellId);
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
      <button
        className="mt-3 w-full rounded-md bg-white/5 px-2 py-1.5 text-sm hover:bg-white/10"
        onClick={clearCollage}
      >
        ✕ Remove layout
      </button>
    </div>
  );
}

function LayoutPanel() {
  const collage = useEditor((s) => activePage(s).collage);
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

/* -------------------------------- Draw --------------------------------- */

function DrawProps({ layer }: { layer: DrawLayer }) {
  const updateLayer = useEditor((s) => s.updateLayer);
  return (
    <>
      <Field label="Stroke colour">
        <ColorField value={layer.stroke} onChange={(c) => updateLayer(layer.id, { stroke: c })} />
      </Field>
      <Slider label={`Thickness — ${layer.strokeWidth}`} min={1} max={80} step={1}
        value={layer.strokeWidth} onChange={(v) => updateLayer(layer.id, { strokeWidth: v })} />
      <Slider label={`Smoothing — ${layer.tension.toFixed(2)}`} min={0} max={1} step={0.05}
        value={layer.tension} onChange={(v) => updateLayer(layer.id, { tension: v })} />
    </>
  );
}

/* ----------------------------- Canvas panel ----------------------------- */

function CanvasProps() {
  const design = useEditor((s) => s.design);
  const background = useEditor((s) => activePage(s).background);
  const setBackground = useEditor((s) => s.setBackground);
  const setCanvasSize = useEditor((s) => s.setCanvasSize);
  const magicResize = useEditor((s) => s.magicResize);
  const activePreset = PRESETS.find(
    (p) => p.width === design.width && p.height === design.height,
  );
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Canvas</h3>
      <Field label="Page background">
        <ColorField value={background} onChange={setBackground} />
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

function PanelContent() {
  const selectedId = useEditor((s) => s.selectedId);
  const selectedCellId = useEditor((s) => s.selectedCellId);
  const pageLayers = useEditor((s) => activePage(s).layers);
  const sharedLayers = useEditor((s) => s.design.shared);
  const removeLayer = useEditor((s) => s.removeLayer);
  const duplicateLayer = useEditor((s) => s.duplicateLayer);
  const layer =
    pageLayers.find((l) => l.id === selectedId) ??
    sharedLayers.find((l) => l.id === selectedId) ??
    null;

  return (
    <>
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
          {layer.type === 'draw' && <DrawProps layer={layer as DrawLayer} />}
        </div>
      )}

      <div className="mt-auto border-t border-white/10 pt-4">
        <LayersList />
      </div>
    </>
  );
}

export function PropertiesPanel() {
  const sheetOpen = useEditor((s) => s.sheetOpen);
  const setSheetOpen = useEditor((s) => s.setSheetOpen);

  // The mobile sheet opens only via the "Edit" button (below) — selecting a
  // layer no longer pops it up, so you can freely move things on the canvas
  // without it shrinking out from under you.

  return (
    <>
      {/* Desktop: fixed right sidebar */}
      <aside className="hidden w-72 shrink-0 flex-col gap-4 overflow-y-auto border-l border-white/10 bg-[#14161b] p-4 md:flex">
        <PanelContent />
      </aside>

      {/* Mobile: floating button to open the edit sheet */}
      {!sheetOpen && (
        <button
          className="fixed bottom-4 right-4 z-20 rounded-full bg-violet-500 px-5 py-3 text-sm font-semibold text-white shadow-2xl md:hidden"
          onClick={() => setSheetOpen(true)}
        >
          Edit ⚙
        </button>
      )}

      {/* Mobile: bottom sheet (fixed height so the canvas can reserve space) */}
      <div
        className={`fixed inset-x-0 bottom-0 z-30 flex h-[55vh] flex-col rounded-t-2xl border-t border-white/10 bg-[#14161b] shadow-2xl transition-transform duration-200 md:hidden ${
          sheetOpen ? 'translate-y-0' : 'translate-y-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-2">
          <span className="text-sm font-semibold text-zinc-200">Edit</span>
          <button
            className="rounded-md bg-white/5 px-3 py-1 text-sm text-zinc-100 hover:bg-white/10"
            onClick={() => setSheetOpen(false)}
          >
            Done
          </button>
        </div>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
          <PanelContent />
        </div>
      </div>
    </>
  );
}
