import { create } from 'zustand';
import { produce } from 'immer';
import type {
  Design,
  Layer,
  BaseLayer,
  ImageLayer,
  TextLayer,
  OverlayLayer,
  ShapeLayer,
  CanvasPreset,
  Collage,
  CollageCell,
} from './types';
import { NO_FILTERS } from './types';
import { DEFAULT_PRESET } from './presets';
import { nextId, getAsset } from './assets';

/** Fill in any fields missing from an older/partial saved design so the
 * renderer never hits `undefined` after a schema change. */
export function normalizeDesign(input: Design): Design {
  const layers = (input.layers ?? []).map((l): Layer => {
    const base = { ...l, flipX: l.flipX ?? false, flipY: l.flipY ?? false } as Layer;
    if (base.type === 'image') {
      const img = base as ImageLayer;
      return { ...img, filters: img.filters ?? { brightness: 0, contrast: 0, saturation: 0, blur: 0 } };
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
  });
  return { ...input, layers };
}

export function emptyDesign(preset: CanvasPreset): Design {
  return {
    width: preset.width,
    height: preset.height,
    background: '#1b1d22',
    layers: [],
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
    opacity: 1,
    blendMode: 'source-over',
    visible: true,
    locked: false,
  };
}

interface EditorState {
  design: Design;
  selectedId: string | null;
  past: Design[];
  future: Design[];

  /** Ephemeral UI modes (not part of undo history). */
  cropTargetId: string | null;
  editingTextId: string | null;
  selectedCellId: string | null;
  setCropTarget: (id: string | null) => void;
  setEditingText: (id: string | null) => void;
  selectCell: (id: string | null) => void;

  applyLayout: (collage: Collage) => void;
  clearCollage: () => void;
  updateCollage: (patch: Partial<Collage>) => void;
  updateCell: (id: string, patch: Partial<CollageCell>) => void;
  setSplit: (axis: 'x' | 'y', index: number, value: number) => void;

  /** Active project (for persistence). */
  projectId: string | null;
  projectName: string;
  setProjectMeta: (id: string, name: string) => void;
  setProjectName: (name: string) => void;

  setPreset: (preset: CanvasPreset) => void;
  setCanvasSize: (width: number, height: number) => void;
  /** Resize the canvas AND reflow every layer proportionally (magic resize). */
  magicResize: (width: number, height: number) => void;
  setBackground: (color: string) => void;

  /** App-level (non-design) state. */
  customFonts: string[];
  addCustomFont: (family: string) => void;
  recentColors: string[];
  pushRecentColor: (color: string) => void;
  select: (id: string | null) => void;
  loadDesign: (design: Design) => void;

  addImageLayer: (assetId: string) => string;
  addTextLayer: () => void;
  addOverlayLayer: () => void;
  addShapeLayer: (shape: ShapeLayer['shape']) => void;

  updateLayer: (id: string, patch: Partial<Layer>) => void;
  removeLayer: (id: string) => void;
  duplicateLayer: (id: string) => void;
  moveLayer: (id: string, dir: 'up' | 'down') => void;
  flipLayer: (id: string, axis: 'x' | 'y') => void;

  undo: () => void;
  redo: () => void;
}

const HISTORY_LIMIT = 50;

export const useEditor = create<EditorState>((set, get) => {
  /** Apply a mutation, pushing the prior design onto the undo stack. */
  function commit(mutator: (d: Design) => void) {
    const prev = get().design;
    const next = produce(prev, mutator);
    set((s) => ({
      design: next,
      past: [...s.past, prev].slice(-HISTORY_LIMIT),
      future: [],
    }));
  }

  return {
    design: emptyDesign(DEFAULT_PRESET),
    selectedId: null,
    past: [],
    future: [],
    cropTargetId: null,
    editingTextId: null,
    selectedCellId: null,
    projectId: null,
    projectName: 'Untitled',
    customFonts: [],
    recentColors: [],

    addCustomFont: (family) =>
      set((s) => ({
        customFonts: s.customFonts.includes(family)
          ? s.customFonts
          : [...s.customFonts, family],
      })),

    pushRecentColor: (color) =>
      set((s) => ({
        recentColors: [color, ...s.recentColors.filter((c) => c !== color)].slice(0, 12),
      })),

    setCropTarget: (id) => set({ cropTargetId: id }),
    setEditingText: (id) => set({ editingTextId: id }),
    selectCell: (id) => set({ selectedCellId: id, selectedId: null }),
    setProjectMeta: (id, name) => set({ projectId: id, projectName: name }),
    setProjectName: (name) => set({ projectName: name }),

    applyLayout: (collage) => {
      commit((d) => {
        d.collage = collage;
      });
      set({ selectedCellId: null });
    },

    clearCollage: () => {
      commit((d) => {
        d.collage = undefined;
      });
      set({ selectedCellId: null });
    },

    updateCollage: (patch) =>
      commit((d) => {
        if (d.collage) Object.assign(d.collage, patch);
      }),

    updateCell: (id, patch) =>
      commit((d) => {
        const cell = d.collage?.cells.find((c) => c.id === id);
        if (cell) Object.assign(cell, patch);
      }),

    setSplit: (axis, index, value) =>
      commit((d) => {
        if (!d.collage) return;
        const splits = axis === 'x' ? d.collage.splitsX : d.collage.splitsY;
        // Clamp between neighbouring dividers (with a small margin).
        const lo = (splits[index - 1] ?? 0) + 0.05;
        const hi = (splits[index + 1] ?? 1) - 0.05;
        splits[index] = Math.min(Math.max(value, lo), hi);
      }),

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
        const sf = (sx + sy) / 2; // font/uniform scale
        for (const l of d.layers) {
          l.x *= sx;
          l.y *= sy;
          l.width *= sx;
          l.height *= sy;
          if (l.type === 'text') l.fontSize = Math.max(4, Math.round(l.fontSize * sf));
        }
        // Collage geometry is normalised, so it adapts automatically.
        d.width = nw;
        d.height = nh;
      }),

    setBackground: (color) =>
      commit((d) => {
        d.background = color;
      }),

    select: (id) => set({ selectedId: id, selectedCellId: null }),

    loadDesign: (design) =>
      set({ design: normalizeDesign(design), selectedId: null, past: [], future: [] }),

    addImageLayer: (assetId) => {
      const asset = getAsset(assetId);
      const { design } = get();
      const sourceW = asset?.width ?? design.width;
      const sourceH = asset?.height ?? design.height;
      const scale = Math.min(
        (design.width * 0.8) / sourceW,
        (design.height * 0.8) / sourceH,
        1,
      );
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
      commit((d) => void d.layers.push(layer));
      set({ selectedId: layer.id });
      return layer.id;
    },

    addTextLayer: () => {
      const { design } = get();
      const layer: TextLayer = {
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
        shadow: {
          enabled: false,
          color: 'rgba(0,0,0,0.6)',
          blur: 8,
          offsetX: 0,
          offsetY: 2,
        },
        background: {
          enabled: false,
          color: 'rgba(0,0,0,0.5)',
          cornerRadius: 8,
          padding: 12,
        },
      };
      commit((d) => void d.layers.push(layer));
      set({ selectedId: layer.id });
    },

    addOverlayLayer: () => {
      const { design } = get();
      const layer: OverlayLayer = {
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
      };
      commit((d) => void d.layers.push(layer));
      set({ selectedId: layer.id });
    },

    addShapeLayer: (shape) => {
      const { design } = get();
      const size = design.width * 0.3;
      const layer: ShapeLayer = {
        ...baseLayer('shape', shape === 'line' ? 'Line' : shape === 'ellipse' ? 'Ellipse' : 'Rectangle', {
          x: design.width * 0.35,
          y: design.height * 0.4,
          width: size,
          height: shape === 'line' ? 8 : size,
        }),
        type: 'shape',
        shape,
        fill: shape === 'line' ? '#c084fc' : '#c084fc',
        stroke: '#ffffff',
        strokeWidth: shape === 'line' ? 6 : 0,
        cornerRadius: 16,
      };
      commit((d) => void d.layers.push(layer));
      set({ selectedId: layer.id });
    },

    updateLayer: (id, patch) =>
      commit((d) => {
        const layer = d.layers.find((l) => l.id === id);
        if (layer) Object.assign(layer, patch);
      }),

    removeLayer: (id) => {
      commit((d) => {
        d.layers = d.layers.filter((l) => l.id !== id);
      });
      if (get().selectedId === id) set({ selectedId: null });
    },

    duplicateLayer: (id) => {
      const { design } = get();
      const src = design.layers.find((l) => l.id === id);
      if (!src) return;
      const copy: Layer = {
        ...structuredClone(src),
        id: nextId('layer'),
        name: `${src.name} copy`,
        x: src.x + 24,
        y: src.y + 24,
      };
      commit((d) => void d.layers.push(copy));
      set({ selectedId: copy.id });
    },

    moveLayer: (id, dir) =>
      commit((d) => {
        const i = d.layers.findIndex((l) => l.id === id);
        if (i < 0) return;
        const j = dir === 'up' ? i + 1 : i - 1;
        if (j < 0 || j >= d.layers.length) return;
        [d.layers[i], d.layers[j]] = [d.layers[j], d.layers[i]];
      }),

    flipLayer: (id, axis) =>
      commit((d) => {
        const layer = d.layers.find((l) => l.id === id);
        if (!layer) return;
        if (axis === 'x') layer.flipX = !layer.flipX;
        else layer.flipY = !layer.flipY;
      }),

    undo: () => {
      const { past, design } = get();
      if (past.length === 0) return;
      const prev = past[past.length - 1];
      set((s) => ({
        design: prev,
        past: past.slice(0, -1),
        future: [design, ...s.future].slice(0, HISTORY_LIMIT),
      }));
    },

    redo: () => {
      const { future, design } = get();
      if (future.length === 0) return;
      const next = future[0];
      set((s) => ({
        design: next,
        past: [...s.past, design].slice(-HISTORY_LIMIT),
        future: future.slice(1),
      }));
    },
  };
});
