import { useEditor } from '../store';

/** Slim bar to switch / add / duplicate / delete pages of a multi-panel post. */
export function PageBar() {
  const pages = useEditor((s) => s.design.pages);
  const active = useEditor((s) => s.activePageIndex);
  const setActivePage = useEditor((s) => s.setActivePage);
  const addPage = useEditor((s) => s.addPage);
  const duplicatePage = useEditor((s) => s.duplicatePage);
  const removePage = useEditor((s) => s.removePage);
  const movePage = useEditor((s) => s.movePage);

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto border-b border-white/10 bg-[#0e1013] px-3 py-1.5">
      <span className="mr-1 shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">Pages</span>
      {pages.map((p, i) => (
        <button
          key={p.id}
          className={`h-7 w-7 shrink-0 rounded-md text-sm ${
            i === active ? 'bg-violet-500 text-white' : 'bg-white/5 text-zinc-300 hover:bg-white/10'
          }`}
          onClick={() => setActivePage(i)}
          title={`Page ${i + 1}`}
        >
          {i + 1}
        </button>
      ))}
      <button
        className="h-7 shrink-0 rounded-md bg-white/5 px-2 text-sm text-zinc-200 hover:bg-white/10"
        onClick={addPage}
        title="Add a page"
      >
        +
      </button>

      <div className="mx-1 h-5 w-px shrink-0 bg-white/10" />

      <button
        className="h-7 shrink-0 rounded-md bg-white/5 px-2 text-sm hover:bg-white/10 disabled:opacity-40"
        onClick={() => movePage(active, active - 1)}
        disabled={active === 0}
        title="Move page left"
      >
        ‹
      </button>
      <button
        className="h-7 shrink-0 rounded-md bg-white/5 px-2 text-sm hover:bg-white/10 disabled:opacity-40"
        onClick={() => movePage(active, active + 1)}
        disabled={active >= pages.length - 1}
        title="Move page right"
      >
        ›
      </button>
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
    </div>
  );
}
