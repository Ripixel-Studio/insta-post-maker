/**
 * Copilot session persistence — the conversation survives a hard reload.
 *
 * The panel's state used to live only in React state/refs, so a refresh (or a
 * PWA relaunch) threw away the whole conversation while the design it built
 * was safely in IndexedDB. Now the API messages, the rendered transcript, the
 * pending question (if the model was waiting on the user) and the set of
 * photos already shown to the model are stored under one `meta` key.
 *
 * Only ever on-device, same as everything else here. Messages can carry
 * base64 photos and previews, so a session is a few MB at most — fine for
 * IndexedDB, and it's replaced (not appended) on every save.
 */

import type { ClaudeMessage, ContentBlock, ToolUseBlock } from './client';
import type { PendingInput } from './copilot';
import { deleteMeta, getMeta, setMeta } from '../persistence';

export const SESSION_KEY = 'copilotSession';
export const SESSION_VERSION = 1;

/** One rendered line of the transcript (mirrors the panel's Item, minus id). */
export type SessionItem =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; name: string; summary: string; isError: boolean }
  | { kind: 'question'; text: string };

export interface CopilotSession {
  version: number;
  savedAt: number;
  messages: ClaudeMessage[];
  items: SessionItem[];
  pending: PendingInput | null;
  sentPhotoIds: string[];
}

const hasToolUse = (m: ClaudeMessage) =>
  Array.isArray(m.content) && (m.content as ContentBlock[]).some((b) => b.type === 'tool_use');

/**
 * Make a stored conversation safe to continue. A reload mid-run can leave the
 * history ending on an assistant turn full of `tool_use` blocks whose results
 * were never sent — the API rejects the next call outright. Unless those
 * tool_uses are the ones a `pending` question already holds results for, drop
 * that trailing assistant turn (the design keeps whatever it did; the model
 * will just re-read it via get_snapshot).
 */
export function sanitizeSession(s: CopilotSession): CopilotSession {
  const messages = [...s.messages];
  let pending = s.pending;
  const last = messages[messages.length - 1];
  if (last && last.role === 'assistant' && hasToolUse(last)) {
    const uses = (last.content as ContentBlock[]).filter((b): b is ToolUseBlock => b.type === 'tool_use');
    const answered = new Set(pending?.toolResults.map((r) => r.tool_use_id) ?? []);
    if (pending) answered.add(pending.askId);
    const complete = uses.every((u) => answered.has(u.id));
    if (!complete) {
      messages.pop();
      pending = null;
    }
  }
  // A user turn cannot follow a user turn either; collapse a dangling one.
  while (messages.length >= 2 && messages[messages.length - 1].role === 'user' && messages[messages.length - 2].role === 'user') {
    messages.splice(messages.length - 2, 1);
  }
  return { ...s, messages, pending };
}

export async function saveSession(s: Omit<CopilotSession, 'version' | 'savedAt'>, now = Date.now()): Promise<void> {
  const session: CopilotSession = { ...s, version: SESSION_VERSION, savedAt: now };
  await setMeta(SESSION_KEY, JSON.stringify(session));
}

export async function loadSession(): Promise<CopilotSession | null> {
  const raw = await getMeta(SESSION_KEY);
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<CopilotSession>;
    if (!obj || obj.version !== SESSION_VERSION || !Array.isArray(obj.messages)) return null;
    return sanitizeSession({
      version: SESSION_VERSION,
      savedAt: typeof obj.savedAt === 'number' ? obj.savedAt : 0,
      messages: obj.messages,
      items: Array.isArray(obj.items) ? obj.items : [],
      pending: obj.pending && typeof obj.pending === 'object' ? (obj.pending as PendingInput) : null,
      sentPhotoIds: Array.isArray(obj.sentPhotoIds) ? obj.sentPhotoIds.filter((x): x is string => typeof x === 'string') : [],
    });
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await deleteMeta(SESSION_KEY);
}
