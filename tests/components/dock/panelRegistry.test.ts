import { describe, expect, it } from 'vitest';
import {
  dockCellTitle,
  getDockPanelDefinition,
  listDockPanelDefinitions,
} from '../../../src/components/dock/panelRegistry';
import { FileViewerPanel } from '../../../src/components/dock/FileViewerPanel';
import { FileExplorerPanel } from '../../../src/components/dock/FileExplorerPanel';
import { MediaViewerPanel } from '../../../src/components/dock/MediaViewerPanel';
import { HtmlArtifactPanel } from '../../../src/components/dock/HtmlArtifactPanel';
import { TaskCenterPanel } from '../../../src/components/dock/TaskCenterPanel';

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

  it('resolves the bridge-independent task center panel', () => {
    const def = getDockPanelDefinition('task-center');
    expect(def?.title).toBe('Task center');
    expect(def?.Component).toBe(TaskCenterPanel);
    expect(def?.requiresBridge).toBe(false);
  });

  it('lists every registered panel', () => {
    const kinds = listDockPanelDefinitions().map(def => def.kind);
    expect(kinds).toEqual(['file-viewer', 'file-explorer', 'media-viewer', 'html-artifact', 'task-center']);
  });

  it('titles a cell by file name when a path is present, else by panel title', () => {
    expect(dockCellTitle({ kind: 'file-viewer', params: { path: '/workspace/notes/plan.md' } })).toBe('plan.md');
    expect(dockCellTitle({ kind: 'media-viewer', params: {} })).toBe('Media viewer');
    expect(dockCellTitle({ kind: 'file-explorer', params: { path: '/workspace' } })).toBe('File explorer');
    expect(dockCellTitle({ kind: 'html-artifact', params: { id: 'demo-1' } })).toBe('HTML artifact');
    expect(dockCellTitle({ kind: 'task-center', params: {} })).toBe('Task center');
  });
});
