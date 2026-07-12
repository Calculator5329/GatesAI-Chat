import { describe, expect, it } from 'vitest';
import {
  dockCellTitle,
  getDockPanelDefinition,
  listDockPanelDefinitions,
} from '../../../src/components/dock/panelRegistry';
import { FileViewerPanel } from '../../../src/components/dock/FileViewerPanel';
import { MediaViewerPanel } from '../../../src/components/dock/MediaViewerPanel';

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

  it('lists every registered panel', () => {
    const kinds = listDockPanelDefinitions().map(def => def.kind);
    expect(kinds).toEqual(['file-viewer', 'media-viewer']);
  });

  it('titles a cell by file name when a path is present, else by panel title', () => {
    expect(dockCellTitle({ kind: 'file-viewer', params: { path: '/workspace/notes/plan.md' } })).toBe('plan.md');
    expect(dockCellTitle({ kind: 'media-viewer', params: {} })).toBe('Media viewer');
  });
});
