import { describe, expect, it } from 'vitest';
import {
  dockCellTitle,
  getDockPanelDefinition,
  listDockPanelDefinitions,
} from '../../../src/components/dock/panelRegistry';
import { FileViewerPanel } from '../../../src/components/dock/FileViewerPanel';
import { FileExplorerPanel } from '../../../src/components/dock/FileExplorerPanel';
import { MediaViewerPanel } from '../../../src/components/dock/MediaViewerPanel';
import { OfflineLibraryPanel } from '../../../src/components/dock/OfflineLibraryPanel';
import { HtmlArtifactPanel } from '../../../src/components/dock/HtmlArtifactPanel';

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

  it('resolves the jailed file explorer definition', () => {
    const def = getDockPanelDefinition('file-explorer');
    expect(def?.title).toBe('File explorer');
    expect(def?.Component).toBe(FileExplorerPanel);
    expect(def?.requiresBridge).toBe(true);
  });

  it('resolves the registry-backed HTML artifact panel', () => {
    const def = getDockPanelDefinition('html-artifact');
    expect(def?.title).toBe('HTML artifact');
    expect(def?.Component).toBe(HtmlArtifactPanel);
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
    expect(kinds).toEqual(['file-viewer', 'file-explorer', 'media-viewer', 'html-artifact', 'offline-library']);
  });

  it('titles a cell by file name when a path is present, else by panel title', () => {
    expect(dockCellTitle({ kind: 'file-viewer', params: { path: '/workspace/notes/plan.md' } })).toBe('plan.md');
    expect(dockCellTitle({ kind: 'media-viewer', params: {} })).toBe('Media viewer');
    expect(dockCellTitle({ kind: 'file-explorer', params: { path: '/workspace' } })).toBe('File explorer');
    expect(dockCellTitle({ kind: 'offline-library', params: {} })).toBe('Knowledge benchmarks');
    expect(dockCellTitle({ kind: 'html-artifact', params: { id: 'demo-1' } })).toBe('HTML artifact');
  });
});
