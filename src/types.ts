/**
 * Core document model. This plain-JSON structure is the single source of
 * truth for a design; the canvas renders it and the exporter re-renders it
 * at full resolution. Keeping it serializable gives us save/load, undo/redo
 * (via snapshots) and templates for free.
 *
 * Geometry convention: x,y are the TOP-LEFT of the layer's unrotated box;
 * width/height are its size in document pixels; rotation is in degrees about
 * the box CENTRE; flipX/flipY mirror about the centre.
 */

export type LayerType = 'image' | 'text' | 'overlay' | 'shape';

/** Shared transform/appearance properties on every layer. */
export interface BaseLayer {
  id: string;
  type: LayerType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  opacity: number;
  /** Konva globalCompositeOperation, e.g. 'multiply', 'screen'. */
  blendMode: GlobalCompositeOperation;
  visible: boolean;
  locked: boolean;
}

/** Per-image colour adjustments (applied via cached Konva filters). */
export interface ImageFilters {
  brightness: number; // -1..1   (0 = none)
  contrast: number; // -100..100 (0 = none)
  saturation: number; // -1..1   (0 = none; -1 = greyscale)
  blur: number; // 0..40 px      (0 = none)
}

export const NO_FILTERS: ImageFilters = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  blur: 0,
};

/** Normalised crop rect (0..1 of the source image). Undefined = whole image. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  /** Key into the asset store (IndexedDB / in-memory object URL cache). */
  assetId: string;
  filters: ImageFilters;
  crop?: CropRect;
}

export interface TextShadow {
  enabled: boolean;
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
}

export interface TextBackground {
  enabled: boolean;
  color: string;
  cornerRadius: number;
  padding: number;
}

export interface TextLayer extends BaseLayer {
  type: 'text';
  text: string;
  fontFamily: string;
  fontSize: number;
  fontStyle: 'normal' | 'bold' | 'italic' | 'italic bold';
  fill: string;
  align: 'left' | 'center' | 'right';
  lineHeight: number;
  letterSpacing: number;
  shadow: TextShadow;
  background: TextBackground;
}

export type GradientDirection =
  | 'to-top'
  | 'to-bottom'
  | 'to-left'
  | 'to-right'
  | 'radial';

/** A gradient scrim for text legibility (e.g. black→transparent). */
export interface OverlayLayer extends BaseLayer {
  type: 'overlay';
  direction: GradientDirection;
  /** Ordered color stops: offset 0..1 → rgba color string. */
  stops: { offset: number; color: string }[];
}

export interface ShapeLayer extends BaseLayer {
  type: 'shape';
  shape: 'rect' | 'ellipse' | 'line';
  fill: string;
  stroke: string;
  strokeWidth: number;
  cornerRadius: number;
}

export type Layer = ImageLayer | TextLayer | OverlayLayer | ShapeLayer;

/** One image frame in a collage, spanning grid tracks [c0..c1] × [r0..r1].
 * The image fills the cell (cover-fit) and can be panned (offset 0..1) and
 * zoomed (>= 1) within it. */
export interface CollageCell {
  id: string;
  c0: number;
  c1: number;
  r0: number;
  r1: number;
  assetId?: string;
  zoom: number;
  offsetX: number;
  offsetY: number;
}

/** A collage grid. `splitsX`/`splitsY` are normalised (0..1) interior divider
 * positions, so cells become unequal by dragging the gutters. */
export interface Collage {
  cols: number;
  rows: number;
  gap: number;
  splitsX: number[]; // length cols-1
  splitsY: number[]; // length rows-1
  cells: CollageCell[];
}

export interface Design {
  width: number;
  height: number;
  background: string;
  layers: Layer[];
  /** Optional collage grid, rendered beneath the free layers. */
  collage?: Collage;
}

export interface CanvasPreset {
  id: string;
  label: string;
  group: 'Story' | 'Post';
  width: number;
  height: number;
}
