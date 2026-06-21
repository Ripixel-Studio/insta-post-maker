import { getAsset, addImageAsset } from './assets';

/**
 * Remove an image's background entirely in-browser (ONNX/WASM via
 * @imgly/background-removal). The library is dynamically imported so its WASM
 * payload only loads when the user actually asks for a cutout. The model is
 * fetched from a CDN on first use, so this one feature needs a connection.
 *
 * Returns the id of a NEW transparent-PNG asset, or undefined on failure.
 */
export async function cutoutAsset(
  assetId: string,
  onProgress?: (ratio: number) => void,
): Promise<string | undefined> {
  const asset = getAsset(assetId);
  if (!asset) return undefined;

  const { removeBackground } = await import('@imgly/background-removal');
  const blob = await removeBackground(asset.url, {
    output: { format: 'image/png' },
    progress: (_key: string, current: number, total: number) => {
      if (onProgress && total > 0) onProgress(current / total);
    },
  });

  const file = new File([blob], 'cutout.png', { type: 'image/png' });
  const newAsset = await addImageAsset(file);
  return newAsset.id;
}
