import { useEffect } from 'react';
import { Toolbar } from './components/Toolbar';
import { PropertiesPanel } from './components/PropertiesPanel';
import { PageBar } from './components/PageBar';
import { PagesOverview } from './components/PagesOverview';
import { EraseOverlay } from './components/EraseOverlay';
import { MobileShell } from './components/MobileShell';
import { ImageTray } from './components/ImageTray';
import { CanvasStage } from './canvas/CanvasStage';
import { useShortcuts } from './useShortcuts';
import { usePersistence } from './usePersistence';
import { loadFonts } from './fonts';
import { useEditor } from './store';
import { addImageAsset } from './assets';
import { importFilesSmart } from './bulkImport';

export default function App() {
  useShortcuts();
  usePersistence();
  const addImageLayer = useEditor((s) => s.addImageLayer);
  const sheetOpen = useEditor((s) => s.sheetOpen);
  const viewAll = useEditor((s) => s.viewAll);

  useEffect(() => {
    loadFonts();
  }, []);

  // Paste an image from the clipboard straight onto the canvas.
  useEffect(() => {
    async function onPaste(e: ClipboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const item = Array.from(e.clipboardData?.items ?? []).find((i) =>
        i.type.startsWith('image/'),
      );
      const file = item?.getAsFile();
      if (!file) return;
      e.preventDefault();
      try {
        const asset = await addImageAsset(file);
        addImageLayer(asset.id);
      } catch (err) {
        console.error(err);
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [addImageLayer]);

  // Drag-and-drop images anywhere onto the workspace. A single photo drops
  // straight onto the canvas; a batch is staged in the image tray instead of
  // landing as a pile of stacked layers.
  function onDrop(e: React.DragEvent) {
    if (e.dataTransfer.files.length === 0) return;
    e.preventDefault();
    void importFilesSmart(e.dataTransfer.files);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Desktop toolbar (mobile uses the floating shell instead). */}
      <div className="hidden md:block">
        <Toolbar />
      </div>
      <div
        className="flex min-h-0 flex-1"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <main className="relative flex min-w-0 flex-1 flex-col bg-[#0b0d10]">
          <div className="hidden md:block">
            <PageBar />
          </div>
          {/* Mobile: canvas goes ~full-screen with floating controls; reserve a
              little top/bottom for the floating bars (or the edit sheet). */}
          <div
            className={`min-h-0 flex-1 transition-[padding] duration-200 md:!p-0 ${
              viewAll ? 'pb-0' : sheetOpen ? 'pb-[55vh] pt-14' : 'pb-20 pt-14'
            }`}
          >
            {viewAll ? <PagesOverview /> : <CanvasStage />}
          </div>
          {/* Image tray — desktop staging shelf for bulk photo import. */}
          <div className="hidden md:block">
            <ImageTray />
          </div>
          {!viewAll && <MobileShell />}
        </main>
        <PropertiesPanel />
      </div>
      <EraseOverlay />
    </div>
  );
}
