import { describe, expect, it } from 'vitest';
import {
  dockCellTitle,
  getDockPanelDefinition,
  listDockPanelDefinitions,
} from '../../../src/components/dock/panelRegistry';
import { FileViewerPanel } from '../../../src/components/dock/FileViewerPanel';
import { MediaViewerPanel } from '../../../src/components/dock/MediaViewerPanel';
import { OfflineLibraryPanel } from '../../../src/components/dock/OfflineLibraryPanel';

describe('dock panelRegistry', () => {
  it('resolves the file viewer definition', () => {
    const def = getDockPanelDefinition('file-viewer');
    expect(def?.kind).toBe('file-viewer');
    expect(def?.title).toBe('File viewer');
    expect(def?.Component).toBe(FileViewerPanel);
    expect(def?.requiresBridge).toBe(true);
  });

  it('resolves the media viewer definition', () => {
    const def = getDockPanelDefinition('media-viewer');
    expect(def?.kind).toBe('media-viewer');
    expect(def?.title).toBe('Media viewer');
    expect(def?.Component).toBe(MediaViewerPanel);
    expect(def?.requiresBridge).toBe(true);
  });

  it('returns undefined for unknown kinds', () => {
    expect(getDockPanelDefinition('terminal')).toBeUndefined();
    expect(getDockPanelDefinition('')).toBeUndefined();
  });

  it('resolves the bridge-independent Offline Library panel', () => {
    const def = getDockPanelDefinition('offline-library');
    expect(def?.title).toBe('Knowledge benchmarks');
    expect(def?.Component).toBe(OfflineLibraryPanel);
    expect(def?.requiresBridge).toBe(false);
  });

  it('lists every registered panel', () => {
    const kinds = listDockPanelDefinitions().map(def => def.kind);
    expect(kinds).toEqual(['file-viewer', 'media-viewer', 'offline-library']);
  });

  it('titles a cell by file name when a path is present, else by panel title', () => {
    expect(dockCellTitle({ kind: 'file-viewer', params: { path: '/workspace/notes/plan.md' } })).toBe('plan.md');
    expect(dockCellTitle({ kind: 'media-viewer', params: {} })).toBe('Media viewer');
    expect(dockCellTitle({ kind: 'offline-library', params: {} })).toBe('Knowledge benchmarks');
  });
});
