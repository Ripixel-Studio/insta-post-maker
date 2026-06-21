import { useEffect } from 'react';
import { Toolbar } from './components/Toolbar';
import { PropertiesPanel } from './components/PropertiesPanel';
import { CanvasStage } from './canvas/CanvasStage';
import { useShortcuts } from './useShortcuts';
import { usePersistence } from './usePersistence';
import { loadFonts } from './fonts';
import { useEditor } from './store';
import { addImageAsset } from './assets';

export default function App() {
  useShortcuts();
  usePersistence();
  const addImageLayer = useEditor((s) => s.addImageLayer);

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

  // Drag-and-drop images anywhere onto the workspace.
  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    for (const file of Array.from(e.dataTransfer.files)) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const asset = await addImageAsset(file);
        addImageLayer(asset.id);
      } catch (err) {
        console.error(err);
      }
    }
  }

  return (
    <div className="flex h-full flex-col">
      <Toolbar />
      <div
        className="flex min-h-0 flex-1"
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <main className="min-w-0 flex-1 bg-[#0b0d10]">
          <CanvasStage />
        </main>
        <PropertiesPanel />
      </div>
    </div>
  );
}
