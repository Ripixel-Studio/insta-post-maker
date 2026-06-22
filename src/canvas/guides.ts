import type Konva from 'konva';
import type { Layer } from '../types';

export interface Guide {
  axis: 'x' | 'y';
  position: number;
}

/**
 * Compute alignment guides for the currently-dragged layer and SNAP the live
 * Konva node to canvas/other-layer edges & centres when within threshold.
 * Returns the guide lines to render (in document coordinates).
 *
 * Nodes are centre-positioned, so node.x()/y() is the box centre.
 */
export function computeGuides(
  layers: Layer[],
  width: number,
  height: number,
  selectedId: string,
  stage?: Konva.Stage,
): Guide[] {
  if (!stage) return [];
  const node = stage.findOne(`#${selectedId}`);
  const layer = layers.find((l) => l.id === selectedId);
  if (!node || !layer) return [];

  const threshold = 6 / (stage.scaleX() || 1);
  const w = layer.width;
  const h = layer.height;

  const targetsX = new Set<number>([0, width / 2, width]);
  const targetsY = new Set<number>([0, height / 2, height]);
  for (const l of layers) {
    if (l.id === selectedId) continue;
    targetsX.add(l.x);
    targetsX.add(l.x + l.width / 2);
    targetsX.add(l.x + l.width);
    targetsY.add(l.y);
    targetsY.add(l.y + l.height / 2);
    targetsY.add(l.y + l.height);
  }

  const cx = node.x();
  const cy = node.y();
  const guides: Guide[] = [];

  const snap = (
    refs: { offset: number }[],
    targets: Set<number>,
    centre: number,
  ): { centre: number; guide: number } | null => {
    let best: { dist: number; centre: number; guide: number } | null = null;
    for (const { offset } of refs) {
      const edge = centre + offset;
      for (const t of targets) {
        const dist = Math.abs(edge - t);
        if (dist <= threshold && (!best || dist < best.dist)) {
          best = { dist, centre: t - offset, guide: t };
        }
      }
    }
    return best ? { centre: best.centre, guide: best.guide } : null;
  };

  const sx = snap([{ offset: -w / 2 }, { offset: 0 }, { offset: w / 2 }], targetsX, cx);
  if (sx) {
    node.x(sx.centre);
    guides.push({ axis: 'x', position: sx.guide });
  }
  const sy = snap([{ offset: -h / 2 }, { offset: 0 }, { offset: h / 2 }], targetsY, cy);
  if (sy) {
    node.y(sy.centre);
    guides.push({ axis: 'y', position: sy.guide });
  }

  return guides;
}
