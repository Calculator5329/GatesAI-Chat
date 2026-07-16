import { describe, expect, it } from 'vitest';
import {
  HTML_ARTIFACT_INDEX_PATH,
  HTML_ARTIFACT_REGISTRY_VERSION,
  HTML_ARTIFACT_ROOT,
  type HtmlArtifactIndex,
} from '../../../src/core/htmlArtifacts';
import {
  loadHtmlArtifactIndex,
  nextHtmlArtifactId,
  writeHtmlArtifactIndex,
} from '../../../src/services/artifacts/artifactRegistry';
import type { BridgeClientFacade } from '../../../src/services/tools/types';

describe('HTML artifact registry', () => {
  it('round-trips the versioned sidecar index', async () => {
    let raw = '';
    const client: BridgeClientFacade = {
      async request<T>(op: string, data: unknown): Promise<T> {
        if (op === 'fs.mkdir') return { path: HTML_ARTIFACT_ROOT } as T;
        if (op === 'fs.write') {
          raw = (data as { content: string }).content;
          return { path: HTML_ARTIFACT_INDEX_PATH, bytes: raw.length } as T;
        }
        if (op === 'fs.read') {
          return { path: HTML_ARTIFACT_INDEX_PATH, content: raw, encoding: 'utf8', size: raw.length, mime: 'application/json' } as T;
        }
        throw new Error(`unexpected ${op}`);
      },
    };
    const index: HtmlArtifactIndex = {
      version: HTML_ARTIFACT_REGISTRY_VERSION,
      artifacts: [{
        id: 'status-board-1', title: 'Status board', threadId: 't-1',
        createdAt: '2026-07-16T12:00:00.000Z', updatedAt: '2026-07-16T12:00:00.000Z',
        revision: 1, sizeBytes: 42,
      }],
    };

    await writeHtmlArtifactIndex(client, index);
    await expect(loadHtmlArtifactIndex(client, { migrate: false })).resolves.toEqual(index);
  });

  it('migrates an index-less HTML folder and persists the result', async () => {
    const writes: Array<{ path: string; content: string }> = [];
    const client: BridgeClientFacade = {
      async request<T>(op: string, data: unknown): Promise<T> {
        const request = data as { path: string; content?: string };
        if (op === 'fs.read') throw new Error('missing index');
        if (op === 'fs.list') return {
          path: HTML_ARTIFACT_ROOT,
          entries: [
            { path: `${HTML_ARTIFACT_ROOT}/weather-map-1.html`, name: 'weather-map-1.html', kind: 'file', size: 99, mtime: 1_700_000_000_000 },
            { path: `${HTML_ARTIFACT_ROOT}/notes.txt`, name: 'notes.txt', kind: 'file', size: 2, mtime: 1_700_000_000_000 },
          ],
        } as T;
        if (op === 'fs.mkdir') return { path: request.path } as T;
        if (op === 'fs.write') {
          writes.push({ path: request.path, content: request.content ?? '' });
          return { path: request.path, bytes: request.content?.length ?? 0 } as T;
        }
        throw new Error(`unexpected ${op}`);
      },
    };

    const index = await loadHtmlArtifactIndex(client, { threadId: 't-migrate' });

    expect(index.artifacts).toEqual([expect.objectContaining({
      id: 'weather-map-1', title: 'Weather Map', threadId: 't-migrate', revision: 1, sizeBytes: 99,
    })]);
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe(HTML_ARTIFACT_INDEX_PATH);
  });

  it('allocates stable slug ids without reusing an existing suffix', () => {
    const records = [1, 2].map(revision => ({
      id: `my-dashboard-${revision}`, title: 'My dashboard', threadId: 't',
      createdAt: '', updatedAt: '', revision: 1, sizeBytes: 1,
    }));
    expect(nextHtmlArtifactId('My Dashboard!', records)).toBe('my-dashboard-3');
  });

  it('does not overwrite a present but malformed index as an index-less migration', async () => {
    let wrote = false;
    const client: BridgeClientFacade = {
      async request<T>(op: string): Promise<T> {
        if (op === 'fs.read') return {
          path: HTML_ARTIFACT_INDEX_PATH,
          content: '{"version":1,"artifacts":"broken"}',
          encoding: 'utf8', size: 1, mime: 'application/json',
        } as T;
        if (op === 'fs.write') wrote = true;
        return {} as T;
      },
    };

    await expect(loadHtmlArtifactIndex(client)).rejects.toThrow('Unsupported or malformed');
    expect(wrote).toBe(false);
  });
});
