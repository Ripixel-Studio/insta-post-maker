import { useState } from 'react';
import { useEditor, activePage } from '../store';
import { LAYOUTS } from '../collage';

/** Compact "+ Add" dropdown used on small screens in place of the inline row
 * of insert buttons. */
export function AddMenu({
  className = '',
  onAddImage,
}: {
  className?: string;
  onAddImage: () => void;
}) {
  const addTextLayer = useEditor((s) => s.addTextLayer);
  const addOverlayLayer = useEditor((s) => s.addOverlayLayer);
  const addShapeLayer = useEditor((s) => s.addShapeLayer);
  const applyLayout = useEditor((s) => s.applyLayout);
  const clearCollage = useEditor((s) => s.clearCollage);
  const hasCollage = useEditor((s) => !!activePage(s).collage);
  const [open, setOpen] = useState(false);

  const item = 'block w-full rounded-md px-2 py-2 text-left text-sm hover:bg-white/10';
  const run = (fn: () => void) => () => {
    fn();
    setOpen(false);
  };

  return (
    <div className={`relative ${className}`}>
      <button
        className="rounded-md bg-violet-500 px-3 py-1.5 text-sm font-semibold text-white"
        onClick={() => setOpen((o) => !o)}
      >
        + Add ▾
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 max-h-[70vh] w-52 overflow-y-auto rounded-lg border border-white/10 bg-[#1b1d22] p-2 shadow-2xl">
          <button className={item} onClick={run(onAddImage)}>🖼 Image</button>
          <button className={item} onClick={run(addTextLayer)}>🅣 Text</button>
          <button className={item} onClick={run(addOverlayLayer)}>🌗 Gradient</button>
          <button className={item} onClick={run(() => addShapeLayer('rect'))}>▭ Rectangle</button>
          <button className={item} onClick={run(() => addShapeLayer('ellipse'))}>◯ Ellipse</button>
          <button className={item} onClick={run(() => addShapeLayer('line'))}>／ Line</button>
          <div className="my-1 h-px bg-white/10" />
          <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-500">Collage</p>
          {LAYOUTS.map((l) => (
            <button key={l.id} className={item} onClick={run(() => applyLayout(l.build()))}>
              {l.label}
            </button>
          ))}
          {hasCollage && (
            <button className={item} onClick={run(clearCollage)}>✕ No layout</button>
          )}
        </div>
      )}
    </div>
  );
}
