import { create } from 'zustand';
import { produce } from 'immer';
import type {
  Design,
  Layer,
  ImageLayer,
  TextLayer,
  OverlayLayer,
  CanvasPreset,
} from './types';
import { DEFAULT_PRESET } from './presets';
import { nextId, getAsset } from './assets';

function emptyDesign(preset: CanvasPreset): Design {
  return {
    width: preset.width,
    height: preset.height,
    background: '#1b1d22',
    layers: [],
  };
}

interface EditorState {
  design: Design;
  selectedId: string | null;
  /** Snapshots for undo/redo. We snapshot whole designs — simple and robust
   * for the layer counts this tool deals with (dozens, not thousands). */
  past: Design[];
  future: Design[];

  setPreset: (preset: CanvasPreset) => void;
  setBackground: (color: string) => void;
  select: (id: string | null) => void;

  addImageLayer: (assetId: string) => void;
  addTextLayer: () => void;
  addOverlayLayer: () => void;

  updateLayer: (id: string, patch: Partial<Layer>) => void;
  removeLayer: (id: string) => void;
  moveLayer: (id: string, dir: 'up' | 'down') => void;

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

    setPreset: (preset) =>
      commit((d) => {
        d.width = preset.width;
        d.height = preset.height;
      }),

    setBackground: (color) =>
      commit((d) => {
        d.background = color;
      }),

    select: (id) => set({ selectedId: id }),

    addImageLayer: (assetId) => {
      const asset = getAsset(assetId);
      if (!asset) return;
      const { design } = get();
      // Fit the image inside the canvas while preserving aspect ratio.
      const scale = Math.min(
        (design.width * 0.8) / asset.width,
        (design.height * 0.8) / asset.height,
        1,
      );
      const w = asset.width * scale;
      const h = asset.height * scale;
      const layer: ImageLayer = {
        id: nextId('layer'),
        type: 'image',
        name: 'Image',
        assetId,
        x: (design.width - w) / 2,
        y: (design.height - h) / 2,
        width: w,
        height: h,
        rotation: 0,
        opacity: 1,
        blendMode: 'source-over',
        visible: true,
        locked: false,
      };
      commit((d) => void d.layers.push(layer));
      set({ selectedId: layer.id });
    },

    addTextLayer: () => {
      const { design } = get();
      const layer: TextLayer = {
        id: nextId('layer'),
        type: 'text',
        name: 'Text',
        text: 'Double-click to edit',
        fontFamily: 'Inter',
        fontSize: Math.round(design.width * 0.08),
        fontStyle: 'bold',
        fill: '#ffffff',
        align: 'center',
        lineHeight: 1.2,
        letterSpacing: 0,
        x: design.width * 0.1,
        y: design.height * 0.45,
        width: design.width * 0.8,
        height: design.width * 0.16,
        rotation: 0,
        opacity: 1,
        blendMode: 'source-over',
        visible: true,
        locked: false,
      };
      commit((d) => void d.layers.push(layer));
      set({ selectedId: layer.id });
    },

    addOverlayLayer: () => {
      const { design } = get();
      // Default to a bottom scrim (black→transparent, fading upward) — the
      // classic "make text legible over a photo" overlay.
      const layer: OverlayLayer = {
        id: nextId('layer'),
        type: 'overlay',
        name: 'Gradient overlay',
        direction: 'to-top',
        stops: [
          { offset: 0, color: 'rgba(0,0,0,0.85)' },
          { offset: 1, color: 'rgba(0,0,0,0)' },
        ],
        x: 0,
        y: design.height * 0.5,
        width: design.width,
        height: design.height * 0.5,
        rotation: 0,
        opacity: 1,
        blendMode: 'source-over',
        visible: true,
        locked: false,
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

    moveLayer: (id, dir) =>
      commit((d) => {
        const i = d.layers.findIndex((l) => l.id === id);
        if (i < 0) return;
        const j = dir === 'up' ? i + 1 : i - 1;
        if (j < 0 || j >= d.layers.length) return;
        [d.layers[i], d.layers[j]] = [d.layers[j], d.layers[i]];
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
