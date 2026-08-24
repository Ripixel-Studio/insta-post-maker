/**
 * On-device storage for the user's Claude API key. It lives in the same
 * IndexedDB `meta` table as the rest of the app's local prefs (brand palette,
 * active project) — nothing here ever leaves the browser. Kept in its own
 * module so `client.ts` stays a pure, network-only unit.
 */
import { getMeta, setMeta, deleteMeta } from '../persistence';

const AI_KEY_META = 'claudeApiKey';

/** The stored key, or '' when none is set. */
export async function loadStoredKey(): Promise<string> {
  return (await getMeta(AI_KEY_META)) ?? '';
}

export async function storeKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) {
    await clearStoredKey();
    return;
  }
  await setMeta(AI_KEY_META, trimmed);
}

export async function clearStoredKey(): Promise<void> {
  await deleteMeta(AI_KEY_META);
}
