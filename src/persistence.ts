import Dexie, { type Table } from 'dexie';
import type { Design } from './types';

/**
 * IndexedDB persistence (via Dexie). Everything stays on-device: image blobs
 * and project JSON. Assets are global (shared across projects); a project just
 * references asset ids inside its design.
 */

export interface StoredAsset {
  id: string;
  blob: Blob;
  width: number;
  height: number;
}

export interface StoredProject {
  id: string;
  name: string;
  design: Design;
  updatedAt: number;
}

class EditorDB extends Dexie {
  assets!: Table<StoredAsset, string>;
  projects!: Table<StoredProject, string>;
  meta!: Table<{ key: string; value: string }, string>;

  constructor() {
    super('insta-post-maker');
    this.version(1).stores({
      assets: 'id',
      projects: 'id, updatedAt',
      meta: 'key',
    });
  }
}

export const db = new EditorDB();

/* --------------------------------- Assets --------------------------------- */

export async function putAsset(asset: StoredAsset): Promise<void> {
  await db.assets.put(asset);
}

export async function getAllAssets(): Promise<StoredAsset[]> {
  return db.assets.toArray();
}

/* -------------------------------- Projects -------------------------------- */

export async function putProject(project: StoredProject): Promise<void> {
  await db.projects.put(project);
}

export async function getProject(id: string): Promise<StoredProject | undefined> {
  return db.projects.get(id);
}

export async function listProjects(): Promise<StoredProject[]> {
  const all = await db.projects.toArray();
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string): Promise<void> {
  await db.projects.delete(id);
}

/* ---------------------------------- Meta ---------------------------------- */

export async function getMeta(key: string): Promise<string | undefined> {
  return (await db.meta.get(key))?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
