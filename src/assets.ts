/**
 * In-memory asset registry. Uploaded images are kept as object URLs keyed by
 * an assetId that layers reference. Everything stays client-side — nothing is
 * uploaded anywhere. (IndexedDB persistence is a later step; the API here is
 * deliberately small so we can swap the backing store without touching layers.)
 */

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
  return `${prefix}_${counter}_${performance.now().toString(36)}`;
}

/** Load a File into the registry, returning the asset id and natural size. */
export function addImageAsset(file: File): Promise<Asset> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const asset: Asset = {
        id: nextId('asset'),
        url,
        width: img.naturalWidth,
        height: img.naturalHeight,
      };
      assets.set(asset.id, asset);
      resolve(asset);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode image'));
    };
    img.src = url;
  });
}

export function getAsset(id: string): Asset | undefined {
  return assets.get(id);
}

export { nextId };
