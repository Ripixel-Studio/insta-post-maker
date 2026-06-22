import { create } from 'zustand';
import { produce } from 'immer';
import type {
  Design,
  Page,
  Layer,
  BaseLayer,
  ImageLayer,
  TextLayer,
  OverlayLayer,
  ShapeLayer,
  DrawLayer,
  CanvasPreset,
  Collage,
  CollageCell,
} from './types';
import { NO_FILTERS } from './types';
import { DEFAULT_PRESET } from './presets';
import { nextId, getAsset } from './assets';

export function emptyPage(): Page {
  return { id: nextId('page'), background: '#1b1d22', layers: [], collage: undefined };
}

export function emptyDesign(preset: CanvasPreset): Design {
  return { width: preset.width, height: preset.height, pages: [emptyPage()], shared: [] };
}

/** The page currently being edited. */
export function activePage(s: { design: Design; activePageIndex: number }): Page {
  return s.design.pages[s.activePageIndex] ?? s.design.pages[0];
}

/** Page layers plus shared layers (paint order: page first, then shared on top). */
export function combinedLayers(s: { design: Design; activePageIndex: number }): Layer[] {
  return [...activePage(s).layers, ...s.design.shared];
}

function fillLayerDefaults(l: Layer): Layer {
  const base = {
    ...l,
    flipX: l.flipX ?? false,
    flipY: l.flipY ?? false,
    skewX: l.skewX ?? 0,
    skewY: l.skewY ?? 0,
  } as Layer;
  if (base.type === 'image') {
    const img = base as ImageLayer;
    return { ...img, filters: img.filters ?? { ...NO_FILTERS } };
  }
  if (base.type === 'text') {
    const t = base as TextLayer;
    return {
      ...t,
      shadow: t.shadow ?? { enabled: false, color: 'rgba(0,0,0,0.6)', blur: 8, offsetX: 0, offsetY: 2 },
      background: t.background ?? { enabled: false, color: 'rgba(0,0,0,0.5)', cornerRadius: 8, padding: 12 },
    };
  }
  if (base.type === 'shape') {
    const s = base as ShapeLayer;
    return { ...s, stroke: s.stroke ?? '#ffffff', strokeWidth: s.strokeWidth ?? 0, cornerRadius: s.cornerRadius ?? 0 };
  }
  return base;
}

/** Accept old single-page designs and partial layers, returning a valid doc. */
export function normalizeDesign(input: Design & { layers?: Layer[]; background?: string; collage?: Collage }): Design {
  let pages: Page[];
  if (Array.isArray(input.pages) && input.pages.length > 0) {
    pages = input.pages.map((p) => ({
      id: p.id ?? nextId('page'),
      background: p.background ?? '#1b1d22',
      collage: p.collage,
      layers: (p.layers ?? []).map(fillLayerDefaults),
    }));
  } else {
    // Legacy single-page document.
    pages = [
      {
        id: nextId('page'),
        background: input.background ?? '#1b1d22',
        collage: input.collage,
        layers: (input.layers ?? []).map(fillLayerDefaults),
      },
    ];
  }
  return {
    width: input.width,
    height: input.height,
    pages,
    shared: (input.shared ?? []).map(fillLayerDefaults),
  };
}

/** Shared defaults for a new layer's transform/appearance fields. */
function baseLayer(
  type: Layer['type'],
  name: string,
  box: { x: number; y: number; width: number; height: number },
): BaseLayer {
  return {
    id: nextId('layer'),
    type,
    name,
    ...box,
    rotation: 0,
    flipX: false,
    flipY: false,
    skewX: 0,
    skewY: 0,
    opacity: 1,
    blendMode: 'source-over',
    visible: true,
    locked: false,
  };
}

/** Locate a layer across the active page and the shared list. */
function layerCtx(d: Design, idx: number, id: string): { layer: Layer; list: Layer[] } | null {
  const page = d.pages[idx] ?? d.pages[0];
  const inPage = page.layers.find((l) => l.id === id);
  if (inPage) return { layer: inPage, list: page.layers };
  const inShared = d.shared.find((l) => l.id === id);
  if (inShared) return { layer: inShared, list: d.shared };
  return null;
}

function scaleLayers(list: Layer[], sx: number, sy: number, sf: number) {
  for (const l of list) {
    l.x *= sx;
    l.y *= sy;
    l.width *= sx;
    l.height *= sy;
    if (l.type === 'text') l.fontSize = Math.max(4, Math.round(l.fontSize * sf));
  }
}

interface EditorState {
  design: Design;
  activePageIndex: number;
  selectedId: string | null;
  past: Design[];
  future: Design[];

  cropTargetId: string | null;
  eraseTargetId: string | null;
  editingTextId: string | null;
  selectedCellId: string | null;
  sheetOpen: boolean;
  setSheetOpen: (open: boolean) => void;
  /** Show all pages side-by-side (overview) instead of editing one. */
  viewAll: boolean;
  setViewAll: (v: boolean) => void;
  /** Freehand pen tool. */
  drawMode: boolean;
  drawColor: string;
  drawWidth: number;
  setDrawMode: (v: boolean) => void;
  setDrawColor: (c: string) => void;
  setDrawWidth: (w: number) => void;
  addDrawLayer: (absPoints: number[]) => void;
  setCropTarget: (id: string | null) => void;
  setEraseTarget: (id: string | null) => void;
  setEditingText: (id: string | null) => void;
  selectCell: (id: string | null) => void;

  projectId: string | null;
  projectName: string;
  setProjectMeta: (id: string, name: string) => void;
  setProjectName: (name: string) => void;

  customFonts: string[];
  addCustomFont: (family: string) => void;
  recentColors: string[];
  pushRecentColor: (color: string) => void;
  brandColors: string[];
  setBrandColors: (colors: string[]) => void;
  addBrandColor: (color: string) => void;
  removeBrandColor: (color: string) => void;

  setPreset: (preset: CanvasPreset) => void;
  setCanvasSize: (width: number, height: number) => void;
  magicResize: (width: number, height: number) => void;
  setBackground: (color: string) => void;
  select: (id: string | null) => void;
  loadDesign: (design: Design) => void;

  // Pages
  setActivePage: (index: number) => void;
  addPage: () => void;
  duplicatePage: () => void;
  removePage: (index: number) => void;
  movePage: (from: number, to: number) => void;
  toggleShared: (id: string) => void;

  // Collage
  applyLayout: (collage: Collage) => void;
  clearCollage: () => void;
  updateCollage: (patch: Partial<Collage>) => void;
  updateCell: (id: string, patch: Partial<CollageCell>) => void;
  setSplit: (axis: 'x' | 'y', index: number, value: number) => void;

  addImageLayer: (assetId: string) => string;
  addTextLayer: () => void;
  addTextElement: (text: string, opts?: Partial<TextLayer>) => void;
  addEmoji: (emoji: string) => void;
  addOverlayLayer: () => void;
  addShapeLayer: (shape: ShapeLayer['shape']) => void;

  updateLayer: (id: string, patch: Partial<Layer>) => void;
  liveUpdateLayer: (id: string, patch: Partial<Layer>) => void;
  beginGesture: () => void;
  removeLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  moveLayer: (id: string, dir: 'up' | 'down') => void;
  reorderLayer: (draggedId: string, targetId: string) => void;
  flipLayer: (id: string, axis: 'x' | 'y') => void;

  undo: () => void;
  redo: () => void;
}

const HISTORY_LIMIT = 50;

export const useEditor = create<EditorState>((set, get) => {
  function commit(mutator: (d: Design, page: Page) => void) {
    const prev = get().design;
    const idx = get().activePageIndex;
    const next = produce(prev, (d) => mutator(d, d.pages[idx] ?? d.pages[0]));
    set((s) => ({
      design: next,
      past: [...s.past, prev].slice(-HISTORY_LIMIT),
      future: [],
    }));
  }

  /** Push a layer onto the active page and select it. */
  function addLayer(layer: Layer) {
    commit((_d, page) => void page.layers.push(layer));
    set({ selectedId: layer.id, selectedCellId: null });
  }

  return {
    design: emptyDesign(DEFAULT_PRESET),
    activePageIndex: 0,
    selectedId: null,
    past: [],
    future: [],

    cropTargetId: null,
    eraseTargetId: null,
    editingTextId: null,
    selectedCellId: null,
    sheetOpen: false,
    setSheetOpen: (open) => set({ sheetOpen: open }),
    viewAll: false,
    setViewAll: (v) => set({ viewAll: v }),
    drawMode: false,
    drawColor: '#ffd400',
    drawWidth: 12,
    setDrawMode: (v) => set({ drawMode: v, selectedId: v ? null : get().selectedId }),
    setDrawColor: (c) => set({ drawColor: c }),
    setDrawWidth: (w) => set({ drawWidth: w }),

    addDrawLayer: (absPoints) => {
      if (absPoints.length < 4) return;
      const { drawColor, drawWidth } = get();
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < absPoints.length; i += 2) {
        minX = Math.min(minX, absPoints[i]);
        maxX = Math.max(maxX, absPoints[i]);
        minY = Math.min(minY, absPoints[i + 1]);
        maxY = Math.max(maxY, absPoints[i + 1]);
      }
      const points = absPoints.map((v, i) => (i % 2 === 0 ? v - minX : v - minY));
      const layer: DrawLayer = {
        ...baseLayer('draw', 'Drawing', {
          x: minX,
          y: minY,
          width: Math.max(1, maxX - minX),
          height: Math.max(1, maxY - minY),
        }),
        type: 'draw',
        points,
        stroke: drawColor,
        strokeWidth: drawWidth,
        tension: 0.4,
      };
      commit((_d, page) => void page.layers.push(layer));
      // Stay in draw mode for multiple strokes; don't select.
    },
    setCropTarget: (id) => set({ cropTargetId: id }),
    setEraseTarget: (id) => set({ eraseTargetId: id }),
    setEditingText: (id) => set({ editingTextId: id }),
    selectCell: (id) => set({ selectedCellId: id, selectedId: null }),

    projectId: null,
    projectName: 'Untitled',
    setProjectMeta: (id, name) => set({ projectId: id, projectName: name }),
    setProjectName: (name) => set({ projectName: name }),

    customFonts: [],
    recentColors: [],
    brandColors: [],
    setBrandColors: (colors) => set({ brandColors: colors }),
    addBrandColor: (color) =>
      set((s) => ({ brandColors: s.brandColors.includes(color) ? s.brandColors : [...s.brandColors, color] })),
    removeBrandColor: (color) => set((s) => ({ brandColors: s.brandColors.filter((c) => c !== color) })),
    addCustomFont: (family) =>
      set((s) => ({ customFonts: s.customFonts.includes(family) ? s.customFonts : [...s.customFonts, family] })),
    pushRecentColor: (color) =>
      set((s) => ({ recentColors: [color, ...s.recentColors.filter((c) => c !== color)].slice(0, 12) })),

    setPreset: (preset) =>
      commit((d) => {
        d.width = preset.width;
        d.height = preset.height;
      }),

    setCanvasSize: (width, height) =>
      commit((d) => {
        d.width = Math.max(64, Math.round(width));
        d.height = Math.max(64, Math.round(height));
      }),

    magicResize: (width, height) =>
      commit((d) => {
        const nw = Math.max(64, Math.round(width));
        const nh = Math.max(64, Math.round(height));
        const sx = nw / d.width;
        const sy = nh / d.height;
        const sf = (sx + sy) / 2;
        for (const p of d.pages) scaleLayers(p.layers, sx, sy, sf);
        scaleLayers(d.shared, sx, sy, sf);
        d.width = nw;
        d.height = nh;
      }),

    setBackground: (color) =>
      commit((_d, page) => {
        page.background = color;
      }),

    select: (id) => set({ selectedId: id, selectedCellId: null }),

    loadDesign: (design) =>
      set({ design: normalizeDesign(design), activePageIndex: 0, selectedId: null, selectedCellId: null, past: [], future: [] }),

    /* ------------------------------ Pages ------------------------------ */

    setActivePage: (index) =>
      set((s) => ({
        activePageIndex: Math.min(Math.max(0, index), s.design.pages.length - 1),
        selectedId: null,
        selectedCellId: null,
        cropTargetId: null,
        editingTextId: null,
      })),

    addPage: () => {
      commit((d) => void d.pages.push(emptyPage()));
      set((s) => ({ activePageIndex: s.design.pages.length - 1, selectedId: null, selectedCellId: null }));
    },

    duplicatePage: () => {
      const { design, activePageIndex } = get();
      const src = design.pages[activePageIndex];
      if (!src) return;
      const copy: Page = {
        ...structuredClone(src),
        id: nextId('page'),
        layers: src.layers.map((l) => ({ ...structuredClone(l), id: nextId('layer') })),
      };
      if (copy.collage) copy.collage.cells = copy.collage.cells.map((c) => ({ ...c, id: nextId('cell') }));
      commit((d) => void d.pages.splice(activePageIndex + 1, 0, copy));
      set({ activePageIndex: activePageIndex + 1, selectedId: null, selectedCellId: null });
    },

    removePage: (index) => {
      const { design } = get();
      if (design.pages.length <= 1) return;
      commit((d) => void d.pages.splice(index, 1));
      set((s) => ({
        activePageIndex: Math.min(s.activePageIndex, s.design.pages.length - 1),
        selectedId: null,
        selectedCellId: null,
      }));
    },

    movePage: (from, to) => {
      commit((d) => {
        if (to < 0 || to >= d.pages.length) return;
        const [p] = d.pages.splice(from, 1);
        d.pages.splice(to, 0, p);
      });
      set({ activePageIndex: Math.min(Math.max(0, to), get().design.pages.length - 1) });
    },

    toggleShared: (id) => {
      const idx = get().activePageIndex;
      commit((d) => {
        const page = d.pages[idx] ?? d.pages[0];
        const fromPage = page.layers.findIndex((l) => l.id === id);
        if (fromPage >= 0) {
          const [l] = page.layers.splice(fromPage, 1);
          d.shared.push(l);
          return;
        }
        const fromShared = d.shared.findIndex((l) => l.id === id);
        if (fromShared >= 0) {
          const [l] = d.shared.splice(fromShared, 1);
          page.layers.push(l);
        }
      });
    },

    /* ----------------------------- Collage ----------------------------- */

    applyLayout: (collage) => {
      commit((_d, page) => {
        const filled = page.collage?.cells.filter((c) => c.assetId) ?? [];
        collage.cells.forEach((cell, i) => {
          const src = filled[i];
          if (src) {
            cell.assetId = src.assetId;
            cell.zoom = src.zoom;
            cell.offsetX = src.offsetX;
            cell.offsetY = src.offsetY;
          }
        });
        page.collage = collage;
      });
      set({ selectedCellId: null });
    },

    clearCollage: () => {
      commit((_d, page) => void (page.collage = undefined));
      set({ selectedCellId: null });
    },

    updateCollage: (patch) =>
      commit((_d, page) => {
        if (page.collage) Object.assign(page.collage, patch);
      }),

    updateCell: (id, patch) =>
      commit((_d, page) => {
        const cell = page.collage?.cells.find((c) => c.id === id);
        if (cell) Object.assign(cell, patch);
      }),

    setSplit: (axis, index, value) =>
      commit((_d, page) => {
        if (!page.collage) return;
        const splits = axis === 'x' ? page.collage.splitsX : page.collage.splitsY;
        const lo = (splits[index - 1] ?? 0) + 0.05;
        const hi = (splits[index + 1] ?? 1) - 0.05;
        splits[index] = Math.min(Math.max(value, lo), hi);
      }),

    /* ------------------------------ Layers ----------------------------- */

    addImageLayer: (assetId) => {
      const asset = getAsset(assetId);
      const { design } = get();
      const sourceW = asset?.width ?? design.width;
      const sourceH = asset?.height ?? design.height;
      const scale = Math.min((design.width * 0.8) / sourceW, (design.height * 0.8) / sourceH, 1);
      const w = sourceW * scale;
      const h = sourceH * scale;
      const layer: ImageLayer = {
        ...baseLayer('image', 'Image', {
          x: (design.width - w) / 2,
          y: (design.height - h) / 2,
          width: w,
          height: h,
        }),
        type: 'image',
        assetId,
        filters: { ...NO_FILTERS },
      };
      addLayer(layer);
      return layer.id;
    },

    addTextLayer: () => {
      const { design } = get();
      addLayer({
        ...baseLayer('text', 'Text', {
          x: design.width * 0.1,
          y: design.height * 0.45,
          width: design.width * 0.8,
          height: design.width * 0.16,
        }),
        type: 'text',
        text: 'Double-click to edit',
        fontFamily: 'Inter',
        fontSize: Math.round(design.width * 0.08),
        fontStyle: 'bold',
        fill: '#ffffff',
        align: 'center',
        lineHeight: 1.2,
        letterSpacing: 0,
        shadow: { enabled: false, color: 'rgba(0,0,0,0.6)', blur: 8, offsetX: 0, offsetY: 2 },
        background: { enabled: false, color: 'rgba(0,0,0,0.5)', cornerRadius: 8, padding: 12 },
      } as TextLayer);
    },

    addTextElement: (text, opts = {}) => {
      const { design } = get();
      const layer: TextLayer = {
        ...baseLayer('text', opts.name ?? 'Text', {
          x: opts.x ?? design.width * 0.1,
          y: opts.y ?? design.height * 0.4,
          width: opts.width ?? design.width * 0.8,
          height: opts.height ?? Math.round(design.width * 0.16),
        }),
        type: 'text',
        text,
        fontFamily: 'Inter',
        fontSize: Math.round(design.width * 0.07),
        fontStyle: 'bold',
        fill: '#ffffff',
        align: 'left',
        lineHeight: 1.15,
        letterSpacing: 0,
        shadow: { enabled: false, color: 'rgba(0,0,0,0.6)', blur: 8, offsetX: 0, offsetY: 2 },
        background: { enabled: false, color: 'rgba(0,0,0,0.5)', cornerRadius: 8, padding: 12 },
        ...opts,
      };
      addLayer(layer);
    },

    addEmoji: (emoji) => {
      const { design } = get();
      const size = design.width * 0.3;
      addLayer({
        ...baseLayer('text', `Emoji ${emoji}`, {
          x: (design.width - size) / 2,
          y: (design.height - size) / 2,
          width: size,
          height: size,
        }),
        type: 'text',
        text: emoji,
        fontFamily: 'Inter',
        fontSize: Math.round(size * 0.8),
        fontStyle: 'normal',
        fill: '#ffffff',
        align: 'center',
        lineHeight: 1,
        letterSpacing: 0,
        shadow: { enabled: false, color: 'rgba(0,0,0,0.6)', blur: 8, offsetX: 0, offsetY: 2 },
        background: { enabled: false, color: 'rgba(0,0,0,0.5)', cornerRadius: 8, padding: 12 },
      } as TextLayer);
    },

    addOverlayLayer: () => {
      const { design } = get();
      addLayer({
        ...baseLayer('overlay', 'Gradient overlay', {
          x: 0,
          y: design.height * 0.5,
          width: design.width,
          height: design.height * 0.5,
        }),
        type: 'overlay',
        direction: 'to-top',
        stops: [
          { offset: 0, color: 'rgba(0,0,0,0.85)' },
          { offset: 1, color: 'rgba(0,0,0,0)' },
        ],
      } as OverlayLayer);
    },

    addShapeLayer: (shape) => {
      const { design } = get();
      const size = design.width * 0.3;
      addLayer({
        ...baseLayer('shape', shape === 'line' ? 'Line' : shape === 'ellipse' ? 'Ellipse' : 'Rectangle', {
          x: design.width * 0.35,
          y: design.height * 0.4,
          width: size,
          height: shape === 'line' ? 8 : size,
        }),
        type: 'shape',
        shape,
        fill: '#c084fc',
        stroke: '#ffffff',
        strokeWidth: shape === 'line' ? 6 : 0,
        cornerRadius: 16,
      } as ShapeLayer);
    },

    updateLayer: (id, patch) =>
      commit((d) => {
        const ctx = layerCtx(d, get().activePageIndex, id);
        if (ctx) Object.assign(ctx.layer, patch);
      }),

    liveUpdateLayer: (id, patch) =>
      set((s) => ({
        design: produce(s.design, (d) => {
          const ctx = layerCtx(d, s.activePageIndex, id);
          if (ctx) Object.assign(ctx.layer, patch);
        }),
      })),

    beginGesture: () => set((s) => ({ past: [...s.past, s.design].slice(-HISTORY_LIMIT), future: [] })),

    removeLayer: (id) => {
      commit((d) => {
        const ctx = layerCtx(d, get().activePageIndex, id);
        if (!ctx) return;
        const i = ctx.list.indexOf(ctx.layer);
        if (i >= 0) ctx.list.splice(i, 1);
      });
      if (get().selectedId === id) set({ selectedId: null });
    },

    duplicateLayer: (id) => {
      const idx = get().activePageIndex;
      const ctx = layerCtx(get().design, idx, id);
      if (!ctx) return;
      const copy: Layer = {
        ...structuredClone(ctx.layer),
        id: nextId('layer'),
        name: `${ctx.layer.name} copy`,
        x: ctx.layer.x + 24,
        y: ctx.layer.y + 24,
      };
      commit((d) => {
        const c = layerCtx(d, idx, id);
        (c ? c.list : (d.pages[idx] ?? d.pages[0]).layers).push(copy);
      });
      set({ selectedId: copy.id, selectedCellId: null });
    },

    moveLayer: (id, dir) =>
      commit((d) => {
        const ctx = layerCtx(d, get().activePageIndex, id);
        if (!ctx) return;
        const i = ctx.list.indexOf(ctx.layer);
        const j = dir === 'up' ? i + 1 : i - 1;
        if (j < 0 || j >= ctx.list.length) return;
        [ctx.list[i], ctx.list[j]] = [ctx.list[j], ctx.list[i]];
      }),

    reorderLayer: (draggedId, targetId) =>
      commit((d) => {
        if (draggedId === targetId) return;
        const idx = get().activePageIndex;
        const dctx = layerCtx(d, idx, draggedId);
        const tctx = layerCtx(d, idx, targetId);
        // Only reorder within the same list (page or shared).
        if (!dctx || !tctx || dctx.list !== tctx.list) return;
        const list = dctx.list;
        const from = list.indexOf(dctx.layer);
        const [moved] = list.splice(from, 1);
        const to = list.indexOf(tctx.layer);
        list.splice(to, 0, moved);
      }),

    flipLayer: (id, axis) =>
      commit((d) => {
        const ctx = layerCtx(d, get().activePageIndex, id);
        if (!ctx) return;
        if (axis === 'x') ctx.layer.flipX = !ctx.layer.flipX;
        else ctx.layer.flipY = !ctx.layer.flipY;
      }),

    undo: () => {
      const { past, design } = get();
      if (past.length === 0) return;
      const prev = past[past.length - 1];
      set((s) => ({
        design: prev,
        past: past.slice(0, -1),
        future: [design, ...s.future].slice(0, HISTORY_LIMIT),
        activePageIndex: Math.min(s.activePageIndex, prev.pages.length - 1),
      }));
    },

    redo: () => {
      const { future, design } = get();
      if (future.length === 0) return;
      const nextDesign = future[0];
      set((s) => ({
        design: nextDesign,
        past: [...s.past, design].slice(-HISTORY_LIMIT),
        future: future.slice(1),
        activePageIndex: Math.min(s.activePageIndex, nextDesign.pages.length - 1),
      }));
    },
  };
});
