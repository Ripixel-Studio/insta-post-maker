/**
 * Curated font set, loaded from the Google Fonts CDN. We inject a single
 * stylesheet link at startup and rely on `document.fonts.ready` before export
 * so text never rasterises in a fallback face.
 */

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
  { family: 'Lobster', spec: 'Lobster' },
  { family: 'Oswald', spec: 'Oswald:wght@400;700' },
  { family: 'Dancing Script', spec: 'Dancing+Script:wght@400;700' },
  { family: 'Roboto Mono', spec: 'Roboto+Mono:wght@400;700' },
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
}
