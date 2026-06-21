import { exportDesign } from './export';
import type { Design } from './types';

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

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/**
 * Render the design to a still, then record a slow "Ken Burns" zoom/pan over it
 * and return a short video clip. Prefers MP4 (Safari), falling back to WebM.
 * This gives Stories a touch of motion without a full keyframe system.
 */
export async function exportMotion(
  design: Design,
  options: { seconds?: number; zoom?: number } = {},
): Promise<{ blob: Blob; ext: 'mp4' | 'webm' }> {
  const seconds = options.seconds ?? 4;
  const zoom = options.zoom ?? 1.12;

  const still = await exportDesign(design, { format: 'png', multiplier: 1 });
  const img = await blobToImage(still);

  const canvas = document.createElement('canvas');
  canvas.width = design.width;
  canvas.height = design.height;
  const ctx = canvas.getContext('2d')!;

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
      const t = Math.min(1, (now - start) / (seconds * 1000));
      const e = easeInOut(t);
      const s = 1 + (zoom - 1) * e;
      const w = canvas.width;
      const h = canvas.height;
      const dw = w * s;
      const dh = h * s;
      // Pan diagonally as we zoom in.
      const dx = -(dw - w) * e;
      const dy = -(dh - h) * e;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, img.width, img.height, dx, dy, dw, dh);
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
  recorder.stop();
  await stopped;

  return { blob: new Blob(chunks, { type: mime }), ext: mime.includes('mp4') ? 'mp4' : 'webm' };
}
