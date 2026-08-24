/**
 * Bulk photo import. Multi-select file pickers and multi-file drag-drop can hand
 * us dozens (or hundreds) of photos at once, so we decode them with a bounded
 * concurrency instead of one giant `Promise.all` — decoding + downscaling a raw
 * phone photo is memory-heavy, and firing all of them at once would thrash the
 * browser on a large batch. Imported photos land in the *image tray* (a staging
 * shelf) rather than being dumped straight onto the canvas as stacked layers.
 */

import { addImageAsset } from './assets';
import { useEditor } from './store';

export interface ImportProgress {
  done: number;
  total: number;
}

export interface BulkImportResult {
  /** Asset ids that decoded successfully, in original file order. */
  assetIds: string[];
  /** Files that failed to decode. */
  failed: number;
  /** Non-image files that were ignored. */
  skipped: number;
}

/** How many photos we decode at once. Enough to keep the pipeline busy without
 * holding a hundred full-resolution bitmaps in memory simultaneously. */
const CONCURRENCY = 4;

/** Decode a list of image Files into persisted assets, at most CONCURRENCY at a
 * time. Non-image files are skipped; a single bad file never aborts the batch.
 * `onAsset` fires as each photo finishes (so a tray can fill progressively) and
 * `onProgress` reports done/total after every file. */
export async function bulkImportImages(
  files: File[],
  opts: {
    onProgress?: (p: ImportProgress) => void;
    onAsset?: (assetId: string, index: number) => void;
  } = {},
): Promise<BulkImportResult> {
  const images = files.filter((f) => f.type.startsWith('image/'));
  const skipped = files.length - images.length;
  const total = images.length;
  const assetIds: (string | null)[] = new Array(total).fill(null);
  let done = 0;
  let failed = 0;

  opts.onProgress?.({ done, total });

  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= total) return;
      try {
        const asset = await addImageAsset(images[i]);
        assetIds[i] = asset.id;
        opts.onAsset?.(asset.id, i);
      } catch (err) {
        console.error('Bulk import: could not load', images[i]?.name, err);
        failed += 1;
      } finally {
        done += 1;
        opts.onProgress?.({ done, total });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()),
  );

  return {
    assetIds: assetIds.filter((id): id is string => id !== null),
    failed,
    skipped,
  };
}

function toFileArray(files: File[] | FileList | null | undefined): File[] {
  return files ? Array.from(files) : [];
}

/** Import photos into the image tray, streaming thumbnails in and reporting
 * progress through the store. Used by the tray's own drop-zone / import button
 * and by any bulk (multi-file) import. */
export async function importFilesToTray(
  files: File[] | FileList | null | undefined,
): Promise<BulkImportResult | undefined> {
  const list = toFileArray(files);
  if (list.length === 0) return undefined;
  const { addToTray, setImportProgress } = useEditor.getState();
  try {
    return await bulkImportImages(list, {
      onProgress: setImportProgress,
      onAsset: (id) => addToTray(id),
    });
  } finally {
    setImportProgress(null);
  }
}

/** Decode + place every image straight onto the current page. Used where there
 * is no tray to stage into (mobile). Reports progress through the store. */
export async function importFilesToCanvas(
  files: File[] | FileList | null | undefined,
): Promise<void> {
  const list = toFileArray(files);
  if (list.length === 0) return;
  const { addImageLayer, setImportProgress } = useEditor.getState();
  try {
    await bulkImportImages(list, {
      onProgress: setImportProgress,
      onAsset: (id) => addImageLayer(id),
    });
  } finally {
    setImportProgress(null);
  }
}

/** Route an import by size: a single photo goes straight onto the canvas (the
 * quick, common case), while a batch is staged in the tray so it doesn't land
 * as a pile of stacked layers. Used by the desktop picker and the global
 * workspace drop target. */
export async function importFilesSmart(
  files: File[] | FileList | null | undefined,
): Promise<void> {
  const images = toFileArray(files).filter((f) => f.type.startsWith('image/'));
  if (images.length === 0) return;
  if (images.length === 1) {
    const { addImageLayer } = useEditor.getState();
    try {
      const asset = await addImageAsset(images[0]);
      addImageLayer(asset.id);
    } catch (err) {
      console.error('Import: could not load', images[0]?.name, err);
    }
    return;
  }
  await importFilesToTray(images);
}
