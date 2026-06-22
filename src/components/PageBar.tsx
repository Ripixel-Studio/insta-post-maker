import { useState } from 'react';
import { useEditor } from '../store';

/** Switch / add / reorder / duplicate / delete pages, and toggle the
 * side-by-side overview. */
export function PageBar() {
  const pages = useEditor((s) => s.design.pages);
  const active = useEditor((s) => s.activePageIndex);
  const setActivePage = useEditor((s) => s.setActivePage);
  const addPage = useEditor((s) => s.addPage);
  const duplicatePage = useEditor((s) => s.duplicatePage);
  const removePage = useEditor((s) => s.removePage);
  const movePage = useEditor((s) => s.movePage);
  const viewAll = useEditor((s) => s.viewAll);
  const setViewAll = useEditor((s) => s.setViewAll);

  // Drag a chip to reorder; a plain click (no drag) just switches page.
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto border-b border-white/10 bg-[#0e1013] px-3 py-1.5">
      <span className="mr-1 shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">Pages</span>

      <button
        className="h-7 shrink-0 rounded-md bg-white/5 px-2 text-sm hover:bg-white/10 disabled:opacity-40"
        onClick={() => setActivePage(active - 1)}
        disabled={active === 0 || viewAll}
        title="Previous page"
      >
        ‹
      </button>

      {pages.map((p, i) => (
        <button
          key={p.id}
          data-page-index={i}
          className={`h-7 w-7 shrink-0 touch-none rounded-md text-sm ${
            i === active && !viewAll ? 'bg-violet-500 text-white' : 'bg-white/5 text-zinc-300 hover:bg-white/10'
          } ${overIdx === i && dragIdx !== i ? 'ring-1 ring-violet-400' : ''}`}
          title={`Page ${i + 1} — tap to open, drag to reorder`}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragIdx(i);
          }}
          onPointerMove={(e) => {
            if (dragIdx === null) return;
            const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-page-index]');
            const idx = el ? Number(el.getAttribute('data-page-index')) : null;
            if (idx !== null && idx !== overIdx) setOverIdx(idx);
          }}
          onPointerUp={(e) => {
            const from = dragIdx;
            setDragIdx(null);
            (e.target as Element).releasePointerCapture?.(e.pointerId);
            if (from !== null && overIdx !== null && overIdx !== from) movePage(from, overIdx);
            else {
              setViewAll(false);
              setActivePage(i);
            }
            setOverIdx(null);
          }}
        >
          {i + 1}
        </button>
      ))}

      <button
        className="h-7 shrink-0 rounded-md bg-white/5 px-2 text-sm hover:bg-white/10 disabled:opacity-40"
        onClick={() => setActivePage(active + 1)}
        disabled={active >= pages.length - 1 || viewAll}
        title="Next page"
      >
        ›
      </button>

      <button
        className="h-7 shrink-0 rounded-md bg-white/5 px-2 text-sm text-zinc-200 hover:bg-white/10"
        onClick={addPage}
        title="Add a page"
      >
        +
      </button>

      <div className="mx-1 h-5 w-px shrink-0 bg-white/10" />

      <button
        className="h-7 shrink-0 rounded-md bg-white/5 px-2 text-sm hover:bg-white/10"
        onClick={duplicatePage}
        title="Duplicate page"
      >
        ⧉
      </button>
      {pages.length > 1 && (
        <button
          className="h-7 shrink-0 rounded-md bg-white/5 px-2 text-sm hover:bg-white/10"
          onClick={() => removePage(active)}
          title="Delete page"
        >
          🗑
        </button>
      )}

      <div className="mx-1 h-5 w-px shrink-0 bg-white/10" />

      <button
        className={`h-7 shrink-0 rounded-md px-2 text-sm ${
          viewAll ? 'bg-violet-500 text-white' : 'bg-white/5 text-zinc-200 hover:bg-white/10'
        }`}
        onClick={() => setViewAll(!viewAll)}
        title="Show all pages side by side"
      >
        ▦ All
      </button>
    </div>
  );
}
