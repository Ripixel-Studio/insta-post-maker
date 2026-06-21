import { getAsset, addImageAsset } from './assets';

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = url;
  });
}

/**
 * Bake a sticker-style outline around a transparent cutout. We build a tinted
 * silhouette of the subject and stamp it in a ring of offsets (alpha dilation),
 * then draw the original cutout on top. Returns a new asset id.
 */
export async function bakeOutline(
  cutoutAssetId: string,
  color: string,
  width: number,
): Promise<string | undefined> {
  const asset = getAsset(cutoutAssetId);
  if (!asset) return undefined;
  const img = await loadImage(asset.url);

  const pad = Math.ceil(width);
  const w = img.width + pad * 2;
  const h = img.height + pad * 2;

  // Silhouette: the cutout filled with the outline colour.
  const sil = document.createElement('canvas');
  sil.width = w;
  sil.height = h;
  const sc = sil.getContext('2d')!;
  sc.drawImage(img, pad, pad);
  sc.globalCompositeOperation = 'source-in';
  sc.fillStyle = color;
  sc.fillRect(0, 0, w, h);

  // Stamp the silhouette around two rings of offsets to dilate the alpha edge.
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const oc = out.getContext('2d')!;
  const steps = 32;
  for (const r of [width, width * 0.6]) {
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      oc.drawImage(sil, Math.cos(a) * r, Math.sin(a) * r);
    }
  }
  // Draw the real cutout on top, centred.
  oc.drawImage(img, pad, pad);

  const blob: Blob = await new Promise((resolve, reject) =>
    out.toBlob((b) => (b ? resolve(b) : reject(new Error('Bake failed'))), 'image/png'),
  );
  const newAsset = await addImageAsset(new File([blob], 'sticker.png', { type: 'image/png' }));
  return newAsset.id;
}
