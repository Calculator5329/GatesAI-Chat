import { describe, expect, it } from 'vitest';
import {
  isWorkspacePath,
  resolveWorkspacePath,
  stripWorkspacePrefix,
} from '../../src/core/workspacePaths';

describe('isWorkspacePath', () => {
  it('matches the workspace root and paths under /workspace/', () => {
    expect(isWorkspacePath('/workspace')).toBe(true);
    expect(isWorkspacePath('/workspace/notes/foo.md')).toBe(true);
    expect(isWorkspacePath('/workspace/artifacts/pi_display.html')).toBe(true);
    expect(isWorkspacePath('/workspace/a')).toBe(true);
  });

  it('rejects non-workspace paths and edge cases', () => {
    expect(isWorkspacePath('')).toBe(false);
    expect(isWorkspacePath('/workspace/')).toBe(false);
    expect(isWorkspacePath('/workspaces/foo')).toBe(false);
    expect(isWorkspacePath('workspace/foo')).toBe(false);
    expect(isWorkspacePath('/var/log/foo')).toBe(false);
    expect(isWorkspacePath('https://example.com/workspace/x')).toBe(false);
  });

  it('rejects paths containing whitespace or control chars', () => {
    expect(isWorkspacePath('/workspace/foo bar.txt')).toBe(false);
    expect(isWorkspacePath('/workspace/foo\nbar')).toBe(false);
  });

  it('tolerates surrounding whitespace', () => {
    expect(isWorkspacePath('  /workspace/notes/foo.md  ')).toBe(true);
  });
});

describe('resolveWorkspacePath', () => {
  it('joins with a windows root using backslashes', () => {
    expect(
      resolveWorkspacePath('/workspace/artifacts/pi.html', 'C:\\Users\\me\\GatesAI\\workspace', 'windows'),
    ).toBe('C:\\Users\\me\\GatesAI\\workspace\\artifacts\\pi.html');
  });

  it('joins with a posix root using forward slashes', () => {
    expect(
      resolveWorkspacePath('/workspace/notes/foo.md', '/Users/me/GatesAI/workspace', 'darwin'),
    ).toBe('/Users/me/GatesAI/workspace/notes/foo.md');
    expect(
      resolveWorkspacePath('/workspace/notes/foo.md', '/home/me/gatesai/workspace', 'linux'),
    ).toBe('/home/me/gatesai/workspace/notes/foo.md');
  });

  it('strips trailing slashes from the root before joining', () => {
    expect(
      resolveWorkspacePath('/workspace', '/Users/me/workspace/', 'darwin'),
    ).toBe('/Users/me/workspace');
    expect(
      resolveWorkspacePath('/workspace/notes/foo.md', '/Users/me/workspace/', 'darwin'),
    ).toBe('/Users/me/workspace/notes/foo.md');
    expect(
      resolveWorkspacePath('/workspace/notes/foo.md', 'C:\\workspace\\', 'windows'),
    ).toBe('C:\\workspace\\notes\\foo.md');
  });

  it('returns null when inputs are missing or invalid', () => {
    expect(resolveWorkspacePath('/workspace/foo', undefined, 'darwin')).toBeNull();
    expect(resolveWorkspacePath('/var/log/x', '/Users/me/workspace', 'darwin')).toBeNull();
    expect(resolveWorkspacePath('/workspace/', '/Users/me/workspace', 'darwin')).toBeNull();
  });
});

describe('stripWorkspacePrefix', () => {
  it('removes the /workspace/ prefix', () => {
    expect(stripWorkspacePrefix('/workspace/notes/foo.md')).toBe('notes/foo.md');
  });

  it('returns empty string for the bare /workspace token', () => {
    expect(stripWorkspacePrefix('/workspace')).toBe('');
  });

  it('passes through unprefixed paths unchanged', () => {
    expect(stripWorkspacePrefix('notes/foo.md')).toBe('notes/foo.md');
  });
});
