import type {
  Design,
  Layer,
  TextLayer,
  OverlayLayer,
  ShapeLayer,
  Collage,
} from './types';
import { nextId } from './assets';

/**
 * Built-in starting templates. These are deliberately asset-free (text,
 * gradients, shapes, empty collage cells) so they always apply cleanly. Fresh
 * layer ids are minted on each build so repeated use never collides.
 */

const W = 1080;
const H = 1920;

function base(type: Layer['type'], name: string, box: { x: number; y: number; width: number; height: number }) {
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
    blendMode: 'source-over' as GlobalCompositeOperation,
    visible: true,
    locked: false,
  };
}

function text(
  content: string,
  box: { x: number; y: number; width: number; height: number },
  opts: Partial<TextLayer> = {},
): TextLayer {
  return {
    ...base('text', 'Text', box),
    type: 'text',
    text: content,
    fontFamily: 'Inter',
    fontSize: 96,
    fontStyle: 'bold',
    fill: '#ffffff',
    align: 'left',
    lineHeight: 1.1,
    letterSpacing: 0,
    shadow: { enabled: false, color: 'rgba(0,0,0,0.6)', blur: 8, offsetX: 0, offsetY: 2 },
    background: { enabled: false, color: 'rgba(0,0,0,0.5)', cornerRadius: 8, padding: 12 },
    ...opts,
  };
}

function scrim(): OverlayLayer {
  return {
    ...base('overlay', 'Gradient overlay', { x: 0, y: H * 0.5, width: W, height: H * 0.5 }),
    type: 'overlay',
    direction: 'to-top',
    stops: [
      { offset: 0, color: 'rgba(0,0,0,0.9)' },
      { offset: 1, color: 'rgba(0,0,0,0)' },
    ],
  };
}

function pill(box: { x: number; y: number; width: number; height: number }, fill: string): ShapeLayer {
  return {
    ...base('shape', 'Accent', box),
    type: 'shape',
    shape: 'rect',
    fill,
    stroke: '#ffffff',
    strokeWidth: 0,
    cornerRadius: 12,
  };
}

/** Deep-clone a design with fresh page/layer/cell ids, so applying a template
 * never collides with existing ids. */
export function freshenDesign(d: Design): Design {
  const clone = structuredClone(d);
  const fresh = (l: Layer): Layer => ({ ...l, id: nextId('layer') });
  clone.pages = clone.pages.map((p) => ({
    ...p,
    id: nextId('page'),
    layers: p.layers.map(fresh),
    collage: p.collage
      ? { ...p.collage, cells: p.collage.cells.map((c) => ({ ...c, id: nextId('cell') })) }
      : undefined,
  }));
  clone.shared = clone.shared.map(fresh);
  return clone;
}

/** Wrap a single page's worth of content into a Design. */
function single(background: string, layers: Layer[], collage?: Collage): Design {
  return { width: W, height: H, pages: [{ id: nextId('page'), background, layers, collage }], shared: [] };
}

export interface DesignTemplate {
  id: string;
  label: string;
  build: () => Design;
}

export const TEMPLATES: DesignTemplate[] = [
  {
    id: 'bold-caption',
    label: 'Bold caption',
    build: (): Design =>
      single('#1b1d22', [
        scrim(),
        pill({ x: 72, y: H - 540, width: 150, height: 60 }, '#c084fc'),
        text('LABEL', { x: 96, y: H - 532, width: 200, height: 50 }, {
          fontSize: 34, letterSpacing: 4, align: 'left', name: 'Label',
        }),
        text('Your bold\nheadline here', { x: 72, y: H - 440, width: W - 144, height: 280 }, {
          fontSize: 110, name: 'Headline',
        }),
        text('A short supporting line of context underneath.', { x: 72, y: H - 150, width: W - 144, height: 70 }, {
          fontSize: 40, fontStyle: 'normal', fill: '#d4d4d8', name: 'Subtitle',
        }),
      ]),
  },
  {
    id: 'quote',
    label: 'Quote',
    build: (): Design =>
      single('#0e0f13', [
        text('“The quote\ngoes right\nhere.”', { x: 120, y: H * 0.32, width: W - 240, height: 700 }, {
          fontFamily: 'Playfair Display', fontSize: 130, align: 'center', lineHeight: 1.15, name: 'Quote',
        }),
        text('— Attribution', { x: 120, y: H * 0.7, width: W - 240, height: 70 }, {
          fontSize: 44, fontStyle: 'italic', fill: '#a1a1aa', align: 'center', name: 'Attribution',
        }),
      ]),
  },
  {
    id: 'two-up',
    label: 'Two-up + title',
    build: (): Design => {
      const collage: Collage = {
        cols: 1, rows: 2, gap: 16, splitsX: [], splitsY: [0.5],
        cells: [
          { id: nextId('cell'), c0: 0, c1: 0, r0: 0, r1: 0, zoom: 1, offsetX: 0.5, offsetY: 0.5 },
          { id: nextId('cell'), c0: 0, c1: 0, r0: 1, r1: 1, zoom: 1, offsetX: 0.5, offsetY: 0.5 },
        ],
      };
      return single(
        '#000000',
        [
          text('YOUR TITLE', { x: 72, y: H - 180, width: W - 144, height: 90 }, {
            fontSize: 72, align: 'center', name: 'Title',
            background: { enabled: true, color: 'rgba(0,0,0,0.55)', cornerRadius: 16, padding: 18 },
          }),
        ],
        collage,
      );
    },
  },
];
