import { describe, expect, it, vi } from 'vitest';
import { isToolFailureContent, safeJsonPreview, logToolCallFailure } from '../../../src/services/chat/toolFailureLog';

describe('tool failure logging helpers', () => {
  it('detects explicit tool errors and non-zero terminal/git exits', () => {
    expect(isToolFailureContent('memory', 'Error: nope')).toBe(true);
    expect(isToolFailureContent('terminal', '$ npm test\n[exit 1]\nfailed')).toBe(true);
    expect(isToolFailureContent('git', '$ git status\n[exit 2]\nfailed')).toBe(true);
    expect(isToolFailureContent('notes', 'Saved note')).toBe(false);
  });

  it('redacts sensitive or large arguments in previews', () => {
    const preview = safeJsonPreview({
      path: '/workspace/file.txt',
      content: 'super secret payload',
      nested: { apiKey: 'abc123' },
    });

    expect(preview).toContain('/workspace/file.txt');
    expect(preview).toContain('[redacted 20 chars]');
    expect(preview).toContain('[redacted 6 chars]');
    expect(preview).not.toContain('super secret payload');
    expect(preview).not.toContain('abc123');
  });

  it('logs a structured warning for failed tool calls', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    logToolCallFailure({
      call: { id: 'call-1', name: 'terminal', arguments: { cmd: 'npm', stdin: 'hidden' } },
      threadId: 'thread-1',
      content: '$ npm test\n[exit 1]\nfailed',
      startedAt: Date.now(),
      bridgeOnline: true,
      readOnly: false,
    });

    expect(warn).toHaveBeenCalledWith('[tool-call-failed]', expect.objectContaining({
      toolName: 'terminal',
      toolCallId: 'call-1',
      threadId: 'thread-1',
      bridgeOnline: true,
      readOnly: false,
    }));
    warn.mockRestore();
  });
});
