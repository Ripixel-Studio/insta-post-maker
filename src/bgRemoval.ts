import { getAsset, addImageAsset } from './assets';

function loadImageEl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encode failed'))), 'image/png'),
  );
}

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

/**
 * "Portrait mode" depth-of-field: blur the background while keeping the subject
 * sharp. We isolate the subject (background removal), blur the original, then
 * composite the sharp subject back on top. Returns a new asset id.
 */
export async function portraitBlur(
  assetId: string,
  blurPx: number,
  onProgress?: (ratio: number) => void,
): Promise<string | undefined> {
  const asset = getAsset(assetId);
  if (!asset) return undefined;

  const { removeBackground } = await import('@imgly/background-removal');
  const cutoutBlob = await removeBackground(asset.url, {
    output: { format: 'image/png' },
    progress: (_k: string, c: number, t: number) => {
      if (onProgress && t > 0) onProgress(c / t);
    },
  });

  const orig = await loadImageEl(asset.url);
  const cutoutUrl = URL.createObjectURL(cutoutBlob);
  const cutout = await loadImageEl(cutoutUrl);

  const w = orig.naturalWidth;
  const h = orig.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  // Blur the background. Draw slightly oversized so the blur doesn't fade in
  // from transparent edges.
  const pad = Math.ceil(blurPx * 2);
  ctx.filter = `blur(${blurPx}px)`;
  ctx.drawImage(orig, -pad, -pad, w + pad * 2, h + pad * 2);
  ctx.filter = 'none';
  // Sharp subject on top.
  ctx.drawImage(cutout, 0, 0, w, h);
  URL.revokeObjectURL(cutoutUrl);

  const blob = await canvasToBlob(canvas);
  const newAsset = await addImageAsset(new File([blob], 'portrait.png', { type: 'image/png' }));
  return newAsset.id;
}
