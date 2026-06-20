import { useEffect, useRef } from 'react';
import { useEditor } from './store';
import { hydrateAssets, nextId } from './assets';
import {
  getMeta,
  setMeta,
  getProject,
  putProject,
  listProjects,
} from './persistence';

const ACTIVE_KEY = 'activeProjectId';

/**
 * Wires the editor to IndexedDB: on startup it rehydrates image assets and
 * loads the most recent (or active) project; thereafter it auto-saves the
 * current design (debounced) whenever it changes.
 */
export function usePersistence() {
  const loadedRef = useRef(false);

  // --- Startup load ---
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await hydrateAssets();
      const activeId = await getMeta(ACTIVE_KEY);
      let project = activeId ? await getProject(activeId) : undefined;
      if (!project) {
        // Fall back to the most recently updated project, if any.
        project = (await listProjects())[0];
      }
      if (cancelled) return;

      const { loadDesign, setProjectMeta, design } = useEditor.getState();
      if (project) {
        loadDesign(project.design);
        setProjectMeta(project.id, project.name);
        await setMeta(ACTIVE_KEY, project.id);
      } else {
        // First run: adopt the current (empty) design as a new project.
        const id = nextId('proj');
        setProjectMeta(id, 'Untitled');
        await putProject({ id, name: 'Untitled', design, updatedAt: Date.now() });
        await setMeta(ACTIVE_KEY, id);
      }
      loadedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Debounced auto-save on design / name changes ---
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = useEditor.subscribe((state, prev) => {
      if (!loadedRef.current) return;
      if (state.design === prev.design && state.projectName === prev.projectName) return;
      if (!state.projectId) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        void putProject({
          id: state.projectId!,
          name: state.projectName,
          design: state.design,
          updatedAt: Date.now(),
        });
      }, 500);
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, []);
}
