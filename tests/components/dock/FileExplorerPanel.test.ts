import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider } from '../../../src/stores/context';
import { FileExplorerPanel } from '../../../src/components/dock/FileExplorerPanel';
import type { RootStore } from '../../../src/stores/RootStore';
import type { BridgeStore } from '../../../src/stores/BridgeStore';
import type { DockStore } from '../../../src/stores/DockStore';
import type { FsListResp } from '../../../src/core/workspace';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function entry(path: string, kind: 'file' | 'dir', size?: number) {
  return { path, name: path.split('/').pop() ?? path, kind, size, mtime: 1 };
}

async function renderExplorer(options: {
  initialPath?: string;
  list: (path: string) => Promise<FsListResp>;
  openPath?: (path: string, cell?: 0 | 1) => void;
  cell?: 0 | 1;
}): Promise<HTMLDivElement> {
  const bridge = {
    isOnline: true,
    listWorkspaceDir: (path: string, recursive: boolean) => {
      expect(recursive).toBe(false);
      return options.list(path);
    },
  } as unknown as BridgeStore;
  const dock = {
    openPath: options.openPath ?? vi.fn(),
  } as unknown as DockStore;
  const store = { bridge, dock } as unknown as RootStore;
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(createElement(StoreProvider, {
      store,
      children: createElement(FileExplorerPanel, {
        params: { path: options.initialPath },
        cell: options.cell,
      }),
    }));
  });
  await act(async () => {});
  return host;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.restoreAllMocks();
});

describe('FileExplorerPanel', () => {
  it('lists one jailed directory, folders first, and opens files in the other cell', async () => {
    const openPath = vi.fn();
    const list = vi.fn(async (path: string): Promise<FsListResp> => ({
      path,
      entries: [
        entry('/workspace/zeta.txt', 'file', 2048),
        entry('/workspace/notes', 'dir'),
        entry('/workspace/alpha.md', 'file', 12),
      ],
    }));
    const rendered = await renderExplorer({ list, openPath, cell: 0 });

    expect(list).toHaveBeenCalledWith('/workspace');
    const rows = [...rendered.querySelectorAll<HTMLButtonElement>('.dock-file-explorer__entry')];
    expect(rows.map(row => row.textContent)).toEqual([
      'notesFolder',
      'alpha.md12 B',
      'zeta.txt2 KB',
    ]);
    act(() => rows[1]?.click());
    expect(openPath).toHaveBeenCalledWith('/workspace/alpha.md', 1);
  });

  it('navigates folders and breadcrumbs without recursive listing', async () => {
    const list = vi.fn(async (path: string): Promise<FsListResp> => ({
      path,
      entries: path === '/workspace'
        ? [entry('/workspace/notes', 'dir')]
        : [entry('/workspace/notes/plan.md', 'file', 80)],
    }));
    const rendered = await renderExplorer({ list });

    const notes = rendered.querySelector<HTMLButtonElement>('.dock-file-explorer__entry');
    await act(async () => { notes?.click(); });
    await act(async () => {});
    expect(list).toHaveBeenLastCalledWith('/workspace/notes');
    expect(rendered.querySelector('[aria-label="Current directory"]')?.textContent).toBe('Workspace/notes');

    const workspace = [...rendered.querySelectorAll<HTMLButtonElement>('.dock-file-explorer__crumbs button')]
      .find(button => button.textContent === 'Workspace');
    await act(async () => { workspace?.click(); });
    await act(async () => {});
    expect(list).toHaveBeenLastCalledWith('/workspace');
  });

  it('clamps an unsafe persisted path and renders bridge errors in place', async () => {
    const list = vi.fn(async () => { throw new Error('jailed listing unavailable'); });
    const rendered = await renderExplorer({ initialPath: '/workspace/../../etc', list });

    expect(list).toHaveBeenCalledWith('/workspace');
    expect(rendered.querySelector('[role="alert"]')?.textContent).toContain('jailed listing unavailable');
  });

  it('shows the bridge truncation signal', async () => {
    const rendered = await renderExplorer({
      list: async path => ({ path, entries: [entry('/workspace/a.txt', 'file')], truncated: true }),
    });
    expect(rendered.textContent).toContain('Listing truncated by the workspace bridge.');
  });
});
