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
  parseHtmlArtifactIndex,
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


describe('artifact registry acquisition preservation', () => {
  const empty = { version: HTML_ARTIFACT_REGISTRY_VERSION, artifacts: [] };
  const entry = (name: string, kind = 'file', parent = HTML_ARTIFACT_ROOT) => ({ path: `${parent}/${name}`, name, kind, mtime: 1, size: 12 });
  function clientFor(list: (path: string) => unknown, content?: string) {
    const mutations: string[] = [];
    const client: BridgeClientFacade = { async request<T>(op: string, data: unknown): Promise<T> {
      const path = (data as { path: string }).path;
      if (op === 'fs.read') {
        if (content !== undefined) return { content } as T;
        throw new Error('operation_failed: temporary permission failure');
      }
      if (op === 'fs.list') return list(path) as T;
      mutations.push(op);
      return {} as T;
    } };
    return { client, mutations };
  }

  it('preserves an unreadable index when listings also fail or the index is visible', async () => {
    for (const listing of [() => { throw new Error('operation_failed'); },
      (path: string) => ({ path, entries: [entry('index.json')] })]) {
      const { client, mutations } = clientFor(listing);
      await expect(loadHtmlArtifactIndex(client)).rejects.toThrow();
      expect(mutations).toEqual([]);
    }
  });

  it.each([undefined, {}, { path: HTML_ARTIFACT_ROOT, entries: [] , truncated: true },
    { path: HTML_ARTIFACT_ROOT, entries: 'broken' },
    { path: HTML_ARTIFACT_ROOT, entries: [{ name: 'legacy.html' }] },
    { path: HTML_ARTIFACT_ROOT, entries: [entry('same.html'), entry('same.html')] },
  ])('refuses malformed or truncated listing without migration (%j)', async listing => {
    const { client, mutations } = clientFor(() => listing);
    await expect(loadHtmlArtifactIndex(client)).rejects.toThrow();
    expect(mutations).toEqual([]);
  });

  it.each(['/workspace/artifacts', '/workspace'])('initializes only after complete parent %s proves the child absent', async parent => {
    const { client, mutations } = clientFor(path => {
      if (path !== parent) throw new Error('operation_failed');
      return { path: path === '/workspace' ? '/workspace/.' : path, entries: [] };
    });
    await expect(loadHtmlArtifactIndex(client)).resolves.toEqual(empty);
    expect(mutations).toEqual(['fs.mkdir', 'fs.write']);
  });

  it('refuses when the unreadable child remains present in its parent', async () => {
    const { client, mutations } = clientFor(path => {
      if (path === HTML_ARTIFACT_ROOT) throw new Error('operation_failed');
      return { path, entries: [entry('html', 'dir', '/workspace/artifacts')] };
    });
    await expect(loadHtmlArtifactIndex(client)).rejects.toThrow('still exists');
    expect(mutations).toEqual([]);
  });

  it.each(['My Chart.html', 'chart.htm', 'chart.HTML'])('preserves noncanonical legacy filename %s', async name => {
    const { client, mutations } = clientFor(path => ({ path, entries: [entry(name)] }));
    await expect(loadHtmlArtifactIndex(client)).rejects.toThrow('Legacy HTML filenames');
    expect(mutations).toEqual([]);
  });

  it('refuses existing empty content but accepts an explicit empty registry', async () => {
    const { client, mutations } = clientFor(() => { throw new Error('unexpected listing'); }, '  ');
    await expect(loadHtmlArtifactIndex(client)).rejects.toThrow('index is empty');
    expect(mutations).toEqual([]);
    expect(parseHtmlArtifactIndex(JSON.stringify(empty))).toEqual(empty);
  });

  it('keeps confirmed indexless listing read-only when migration is disabled', async () => {
    const { client, mutations } = clientFor(path => ({ path, entries: [entry('chart-1.html')] }));
    expect((await loadHtmlArtifactIndex(client, { migrate: false })).artifacts[0].id).toBe('chart-1');
    expect(mutations).toEqual([]);
  });
});
