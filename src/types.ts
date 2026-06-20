/**
 * Core document model. This plain-JSON structure is the single source of
 * truth for a design; the canvas renders it and the exporter re-renders it
 * at full resolution. Keeping it serializable gives us save/load, undo/redo
 * (via snapshots) and templates for free.
 */

export type LayerType = 'image' | 'text' | 'overlay' | 'shape';

/** Shared transform/appearance properties on every layer. */
export interface BaseLayer {
  id: string;
  type: LayerType;
  name: string;
  /** Top-left position in document coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  /** Konva globalCompositeOperation, e.g. 'multiply', 'screen'. */
  blendMode: GlobalCompositeOperation;
  visible: boolean;
  locked: boolean;
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  /** Key into the asset store (IndexedDB / in-memory object URL cache). */
  assetId: string;
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
  shape: 'rect' | 'ellipse';
  fill: string;
  cornerRadius: number;
}

export type Layer =
  | ImageLayer
  | TextLayer
  | OverlayLayer
  | ShapeLayer;

export interface Design {
  width: number;
  height: number;
  background: string;
  layers: Layer[];
}

export interface CanvasPreset {
  id: string;
  label: string;
  group: 'Story' | 'Post';
  width: number;
  height: number;
}
