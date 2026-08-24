import { beforeEach, describe, expect, it } from 'vitest';
import 'fake-indexeddb/auto';
import { clearSession, loadSession, sanitizeSession, saveSession, type CopilotSession } from './session';
import type { ClaudeMessage } from './client';

const user = (text: string): ClaudeMessage => ({ role: 'user', content: text });
const assistantText = (text: string): ClaudeMessage => ({ role: 'assistant', content: [{ type: 'text', text }] });
const assistantTools = (...ids: string[]): ClaudeMessage => ({
  role: 'assistant',
  content: ids.map((id) => ({ type: 'tool_use' as const, id, name: 'add_text', input: { text: id } })),
});

function session(messages: ClaudeMessage[], pending: CopilotSession['pending'] = null): CopilotSession {
  return { version: 1, savedAt: 1, messages, items: [], pending, sentPhotoIds: ['asset_1'] };
}

beforeEach(async () => {
  await clearSession();
});

describe('sanitizeSession', () => {
  it('keeps a conversation that ended cleanly', () => {
    const s = session([user('hi'), assistantText('hello')]);
    expect(sanitizeSession(s).messages).toHaveLength(2);
  });

  it('drops a trailing assistant turn whose tool calls never got results', () => {
    const s = session([user('build'), assistantTools('t1', 't2')]);
    const out = sanitizeSession(s);
    expect(out.messages).toHaveLength(1);
    expect(out.pending).toBeNull();
  });

  it('keeps the trailing turn when a pending question holds its results', () => {
    const pending = {
      question: 'Colour?',
      askId: 'a1',
      toolResults: [{ type: 'tool_result' as const, tool_use_id: 't1', content: 'ok' }],
    };
    const msgs: ClaudeMessage[] = [
      user('build'),
      { role: 'assistant', content: [
        { type: 'tool_use', id: 't1', name: 'add_text', input: {} },
        { type: 'tool_use', id: 'a1', name: 'ask_user', input: { question: 'Colour?' } },
      ] },
    ];
    const out = sanitizeSession(session(msgs, pending));
    expect(out.messages).toHaveLength(2);
    expect(out.pending).toEqual(pending);
  });

  it('collapses two user turns in a row', () => {
    const out = sanitizeSession(session([user('a'), assistantText('b'), user('c'), user('d')]));
    expect(out.messages.map((m) => m.content)).toEqual(['a', [{ type: 'text', text: 'b' }], 'd']);
  });
});

describe('save / load / clear', () => {
  it('round-trips through IndexedDB and sanitises on the way out', async () => {
    await saveSession({ messages: [user('build'), assistantTools('t1')], items: [{ kind: 'user', text: 'build' }], pending: null, sentPhotoIds: ['asset_1'] }, 42);
    const loaded = await loadSession();
    expect(loaded?.savedAt).toBe(42);
    expect(loaded?.items).toEqual([{ kind: 'user', text: 'build' }]);
    expect(loaded?.sentPhotoIds).toEqual(['asset_1']);
    expect(loaded?.messages).toHaveLength(1); // dangling tool_use turn dropped
  });

  it('returns null when nothing is stored or the blob is junk', async () => {
    expect(await loadSession()).toBeNull();
    await saveSession({ messages: [], items: [], pending: null, sentPhotoIds: [] });
    await clearSession();
    expect(await loadSession()).toBeNull();
  });
});
