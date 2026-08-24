/**
 * Editor action layer — a typed, programmatic API over the zustand editor
 * store (`useEditor`), the asset registry and the exporter.
 *
 * This is the keystone that lets a caller drive the *real* editor without
 * touching React or Konva: every operation mutates the same store the UI reads,
 * so anything built through here is a normal, fully-editable project.
 *
 * Two surfaces, one implementation:
 *
 *  1. `editorActions` — strongly-typed methods for use from app code (UI, tests).
 *  2. `EDITOR_TOOLS` / `runAction` — a name-addressable, JSON-describable tool
 *     registry so an AI Copilot can enumerate the editor's operations and call
 *     them by name with a plain object of arguments. The schemas here are
 *     provider-agnostic (minimal JSON Schema); a Copilot wires them into
 *     whatever tool-use format its model expects.
 *
 * Design notes:
 *  - Creators return the new layer's id (or cell ids) so a caller can style,
 *    place or fill what it just made. The store selects each new layer, so we
 *    read `selectedId` back for the creators that don't return it themselves.
 *  - Lookups that reference a missing layer/cell/preset throw a descriptive
 *    Error rather than silently no-op'ing (the store no-ops), so a Copilot gets
 *    actionable feedback instead of a mystery non-change.
 *  - Nothing here knows about Anthropic/Claude. It is a pure editor wrapper.
 */

import { useEditor, activePage, emptyPage } from './store';
import type {
  Design,
  Page,
  Layer,
  ImageLayer,
  TextLayer,
  OverlayLayer,
  ShapeLayer,
  GradientDirection,
  ImageFilters,
  CropRect,
  CollageCell,
} from './types';
import { NO_FILTERS } from './types';
import { PRESETS, DEFAULT_PRESET } from './presets';
import { LAYOUTS } from './collage';
import { FONTS, ensureFont } from './fonts';
import { FILTER_PRESETS } from './filters';
import { getAsset } from './assets';
import {
  exportDesign,
  exportCarousel as exportCarouselBlobs,
  downloadBlob,
  type ExportFormat,
} from './export';

/* --------------------------------------------------------------------------
 * Internal helpers
 * ------------------------------------------------------------------------ */

const store = () => useEditor.getState();

/** Id of the most recently created (and therefore selected) layer. */
function lastCreatedId(): string {
  const id = store().selectedId;
  if (!id) throw new Error('Expected a newly created layer to be selected.');
  return id;
}

/** Find a layer by id across the active page and the shared list, or throw. */
function requireLayer(id: string): Layer {
  const s = store();
  const page = activePage(s);
  const found = page.layers.find((l) => l.id === id) ?? s.design.shared.find((l) => l.id === id);
  if (!found) throw new Error(`No layer with id "${id}" on the active page or shared layers.`);
  return found;
}

function requireImageLayer(id: string): ImageLayer {
  const l = requireLayer(id);
  if (l.type !== 'image') throw new Error(`Layer "${id}" is a ${l.type} layer, not an image.`);
  return l;
}

function requireTextLayer(id: string): TextLayer {
  const l = requireLayer(id);
  if (l.type !== 'text') throw new Error(`Layer "${id}" is a ${l.type} layer, not text.`);
  return l;
}

/** Cover-fit crop mapping a W×H source onto the current W×H canvas. */
function coverCrop(srcW: number, srcH: number, canvasW: number, canvasH: number): CropRect {
  const canvasAspect = canvasW / canvasH;
  const srcAspect = srcW / srcH;
  return srcAspect > canvasAspect
    ? { x: (1 - canvasAspect / srcAspect) / 2, y: 0, width: canvasAspect / srcAspect, height: 1 }
    : { x: 0, y: (1 - srcAspect / canvasAspect) / 2, width: 1, height: srcAspect / canvasAspect };
}

/* --------------------------------------------------------------------------
 * Typed argument shapes
 * ------------------------------------------------------------------------ */

export interface Box {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
}

export interface NewCanvasOptions {
  /** A preset id (see `listPresets`), e.g. 'story', 'square'. Default: story. */
  preset?: string;
  /** Explicit size (overrides the preset's dimensions). */
  width?: number;
  height?: number;
  /** Page background colour. */
  background?: string;
}

export interface AddImageOptions extends Box {
  name?: string;
}

export interface AddTextOptions extends Box {
  name?: string;
  fontFamily?: string;
  fontSize?: number;
  fontStyle?: TextLayer['fontStyle'];
  fill?: string;
  align?: TextLayer['align'];
  lineHeight?: number;
  letterSpacing?: number;
}

export interface GradientOverlayOptions extends Box {
  /** Where the dark end sits: 'to-top' darkens the bottom edge (default),
   * 'to-bottom' the top, 'to-left'/'to-right' the sides, 'radial' a vignette. */
  direction?: GradientDirection;
  /** Colour of the dark end, e.g. '#000000' (default) or a brand colour. */
  color?: string;
  /** Opacity of the dark end, 0..1 (default 0.85). */
  strength?: number;
  name?: string;
}

export interface ShapeOptions extends Box {
  fill?: string;
  opacity?: number;
  cornerRadius?: number;
  stroke?: string;
  strokeWidth?: number;
  name?: string;
}

export interface TextStyle {
  text?: string;
  fontFamily?: string;
  fontSize?: number;
  fontStyle?: TextLayer['fontStyle'];
  fill?: string;
  fillKind?: TextLayer['fillKind'];
  gradient?: TextLayer['gradient'];
  stroke?: string;
  strokeWidth?: number;
  align?: TextLayer['align'];
  lineHeight?: number;
  letterSpacing?: number;
  shadow?: TextLayer['shadow'];
  background?: TextLayer['background'];
}

export interface ExportImageOptions {
  format?: ExportFormat;
  /** 1 = exact preset pixels, 2 = @2x. */
  multiplier?: 1 | 2;
  quality?: number;
}

/** Compact, serialisable view of the editor for a Copilot to reason over. */
export interface EditorSnapshot {
  canvas: { width: number; height: number };
  activePageIndex: number;
  selectedId: string | null;
  pageCount: number;
  pages: {
    id: string;
    background: string;
    layers: SnapshotLayer[];
    collage?: { cols: number; rows: number; cells: { id: string; filled: boolean }[] };
  }[];
  shared: SnapshotLayer[];
}

/** One layer as the Copilot sees it: id/type/name plus its box on the canvas
 * (top-left origin, canvas px) and the few visual facts that matter for
 * judging a layout — text content/size/colour, image asset + non-default
 * adjustments. Without geometry the model was placing things blind. */
export interface SnapshotLayer {
  id: string;
  type: Layer['type'];
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  text?: string;
  fontSize?: number;
  fill?: string;
  assetId?: string;
  adjustments?: Partial<ImageFilters>;
  /** Overlay: gradient direction; shape: kind. */
  direction?: string;
  shape?: string;
}

function snapshotLayer(l: Layer): SnapshotLayer {
  const r = (n: number) => Math.round(n);
  const out: SnapshotLayer = {
    id: l.id, type: l.type, name: l.name,
    x: r(l.x), y: r(l.y), width: r(l.width), height: r(l.height),
  };
  if (l.rotation) out.rotation = r(l.rotation);
  if (l.opacity != null && l.opacity !== 1) out.opacity = Math.round(l.opacity * 100) / 100;
  if (l.type === 'text') {
    const t = l as TextLayer;
    out.text = t.text.length > 60 ? `${t.text.slice(0, 57)}…` : t.text;
    out.fontSize = r(t.fontSize);
    out.fill = t.fill;
  } else if (l.type === 'image') {
    const im = l as ImageLayer;
    out.assetId = im.assetId;
    const f = im.filters ?? NO_FILTERS;
    const adj: Partial<ImageFilters> = {};
    (Object.keys(NO_FILTERS) as (keyof ImageFilters)[]).forEach((k) => {
      if (f[k] !== NO_FILTERS[k]) adj[k] = f[k];
    });
    if (Object.keys(adj).length) out.adjustments = adj;
  } else if (l.type === 'overlay') {
    out.direction = (l as OverlayLayer).direction;
  } else if (l.type === 'shape') {
    const sh = l as ShapeLayer;
    out.shape = sh.shape;
    out.fill = sh.fill;
  }
  return out;
}

/* --------------------------------------------------------------------------
 * The typed action layer
 * ------------------------------------------------------------------------ */

export const editorActions = {
  /* ------------------------------ Canvas ------------------------------ */

  /** Replace the whole design with a fresh, empty canvas at a preset (or size).
   * Resets undo history — this is a "new document" operation. */
  newCanvas(opts: NewCanvasOptions = {}): void {
    const preset = opts.preset
      ? PRESETS.find((p) => p.id === opts.preset) ??
        (() => {
          throw new Error(
            `Unknown preset "${opts.preset}". Options: ${PRESETS.map((p) => p.id).join(', ')}.`,
          );
        })()
      : DEFAULT_PRESET;
    const page = emptyPage();
    if (opts.background) page.background = opts.background;
    const design: Design = {
      width: Math.max(64, Math.round(opts.width ?? preset.width)),
      height: Math.max(64, Math.round(opts.height ?? preset.height)),
      pages: [page],
      shared: [],
    };
    store().loadDesign(design);
  },

  /** Switch the canvas to a named preset (keeps all pages/layers). */
  setPreset(presetId: string): void {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset)
      throw new Error(
        `Unknown preset "${presetId}". Options: ${PRESETS.map((p) => p.id).join(', ')}.`,
      );
    store().setPreset(preset);
  },

  setCanvasSize(width: number, height: number): void {
    store().setCanvasSize(width, height);
  },

  /** Reflow the whole design between two sizes (scales every layer). */
  magicResize(width: number, height: number): void {
    store().magicResize(width, height);
  },

  /** Set the active page's background colour. */
  setBackground(color: string): void {
    store().setBackground(color);
  },

  listPresets() {
    return PRESETS.map((p) => ({ id: p.id, label: p.label, width: p.width, height: p.height }));
  },

  /* ------------------------------- Pages ------------------------------ */

  /** Append a blank page and make it active. Returns the new page id. */
  addPage(): string {
    store().addPage();
    return activePage(store()).id;
  },

  /** Duplicate the active page (all layers) and make the copy active. */
  duplicatePage(): string {
    store().duplicatePage();
    return activePage(store()).id;
  },

  removePage(index: number): void {
    store().removePage(index);
  },

  setActivePage(index: number): void {
    const count = store().design.pages.length;
    if (index < 0 || index >= count)
      throw new Error(`Page index ${index} out of range (0..${count - 1}).`);
    store().setActivePage(index);
  },

  movePage(from: number, to: number): void {
    store().movePage(from, to);
  },

  pageCount(): number {
    return store().design.pages.length;
  },

  /** Toggle a layer between page-local and shared-on-every-page. */
  toggleShared(id: string): void {
    requireLayer(id);
    store().toggleShared(id);
  },

  /* ------------------------------ Images ------------------------------ */

  /** Add an uploaded image (by asset id) to the active page, optionally
   * positioned/sized. Returns the new layer id. */
  addImage(assetId: string, opts: AddImageOptions = {}): string {
    const id = store().addImageLayer(assetId);
    const patch: Partial<ImageLayer> = {};
    if (opts.name !== undefined) patch.name = opts.name;
    if (opts.x !== undefined) patch.x = opts.x;
    if (opts.y !== undefined) patch.y = opts.y;
    if (opts.width !== undefined) patch.width = opts.width;
    if (opts.height !== undefined) patch.height = opts.height;
    if (opts.rotation !== undefined) patch.rotation = opts.rotation;
    if (Object.keys(patch).length) store().updateLayer(id, patch);
    return id;
  },

  /** Move/resize/rotate any layer. Omitted fields are left unchanged. */
  transformLayer(id: string, box: Box): void {
    requireLayer(id);
    const patch: Partial<Layer> = {};
    if (box.x !== undefined) patch.x = box.x;
    if (box.y !== undefined) patch.y = box.y;
    if (box.width !== undefined) patch.width = box.width;
    if (box.height !== undefined) patch.height = box.height;
    if (box.rotation !== undefined) patch.rotation = box.rotation;
    store().updateLayer(id, patch);
  },

  /** Position/size an image layer (alias of transformLayer with a type check). */
  placeImage(id: string, box: Box): void {
    requireImageLayer(id);
    editorActions.transformLayer(id, box);
  },

  /** Crop an image to a normalised rect (0..1 of the source). */
  cropImage(id: string, crop: CropRect): void {
    requireImageLayer(id);
    store().updateLayer(id, { crop });
  },

  /** Clear any crop, showing the whole source image again. */
  resetCrop(id: string): void {
    requireImageLayer(id);
    store().updateLayer(id, { crop: undefined });
  },

  /** Scale an image to cover the whole canvas, centre-cropping the overflow. */
  fitImageToCanvas(id: string): void {
    const layer = requireImageLayer(id);
    const { width: cw, height: ch } = store().design;
    const asset = getAsset(layer.assetId);
    const crop = coverCrop(asset?.width ?? cw, asset?.height ?? ch, cw, ch);
    store().updateLayer(id, { x: 0, y: 0, width: cw, height: ch, rotation: 0, crop });
  },

  /** Merge colour adjustments into an image (unset fields keep their value). */
  adjustImage(id: string, filters: Partial<ImageFilters>): void {
    const layer = requireImageLayer(id);
    store().updateLayer(id, { filters: { ...(layer.filters ?? NO_FILTERS), ...clampFilters(filters) } });
  },

  /** Apply a one-tap filter preset (see `listFilterPresets`) to an image. */
  applyFilterPreset(id: string, presetId: string): void {
    requireImageLayer(id);
    const preset = FILTER_PRESETS.find((p) => p.id === presetId);
    if (!preset)
      throw new Error(
        `Unknown filter preset "${presetId}". Options: ${FILTER_PRESETS.map((p) => p.id).join(', ')}.`,
      );
    store().updateLayer(id, { filters: { ...preset.values } });
  },

  listFilterPresets() {
    return FILTER_PRESETS.map((p) => ({ id: p.id, label: p.label }));
  },

  /* --------------------------- Overlays & shapes ----------------------- */

  /**
   * A gradient scrim — the standard way to make text readable over a photo.
   * Defaults to the bottom half of the canvas fading from 85% black at the
   * bottom edge to transparent, which is the Instagram-caption look. Returns
   * the new layer id; add the text AFTER it so the text sits on top.
   */
  addGradientOverlay(opts: GradientOverlayOptions = {}): string {
    const s = store();
    s.addOverlayLayer();
    const id = lastCreatedId();
    const { color, strength, direction, name, ...box } = opts;
    const rgba = toRgba(color ?? '#000000', Math.min(1, Math.max(0, strength ?? 0.85)));
    const transparent = toRgba(color ?? '#000000', 0);
    const patch: Partial<OverlayLayer> = {
      ...compactBox(box),
      direction: direction ?? 'to-top',
      stops: [
        { offset: 0, color: rgba },
        { offset: 1, color: transparent },
      ],
    };
    if (name) patch.name = name;
    store().updateLayer(id, patch);
    return id;
  },

  /** A solid rectangle/ellipse — e.g. a plate behind a stats block. Returns
   * the new layer id. */
  addShape(shape: 'rect' | 'ellipse', opts: ShapeOptions = {}): string {
    const s = store();
    s.addShapeLayer(shape);
    const id = lastCreatedId();
    const { fill, opacity, cornerRadius, stroke, strokeWidth, name, ...box } = opts;
    const patch: Partial<ShapeLayer> = { ...compactBox(box) };
    if (fill) patch.fill = fill;
    if (opacity != null) patch.opacity = Math.min(1, Math.max(0, opacity));
    if (cornerRadius != null) patch.cornerRadius = cornerRadius;
    if (stroke != null) patch.stroke = stroke;
    if (strokeWidth != null) patch.strokeWidth = strokeWidth;
    if (name) patch.name = name;
    store().updateLayer(id, patch);
    return id;
  },

  /* ------------------------------- Text ------------------------------- */

  /** Add a text element to the active page. Returns the new layer id. */
  addText(text: string, opts: AddTextOptions = {}): string {
    if (opts.fontFamily) ensureFont(opts.fontFamily);
    store().addTextElement(text, opts as Partial<TextLayer>);
    return lastCreatedId();
  },

  /** Restyle an existing text layer (text, font, colour, alignment, …).
   * Loads the requested web font so it never rasterises in a fallback face. */
  styleText(id: string, style: TextStyle): void {
    requireTextLayer(id);
    if (style.fontFamily) ensureFont(style.fontFamily);
    store().updateLayer(id, style as Partial<TextLayer>);
  },

  /** Convenience: set only a text layer's fill colour. */
  setTextColor(id: string, color: string): void {
    requireTextLayer(id);
    store().updateLayer(id, { fill: color, fillKind: 'solid' });
  },

  /** Built-in + user-uploaded font families available to text layers. */
  listFonts(): string[] {
    return [...FONTS.map((f) => f.family), ...store().customFonts];
  },

  /* ------------------------- Layout / collage ------------------------- */

  /** Apply a named collage layout (see `listLayouts`) to the active page.
   * Existing filled photos carry over into the new cells where they fit. */
  applyLayout(layoutId: string): void {
    const layout = LAYOUTS.find((l) => l.id === layoutId);
    if (!layout)
      throw new Error(
        `Unknown layout "${layoutId}". Options: ${LAYOUTS.map((l) => l.id).join(', ')}.`,
      );
    store().applyLayout(layout.build());
  },

  listLayouts() {
    return LAYOUTS.map((l) => ({ id: l.id, label: l.label }));
  },

  /** Ids of the active page's collage cells, in order. */
  collageCellIds(): string[] {
    return activePage(store()).collage?.cells.map((c) => c.id) ?? [];
  },

  /** Put an image into a collage cell (reset to a centred, un-zoomed fit). */
  setCollageCellImage(cellId: string, assetId: string): void {
    requireCell(cellId);
    store().updateCell(cellId, { assetId, zoom: 1, offsetX: 0.5, offsetY: 0.5 });
  },

  /** Fine-tune a collage cell (zoom/pan/clear). */
  updateCollageCell(cellId: string, patch: Partial<CollageCell>): void {
    requireCell(cellId);
    store().updateCell(cellId, patch);
  },

  /** Remove the collage grid from the active page. */
  clearCollage(): void {
    store().clearCollage();
  },

  /* --------------------------- Generic layers ------------------------- */

  select(id: string | null): void {
    if (id !== null) requireLayer(id);
    store().select(id);
  },

  removeLayer(id: string): void {
    requireLayer(id);
    store().removeLayer(id);
  },

  duplicateLayer(id: string): string {
    requireLayer(id);
    store().duplicateLayer(id);
    return lastCreatedId();
  },

  /** Escape hatch: patch any field on a layer. Prefer the typed helpers. */
  updateLayer(id: string, patch: Partial<Layer>): void {
    requireLayer(id);
    store().updateLayer(id, patch as Partial<Layer>);
  },

  flipLayer(id: string, axis: 'x' | 'y'): void {
    requireLayer(id);
    store().flipLayer(id, axis);
  },

  /* ------------------------------ Export ------------------------------ */

  /** Render the current design to a PNG/JPEG blob at true resolution. */
  exportImage(opts: ExportImageOptions = {}): Promise<Blob> {
    return exportDesign(store().design, {
      format: opts.format ?? 'png',
      multiplier: opts.multiplier ?? 1,
      quality: opts.quality,
    });
  },

  /** Slice the design into `slides` seamless carousel panels. */
  exportCarousel(slides: number, opts: ExportImageOptions = {}): Promise<Blob[]> {
    if (slides < 1) throw new Error('A carousel needs at least 1 slide.');
    return exportCarouselBlobs(
      store().design,
      { format: opts.format ?? 'png', multiplier: opts.multiplier ?? 1, quality: opts.quality },
      slides,
    );
  },

  /** Export a PNG/JPEG and trigger a browser download. */
  async downloadImage(filename: string, opts: ExportImageOptions = {}): Promise<void> {
    const blob = await editorActions.exportImage(opts);
    downloadBlob(blob, filename);
  },

  /* ---------------------------- Inspection ---------------------------- */

  /** Raw editor state: the live design plus which page/layer is active. */
  getState() {
    const s = store();
    return { design: s.design, activePageIndex: s.activePageIndex, selectedId: s.selectedId };
  },

  /** A compact, serialisable summary for a Copilot to reason about. */
  getSnapshot(): EditorSnapshot {
    const s = store();
    const brief = snapshotLayer;
    return {
      canvas: { width: s.design.width, height: s.design.height },
      activePageIndex: s.activePageIndex,
      selectedId: s.selectedId,
      pageCount: s.design.pages.length,
      pages: s.design.pages.map((p: Page) => ({
        id: p.id,
        background: p.background,
        layers: p.layers.map(brief),
        collage: p.collage
          ? {
              cols: p.collage.cols,
              rows: p.collage.rows,
              cells: p.collage.cells.map((c) => ({ id: c.id, filled: Boolean(c.assetId) })),
            }
          : undefined,
      })),
      shared: s.design.shared.map(brief),
    };
  },
};

export type EditorActions = typeof editorActions;

/** Drop undefined box fields so a patch never overwrites with undefined. */
function compactBox(box: Box): Partial<Box> {
  const out: Partial<Box> = {};
  (['x', 'y', 'width', 'height', 'rotation'] as (keyof Box)[]).forEach((k) => {
    const v = box[k];
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  });
  return out;
}

/** '#rgb' / '#rrggbb' / 'rgb(a)' → 'rgba(r,g,b,a)'. Unknown strings fall back
 * to black so a bad colour still produces a usable scrim. */
export function toRgba(color: string, alpha: number): string {
  const c = color.trim();
  const hex = c.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((ch) => ch + ch).join('');
    const n = parseInt(h, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }
  const rgb = c.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgb) return `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${alpha})`;
  return `rgba(0,0,0,${alpha})`;
}

/** The legal range of each adjustment. Values outside are clamped, and a
 * caller passing e.g. brightness 50 (thinking 0..100) gets the max, not a
 * black frame. */
export const FILTER_RANGES: Record<keyof ImageFilters, [number, number]> = {
  brightness: [-1, 1],
  contrast: [-100, 100],
  saturation: [-1, 1],
  blur: [0, 40],
};

export function clampFilters(filters: Partial<ImageFilters>): Partial<ImageFilters> {
  const out: Partial<ImageFilters> = {};
  (Object.keys(filters) as (keyof ImageFilters)[]).forEach((k) => {
    const v = filters[k];
    const range = FILTER_RANGES[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || !range) return;
    out[k] = Math.min(range[1], Math.max(range[0], v));
  });
  return out;
}

/** Find a collage cell on the active page by id, or throw. */
function requireCell(cellId: string): CollageCell {
  const collage = activePage(store()).collage;
  const cell = collage?.cells.find((c) => c.id === cellId);
  if (!cell) throw new Error(`No collage cell "${cellId}" on the active page.`);
  return cell;
}

/* --------------------------------------------------------------------------
 * Tool registry — the name-addressable surface for the Copilot
 * ------------------------------------------------------------------------ */

/** Minimal, provider-agnostic JSON-Schema-ish parameter description. */
export interface ParamSchema {
  type: 'object';
  properties: Record<
    string,
    {
      type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array';
      description?: string;
      enum?: (string | number)[];
      /** Element schema for `array` properties. */
      items?: { type: 'string' | 'number' | 'integer' | 'boolean' };
    }
  >;
  required?: string[];
}

export interface EditorTool {
  name: string;
  description: string;
  parameters: ParamSchema;
  /** Runs the tool against the live store. May return a value (e.g. an id) or a
   * Promise (exports). Args are validated for required keys before this runs. */
  run: (args: Record<string, unknown>) => unknown;
}

const str = (description: string) => ({ type: 'string' as const, description });
const num = (description: string) => ({ type: 'number' as const, description });
const int = (description: string) => ({ type: 'integer' as const, description });
const obj = (description: string) => ({ type: 'object' as const, description });

/**
 * The editor's operations as callable tools. Kept deliberately close to the
 * typed methods above — same names, same semantics — so both surfaces stay in
 * lock-step. Args come in as a plain object; each `run` pulls what it needs.
 */
export const EDITOR_TOOLS: EditorTool[] = [
  {
    name: 'new_canvas',
    description:
      'Start a fresh, empty canvas at a preset (story/square/portrait/landscape) or an explicit size. Clears the current design.',
    parameters: {
      type: 'object',
      properties: {
        preset: str('Preset id: story, square, portrait or landscape.'),
        width: num('Explicit width in px (overrides the preset).'),
        height: num('Explicit height in px (overrides the preset).'),
        background: str('Page background colour, e.g. "#0b0d10".'),
      },
    },
    run: (a) => editorActions.newCanvas(a as NewCanvasOptions),
  },
  {
    name: 'set_preset',
    description: 'Switch the canvas to a named preset, keeping all pages and layers.',
    parameters: {
      type: 'object',
      properties: { preset: str('Preset id: story, square, portrait or landscape.') },
      required: ['preset'],
    },
    run: (a) => editorActions.setPreset(a.preset as string),
  },
  {
    name: 'set_canvas_size',
    description: 'Set an explicit canvas size in pixels.',
    parameters: {
      type: 'object',
      properties: { width: num('Width in px.'), height: num('Height in px.') },
      required: ['width', 'height'],
    },
    run: (a) => editorActions.setCanvasSize(a.width as number, a.height as number),
  },
  {
    name: 'set_background',
    description: "Set the active page's background colour.",
    parameters: {
      type: 'object',
      properties: { color: str('CSS colour, e.g. "#1b1d22".') },
      required: ['color'],
    },
    run: (a) => editorActions.setBackground(a.color as string),
  },
  {
    name: 'add_page',
    description: 'Append a blank page (panel) and make it active. Returns the new page id.',
    parameters: { type: 'object', properties: {} },
    run: () => editorActions.addPage(),
  },
  {
    name: 'duplicate_page',
    description: 'Duplicate the active page and make the copy active. Returns the new page id.',
    parameters: { type: 'object', properties: {} },
    run: () => editorActions.duplicatePage(),
  },
  {
    name: 'set_active_page',
    description: 'Switch which page (panel) is being edited.',
    parameters: {
      type: 'object',
      properties: { index: int('Zero-based page index.') },
      required: ['index'],
    },
    run: (a) => editorActions.setActivePage(a.index as number),
  },
  {
    name: 'add_image',
    description:
      'Add an uploaded image (by asset id) to the active page, optionally positioned/sized. Returns the new layer id.',
    parameters: {
      type: 'object',
      properties: {
        assetId: str('Asset id of a previously uploaded image.'),
        x: num('Left edge in canvas px.'),
        y: num('Top edge in canvas px.'),
        width: num('Width in canvas px.'),
        height: num('Height in canvas px.'),
        rotation: num('Rotation in degrees about the centre.'),
        name: str('Layer name.'),
      },
      required: ['assetId'],
    },
    run: (a) => {
      const { assetId, ...opts } = a;
      return editorActions.addImage(assetId as string, opts as AddImageOptions);
    },
  },
  {
    name: 'place_image',
    description: 'Move/resize/rotate an existing image layer.',
    parameters: {
      type: 'object',
      properties: {
        id: str('Image layer id.'),
        x: num('Left edge in canvas px.'),
        y: num('Top edge in canvas px.'),
        width: num('Width in canvas px.'),
        height: num('Height in canvas px.'),
        rotation: num('Rotation in degrees.'),
      },
      required: ['id'],
    },
    run: (a) => {
      const { id, ...box } = a;
      editorActions.placeImage(id as string, box as Box);
    },
  },
  {
    name: 'crop_image',
    description: 'Crop an image to a normalised rect (each of x/y/width/height is 0..1 of the source).',
    parameters: {
      type: 'object',
      properties: {
        id: str('Image layer id.'),
        x: num('Left of crop, 0..1.'),
        y: num('Top of crop, 0..1.'),
        width: num('Crop width, 0..1.'),
        height: num('Crop height, 0..1.'),
      },
      required: ['id', 'x', 'y', 'width', 'height'],
    },
    run: (a) =>
      editorActions.cropImage(a.id as string, {
        x: a.x as number,
        y: a.y as number,
        width: a.width as number,
        height: a.height as number,
      }),
  },
  {
    name: 'fit_image_to_canvas',
    description: 'Scale an image to cover the whole canvas, centre-cropping the overflow.',
    parameters: {
      type: 'object',
      properties: { id: str('Image layer id.') },
      required: ['id'],
    },
    run: (a) => editorActions.fitImageToCanvas(a.id as string),
  },
  {
    name: 'adjust_image',
    description:
      'Merge colour adjustments into an image. Ranges: brightness -1..1, contrast -100..100, saturation -1..1 (-1 = greyscale), blur 0..40 px; values are clamped. These are STRONG: keep |brightness| ≤ 0.15, |contrast| ≤ 15, |saturation| ≤ 0.2 for natural photos, and check the preview afterwards. Pass 0 to reset a channel.',
    parameters: {
      type: 'object',
      properties: {
        id: str('Image layer id.'),
        brightness: num('-1..1 (0 = none).'),
        contrast: num('-100..100 (0 = none).'),
        saturation: num('-1..1 (-1 = greyscale).'),
        blur: num('0..40 px.'),
      },
      required: ['id'],
    },
    run: (a) => {
      const { id, ...filters } = a;
      editorActions.adjustImage(id as string, filters as Partial<ImageFilters>);
    },
  },
  {
    name: 'apply_filter_preset',
    description: 'Apply a one-tap filter preset to an image (none/vivid/warm/moody/fade/mono).',
    parameters: {
      type: 'object',
      properties: { id: str('Image layer id.'), preset: str('Filter preset id.') },
      required: ['id', 'preset'],
    },
    run: (a) => editorActions.applyFilterPreset(a.id as string, a.preset as string),
  },
  {
    name: 'add_gradient_overlay',
    description:
      'Add a gradient scrim so text stays readable over a photo — THE standard fix for illegible captions/stats. Defaults: bottom half of the canvas, fading from 85% black at the bottom edge to transparent (direction "to-top"). Add it BEFORE the text so the text sits on top. Returns the new layer id.',
    parameters: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          description: 'Which edge is dark: to-top = bottom edge dark (default), to-bottom = top edge dark, to-left, to-right, radial = vignette.',
          enum: ['to-top', 'to-bottom', 'to-left', 'to-right', 'radial'],
        },
        color: str('Colour of the dark end, e.g. "#000000" (default) or a brand colour.'),
        strength: num('Opacity of the dark end 0..1 (default 0.85).'),
        x: num('Left edge in canvas px (default 0).'),
        y: num('Top edge in canvas px (default half the canvas height).'),
        width: num('Width in canvas px (default full width).'),
        height: num('Height in canvas px (default half the canvas height).'),
      },
    },
    run: (a) => editorActions.addGradientOverlay(a as GradientOverlayOptions),
  },
  {
    name: 'add_shape',
    description:
      'Add a solid rectangle or ellipse (e.g. a semi-transparent plate behind a stats block, a colour bar, a divider). Returns the new layer id.',
    parameters: {
      type: 'object',
      properties: {
        shape: { type: 'string', description: 'rect | ellipse.', enum: ['rect', 'ellipse'] },
        fill: str('Fill colour, e.g. "#000000".'),
        opacity: num('0..1 (default 1).'),
        cornerRadius: num('Corner radius in px (rect only).'),
        x: num('Left edge in canvas px.'),
        y: num('Top edge in canvas px.'),
        width: num('Width in canvas px.'),
        height: num('Height in canvas px.'),
        name: str('Layer name.'),
      },
      required: ['shape'],
    },
    run: (a) => {
      const { shape, ...opts } = a;
      return editorActions.addShape(shape as 'rect' | 'ellipse', opts as ShapeOptions);
    },
  },
  {
    name: 'add_text',
    description:
      'Add a text element to the active page with optional font, size, colour and alignment. Returns the new layer id.',
    parameters: {
      type: 'object',
      properties: {
        text: str('The text content.'),
        fontFamily: str('Font family (see list_fonts).'),
        fontSize: num('Font size in canvas px.'),
        fontStyle: {
          type: 'string',
          description: 'normal | bold | italic | "italic bold".',
          enum: ['normal', 'bold', 'italic', 'italic bold'],
        },
        fill: str('Text colour, e.g. "#ffffff".'),
        align: { type: 'string', description: 'left | center | right.', enum: ['left', 'center', 'right'] },
        x: num('Left edge in canvas px.'),
        y: num('Top edge in canvas px.'),
        width: num('Box width in canvas px.'),
        height: num('Box height in canvas px.'),
      },
      required: ['text'],
    },
    run: (a) => {
      const { text, ...opts } = a;
      return editorActions.addText(text as string, opts as AddTextOptions);
    },
  },
  {
    name: 'style_text',
    description:
      'Restyle an existing text layer: change its text, font, size, colour, alignment, spacing, shadow or background.',
    parameters: {
      type: 'object',
      properties: {
        id: str('Text layer id.'),
        text: str('New text content.'),
        fontFamily: str('Font family (see list_fonts).'),
        fontSize: num('Font size in canvas px.'),
        fontStyle: {
          type: 'string',
          description: 'normal | bold | italic | "italic bold".',
          enum: ['normal', 'bold', 'italic', 'italic bold'],
        },
        fill: str('Text colour.'),
        align: { type: 'string', description: 'left | center | right.', enum: ['left', 'center', 'right'] },
        lineHeight: num('Line height multiplier.'),
        letterSpacing: num('Letter spacing in px.'),
        shadow: obj('TextShadow object.'),
        background: obj('TextBackground object.'),
      },
      required: ['id'],
    },
    run: (a) => {
      const { id, ...style } = a;
      editorActions.styleText(id as string, style as TextStyle);
    },
  },
  {
    name: 'apply_layout',
    description:
      'Apply a named collage layout to the active page (2v, 2h, 3v, 1+2, 2+1, 4). Existing photos carry over.',
    parameters: {
      type: 'object',
      properties: { layout: str('Layout id.') },
      required: ['layout'],
    },
    run: (a) => editorActions.applyLayout(a.layout as string),
  },
  {
    name: 'set_collage_cell_image',
    description:
      'Put an uploaded image into a collage cell. Get cell ids from the snapshot after applying a layout.',
    parameters: {
      type: 'object',
      properties: { cellId: str('Collage cell id.'), assetId: str('Uploaded image asset id.') },
      required: ['cellId', 'assetId'],
    },
    run: (a) => editorActions.setCollageCellImage(a.cellId as string, a.assetId as string),
  },
  {
    name: 'clear_collage',
    description: 'Remove the collage grid from the active page.',
    parameters: { type: 'object', properties: {} },
    run: () => editorActions.clearCollage(),
  },
  {
    name: 'remove_layer',
    description: 'Delete a layer from the active page (or shared list).',
    parameters: {
      type: 'object',
      properties: { id: str('Layer id.') },
      required: ['id'],
    },
    run: (a) => editorActions.removeLayer(a.id as string),
  },
  {
    name: 'export_png',
    description: 'Render the current design to a PNG (or JPEG) blob. Returns the image blob.',
    parameters: {
      type: 'object',
      properties: {
        format: { type: 'string', description: 'png | jpeg.', enum: ['png', 'jpeg'] },
        multiplier: { type: 'integer', description: '1 = preset px, 2 = @2x.', enum: [1, 2] },
      },
    },
    run: (a) => editorActions.exportImage(a as ExportImageOptions),
  },
  {
    name: 'export_carousel',
    description: 'Slice the design into N seamless carousel panels. Returns an array of image blobs.',
    parameters: {
      type: 'object',
      properties: {
        slides: int('Number of slides (>= 1).'),
        format: { type: 'string', description: 'png | jpeg.', enum: ['png', 'jpeg'] },
        multiplier: { type: 'integer', description: '1 = preset px, 2 = @2x.', enum: [1, 2] },
      },
      required: ['slides'],
    },
    run: (a) => {
      const { slides, ...opts } = a;
      return editorActions.exportCarousel(slides as number, opts as ExportImageOptions);
    },
  },
  {
    name: 'get_snapshot',
    description:
      'Read the editor state: canvas size, pages, and every layer with its id/type/name AND its box (x, y, width, height in canvas px, origin top-left), text content/size/colour, image assetId and non-default adjustments, plus collage cell ids. Call this before placing or restyling anything so you know where things are.',
    parameters: { type: 'object', properties: {} },
    run: () => editorActions.getSnapshot(),
  },
];

/** Look up a tool descriptor by name. */
export function getTool(name: string): EditorTool | undefined {
  return EDITOR_TOOLS.find((t) => t.name === name);
}

/**
 * Run a tool by name with a plain-object of arguments. Validates that required
 * parameters are present, then executes against the live store. Throws
 * (rather than returning an error object) so callers get a stack; a Copilot
 * host is expected to catch and relay the message back to the model.
 */
export function runAction(name: string, args: Record<string, unknown> = {}): unknown {
  const tool = getTool(name);
  if (!tool)
    throw new Error(`Unknown tool "${name}". Available: ${EDITOR_TOOLS.map((t) => t.name).join(', ')}.`);
  const missing = (tool.parameters.required ?? []).filter(
    (k) => args[k] === undefined || args[k] === null,
  );
  if (missing.length)
    throw new Error(`Tool "${name}" is missing required argument(s): ${missing.join(', ')}.`);
  return tool.run(args);
}
