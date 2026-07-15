// Compact, read-only workspace browser for the right dock. Directory listing
// and file reads stay behind BridgeStore, whose bridge API enforces the
// workspace jail. This component cannot write, execute, fetch, or escape it.
import { useEffect, useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import type { FsEntry } from '../../core/workspace';
import { useBridgeStore, useDockStore } from '../../stores/context';
import { Icons } from '../ui/icons';
import type { DockPanelProps } from './panelRegistry';

const WORKSPACE_ROOT = '/workspace';

type ExplorerState =
  | { status: 'loading' }
  | { status: 'ready'; entries: FsEntry[]; truncated: boolean }
  | { status: 'error'; reason: string };

function safeDirectory(path: string | undefined): string {
  const normalized = (path ?? '').trim().replace(/\/+$/, '');
  const segments = normalized.split('/');
  const safe = !segments.some(segment => segment === '.' || segment === '..');
  return safe && (normalized === WORKSPACE_ROOT || normalized.startsWith(`${WORKSPACE_ROOT}/`))
    ? normalized
    : WORKSPACE_ROOT;
}

function parentDirectory(path: string): string | null {
  if (path === WORKSPACE_ROOT) return null;
  const parent = path.slice(0, path.lastIndexOf('/'));
  return parent.startsWith(WORKSPACE_ROOT) ? parent : WORKSPACE_ROOT;
}

function sortEntries(entries: FsEntry[]): FsEntry[] {
  return [...entries].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'dir' ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
}

export const FileExplorerPanel = observer(function FileExplorerPanel({ params, cell }: DockPanelProps) {
  const bridge = useBridgeStore();
  const dock = useDockStore();
  const [path, setPath] = useState(() => safeDirectory(params.path));
  const [reload, setReload] = useState(0);
  const [state, setState] = useState<ExplorerState>({ status: 'loading' });
  const bridgeOnline = bridge.isOnline;

  useEffect(() => {
    if (!bridgeOnline) {
      setState({ status: 'loading' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    void bridge.listWorkspaceDir(path, false).then(result => {
      if (cancelled) return;
      setState({
        status: 'ready',
        entries: sortEntries(result.entries),
        truncated: result.truncated === true,
      });
    }).catch((error: unknown) => {
      if (cancelled) return;
      setState({ status: 'error', reason: (error as Error).message || 'Directory listing failed.' });
    });
    return () => { cancelled = true; };
  }, [bridge, bridgeOnline, path, reload]);

  const crumbs = useMemo(() => {
    const relative = path.slice(WORKSPACE_ROOT.length).split('/').filter(Boolean);
    return [
      { label: 'Workspace', path: WORKSPACE_ROOT },
      ...relative.map((label, index) => ({
        label,
        path: `${WORKSPACE_ROOT}/${relative.slice(0, index + 1).join('/')}`,
      })),
    ];
  }, [path]);

  const openEntry = (entry: FsEntry): void => {
    if (entry.kind === 'dir') {
      setPath(safeDirectory(entry.path));
      return;
    }
    dock.openPath(entry.path, cell === 0 ? 1 : 0);
  };

  return (
    <div className="dock-file-explorer" data-testid="dock-file-explorer">
      <div className="dock-file-explorer__toolbar">
        <button
          type="button"
          aria-label="Parent directory"
          title="Parent directory"
          disabled={parentDirectory(path) === null}
          onClick={() => {
            const parent = parentDirectory(path);
            if (parent) setPath(parent);
          }}
        >
          <Icons.Back />
        </button>
        <div className="dock-file-explorer__crumbs" aria-label="Current directory">
          {crumbs.map((crumb, index) => (
            <span key={crumb.path}>
              {index > 0 && <i aria-hidden="true">/</i>}
              <button type="button" onClick={() => setPath(crumb.path)}>{crumb.label}</button>
            </span>
          ))}
        </div>
        <button
          type="button"
          aria-label="Refresh directory"
          title="Refresh directory"
          onClick={() => setReload(value => value + 1)}
        >
          <Icons.Refresh />
        </button>
      </div>

      {state.status === 'loading' && (
        <div className="dock-panel__notice">{bridgeOnline ? 'Loading directory...' : 'Bridge offline.'}</div>
      )}
      {state.status === 'error' && (
        <div className="dock-panel__notice" role="alert">{state.reason}</div>
      )}
      {state.status === 'ready' && state.entries.length === 0 && (
        <div className="dock-panel__notice">This folder is empty.</div>
      )}
      {state.status === 'ready' && state.entries.length > 0 && (
        <div className="dock-file-explorer__entries" role="list">
          {state.entries.map(entry => (
            <button
              type="button"
              role="listitem"
              className="dock-file-explorer__entry"
              key={`${entry.kind}:${entry.path}`}
              title={entry.path}
              onClick={() => openEntry(entry)}
            >
              <span className="dock-file-explorer__entry-icon" aria-hidden="true">
                {entry.kind === 'dir' ? <Icons.Folder /> : <Icons.FileText />}
              </span>
              <span>{entry.name}</span>
              <small>{entry.kind === 'dir' ? 'Folder' : formatSize(entry.size)}</small>
            </button>
          ))}
          {state.truncated && <div className="dock-file-explorer__truncated">Listing truncated by the workspace bridge.</div>}
        </div>
      )}
    </div>
  );
});

function formatSize(size: number | undefined): string {
  if (size == null || !Number.isFinite(size) || size < 0) return 'File';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
