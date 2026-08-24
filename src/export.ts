import type Konva from 'konva';
import { stageHolder } from './canvas/stageHolder';
import type { Design } from './types';

export type ExportFormat = 'png' | 'jpeg';

export interface ExportOptions {
  format: ExportFormat;
  /** 1 = exact preset pixels (e.g. 1080-wide); 2 = @2x for extra crispness. */
  multiplier: 1 | 2;
  /** JPEG quality 0..1 (ignored for PNG). */
  quality?: number;
}

/**
 * Render the current design to an image blob at true document resolution,
 * independent of the on-screen display scale.
 *
 * The stage is displayed scaled-to-fit (stage.width() === design.width * scale),
 * so a pixelRatio of (design.width / stage.width()) renders back at 1:1 — i.e.
 * exactly `design.width` px wide. The @2x option doubles that.
 */
/** Hide selection transformers, run an async rasterise, then restore them. */
async function withCleanStage<T>(fn: (stage: Konva.Stage) => Promise<T>): Promise<T> {
  const stage = stageHolder.current;
  if (!stage) throw new Error('Canvas is not ready yet.');
  if (document.fonts?.ready) await document.fonts.ready;

  const transformers = stage.find('Transformer');
  const restore = transformers.map((t) => {
    const wasVisible = t.visible();
    t.visible(false);
    return () => t.visible(wasVisible);
  });
  stage.batchDraw();
  try {
    return await fn(stage);
  } finally {
    restore.forEach((r) => r());
    stage.batchDraw();
  }
}

function toBlob(
  stage: Konva.Stage,
  opts: ExportOptions,
  pixelRatio: number,
  region?: { x: number; y: number; width: number; height: number },
): Promise<Blob> {
  const mimeType = opts.format === 'png' ? 'image/png' : 'image/jpeg';
  return new Promise((resolve, reject) => {
    stage.toBlob({
      mimeType,
      quality: opts.quality ?? 0.92,
      pixelRatio,
      ...region,
      callback: (b) => (b ? resolve(b) : reject(new Error('Export failed'))),
    });
  });
}

export async function exportDesign(design: Design, opts: ExportOptions): Promise<Blob> {
  return withCleanStage((stage) => {
    const pixelRatio = (design.width / stage.width()) * opts.multiplier;
    return toBlob(stage, opts, pixelRatio);
  });
}

/**
 * A small render of the active page for the Copilot to look at — the model
 * otherwise never sees the result of its own edits. Long edge capped at
 * `maxEdge` px so it stays cheap to send.
 */
export async function exportPreview(design: Design, maxEdge = 768): Promise<Blob> {
  return withCleanStage((stage) => {
    const longEdge = Math.max(design.width, design.height) || 1;
    const pixelRatio = (design.width / stage.width()) * Math.min(1, maxEdge / longEdge);
    return toBlob(stage, { format: 'jpeg', multiplier: 1, quality: 0.8 }, pixelRatio);
  });
}

/**
 * Slice the design into N equal vertical panels and export each as its own
 * image — a seamless Instagram carousel that pans as you swipe. Each slide is
 * (design.width / slides) px wide × design.height tall (× the @2x multiplier).
 */
export async function exportCarousel(
  design: Design,
  opts: ExportOptions,
  slides: number,
): Promise<Blob[]> {
  return withCleanStage(async (stage) => {
    const displayScale = stage.width() / design.width;
    const pixelRatio = (design.width / stage.width()) * opts.multiplier;
    const sliceDocW = design.width / slides;
    const blobs: Blob[] = [];
    for (let i = 0; i < slides; i++) {
      blobs.push(
        await toBlob(stage, opts, pixelRatio, {
          x: i * sliceDocW * displayScale,
          y: 0,
          width: sliceDocW * displayScale,
          height: stage.height(),
        }),
      );
    }
    return blobs;
  });
}

/** True if the browser can share image files (mobile Safari/Chrome, etc.). */
export function canShareFiles(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [new File([], 'probe.png', { type: 'image/png' })] })
  );
}

/** Share an exported blob via the Web Share API (e.g. straight to Instagram on
 * mobile). Returns false if sharing isn't available or was cancelled. */
export async function shareBlob(blob: Blob, filename: string): Promise<boolean> {
  if (!canShareFiles()) return false;
  const file = new File([blob], filename, { type: blob.type });
  try {
    await navigator.share({ files: [file], title: filename });
    return true;
  } catch {
    // AbortError (user cancelled) or unsupported — treat as no-op.
    return false;
  }
}

/** Trigger a browser download of an exported blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
