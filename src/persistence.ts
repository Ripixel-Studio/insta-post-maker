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

export interface StoredFont {
  family: string;
  blob: Blob;
}

export interface StoredTemplate {
  id: string;
  name: string;
  design: Design;
  updatedAt: number;
}

class EditorDB extends Dexie {
  assets!: Table<StoredAsset, string>;
  projects!: Table<StoredProject, string>;
  meta!: Table<{ key: string; value: string }, string>;
  fonts!: Table<StoredFont, string>;
  templates!: Table<StoredTemplate, string>;

  constructor() {
    super('insta-post-maker');
    this.version(1).stores({
      assets: 'id',
      projects: 'id, updatedAt',
      meta: 'key',
    });
    // v2 adds a fonts table for user-uploaded typefaces.
    this.version(2).stores({
      assets: 'id',
      projects: 'id, updatedAt',
      meta: 'key',
      fonts: 'family',
    });
    // v3 adds user-saved design templates.
    this.version(3).stores({
      assets: 'id',
      projects: 'id, updatedAt',
      meta: 'key',
      fonts: 'family',
      templates: 'id, updatedAt',
    });
  }
}

export const db = new EditorDB();

/** Wall-clock timestamp helper (kept out of components so the React purity
 * lint rule doesn't flag inline Date.now() calls). */
export const nowMs = (): number => Date.now();

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

/* --------------------------------- Fonts --------------------------------- */

export async function putFont(font: StoredFont): Promise<void> {
  await db.fonts.put(font);
}

export async function getAllFonts(): Promise<StoredFont[]> {
  return db.fonts.toArray();
}

/* ------------------------------- Templates ------------------------------- */

export async function putTemplate(t: StoredTemplate): Promise<void> {
  await db.templates.put(t);
}

export async function listTemplates(): Promise<StoredTemplate[]> {
  const all = await db.templates.toArray();
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteTemplate(id: string): Promise<void> {
  await db.templates.delete(id);
}

/* ---------------------------------- Meta ---------------------------------- */

export async function getMeta(key: string): Promise<string | undefined> {
  return (await db.meta.get(key))?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
