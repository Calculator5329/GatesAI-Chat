// Registry mapping dock panel kinds to their title, icon, and component —
// the same registration shape as the tool registry: one line per panel.
// Rendered by DockPanel; panels resolve their own data through store facades.
import type { ComponentType, ReactNode } from 'react';
import type { DockPanelKind, DockPanelRef } from '../../core/dock';
import { dockFileName } from '../../core/dock';
import { Icons } from '../ui/icons';
import { FileViewerPanel } from './FileViewerPanel';
import { FileExplorerPanel } from './FileExplorerPanel';
import { MediaViewerPanel } from './MediaViewerPanel';
import { HtmlArtifactPanel } from './HtmlArtifactPanel';
import { TaskCenterPanel } from './TaskCenterPanel';

export interface DockPanelProps {
  params: DockPanelRef['params'];
  cell?: 0 | 1;
}

export interface DockPanelDefinition {
  kind: DockPanelKind;
  title: string;
  icon: () => ReactNode;
  Component: ComponentType<DockPanelProps>;
  /** Panels that read through the bridge are unavailable on Web Lite. */
  requiresBridge: boolean;
}

const PANELS: Record<DockPanelKind, DockPanelDefinition> = {
  'file-viewer': {
    kind: 'file-viewer',
    title: 'File viewer',
    icon: () => <Icons.FileText />,
    Component: FileViewerPanel,
    requiresBridge: true,
  },
  'file-explorer': {
    kind: 'file-explorer',
    title: 'File explorer',
    icon: () => <Icons.Folder />,
    Component: FileExplorerPanel,
    requiresBridge: true,
  },
  'media-viewer': {
    kind: 'media-viewer',
    title: 'Media viewer',
    icon: () => <Icons.Image />,
    Component: MediaViewerPanel,
    requiresBridge: true,
  },
  'html-artifact': {
    kind: 'html-artifact',
    title: 'HTML artifact',
    icon: () => <Icons.FileText />,
    Component: HtmlArtifactPanel,
    requiresBridge: true,
  },
  'task-center': {
    kind: 'task-center',
    title: 'Task center',
    icon: () => <Icons.Clock />,
    Component: TaskCenterPanel,
    requiresBridge: false,
  },
};

export function getDockPanelDefinition(kind: string): DockPanelDefinition | undefined {
  return (PANELS as Record<string, DockPanelDefinition>)[kind];
}

export function listDockPanelDefinitions(): DockPanelDefinition[] {
  return Object.values(PANELS);
}

/** Header label for an open panel: the file name when present, else the panel title. */
export function dockCellTitle(ref: DockPanelRef): string {
  if (ref.params.path && ref.kind !== 'file-explorer') return dockFileName(ref.params.path);
  return getDockPanelDefinition(ref.kind)?.title ?? ref.kind;
}
