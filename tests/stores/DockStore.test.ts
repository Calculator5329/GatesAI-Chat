import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DockStore } from '../../src/stores/DockStore';

const KEY = 'gatesai.dock.v1';

let stores: DockStore[] = [];

function makeStore(runtime: 'desktop' | 'web-lite' | 'headless' = 'desktop'): DockStore {
  const store = new DockStore({ runtime });
  stores.push(store);
  return store;
}

beforeEach(() => {
  localStorage.removeItem(KEY);
});

afterEach(() => {
  for (const store of stores) store.dispose();
  stores = [];
  localStorage.removeItem(KEY);
});

describe('DockStore', () => {
  it('opens into the first empty cell, then the second, then replaces cell 0', () => {
    const dock = makeStore();
    dock.openPanel('file-viewer', { path: '/workspace/a.md' });
    expect(dock.cells[0]).toEqual({ kind: 'file-viewer', params: { path: '/workspace/a.md' } });
    expect(dock.cells[1]).toBeNull();

    dock.openPanel('media-viewer', { path: '/workspace/b.png' });
    expect(dock.cells[1]).toEqual({ kind: 'media-viewer', params: { path: '/workspace/b.png' } });

    dock.openPanel('file-viewer', { path: '/workspace/c.txt' });
    expect(dock.cells[0]).toEqual({ kind: 'file-viewer', params: { path: '/workspace/c.txt' } });
    expect(dock.cells[1]).toEqual({ kind: 'media-viewer', params: { path: '/workspace/b.png' } });
  });

  it('honors an explicit target cell and un-collapses on open', () => {
    const dock = makeStore();
    dock.setCollapsed(true);
    dock.openPanel('file-viewer', { path: '/workspace/a.md' }, 1);
    expect(dock.cells[0]).toBeNull();
    expect(dock.cells[1]?.params.path).toBe('/workspace/a.md');
    expect(dock.collapsed).toBe(false);
  });

  it('routes paths to the right panel kind via openPath', () => {
    const dock = makeStore();
    dock.openPath('/workspace/report.md');
    dock.openPath('/workspace/artifacts/images/pic.png');
    expect(dock.cells[0]?.kind).toBe('file-viewer');
    expect(dock.cells[1]?.kind).toBe('media-viewer');
  });

  it('opens the file explorer through the same persisted registry contract', () => {
    const dock = makeStore();
    dock.openPanel('file-explorer', { path: '/workspace' });
    expect(dock.cells[0]).toEqual({ kind: 'file-explorer', params: { path: '/workspace' } });
    dock.dispose();
    const restored = makeStore();
    expect(restored.cells[0]).toEqual({ kind: 'file-explorer', params: { path: '/workspace' } });
  });

  it('closing cell 0 promotes cell 1 so a lone panel sits in cell 0', () => {
    const dock = makeStore();
    dock.openPath('/workspace/a.md');
    dock.openPath('/workspace/b.png');
    dock.closeCell(0);
    expect(dock.cells[0]?.params.path).toBe('/workspace/b.png');
    expect(dock.cells[1]).toBeNull();
    dock.closeCell(0);
    expect(dock.hasOpenPanels).toBe(false);
  });

  it('swaps cells', () => {
    const dock = makeStore();
    dock.openPath('/workspace/a.md');
    dock.openPath('/workspace/b.png');
    dock.swapCells();
    expect(dock.cells[0]?.params.path).toBe('/workspace/b.png');
    expect(dock.cells[1]?.params.path).toBe('/workspace/a.md');
  });

  it('clamps split and dock ratios', () => {
    const dock = makeStore();
    dock.setSplitRatio(5);
    expect(dock.splitRatio).toBe(0.85);
    dock.setSplitRatio(-1);
    expect(dock.splitRatio).toBe(0.15);
    dock.setDockRatio(0.99);
    expect(dock.dockRatio).toBe(0.6);
    dock.setDockRatio(0.01);
    expect(dock.dockRatio).toBe(0.18);
    dock.setDockRatio(Number.NaN);
    expect(dock.dockRatio).toBe(0.32);
  });

  it('persists layout across instances (flushed on dispose)', () => {
    const first = makeStore();
    first.openPath('/workspace/a.md');
    first.setDockRatio(0.4);
    first.setCollapsed(true);
    first.dispose();

    const second = makeStore();
    expect(second.cells[0]).toEqual({ kind: 'file-viewer', params: { path: '/workspace/a.md' } });
    expect(second.dockRatio).toBe(0.4);
    expect(second.collapsed).toBe(true);
  });

  it('boots with defaults from a corrupt snapshot', () => {
    localStorage.setItem(KEY, 'garbage{{');
    const dock = makeStore();
    expect(dock.cells).toEqual([null, null]);
    expect(dock.splitRatio).toBe(0.5);
    expect(dock.dockRatio).toBe(0.32);
    expect(dock.collapsed).toBe(false);
  });

  it('is unavailable (and openPanel is a no-op) on Web Lite', () => {
    const dock = makeStore('web-lite');
    expect(dock.available).toBe(false);
    dock.openPath('/workspace/a.md');
    expect(dock.hasOpenPanels).toBe(false);
  });
});
