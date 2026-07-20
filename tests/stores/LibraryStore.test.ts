import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LibraryStore } from '../../src/stores/LibraryStore';
import { LIBRARY_STORAGE_KEY } from '../../src/services/library/libraryStorage';
import type { BridgeStore } from '../../src/stores/BridgeStore';
import { clearAppStorage } from '../helpers/storage';

beforeEach(() => clearAppStorage());

function bridge(): BridgeStore {
  return {
    isOnline: true,
    workspaceRoot: '/data/gates',
    client: {
      request: vi.fn(async (op: string) => {
        if (op === 'fs.stat') return { path: '/workspace/notes/guide.md', kind: 'file', size: 12, mtime: 123 };
        return { path: '/workspace/notes/guide.md', content: '# Guide', encoding: 'utf8', size: 7, mime: 'text/markdown' };
      }),
    },
  } as unknown as BridgeStore;
}

describe('LibraryStore', () => {
  it('adds, loads, persists, disables, and re-enables a workspace source', async () => {
    const changed = vi.fn();
    const store = new LibraryStore(bridge(), { storage: localStorage, onChanged: changed });
    expect(await store.addPath('notes/guide.md')).toBe(true);
    expect(store.readyCount).toBe(1);
    expect(store.documents.get(store.sources[0].id)?.text).toBe('# Guide');
    expect(localStorage.getItem(LIBRARY_STORAGE_KEY)).toContain('/workspace/notes/guide.md');

    store.setEnabled(store.sources[0].id, false);
    expect(store.documents.size).toBe(0);
    expect(store.sources).toHaveLength(1);
    store.setEnabled(store.sources[0].id, true);
    await vi.waitFor(() => expect(store.readyCount).toBe(1));
    expect(changed).toHaveBeenCalled();
  });

  it('rejects picker files outside the workspace', async () => {
    const store = new LibraryStore(bridge(), { pickFile: async () => '/private/secret.md' });
    expect(await store.pickAndAdd()).toBe(false);
    expect(store.lastError).toContain('inside the current GatesAI workspace');
  });
});
