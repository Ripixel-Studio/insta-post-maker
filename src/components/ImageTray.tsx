import { useRef, useState } from 'react';
import { useEditor } from '../store';
import { getAsset } from '../assets';
import { importFilesToTray } from '../bulkImport';

/**
 * The image tray: a staging shelf for bulk-imported photos. Multi-select the
 * picker or drag a batch of files onto it and the photos land here as
 * thumbnails; click a thumbnail to drop it onto the current page. Keeping a
 * batch here (instead of dumping every photo onto the canvas at once) is what
 * makes a 40-photo import manageable.
 */
export function ImageTray() {
  const tray = useEditor((s) => s.tray);
  const trayOpen = useEditor((s) => s.trayOpen);
  const importProgress = useEditor((s) => s.importProgress);
  const setTrayOpen = useEditor((s) => s.setTrayOpen);
  const removeFromTray = useEditor((s) => s.removeFromTray);
  const clearTray = useEditor((s) => s.clearTray);
  const addImageLayer = useEditor((s) => s.addImageLayer);

  const fileRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const importing = importProgress !== null && importProgress.done < importProgress.total;
  const count = tray.length;

  // Collapsed: a slim handle that still accepts a file drop so a batch can be
  // imported without expanding the tray first.
  if (!trayOpen) {
    return (
      <div
        className={`flex items-center gap-3 border-t border-white/10 bg-[#14161b] px-3 py-1.5 ${
          dragOver ? 'bg-violet-500/20' : ''
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          void importFilesToTray(e.dataTransfer.files);
        }}
      >
        <button
          className="text-sm font-medium text-zinc-300 hover:text-white"
          onClick={() => setTrayOpen(true)}
        >
          🖼 Photos{count > 0 ? ` (${count})` : ''} ▴
        </button>
        {importing && (
          <span className="text-xs text-violet-300">
            Importing {importProgress!.done}/{importProgress!.total}…
          </span>
        )}
        <span className="ml-auto text-xs text-zinc-500">Drag photos here to import a batch</span>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col border-t border-white/10 bg-[#14161b] ${
        dragOver ? 'bg-violet-500/20 ring-1 ring-inset ring-violet-400' : ''
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void importFilesToTray(e.dataTransfer.files);
      }}
    >
      <div className="flex items-center gap-2 px-3 py-1.5">
        <button
          className="text-sm font-medium text-zinc-300 hover:text-white"
          onClick={() => setTrayOpen(false)}
          title="Collapse tray"
        >
          🖼 Photos{count > 0 ? ` (${count})` : ''} ▾
        </button>
        {importing && (
          <span className="text-xs text-violet-300">
            Importing {importProgress!.done}/{importProgress!.total}…
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            className="rounded-md bg-white/5 px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-white/10"
            onClick={() => fileRef.current?.click()}
          >
            + Import photos
          </button>
          {count > 0 && (
            <button
              className="rounded-md bg-white/5 px-2.5 py-1 text-xs font-medium text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
              onClick={clearTray}
              title="Remove every photo from the tray (originals stay in your projects)"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      {importing && (
        <div className="mx-3 mb-1 h-1 overflow-hidden rounded bg-white/10">
          <div
            className="h-full bg-violet-500 transition-[width] duration-150"
            style={{ width: `${(importProgress!.done / importProgress!.total) * 100}%` }}
          />
        </div>
      )}

      <div className="flex min-h-[92px] items-center gap-2 overflow-x-auto px-3 pb-2 pt-1">
        {count === 0 && !importing && (
          <p className="text-xs text-zinc-500">
            Drop a batch of photos here, or use <span className="text-zinc-300">+ Import photos</span>. Click a
            thumbnail to add it to the current page.
          </p>
        )}
        {tray.map((id) => {
          const asset = getAsset(id);
          if (!asset) return null;
          return (
            <div key={id} className="group relative shrink-0">
              <button
                className="block h-[76px] w-[76px] overflow-hidden rounded-md border border-white/10 bg-black/30 hover:border-violet-400"
                onClick={() => addImageLayer(id)}
                title="Add to current page"
              >
                <img src={asset.url} alt="" className="h-full w-full object-cover" draggable={false} />
              </button>
              <button
                className="absolute -right-1.5 -top-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-black/80 text-xs text-white group-hover:flex hover:bg-black"
                onClick={() => removeFromTray(id)}
                title="Remove from tray"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          void importFilesToTray(e.target.files);
          e.target.value = '';
        }}
      />
    </div>
  );
}
