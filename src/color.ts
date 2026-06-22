export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parse hex (#rgb/#rrggbb/#rrggbbaa) or rgb()/rgba() into RGBA. */
export function parseColor(input: string): RGBA {
  const s = (input ?? '').trim();
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split('').map((c) => c + c).join('');
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return { r, g, b, a };
    }
  }
  const m = s.match(/rgba?\(([^)]+)\)/i);
  if (m) {
    const parts = m[1].split(',').map((p) => parseFloat(p.trim()));
    return { r: parts[0] || 0, g: parts[1] || 0, b: parts[2] || 0, a: parts[3] ?? 1 };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** Plain 6-digit hex (for native <input type="color">). */
export function rgbToHex({ r, g, b }: RGBA): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

/** Serialise to hex when opaque, otherwise rgba() so alpha survives. */
export function formatColor({ r, g, b, a }: RGBA): string {
  if (a >= 1) return rgbToHex({ r, g, b, a: 1 });
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Math.round(a * 100) / 100})`;
}
