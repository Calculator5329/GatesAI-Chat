import { describe, expect, it, vi } from 'vitest';
import {
  loadLibraryDocument,
  normalizeLibraryPath,
  sourceKindForPath,
  workspacePathFromAbsolute,
} from '../../../src/services/library/librarySourceService';
import type { BridgeClientFacade } from '../../../src/services/tools/types';

describe('library source service', () => {
  it('accepts only supported workspace files and converts picked paths', () => {
    expect(normalizeLibraryPath('notes/guide.md')).toBe('/workspace/notes/guide.md');
    expect(sourceKindForPath('/workspace/data/app.sqlite')).toBe('database');
    expect(workspacePathFromAbsolute('/data/gates/notes/guide.md', '/data/gates')).toBe('/workspace/notes/guide.md');
    expect(workspacePathFromAbsolute('/data/other/guide.md', '/data/gates')).toBeNull();
    expect(workspacePathFromAbsolute('/DATA/GATES/notes/guide.md', '/data/gates')).toBeNull();
    expect(workspacePathFromAbsolute('C:\\DATA\\notes\\guide.md', 'c:\\data', 'win32')).toBe('/workspace/notes/guide.md');
    expect(() => normalizeLibraryPath('../secret.md')).toThrow('cannot contain');
    expect(() => normalizeLibraryPath('image.png')).toThrow('Supported library files');
  });

  it('loads bounded text through the jailed bridge', async () => {
    const request = vi.fn(async <T,>(op: string): Promise<T> => {
      const result = op === 'fs.stat'
        ? { path: '/workspace/notes/guide.md', kind: 'file', size: 12, mtime: 123 }
        : { path: '/workspace/notes/guide.md', content: '# Guide', encoding: 'utf8', size: 7, mime: 'text/markdown' };
      return result as T;
    }) as BridgeClientFacade['request'];
    const loaded = await loadLibraryDocument({ request }, {
      id: 'guide', path: '/workspace/notes/guide.md', title: 'Guide', kind: 'document',
    });
    expect(loaded.document.text).toBe('# Guide');
    expect(loaded.document.updatedAt).toBe(123);
  });

  it('opens SQLite schema read-only and never exposes rows', async () => {
    const request = vi.fn(async <T,>(op: string, data: unknown): Promise<T> => {
      if (op === 'fs.stat') return { path: '/workspace/data/app.db', kind: 'file', size: 100, mtime: 456 } as T;
      expect(op).toBe('exec.run');
      expect(JSON.stringify(data)).toContain('mode=ro');
      expect(JSON.stringify(data)).not.toContain('SELECT *');
      return {
        exit_code: 0, duration_ms: 4, stderr: '',
        stdout: JSON.stringify({ objects: [['table', 'projects', 'projects', 'CREATE TABLE projects (id TEXT)']] }),
      } as T;
    }) as BridgeClientFacade['request'];
    const loaded = await loadLibraryDocument({ request }, {
      id: 'db', path: '/workspace/data/app.db', title: 'App data', kind: 'database',
    });
    expect(loaded.document.text).toContain('CREATE TABLE projects');
    expect(loaded.document.text).not.toContain('rows:');
  });
});
