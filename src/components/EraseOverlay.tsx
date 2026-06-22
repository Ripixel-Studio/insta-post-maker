import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../store';
import { getAsset, addImageAsset } from '../assets';
import type { ImageLayer } from '../types';

/**
 * Manual erase/restore brush for refining an image (e.g. cleaning up a cutout
 * that grabbed too much). Paints alpha away (or back) on a full-resolution copy
 * and commits the result as a new asset.
 */
export function EraseOverlay() {
  const eraseTargetId = useEditor((s) => s.eraseTargetId);
  const setEraseTarget = useEditor((s) => s.setEraseTarget);
  const updateLayer = useEditor((s) => s.updateLayer);
  const design = useEditor((s) => s.design);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const origRef = useRef<HTMLCanvasElement | null>(null);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const [brush, setBrush] = useState(120);
  const [mode, setMode] = useState<'erase' | 'restore'>('erase');
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  const layer = design.pages
    .flatMap((p) => p.layers)
    .concat(design.shared)
    .find((l) => l.id === eraseTargetId);
  const assetId = layer && layer.type === 'image' ? layer.assetId : undefined;

  // Load the asset into the working canvas + keep a pristine copy for restore.
  useEffect(() => {
    if (!eraseTargetId || !assetId) return;
    const asset = getAsset(assetId);
    const canvas = canvasRef.current;
    if (!asset || !canvas) return;
    setReady(false);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      const orig = document.createElement('canvas');
      orig.width = canvas.width;
      orig.height = canvas.height;
      orig.getContext('2d')!.drawImage(img, 0, 0);
      origRef.current = orig;
      setReady(true);
    };
    img.src = asset.url;
  }, [eraseTargetId, assetId]);

  if (!eraseTargetId) return null;

  const toSource = (e: React.PointerEvent) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * canvas.width,
      y: ((e.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const stamp = (x: number, y: number) => {
    const ctx = canvasRef.current!.getContext('2d')!;
    ctx.save();
    if (mode === 'erase') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(x, y, brush / 2, 0, Math.PI * 2);
      ctx.fill();
    } else if (origRef.current) {
      ctx.beginPath();
      ctx.arc(x, y, brush / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(origRef.current, 0, 0);
    }
    ctx.restore();
  };

  const paintTo = (x: number, y: number) => {
    const last = lastRef.current ?? { x, y };
    const dist = Math.hypot(x - last.x, y - last.y);
    const step = Math.max(brush / 6, 2);
    for (let d = 0; d <= dist; d += step) {
      const t = dist === 0 ? 0 : d / dist;
      stamp(last.x + (x - last.x) * t, last.y + (y - last.y) * t);
    }
    lastRef.current = { x, y };
  };

  async function apply() {
    const canvas = canvasRef.current;
    if (!canvas || !layer) return;
    setBusy(true);
    try {
      const blob: Blob = await new Promise((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error('Encode failed'))), 'image/png'),
      );
      const asset = await addImageAsset(new File([blob], 'erased.png', { type: 'image/png' }));
      const patch: Partial<ImageLayer> = { assetId: asset.id };
      // If this is a sticker, also refresh its clean base so outlines re-bake.
      if (layer.type === 'image' && layer.baseAssetId) patch.baseAssetId = asset.id;
      updateLayer(layer.id, patch);
      setEraseTarget(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-2">
        <span className="mr-2 text-sm font-semibold text-zinc-200">Erase / refine</span>
        <div className="flex gap-1">
          {(['erase', 'restore'] as const).map((m) => (
            <button
              key={m}
              className={`rounded-md px-3 py-1.5 text-sm ${
                mode === m ? 'bg-violet-500 text-white' : 'bg-white/5 hover:bg-white/10'
              }`}
              onClick={() => setMode(m)}
            >
              {m === 'erase' ? '🧽 Erase' : '↩ Restore'}
            </button>
          ))}
        </div>
        <label className="ml-2 flex items-center gap-2 text-sm text-zinc-300">
          Brush
          <input type="range" min={20} max={400} step={5} value={brush}
            className="accent-violet-500" onChange={(e) => setBrush(Number(e.target.value))} />
        </label>
        <div className="ml-auto flex gap-2">
          <button className="rounded-md px-3 py-1.5 text-sm hover:bg-white/10"
            onClick={() => setEraseTarget(null)}>Cancel</button>
          <button
            className="rounded-md bg-violet-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-violet-400 disabled:opacity-50"
            onClick={apply}
            disabled={busy || !ready}
          >
            {busy ? 'Saving…' : 'Apply'}
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        {/* Checkerboard shows through erased (transparent) areas. */}
        <div
          className="max-h-full max-w-full"
          style={{
            backgroundImage:
              'conic-gradient(#3a3d47 0 25%, #23262e 0 50%, #3a3d47 0 75%, #23262e 0)',
            backgroundSize: '24px 24px',
          }}
        >
          <canvas
            ref={canvasRef}
            className="block max-h-[calc(100vh-7rem)] max-w-full touch-none"
            style={{ cursor: 'crosshair' }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              const p = toSource(e);
              lastRef.current = p;
              stamp(p.x, p.y);
            }}
            onPointerMove={(e) => {
              if (lastRef.current === null) return;
              const p = toSource(e);
              paintTo(p.x, p.y);
            }}
            onPointerUp={() => {
              lastRef.current = null;
            }}
          />
        </div>
      </div>
      <p className="px-4 pb-3 text-center text-xs text-zinc-500">
        Paint to erase parts of the image; switch to Restore to paint them back.
      </p>
    </div>
  );
}
