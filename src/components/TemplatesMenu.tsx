import { useEffect, useState } from 'react';
import { useEditor } from '../store';
import { nextId } from '../assets';
import { TEMPLATES, freshenDesign } from '../templates';
import type { Design } from '../types';
import {
  putProject,
  setMeta,
  listTemplates,
  putTemplate,
  deleteTemplate,
  nowMs,
  type StoredTemplate,
} from '../persistence';

const ACTIVE_KEY = 'activeProjectId';

export function TemplatesMenu() {
  const design = useEditor((s) => s.design);
  const loadDesign = useEditor((s) => s.loadDesign);
  const setProjectMeta = useEditor((s) => s.setProjectMeta);

  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<StoredTemplate[]>([]);

  useEffect(() => {
    if (open) void listTemplates().then(setSaved);
  }, [open]);

  /** Apply a template by spinning up a fresh project from it. */
  async function apply(name: string, source: Design) {
    const id = nextId('proj');
    const fresh = freshenDesign(source);
    setProjectMeta(id, name);
    loadDesign(fresh);
    await putProject({ id, name, design: fresh, updatedAt: nowMs() });
    await setMeta(ACTIVE_KEY, id);
    setOpen(false);
  }

  async function saveCurrent() {
    const name = prompt('Save current design as template named:', 'My template');
    if (!name) return;
    await putTemplate({ id: nextId('tpl'), name, design: structuredClone(design), updatedAt: nowMs() });
    setSaved(await listTemplates());
  }

  async function remove(t: StoredTemplate) {
    await deleteTemplate(t.id);
    setSaved(await listTemplates());
  }

  return (
    <div className="relative">
      <button
        className="rounded-md bg-white/5 px-2 py-1.5 text-sm text-zinc-200 hover:bg-white/10"
        onClick={() => setOpen((o) => !o)}
      >
        Templates ▾
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-white/10 bg-[#1b1d22] p-2 shadow-2xl">
          <p className="px-1 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Starters
          </p>
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/5"
              onClick={() => apply(t.label, t.build())}
            >
              {t.label}
            </button>
          ))}

          {saved.length > 0 && (
            <>
              <p className="mt-2 px-1 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Your templates
              </p>
              {saved.map((t) => (
                <div key={t.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-white/5">
                  <button className="flex-1 truncate text-left" onClick={() => apply(t.name, t.design)}>
                    {t.name}
                  </button>
                  <button className="opacity-60 hover:opacity-100" title="Delete template" onClick={() => remove(t)}>
                    ✕
                  </button>
                </div>
              ))}
            </>
          )}

          <button
            className="mt-2 w-full rounded-md bg-violet-500 px-2 py-1.5 text-sm font-semibold text-white hover:bg-violet-400"
            onClick={saveCurrent}
          >
            Save current as template
          </button>
        </div>
      )}
    </div>
  );
}
