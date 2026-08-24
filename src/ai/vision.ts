/**
 * Vision plumbing for the Copilot: turn the user's uploaded photos into base64
 * image blocks the model can actually *see*, tagged with the `assetId` the
 * editor tools address them by. This is how the Copilot reasons over the real
 * photos (which face is the subject, what's in frame, dominant colour) rather
 * than working blind from filenames.
 *
 * The heavy lifting — downscale + JPEG encode — is reused from the style-profile
 * pass, so photos are sent at the same modest resolution (≤1024px long edge),
 * keeping each request small even with a handful of images in play.
 */
import { getAsset, listAssets } from '../assets';
import { encodePostImage, type StyleImage } from './styleProfile';
import type { Design } from '../types';

/** How many photos we're willing to put in front of the model at once. Vision
 * tokens add up fast; a post rarely needs more than this to design around. */
export const MAX_VISION_PHOTOS = 10;

/** An uploaded photo encoded for the vision pass, with the id the tools use. */
export interface PhotoContext {
  assetId: string;
  width: number;
  height: number;
  image: StyleImage;
}

/**
 * Ids of every photo the Copilot should be able to see and place: the ones
 * already on the design (image layers + collage cells) plus anything staged in
 * the import tray, de-duplicated. Falls back to the whole asset registry when
 * nothing is placed yet, so a fresh "help me build a post" still has vision.
 */
export function usablePhotoIds(design: Design, tray: string[] = []): string[] {
  const ids: string[] = [];
  const push = (id: string | undefined) => {
    if (id && !ids.includes(id)) ids.push(id);
  };
  for (const page of design.pages) {
    for (const layer of page.layers) if (layer.type === 'image') push(layer.assetId);
    for (const cell of page.collage?.cells ?? []) push(cell.assetId);
  }
  for (const layer of design.shared) if (layer.type === 'image') push(layer.assetId);
  tray.forEach(push);
  if (ids.length === 0) listAssets().forEach((a) => push(a.id));
  return ids;
}

/**
 * Encode a single asset (by id) into a vision block. Returns null if the asset
 * is unknown or can't be read, so callers can simply filter nulls out.
 */
export async function encodeAssetImage(assetId: string): Promise<PhotoContext | null> {
  const asset = getAsset(assetId);
  if (!asset) return null;
  try {
    const blob = await (await fetch(asset.url)).blob();
    const image = await encodePostImage(blob);
    return { assetId, width: asset.width, height: asset.height, image };
  } catch {
    return null;
  }
}

/** Encode up to {@link MAX_VISION_PHOTOS} of the given ids, dropping any that
 * fail. Order is preserved so the newest-relevant photos win the cap. */
export async function encodePhotos(assetIds: string[]): Promise<PhotoContext[]> {
  const picked = assetIds.slice(0, MAX_VISION_PHOTOS);
  const encoded = await Promise.all(picked.map(encodeAssetImage));
  return encoded.filter((p): p is PhotoContext => p !== null);
}
