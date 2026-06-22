import type { RoutePoint } from './fitglue';

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encode failed'))), 'image/png'),
  );
}

function hexToRgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Render a time-series as a clean line graphic on a transparent background. */
export function renderChart(
  series: number[],
  color: string,
  opts: { width?: number; height?: number; fill?: boolean } = {},
): Promise<Blob> {
  const width = opts.width ?? 1080;
  const height = opts.height ?? 420;
  const pad = Math.round(height * 0.12);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;
  const n = series.length;
  const x = (i: number) => pad + (i / (n - 1)) * (width - pad * 2);
  const y = (v: number) => height - pad - ((v - min) / range) * (height - pad * 2);

  // Optional gradient fill under the line.
  if (opts.fill !== false) {
    ctx.beginPath();
    ctx.moveTo(x(0), height - pad);
    series.forEach((v, i) => ctx.lineTo(x(i), y(v)));
    ctx.lineTo(x(n - 1), height - pad);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, pad, 0, height - pad);
    grad.addColorStop(0, hexToRgba(color, 0.35));
    grad.addColorStop(1, hexToRgba(color, 0));
    ctx.fillStyle = grad;
    ctx.fill();
  }

  // The line itself, with a soft glow.
  ctx.beginPath();
  series.forEach((v, i) => (i === 0 ? ctx.moveTo(x(i), y(v)) : ctx.lineTo(x(i), y(v))));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(3, height * 0.018);
  ctx.strokeStyle = color;
  ctx.shadowColor = hexToRgba(color, 0.8);
  ctx.shadowBlur = height * 0.05;
  ctx.stroke();

  return toBlob(canvas);
}

/** Render a GPS route as a glowing polyline on a transparent background. */
export function renderRoute(
  points: RoutePoint[],
  color: string,
  opts: { size?: number } = {},
): Promise<Blob> {
  const size = opts.size ?? 1080;
  const pad = Math.round(size * 0.1);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // Project lat/lng to a local plane (longitude compressed by cos(lat)).
  const latMean = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const k = Math.cos((latMean * Math.PI) / 180);
  const xs = points.map((p) => p.lng * k);
  const ys = points.map((p) => -p.lat);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX || 1e-6;
  const spanY = maxY - minY || 1e-6;
  const scale = Math.min((size - pad * 2) / spanX, (size - pad * 2) / spanY);
  const offX = (size - spanX * scale) / 2;
  const offY = (size - spanY * scale) / 2;
  const px = (i: number) => offX + (xs[i] - minX) * scale;
  const py = (i: number) => offY + (ys[i] - minY) * scale;

  ctx.beginPath();
  points.forEach((_, i) => (i === 0 ? ctx.moveTo(px(i), py(i)) : ctx.lineTo(px(i), py(i))));
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(5, size * 0.012);
  ctx.strokeStyle = color;
  ctx.shadowColor = hexToRgba(color, 0.9);
  ctx.shadowBlur = size * 0.03;
  ctx.stroke();

  // Start (green) and end (pink) markers.
  ctx.shadowBlur = 0;
  const dot = (i: number, c: string) => {
    ctx.beginPath();
    ctx.arc(px(i), py(i), size * 0.018, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  };
  dot(0, '#4ade80');
  dot(points.length - 1, '#ff3b5c');

  return toBlob(canvas);
}
