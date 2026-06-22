/**
 * Curated font set, loaded from the Google Fonts CDN. We inject a single
 * stylesheet link at startup and rely on `document.fonts.ready` before export
 * so text never rasterises in a fallback face. Users can also upload their own
 * font files, which are registered via the FontFace API and persisted.
 */

import { putFont, getAllFonts } from './persistence';
import { stageHolder } from './canvas/stageHolder';

/** Konva draws text to the canvas immediately; if the web font isn't ready yet
 * it uses a fallback and won't redraw on its own. Force a redraw. */
function redrawCanvas() {
  stageHolder.current?.batchDraw();
}

/** Force-download a family (regular + bold) so it's ready before first use,
 * then redraw so any fallback-rendered text is replaced. */
export function ensureFont(family: string): void {
  if (typeof document === 'undefined' || !document.fonts) return;
  Promise.all([
    document.fonts.load(`400 48px "${family}"`),
    document.fonts.load(`700 48px "${family}"`),
  ])
    .then(redrawCanvas)
    .catch(() => {});
}

export interface FontDef {
  family: string;
  /** Google Fonts family spec, e.g. 'Inter:wght@400;700'. */
  spec: string;
}

export const FONTS: FontDef[] = [
  { family: 'Inter', spec: 'Inter:wght@400;700' },
  { family: 'Poppins', spec: 'Poppins:wght@400;600;700' },
  { family: 'Montserrat', spec: 'Montserrat:wght@400;700' },
  { family: 'Playfair Display', spec: 'Playfair+Display:ital,wght@0,400;0,700;1,400' },
  { family: 'Bebas Neue', spec: 'Bebas+Neue' },
  { family: 'Oswald', spec: 'Oswald:wght@400;700' },
  { family: 'Anton', spec: 'Anton' },
  { family: 'Roboto Mono', spec: 'Roboto+Mono:wght@400;700' },
  // Cute / display / handwritten
  { family: 'Caveat', spec: 'Caveat:wght@400;700' },
  { family: 'Pacifico', spec: 'Pacifico' },
  { family: 'Permanent Marker', spec: 'Permanent+Marker' },
  { family: 'Shrikhand', spec: 'Shrikhand' },
  { family: 'Sacramento', spec: 'Sacramento' },
  { family: 'Dancing Script', spec: 'Dancing+Script:wght@400;700' },
  { family: 'Lobster', spec: 'Lobster' },
  { family: 'Righteous', spec: 'Righteous' },
  { family: 'Abril Fatface', spec: 'Abril+Fatface' },
  { family: 'Bungee', spec: 'Bungee' },
];

let injected = false;

/** Inject the Google Fonts stylesheet once. Safe to call on every mount. */
export function loadFonts() {
  if (injected || typeof document === 'undefined') return;
  injected = true;

  // Preconnect for faster font fetches.
  const pre1 = document.createElement('link');
  pre1.rel = 'preconnect';
  pre1.href = 'https://fonts.googleapis.com';
  const pre2 = document.createElement('link');
  pre2.rel = 'preconnect';
  pre2.href = 'https://fonts.gstatic.com';
  pre2.crossOrigin = 'anonymous';

  const families = FONTS.map((f) => `family=${f.spec}`).join('&');
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;

  document.head.append(pre1, pre2, link);

  // Redraw the canvas whenever any batch of fonts finishes loading, so text
  // that was drawn with a fallback is re-rendered in the real face.
  if (document.fonts) {
    document.fonts.addEventListener('loadingdone', redrawCanvas);
    // Eagerly fetch every curated font so picking one never flashes a fallback.
    FONTS.forEach((f) => ensureFont(f.family));
  }
}

/** Register a font from raw bytes via the FontFace API. */
async function registerFontData(family: string, data: ArrayBuffer): Promise<void> {
  const face = new FontFace(family, data);
  await face.load();
  document.fonts.add(face);
}

/** Derive a usable family name from an uploaded file's name. */
function familyFromFilename(name: string): string {
  return name.replace(/\.(ttf|otf|woff2?|TTF|OTF|WOFF2?)$/, '').replace(/[_-]+/g, ' ').trim();
}

/** Upload a user font file: register it for immediate use and persist it.
 * Returns the family name to add to the font list. */
export async function uploadFont(file: File): Promise<string> {
  const family = familyFromFilename(file.name) || `Custom ${Date.now()}`;
  const buffer = await file.arrayBuffer();
  await registerFontData(family, buffer);
  void putFont({ family, blob: file });
  return family;
}

/** Re-register every persisted user font at startup. Returns their families. */
export async function hydrateFonts(): Promise<string[]> {
  const stored = await getAllFonts();
  const families: string[] = [];
  for (const f of stored) {
    try {
      await registerFontData(f.family, await f.blob.arrayBuffer());
      families.push(f.family);
    } catch (err) {
      console.error('Failed to load font', f.family, err);
    }
  }
  return families;
}
