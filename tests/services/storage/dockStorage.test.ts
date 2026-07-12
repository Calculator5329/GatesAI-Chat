import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_DOCK_SNAPSHOT } from '../../../src/core/dock';
import { clearDockSnapshot, loadDockSnapshot, saveDockSnapshot } from '../../../src/services/storage/dockStorage';

const KEY = 'gatesai.dock.v1';

describe('dockStorage', () => {
  beforeEach(() => {
    localStorage.removeItem(KEY);
  });

  it('loads defaults when nothing is persisted', () => {
    expect(loadDockSnapshot()).toEqual(DEFAULT_DOCK_SNAPSHOT);
  });

  it('round-trips a full snapshot', () => {
    saveDockSnapshot({
      version: 1,
      cells: [
        { kind: 'file-viewer', params: { path: '/workspace/readme.md' } },
        { kind: 'media-viewer', params: { path: '/workspace/artifacts/images/a.png' } },
      ],
      splitRatio: 0.4,
      dockRatio: 0.3,
      collapsed: true,
    });
    expect(loadDockSnapshot()).toEqual({
      version: 1,
      cells: [
        { kind: 'file-viewer', params: { path: '/workspace/readme.md' } },
        { kind: 'media-viewer', params: { path: '/workspace/artifacts/images/a.png' } },
      ],
      splitRatio: 0.4,
      dockRatio: 0.3,
      collapsed: true,
    });
  });

  it('falls back to defaults on unparseable JSON', () => {
    localStorage.setItem(KEY, '{not json at all');
    expect(loadDockSnapshot()).toEqual(DEFAULT_DOCK_SNAPSHOT);
  });

  it('falls back to defaults on an unknown snapshot version', () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 99, cells: [{ kind: 'file-viewer', params: {} }, null] }));
    expect(loadDockSnapshot()).toEqual(DEFAULT_DOCK_SNAPSHOT);
  });

  it('drops cells with unknown panel kinds and clamps ratios', () => {
    localStorage.setItem(KEY, JSON.stringify({
      version: 1,
      cells: [{ kind: 'terminal', params: {} }, { kind: 'media-viewer', params: { path: 42 } }],
      splitRatio: 12,
      dockRatio: -3,
      collapsed: 'yes',
    }));
    const snapshot = loadDockSnapshot();
    expect(snapshot.cells[0]).toBeNull();
    expect(snapshot.cells[1]).toEqual({ kind: 'media-viewer', params: {} });
    expect(snapshot.splitRatio).toBeLessThanOrEqual(0.85);
    expect(snapshot.dockRatio).toBeGreaterThanOrEqual(0.18);
    expect(snapshot.collapsed).toBe(false);
  });

  it('clears the slot', () => {
    saveDockSnapshot({ ...DEFAULT_DOCK_SNAPSHOT, collapsed: true });
    clearDockSnapshot();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(loadDockSnapshot()).toEqual(DEFAULT_DOCK_SNAPSHOT);
  });
});
