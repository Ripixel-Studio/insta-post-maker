import { useEffect, useState } from 'react';
import { useEditor, emptyDesign } from '../store';
import { DEFAULT_PRESET } from '../presets';
import { nextId } from '../assets';
import {
  listProjects,
  putProject,
  deleteProject,
  setMeta,
  type StoredProject,
} from '../persistence';

const ACTIVE_KEY = 'activeProjectId';

export function ProjectsMenu() {
  const projectName = useEditor((s) => s.projectName);
  const projectId = useEditor((s) => s.projectId);
  const setProjectName = useEditor((s) => s.setProjectName);
  const setProjectMeta = useEditor((s) => s.setProjectMeta);
  const loadDesign = useEditor((s) => s.loadDesign);

  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<StoredProject[]>([]);

  useEffect(() => {
    if (open) void listProjects().then(setProjects);
  }, [open]);

  async function newProject() {
    const id = nextId('proj');
    const design = emptyDesign(DEFAULT_PRESET);
    setProjectMeta(id, 'Untitled');
    loadDesign(design);
    await putProject({ id, name: 'Untitled', design, updatedAt: Date.now() });
    await setMeta(ACTIVE_KEY, id);
    setOpen(false);
  }

  async function openProject(p: StoredProject) {
    loadDesign(p.design);
    setProjectMeta(p.id, p.name);
    await setMeta(ACTIVE_KEY, p.id);
    setOpen(false);
  }

  async function removeProject(p: StoredProject) {
    await deleteProject(p.id);
    const remaining = await listProjects();
    setProjects(remaining);
    if (p.id === projectId) {
      if (remaining[0]) await openProject(remaining[0]);
      else await newProject();
    }
  }

  return (
    <div className="relative flex items-center gap-2">
      <input
        className="w-36 rounded-md border border-transparent bg-white/5 px-2 py-1 text-sm text-zinc-100 outline-none hover:border-white/10 focus:border-violet-400"
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
        title="Project name"
      />
      <button
        className="rounded-md bg-white/5 px-2 py-1.5 text-sm text-zinc-200 hover:bg-white/10"
        onClick={() => setOpen((o) => !o)}
      >
        Projects ▾
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-white/10 bg-[#1b1d22] p-2 shadow-2xl">
          <button
            className="mb-2 w-full rounded-md bg-violet-500 px-2 py-1.5 text-sm font-semibold text-white hover:bg-violet-400"
            onClick={newProject}
          >
            + New project
          </button>
          <div className="max-h-72 overflow-y-auto">
            {projects.length === 0 && (
              <p className="px-1 py-2 text-sm text-zinc-500">No saved projects yet.</p>
            )}
            {projects.map((p) => (
              <div
                key={p.id}
                className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
                  p.id === projectId ? 'bg-violet-500/20' : 'hover:bg-white/5'
                }`}
              >
                <button className="flex-1 truncate text-left" onClick={() => openProject(p)}>
                  {p.name || 'Untitled'}
                </button>
                <button
                  className="opacity-60 hover:opacity-100"
                  title="Delete project"
                  onClick={() => removeProject(p)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
