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
