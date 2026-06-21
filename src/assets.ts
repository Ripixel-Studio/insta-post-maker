/**
 * In-memory asset registry backed by IndexedDB. Uploaded images are kept as
 * object URLs (for fast canvas rendering) and their blobs are persisted so
 * projects survive a reload. Everything stays client-side.
 */

import { putAsset, getAllAssets } from './persistence';

interface Asset {
  id: string;
  url: string;
  width: number;
  height: number;
}

const assets = new Map<string, Asset>();

let counter = 0;
function nextId(prefix: string) {
  counter += 1;
  return `${prefix}_${counter}_${performance.now().toString(36).replace('.', '')}`;
}

/** Largest edge (px) we keep for the editing/export texture. Comfortably above
 * a 1080-wide Instagram canvas even at @2x, but far cheaper than a raw ~4000px
 * phone photo to draw and cache every frame. */
const MAX_DIM = 2880;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = url;
  });
}

/** Load a File into the registry + persist its blob. Oversized images are
 * downscaled first (preserving PNG alpha for cutouts). Returns the asset. */
export async function addImageAsset(file: File): Promise<Asset> {
  const srcUrl = URL.createObjectURL(file);
  const img = await loadImage(srcUrl);
  const { naturalWidth: w0, naturalHeight: h0 } = img;

  if (Math.max(w0, h0) <= MAX_DIM) {
    const asset: Asset = { id: nextId('asset'), url: srcUrl, width: w0, height: h0 };
    assets.set(asset.id, asset);
    void putAsset({ id: asset.id, blob: file, width: w0, height: h0 });
    return asset;
  }

  // Downscale onto a canvas, keeping aspect ratio.
  const scale = MAX_DIM / Math.max(w0, h0);
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(srcUrl);

  const isPng = file.type.includes('png');
  const blob: Blob = await new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Downscale failed'))),
      isPng ? 'image/png' : 'image/jpeg',
      0.92,
    ),
  );
  const url = URL.createObjectURL(blob);
  const asset: Asset = { id: nextId('asset'), url, width: w, height: h };
  assets.set(asset.id, asset);
  void putAsset({ id: asset.id, blob, width: w, height: h });
  return asset;
}

/** Recreate in-memory object URLs for every persisted asset (call at startup
 * before loading a saved design that references them). */
export async function hydrateAssets(): Promise<void> {
  const stored = await getAllAssets();
  for (const s of stored) {
    if (assets.has(s.id)) continue;
    const url = URL.createObjectURL(s.blob);
    assets.set(s.id, { id: s.id, url, width: s.width, height: s.height });
  }
}

export function getAsset(id: string): Asset | undefined {
  return assets.get(id);
}

export { nextId };
