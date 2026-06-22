import { useEffect } from 'react';
import { useEditor, combinedLayers } from './store';

/** Returns true if focus is in a text input where keystrokes should pass through. */
function isEditingText(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

export function useShortcuts() {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isEditingText(e.target)) return;
      const state = useEditor.getState();
      const {
        undo,
        redo,
        selectedId,
        removeLayer,
        updateLayer,
        duplicateLayer,
        select,
        cropTargetId,
        setCropTarget,
        editingTextId,
      } = state;

      // In crop/erase mode, only allow Escape (cancel); swallow everything else
      // so we don't e.g. delete the image being edited.
      if (cropTargetId) {
        if (e.key === 'Escape') setCropTarget(null);
        return;
      }
      if (state.eraseTargetId) {
        if (e.key === 'Escape') state.setEraseTarget(null);
        return;
      }
      if (state.drawMode) {
        if (e.key === 'Escape') state.setDrawMode(false);
        return;
      }
      if (editingTextId) return;

      const meta = e.metaKey || e.ctrlKey;

      if (meta && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (selectedId) duplicateLayer(selectedId);
        return;
      }

      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
        return;
      }

      if (!selectedId) return;
      const layer = combinedLayers(state).find((l) => l.id === selectedId);
      if (!layer) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        removeLayer(selectedId);
        return;
      }
      if (e.key === 'Escape') {
        select(null);
        return;
      }

      // Arrow-key nudge (Shift = 10px steps).
      const step = e.shiftKey ? 10 : 1;
      const nudges: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const delta = nudges[e.key];
      if (delta) {
        e.preventDefault();
        updateLayer(selectedId, { x: layer.x + delta[0], y: layer.y + delta[1] });
      }
    }

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
