import { useLayoutEffect, useRef, useState } from 'react';
import { useEditor } from '../store';
import { PagePreview } from './PagePreview';

/** Side-by-side view of every page — handy on a wide monitor for keeping a
 * multi-panel post visually coherent. Tap a page to jump into editing it. */
export function PagesOverview() {
  const pages = useEditor((s) => s.design.pages);
  const shared = useEditor((s) => s.design.shared);
  const width = useEditor((s) => s.design.width);
  const height = useEditor((s) => s.design.height);
  const active = useEditor((s) => s.activePageIndex);
  const setActivePage = useEditor((s) => s.setActivePage);
  const setViewAll = useEditor((s) => s.setViewAll);

  const ref = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAvail(e.contentRect.height));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit tiles to the container height (minus room for the caption), capped.
  const displayHeight = Math.min(Math.max(avail - 56, 160), 900);

  return (
    <div ref={ref} className="h-full w-full overflow-x-auto bg-[#0b0d10]">
      <div className="flex h-full items-center gap-6 px-8">
        {displayHeight > 0 &&
          pages.map((p, i) => (
            <button
              key={p.id}
              className="group shrink-0"
              onClick={() => {
                setActivePage(i);
                setViewAll(false);
              }}
            >
              <div
                className={`overflow-hidden rounded-lg shadow-2xl ring-2 ${
                  i === active ? 'ring-violet-400' : 'ring-transparent group-hover:ring-white/20'
                }`}
              >
                <PagePreview
                  page={p}
                  shared={shared}
                  width={width}
                  height={height}
                  displayHeight={displayHeight}
                />
              </div>
              <div className="mt-2 text-center text-xs text-zinc-400">Page {i + 1}</div>
            </button>
          ))}
      </div>
    </div>
  );
}
