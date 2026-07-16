import { describe, expect, it } from 'vitest';
import { HTML_ARTIFACT_INDEX_PATH } from '../../src/core/htmlArtifacts';
import { ArtifactStore } from '../../src/stores/ArtifactStore';
import type { BridgeClientFacade } from '../../src/services/tools/types';

describe('ArtifactStore', () => {
  it('loads and sorts the registry by most recently updated', async () => {
    const client: BridgeClientFacade = {
      async request<T>(op: string): Promise<T> {
        if (op !== 'fs.read') throw new Error(`unexpected ${op}`);
        return {
          path: HTML_ARTIFACT_INDEX_PATH,
          encoding: 'utf8',
          size: 1,
          mime: 'application/json',
          content: JSON.stringify({
            version: 1,
            artifacts: [
              { id: 'old-1', title: 'Old', threadId: 't', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', revision: 1, sizeBytes: 1 },
              { id: 'new-1', title: 'New', threadId: 't', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-07-16T00:00:00.000Z', revision: 2, sizeBytes: 2 },
            ],
          }),
        } as T;
      },
    };
    const store = new ArtifactStore({ isOnline: true, client });

    await store.refresh();

    expect(store.artifacts.map(record => record.id)).toEqual(['new-1', 'old-1']);
    expect(store.findById('new-1')?.revision).toBe(2);
    expect(store.pathFor('new-1')).toBe('/workspace/artifacts/html/new-1.html');
  });

  it('does not touch the bridge while offline', async () => {
    let called = false;
    const store = new ArtifactStore({
      isOnline: false,
      client: { request: async <T>() => { called = true; return {} as T; } },
    });
    await store.refresh();
    expect(called).toBe(false);
  });
});
