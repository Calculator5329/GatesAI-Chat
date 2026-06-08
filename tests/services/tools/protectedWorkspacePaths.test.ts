import { describe, expect, it } from 'vitest';
import {
  denyIfReferencesProtectedChatHistory,
  isProtectedChatHistoryScope,
  referencesProtectedChatHistory,
} from '../../../src/services/tools/protectedWorkspacePaths';

describe('protectedWorkspacePaths', () => {
  it('isProtectedChatHistoryScope includes .gatesai/chat and chat-history mirror paths', () => {
    expect(isProtectedChatHistoryScope('/workspace/.gatesai/chat')).toBe(true);
    expect(isProtectedChatHistoryScope('/workspace/.gatesai/chat/state.v1.json')).toBe(true);
    expect(isProtectedChatHistoryScope('/workspace/chat-history')).toBe(true);
    expect(isProtectedChatHistoryScope('/workspace/chat-history/conversations/t1.html')).toBe(true);
    expect(isProtectedChatHistoryScope('/workspace/artifacts/report.md')).toBe(false);
  });

  it('isProtectedChatHistoryScope matches individual files under protected scopes', () => {
    expect(isProtectedChatHistoryScope('/workspace/chat-history/index.html')).toBe(true);
    expect(isProtectedChatHistoryScope('chat-history/conversations/foo.md')).toBe(true);
    expect(isProtectedChatHistoryScope('/workspace/notes/diary.md')).toBe(false);
  });

  it('isProtectedChatHistoryScope is case-insensitive (Windows/macOS filesystems)', () => {
    expect(isProtectedChatHistoryScope('/workspace/Chat-History/conversations/t1.html')).toBe(true);
    expect(isProtectedChatHistoryScope('/workspace/.GatesAI/Chat/state.v1.json')).toBe(true);
    expect(isProtectedChatHistoryScope('CHAT-HISTORY/export.db')).toBe(true);
    // A folder that merely contains the token as a suffix is still allowed.
    expect(isProtectedChatHistoryScope('/workspace/my-chat-history/notes.md')).toBe(false);
  });

  it('isProtectedChatHistoryScope blocks ".." traversal into protected scopes', () => {
    expect(isProtectedChatHistoryScope('/workspace/notes/../chat-history/t1.html')).toBe(true);
    expect(isProtectedChatHistoryScope('notes/../.gatesai/chat/state.v1.json')).toBe(true);
  });

  it('referencesProtectedChatHistory detects path literals in command snippets', () => {
    expect(referencesProtectedChatHistory('cat /workspace/chat-history/conversations/t1.html')).toBe(true);
    expect(referencesProtectedChatHistory('open(".gatesai/chat/state.v1.json")')).toBe(true);
    expect(referencesProtectedChatHistory('print(open("artifacts/out.txt").read())')).toBe(false);
  });

  it('denyIfReferencesProtectedChatHistory returns a stable denial message', () => {
    const denial = denyIfReferencesProtectedChatHistory(['cat', '/workspace/chat-history/index.html']);
    expect(denial).toMatch(/chat_history/);
    expect(denyIfReferencesProtectedChatHistory(['ls', 'artifacts'])).toBeNull();
  });
});
