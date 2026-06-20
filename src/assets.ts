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

/** Decode a blob to get its natural dimensions. */
function probe(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = url;
  });
}

/** Load a File into the registry + persist its blob. Returns the asset. */
export async function addImageAsset(file: File): Promise<Asset> {
  const url = URL.createObjectURL(file);
  const { width, height } = await probe(url);
  const asset: Asset = { id: nextId('asset'), url, width, height };
  assets.set(asset.id, asset);
  // Persist the original blob (fire-and-forget; rendering uses the object URL).
  void putAsset({ id: asset.id, blob: file, width, height });
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
