import { useEffect, useRef } from 'react';
import { useEditor } from './store';
import { hydrateAssets, nextId, getAsset } from './assets';
import { hydrateFonts } from './fonts';
import { loadStoredKey } from './ai/storage';
import { reviveStyleProfile } from './ai/styleProfile';
import {
  getMeta,
  setMeta,
  deleteMeta,
  getProject,
  putProject,
  listProjects,
  nowMs,
} from './persistence';

const ACTIVE_KEY = 'activeProjectId';
const TRAY_KEY = 'tray';

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
      const fontFamilies = await hydrateFonts();
      const brandJson = await getMeta('brandColors');
      const storedKey = await loadStoredKey();
      const styleJson = await getMeta('styleProfile');
      const trayJson = await getMeta(TRAY_KEY);
      if (!cancelled) {
        const { addCustomFont, setBrandColors, setAiKey, setStyleProfile } = useEditor.getState();
        fontFamilies.forEach(addCustomFont);
        setAiKey(storedKey);
        if (styleJson) setStyleProfile(reviveStyleProfile(styleJson));
        // The tray (bulk-imported photos not yet placed) is UI state, not part
        // of the design, but losing it on a reload meant re-importing. Restore
        // the ids that still resolve to a hydrated asset.
        if (trayJson) {
          try {
            const ids = (JSON.parse(trayJson) as unknown[]).filter(
              (id): id is string => typeof id === 'string' && Boolean(getAsset(id)),
            );
            if (ids.length) useEditor.setState({ tray: ids });
          } catch {
            /* ignore malformed */
          }
        }
        if (brandJson) {
          try {
            setBrandColors(JSON.parse(brandJson));
          } catch {
            /* ignore malformed */
          }
        }
      }
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
        await putProject({ id, name: 'Untitled', design, updatedAt: nowMs() });
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
          updatedAt: nowMs(),
        });
      }, 500);
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, []);

  // --- Persist the tray whenever it changes ---
  useEffect(() => {
    const unsub = useEditor.subscribe((state, prev) => {
      if (!loadedRef.current) return;
      if (state.tray === prev.tray) return;
      void setMeta(TRAY_KEY, JSON.stringify(state.tray));
    });
    return unsub;
  }, []);

  // --- Persist the brand palette whenever it changes ---
  useEffect(() => {
    const unsub = useEditor.subscribe((state, prev) => {
      if (!loadedRef.current) return;
      if (state.brandColors === prev.brandColors) return;
      void setMeta('brandColors', JSON.stringify(state.brandColors));
    });
    return unsub;
  }, []);

  // --- Persist the distilled style profile whenever it changes ---
  useEffect(() => {
    const unsub = useEditor.subscribe((state, prev) => {
      if (!loadedRef.current) return;
      if (state.styleProfile === prev.styleProfile) return;
      if (state.styleProfile) void setMeta('styleProfile', JSON.stringify(state.styleProfile));
      else void deleteMeta('styleProfile');
    });
    return unsub;
  }, []);
}
