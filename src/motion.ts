import { exportDesign } from './export';
import { stageHolder } from './canvas/stageHolder';
import { useEditor, combinedLayers } from './store';
import type { Design, Layer } from './types';

export type AnimPreset = 'kenburns' | 'reveal';

/** True if the browser can record a canvas to video. */
export function canRecordVideo(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    'captureStream' in HTMLCanvasElement.prototype
  );
}

function pickMime(): string {
  const candidates = [
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return 'video/webm';
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not load still'));
    };
    img.src = url;
  });
}

/** Record a canvas while `draw(elapsedMs)` paints each frame. */
async function recordCanvas(
  canvas: HTMLCanvasElement,
  durationMs: number,
  draw: (elapsedMs: number) => void,
): Promise<{ blob: Blob; ext: 'mp4' | 'webm' }> {
  const mime = pickMime();
  const stream = canvas.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  recorder.start();
  const start = performance.now();
  await new Promise<void>((resolve) => {
    function frame(now: number) {
      const elapsed = now - start;
      draw(Math.min(elapsed, durationMs));
      if (elapsed < durationMs) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
  recorder.stop();
  await stopped;
  return { blob: new Blob(chunks, { type: mime }), ext: mime.includes('mp4') ? 'mp4' : 'webm' };
}

/* ------------------------------- Ken Burns ------------------------------- */

async function exportKenBurns(
  design: Design,
  seconds: number,
): Promise<{ blob: Blob; ext: 'mp4' | 'webm' }> {
  const still = await exportDesign(design, { format: 'png', multiplier: 1 });
  const img = await blobToImage(still);
  const canvas = document.createElement('canvas');
  canvas.width = design.width;
  canvas.height = design.height;
  const ctx = canvas.getContext('2d')!;
  const zoom = 1.12;

  return recordCanvas(canvas, seconds * 1000, (elapsed) => {
    const e = easeInOut(Math.min(1, elapsed / (seconds * 1000)));
    const s = 1 + (zoom - 1) * e;
    const w = canvas.width;
    const h = canvas.height;
    const dw = w * s;
    const dh = h * s;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, img.width, img.height, -(dw - w) * e, -(dh - h) * e, dw, dh);
  });
}

/* ----------------------------- Layer reveal ----------------------------- */

/** Reveal step for a layer (1-based auto from paint order if unset). */
const stepOf = (l: Layer, i: number) => l.animStep ?? i + 1;

/** Ordered groups of layers that reveal together. */
export function revealGroups(layers: Layer[]): Layer[][] {
  const rank = new Map(layers.map((l, i) => [l.id, stepOf(l, i)]));
  const steps = [...new Set([...rank.values()])].sort((a, b) => a - b);
  return steps.map((s) => layers.filter((l) => rank.get(l.id) === s));
}

/** Render a full-resolution still with only the given layers visible. The
 * stage is shown scaled-to-fit, so pixelRatio = 1/scale brings it to true res. */
function renderStill(visibleIds: Set<string>): HTMLCanvasElement {
  const stage = stageHolder.current!;
  const restore: (() => void)[] = [];
  for (const node of stage.find('.layer-node')) {
    const was = node.visible();
    node.visible(visibleIds.has(node.id()));
    restore.push(() => node.visible(was));
  }
  const pixelRatio = stage.scaleX() ? 1 / stage.scaleX() : 1;
  const canvas = stage.toCanvas({ pixelRatio }) as HTMLCanvasElement;
  restore.forEach((r) => r());
  return canvas;
}

async function exportReveal(
  design: Design,
  seconds: number,
): Promise<{ blob: Blob; ext: 'mp4' | 'webm' }> {
  const stage = stageHolder.current;
  if (!stage) throw new Error('Canvas is not ready yet.');
  if (document.fonts?.ready) await document.fonts.ready;

  // Hide transformers for the duration of still capture.
  const transformers = stage.find('Transformer');
  const restoreTr = transformers.map((t) => {
    const v = t.visible();
    t.visible(false);
    return () => t.visible(v);
  });
  stage.batchDraw();

  const groups = revealGroups(combinedLayers(useEditor.getState()));
  const G = Math.max(1, groups.length);

  // Cumulative stills: stills[k] shows groups 0..k-1 (stills[0] = base only).
  const stills: HTMLCanvasElement[] = [];
  for (let k = 0; k <= G; k++) {
    const visible = new Set<string>();
    for (let g = 0; g < k; g++) groups[g]?.forEach((l) => visible.add(l.id));
    stills.push(renderStill(visible));
  }

  restoreTr.forEach((r) => r());
  stage.batchDraw();

  const canvas = document.createElement('canvas');
  canvas.width = design.width;
  canvas.height = design.height;
  const ctx = canvas.getContext('2d')!;
  const w = canvas.width;
  const h = canvas.height;

  return recordCanvas(canvas, seconds * 1000, (elapsed) => {
    const t = Math.min(0.9999, elapsed / (seconds * 1000));
    const gf = t * G;
    const g = Math.floor(gf);
    const p = easeInOut(gf - g);
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.drawImage(stills[g], 0, 0, w, h);
    ctx.globalAlpha = p;
    ctx.drawImage(stills[g + 1], 0, 0, w, h);
    ctx.globalAlpha = 1;
  });
}

/* -------------------------------- Public -------------------------------- */

export async function exportAnimation(
  design: Design,
  opts: { preset: AnimPreset; seconds?: number },
): Promise<{ blob: Blob; ext: 'mp4' | 'webm' }> {
  const seconds = opts.seconds ?? 4;
  return opts.preset === 'reveal'
    ? exportReveal(design, seconds)
    : exportKenBurns(design, seconds);
}
