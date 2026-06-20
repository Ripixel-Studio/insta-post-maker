import type { Collage, CollageCell } from './types';

let cellCounter = 0;
function cellId() {
  cellCounter += 1;
  return `cell_${cellCounter}_${performance.now().toString(36).replace('.', '')}`;
}

function cell(c0: number, c1: number, r0: number, r1: number): CollageCell {
  return { id: cellId(), c0, c1, r0, r1, zoom: 1, offsetX: 0.5, offsetY: 0.5 };
}

export interface LayoutTemplate {
  id: string;
  label: string;
  build: () => Collage;
}

/** Evenly-spaced interior splits for n tracks. */
function evenSplits(n: number): number[] {
  return Array.from({ length: n - 1 }, (_, i) => (i + 1) / n);
}

export const LAYOUTS: LayoutTemplate[] = [
  {
    id: '2v',
    label: '2 ▌▐',
    build: () => ({
      cols: 2, rows: 1, gap: 12, splitsX: [0.5], splitsY: [],
      cells: [cell(0, 0, 0, 0), cell(1, 1, 0, 0)],
    }),
  },
  {
    id: '2h',
    label: '2 ▀▄',
    build: () => ({
      cols: 1, rows: 2, gap: 12, splitsX: [], splitsY: [0.5],
      cells: [cell(0, 0, 0, 0), cell(0, 0, 1, 1)],
    }),
  },
  {
    id: '3v',
    label: '3 |||',
    build: () => ({
      cols: 3, rows: 1, gap: 12, splitsX: evenSplits(3), splitsY: [],
      cells: [cell(0, 0, 0, 0), cell(1, 1, 0, 0), cell(2, 2, 0, 0)],
    }),
  },
  {
    id: '1+2',
    label: '1 + 2',
    build: () => ({
      cols: 2, rows: 2, gap: 12, splitsX: [0.6], splitsY: [0.5],
      // Big left cell spanning both rows + two stacked right cells.
      cells: [cell(0, 0, 0, 1), cell(1, 1, 0, 0), cell(1, 1, 1, 1)],
    }),
  },
  {
    id: '2+1',
    label: '2 / 1',
    build: () => ({
      cols: 2, rows: 2, gap: 12, splitsX: [0.5], splitsY: [0.55],
      // Two top cells + a wide bottom cell.
      cells: [cell(0, 0, 0, 0), cell(1, 1, 0, 0), cell(0, 1, 1, 1)],
    }),
  },
  {
    id: '4',
    label: '4 ▦',
    build: () => ({
      cols: 2, rows: 2, gap: 12, splitsX: [0.5], splitsY: [0.5],
      cells: [cell(0, 0, 0, 0), cell(1, 1, 0, 0), cell(0, 0, 1, 1), cell(1, 1, 1, 1)],
    }),
  },
];

/** Cumulative track edges (length n+1) from interior splits. */
export function edges(splits: number[]): number[] {
  return [0, ...splits, 1];
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Pixel rect for a cell within a canvas of W×H, inset by half the gap on
 * every side so cells are evenly separated. */
export function cellRect(collage: Collage, c: CollageCell, W: number, H: number): Rect {
  const ex = edges(collage.splitsX);
  const ey = edges(collage.splitsY);
  const half = collage.gap / 2;
  const x = ex[c.c0] * W + half;
  const y = ey[c.r0] * H + half;
  const right = ex[c.c1 + 1] * W - half;
  const bottom = ey[c.r1 + 1] * H - half;
  return { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) };
}
