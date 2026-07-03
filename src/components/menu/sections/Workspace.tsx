// Renders the Workspace menu section and the controls for its store-backed workflow.
// Called by GatesMenu; depends on MobX stores, bridge services, and shared UI primitives.
// Invariant: menu components present state and delegate side effects to stores/services.
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { useBridgeStore, useSourceWorkspaceStore } from '../../../stores/context';
import type { FsEntry, FsListResp } from '../../../core/workspace';
import { Card } from '../../ui/Card';
import { WebLiteNotice } from '../../ui/WebLiteNotice';
import { isTauri, isWebLite } from '../../../core/runtime';
import { tokens } from '../../../core/styleTokens';
import type { SourceWorkspaceStatus } from '../../../stores/SourceWorkspaceStore';
import type { SourceBuildCommand, SourceBuildStatus } from '../../../stores/SourceWorkspaceStore';

export const WorkspaceSection = observer(function WorkspaceSection() {
  const bridge = useBridgeStore();
  const source = useSourceWorkspaceStore();
  const webLite = isWebLite();
  const [tree, setTree] = useState<FsListResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceStatus, setSourceStatus] = useState<SourceWorkspaceStatus | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [buildStatus, setBuildStatus] = useState<SourceBuildStatus | null>(null);
  const [buildLoading, setBuildLoading] = useState(false);
  const [buildError, setBuildError] = useState<string | null>(null);

  const refresh = async () => {
    setError(null);
    if (!bridge.isOnline) { setTree(null); return; }
    setLoading(true);
    try {
      const resp = await bridge.listWorkspaceDir('/workspace', true);
      setTree(resp);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh closes over bridge client state; bridge.state is the only intended trigger.
  }, [bridge.state]);
  useEffect(() => {
    if (webLite || !isTauri()) return;
    void refreshSourceWorkspace();
    void refreshSourceBuild();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- these probes are Tauri-only boot checks, not reactive subscriptions to their local helpers.
  }, [webLite]);

  useEffect(() => {
    if (webLite || !isTauri() || buildStatus?.status !== 'running') return;
    const timer = setInterval(() => { void refreshSourceBuild(); }, 1500);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- polling cadence is keyed to build status; refreshSourceBuild only refreshes that status.
  }, [webLite, buildStatus?.status]);

  const refreshSourceWorkspace = async () => {
    setSourceError(null);
    if (webLite || !isTauri()) {
      setSourceStatus(null);
      return;
    }
    setSourceLoading(true);
    try {
      setSourceStatus(await source.status());
    } catch (err) {
      setSourceError((err as Error).message);
    } finally {
      setSourceLoading(false);
    }
  };

  const prepareSource = async () => {
    setSourceError(null);
    setSourceLoading(true);
    try {
      setSourceStatus(await source.prepare());
    } catch (err) {
      setSourceError((err as Error).message);
    } finally {
      setSourceLoading(false);
    }
  };

  const openSource = async () => {
    setSourceError(null);
    try {
      await source.open();
    } catch (err) {
      setSourceError((err as Error).message);
    }
  };

  const refreshSourceBuild = async () => {
    setBuildError(null);
    if (webLite || !isTauri()) {
      setBuildStatus(null);
      return;
    }
    try {
      setBuildStatus(await source.buildStatus());
    } catch (err) {
      setBuildError((err as Error).message);
    }
  };

  const startBuild = async (command: SourceBuildCommand) => {
    setBuildError(null);
    setBuildLoading(true);
    try {
      setBuildStatus(await source.startBuild(command));
    } catch (err) {
      setBuildError((err as Error).message);
    } finally {
      setBuildLoading(false);
    }
  };

  const clearBuild = async () => {
    setBuildError(null);
    setBuildLoading(true);
    try {
      setBuildStatus(await source.clearBuild());
    } catch (err) {
      setBuildError((err as Error).message);
    } finally {
      setBuildLoading(false);
    }
  };

  if (webLite) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <WebLiteNotice show={webLite}>
          <strong style={{ color: 'var(--text)' }}>Web Lite:</strong>{' '}
          the local /workspace bridge isn't available in the browser build. Chats and settings are saved in this browser.
        </WebLiteNotice>
        <Card>
          <div style={S.label}>Desktop-only workspace capabilities</div>
          <div style={{ ...S.sub, marginTop: 8, lineHeight: 1.6 }}>
            The installed desktop app connects to a local bridge that unlocks the
            features this section manages:
          </div>
          <ul style={{ margin: '12px 0 0', paddingLeft: 18, color: 'var(--text-dim)', fontSize: 12.5, lineHeight: 1.7 }}>
            <li>Workspace file browser — <code style={S.inlineCode}>attachments/</code>, <code style={S.inlineCode}>notes/</code>, <code style={S.inlineCode}>artifacts/</code></li>
            <li>Terminal, Python, SQLite, and Git tools over your files</li>
            <li>Source workspace snapshot + build / test / package runner</li>
            <li>Local image generation (ComfyUI) and local LLMs (Ollama)</li>
          </ul>
          <div style={{ ...S.sub, marginTop: 12 }}>
            A future cloud backend can add server-side tools and hosted artifact
            storage to the web app without a local bridge.
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Bridge status */}
      <Card>
        <div style={S.row}>
          <span style={S.dot(bridge.state === 'online' ? '#5fbf7a' : bridge.state === 'offline' ? '#c96a6a' : 'var(--text-faint)')} />
          <div style={{ flex: 1 }}>
            <div style={S.label}>{bridge.state === 'online' ? 'Bridge online' : bridge.state === 'offline' ? 'Bridge offline' : 'Checking…'}</div>
            <div style={S.sub}>
              {bridge.state === 'online'
                ? `${bridge.version ?? 'unknown'} · ${bridge.platform ?? '—'}`
                : bridge.lastError ?? 'No connection yet.'}
            </div>
          </div>
          <button type="button" className="workspace-action-button" onClick={() => { void bridge.poll(); }} style={S.btn}>Re-poll</button>
        </div>
      </Card>

      {/* Workspace root */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={S.label}>Workspace root</div>
          <button
            type="button"
            className="workspace-action-button"
            onClick={() => { void bridge.openWorkspacePath('/workspace'); }}
            disabled={!bridge.isOnline}
            title={bridge.isOnline ? 'Open the workspace folder' : 'Bridge must be online to open the workspace.'}
            style={S.btn}
          >
            Open workspace
          </button>
        </div>
        <div style={S.code}>{bridge.workspaceRoot ?? '— (offline)'}</div>
        <div style={{ ...S.sub, marginTop: 8 }}>
          Three folders inside this root: <code style={S.inlineCode}>attachments/</code> (your uploads), <code style={S.inlineCode}>notes/</code> (model scratchpad), <code style={S.inlineCode}>artifacts/</code> (final outputs).
        </div>
      </Card>

      <SourceWorkspaceCard
        status={sourceStatus}
        loading={sourceLoading}
        error={sourceError}
        unavailable={webLite || !isTauri()}
        onPrepare={prepareSource}
        onRefresh={refreshSourceWorkspace}
        onOpen={openSource}
      />

      <SourceBuildCard
        status={buildStatus}
        sourcePrepared={Boolean(sourceStatus?.prepared)}
        loading={buildLoading}
        error={buildError}
        unavailable={webLite || !isTauri()}
        onStart={startBuild}
        onRefresh={refreshSourceBuild}
        onClear={clearBuild}
      />

      {/* Allowlist */}
      <Card>
        <div style={S.label}>Allowlisted commands</div>
        <div style={{ ...S.sub, marginBottom: 10 }}>
          Edit <code style={S.inlineCode}>~/.gatesai/bridge.json</code> and restart the bridge to add more.
        </div>
        {bridge.allowlist.length === 0 ? (
          <div style={S.empty}>No allowlist yet (bridge offline).</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {bridge.allowlist.map(cmd => (
              <span key={cmd} style={S.cmdChip}>{cmd}</span>
            ))}
          </div>
        )}
      </Card>

      {/* File explorer */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <div style={S.label}>Workspace contents</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="workspace-action-button"
              onClick={() => { void bridge.openWorkspacePath('/workspace'); }}
              disabled={!bridge.isOnline}
              title={bridge.isOnline ? 'Open the workspace folder' : 'Bridge must be online to open the workspace.'}
              style={S.btn}
            >
              Open workspace
            </button>
            <button type="button" className="workspace-action-button" onClick={() => { void refresh(); }} style={S.btn}>
              {loading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
        {error && <div style={{ ...S.empty, color: '#c96a6a' }}>{error}</div>}
        {loading && !tree && <div style={S.empty}>Loading…</div>}
        {!error && tree && (
          tree.entries.length === 0
            ? <div style={S.empty}>Workspace is empty.</div>
            : <FileExplorer entries={tree.entries} truncated={tree.truncated} />
        )}
        {!loading && !error && !tree && <div style={S.empty}>Bridge offline.</div>}
      </Card>
    </div>
  );
});

function SourceWorkspaceCard({
  status,
  loading,
  error,
  unavailable,
  onPrepare,
  onRefresh,
  onOpen,
}: {
  status: SourceWorkspaceStatus | null;
  loading: boolean;
  error: string | null;
  unavailable: boolean;
  onPrepare: () => void;
  onRefresh: () => void;
  onOpen: () => void;
}) {
  const ready = Boolean(status?.available && status.prepared && !status.stale);
  const needsPrepare = Boolean(status?.available && (!status.prepared || status.stale));
  const statusText = unavailable
    ? 'Desktop app only'
    : !status
      ? 'Not checked'
      : !status.available
        ? 'Snapshot unavailable'
        : ready
          ? 'Prepared'
          : status.stale
            ? 'Update available'
            : 'Not prepared';

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={S.label}>Source workspace</div>
          <div style={S.sub}>Managed duplicate codebase for future self-update work.</div>
        </div>
        <span style={S.statusChip(ready ? '#5fbf7a' : needsPrepare ? '#c8b87e' : 'var(--text-faint)')}>
          {statusText}
        </span>
      </div>

      <div style={{ ...S.code, marginTop: 12 }}>
        {status?.sourceRoot || '—'}
      </div>
      {status?.available && (
        <div style={{ ...S.sub, marginTop: 8 }}>
          {status.version ?? 'unknown version'} · {shortHash(status.contentHash)} · {formatSize(status.totalBytes ?? 0)} · {status.fileCount ?? 0} files
          {status.preparedAtUnix ? ` · prepared ${new Date(status.preparedAtUnix * 1000).toLocaleString()}` : ''}
        </div>
      )}
      {(error || status?.lastError) && (
        <div style={{ ...S.empty, color: '#c96a6a', marginTop: 8 }}>{error ?? status?.lastError}</div>
      )}
      {unavailable && (
        <div style={{ ...S.empty, marginTop: 8 }}>Source workspace controls are available in the installed desktop app.</div>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" className="workspace-action-button" onClick={onPrepare} disabled={unavailable || loading || !status?.available} style={S.btn}>
          {loading ? 'Working…' : status?.stale ? 'Refresh source' : 'Prepare source'}
        </button>
        <button type="button" className="workspace-action-button" onClick={onOpen} disabled={unavailable || !status?.prepared} style={S.btn}>Open source</button>
        <button type="button" className="workspace-action-button" onClick={onRefresh} disabled={unavailable || loading} style={S.btn}>Refresh</button>
      </div>
    </Card>
  );
}

function SourceBuildCard({
  status,
  sourcePrepared,
  loading,
  error,
  unavailable,
  onStart,
  onRefresh,
  onClear,
}: {
  status: SourceBuildStatus | null;
  sourcePrepared: boolean;
  loading: boolean;
  error: string | null;
  unavailable: boolean;
  onStart: (command: SourceBuildCommand) => void;
  onRefresh: () => void;
  onClear: () => void;
}) {
  const running = status?.status === 'running';
  const disabled = unavailable || loading || running || !sourcePrepared;
  const chipColor = status?.status === 'succeeded'
    ? '#5fbf7a'
    : status?.status === 'failed'
      ? '#c96a6a'
      : running
        ? '#c8b87e'
        : 'var(--text-faint)';

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={S.label}>Source build runner</div>
          <div style={S.sub}>Run approved validation and packaging commands in the duplicate source.</div>
        </div>
        <span style={S.statusChip(chipColor)}>{status?.status ?? 'idle'}</span>
      </div>

      <div style={{ ...S.sub, marginTop: 10 }}>
        {status?.cmdline ?? 'No build job has run yet.'}
        {status?.exitCode != null ? ` · exit ${status.exitCode}` : ''}
      </div>
      {status?.installerPath && (
        <div style={{ ...S.code, marginTop: 8 }}>
          installer: {status.installerPath} {status.installerBytes ? `(${formatSize(status.installerBytes)})` : ''}
        </div>
      )}
      {(error || status?.lastError) && (
        <div style={{ ...S.empty, color: '#c96a6a', marginTop: 8 }}>{error ?? status?.lastError}</div>
      )}
      {!sourcePrepared && !unavailable && (
        <div style={{ ...S.empty, marginTop: 8 }}>Prepare the source workspace before running builds.</div>
      )}
      {status?.logs?.length ? (
        <pre style={S.logTail}>{status.logs.slice(-12).join('\n')}</pre>
      ) : null}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" className="workspace-action-button" onClick={() => onStart('install')} disabled={disabled} style={S.btn}>Install deps</button>
        <button type="button" className="workspace-action-button" onClick={() => onStart('test')} disabled={disabled} style={S.btn}>Test</button>
        <button type="button" className="workspace-action-button" onClick={() => onStart('build')} disabled={disabled} style={S.btn}>Build</button>
        <button type="button" className="workspace-action-button" onClick={() => onStart('package')} disabled={disabled} style={S.btn}>Package</button>
        <button type="button" className="workspace-action-button" onClick={onRefresh} disabled={unavailable || loading} style={S.btn}>Refresh</button>
        <button type="button" className="workspace-action-button" onClick={onClear} disabled={unavailable || loading || running} style={S.btn}>Clear</button>
      </div>
    </Card>
  );
}

// ── File explorer ──────────────────────────────────────────────────────────────

interface TreeNode {
  name: string;
  path: string;
  kind: 'file' | 'dir';
  size?: number;
  mtime: number;
  children: TreeNode[];
}

function buildTree(entries: FsEntry[]): TreeNode[] {
  const map = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];

  // Sort dirs before files, then alphabetically
  const sorted = [...entries].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  for (const e of sorted) {
    const node: TreeNode = { name: e.name, path: e.path, kind: e.kind, size: e.size, mtime: e.mtime, children: [] };
    map.set(e.path, node);

    const parts = e.path.replace(/^\/workspace\//, '').split('/');
    if (parts.length === 1) {
      roots.push(node);
    } else {
      const parentPath = e.path.substring(0, e.path.lastIndexOf('/'));
      const parent = map.get(parentPath);
      if (parent) parent.children.push(node);
    }
  }
  return roots;
}

const KNOWN_FOLDERS = ['attachments', 'notes', 'artifacts'];

function FileExplorer({ entries, truncated }: { entries: FsEntry[]; truncated?: boolean }) {
  const augmented = useMemo(() => {
    const existing = new Set(entries.map(e => e.path));
    const synthetic: FsEntry[] = KNOWN_FOLDERS
      .filter(name => !existing.has(`/workspace/${name}`))
      .map(name => ({ path: `/workspace/${name}`, name, kind: 'dir' as const, mtime: 0 }));
    return [...synthetic, ...entries];
  }, [entries]);
  const roots = useMemo(() => buildTree(augmented), [augmented]);

  return (
    <div style={{ fontFamily: '"Geist Mono", ui-monospace, monospace', fontSize: 12 }}>
      {roots.map(node => (
        <TreeRow key={node.path} node={node} depth={0} />
      ))}
      {truncated && (
        <div style={{ ...S.empty, marginTop: 8, fontFamily: 'inherit', fontSize: 11 }}>
          … list truncated (too many files)
        </div>
      )}
    </div>
  );
}

function TreeRow({ node, depth }: { node: TreeNode; depth: number }) {
  const bridge = useBridgeStore();
  const [open, setOpen] = useState(depth === 0);
  const [hovered, setHovered] = useState(false);
  const isDir = node.kind === 'dir';

  const folderColor = folderAccent(node.name);
  const activate = (): void => {
    if (isDir) {
      setOpen(o => !o);
      return;
    }
    void bridge.openWorkspacePath(node.path);
  };

  return (
    <div>
      <div
        className="workspace-tree-row"
        role="button"
        tabIndex={0}
        data-open={isDir && open ? 'true' : undefined}
        onClick={activate}
        onKeyDown={e => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          activate();
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 6px',
          paddingLeft: `${6 + depth * 16}px`,
          borderRadius: 5,
          cursor: 'pointer',
          background: hovered ? 'rgba(255,255,255,0.05)' : 'transparent',
          userSelect: 'none',
          transition: `background-color ${tokens.motion.fast}`,
        }}
      >
        {/* Chevron for dirs */}
        <span style={{
          width: 12,
          color: 'rgba(255,255,255,0.25)',
          fontSize: 9,
          flexShrink: 0,
          transform: isDir && open ? 'rotate(90deg)' : 'none',
          transition: `transform ${tokens.motion.fast}`,
          visibility: isDir ? 'visible' : 'hidden',
        }}>▶</span>

        {/* Icon */}
        <span style={{ fontSize: 13, flexShrink: 0 }}>
          {isDir ? folderIcon(node.name, open) : fileIcon(node.name)}
        </span>

        {/* Name */}
        <span style={{
          flex: 1,
          color: isDir ? folderColor : 'rgba(255,255,255,0.8)',
          fontWeight: isDir ? 500 : 400,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {node.name}{isDir ? '/' : ''}
        </span>

        {/* Size */}
        {!isDir && node.size != null && (
          <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 10, flexShrink: 0 }}>
            {formatSize(node.size)}
          </span>
        )}

        {/* File count for dirs */}
        {isDir && node.children.length > 0 && (
          <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 10, flexShrink: 0 }}>
            {node.children.filter(c => c.kind === 'file').length} files
          </span>
        )}
      </div>

      {isDir && open && node.children.map(child => (
        <TreeRow key={child.path} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function folderAccent(name: string): string {
  if (name === 'artifacts') return '#7ec8a0';
  if (name === 'attachments') return '#7db4e0';
  if (name === 'notes') return '#c8b87e';
  return 'rgba(255,255,255,0.7)';
}

function folderIcon(name: string, open: boolean): string {
  if (open) return '📂';
  if (name === 'artifacts') return '📦';
  if (name === 'attachments') return '📎';
  if (name === 'notes') return '📋';
  return '📁';
}

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp'].includes(ext)) return '🖼️';
  if (['mp4', 'mov', 'avi', 'webm', 'mkv'].includes(ext)) return '🎬';
  if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return '🎵';
  if (['pdf'].includes(ext)) return '📄';
  if (['zip', 'tar', 'gz', 'bz2', '7z', 'rar'].includes(ext)) return '🗜️';
  if (['js', 'ts', 'tsx', 'jsx', 'py', 'go', 'rs', 'c', 'cpp', 'sh'].includes(ext)) return '📝';
  if (['json', 'yaml', 'yml', 'toml', 'xml'].includes(ext)) return '⚙️';
  if (['md', 'txt', 'csv'].includes(ext)) return '📃';
  return '📄';
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function shortHash(hash?: string): string {
  if (!hash) return 'unknown hash';
  return hash.replace(/^sha256:/, '').slice(0, 12);
}

// ── Styles ─────────────────────────────────────────────────────────────────────

const S = {
  row: { display: 'flex', alignItems: 'center', gap: 12 } as CSSProperties,
  dot: (color: string): CSSProperties => ({ width: 9, height: 9, borderRadius: '50%', background: color, flex: 'none' }),
  label: { fontSize: 13, color: 'var(--text)', fontWeight: 500 } as CSSProperties,
  sub: { fontSize: 12, color: 'var(--text-faint)' } as CSSProperties,
  code: { fontFamily: '"Geist Mono", monospace', fontSize: 12, color: 'var(--text-dim)', marginTop: 4 } as CSSProperties,
  inlineCode: { fontFamily: '"Geist Mono", monospace', fontSize: 11, color: 'var(--text-dim)' } as CSSProperties,
  btn: {
    padding: '4px 10px', fontSize: 11,
    border: '1px solid var(--border)', borderRadius: 4,
    background: 'transparent', color: 'var(--text-dim)',
    cursor: 'pointer',
  } as CSSProperties,
  cmdChip: {
    padding: '3px 8px', fontSize: 11,
    fontFamily: '"Geist Mono", monospace',
    border: '1px solid var(--border)', borderRadius: 3,
    color: 'var(--text-dim)',
  } as CSSProperties,
  empty: { fontSize: 12, color: 'var(--text-faint)', fontStyle: 'italic' } as CSSProperties,
  statusChip: (color: string): CSSProperties => ({
    padding: '3px 8px',
    fontSize: 11,
    border: '1px solid var(--border)',
    borderRadius: 3,
    color,
    whiteSpace: 'nowrap',
  }),
  logTail: {
    margin: '10px 0 0',
    maxHeight: 180,
    overflow: 'auto',
    padding: 10,
    border: '1px solid var(--border)',
    borderRadius: 4,
    background: 'rgba(0,0,0,0.18)',
    color: 'var(--text-dim)',
    fontSize: 11,
    lineHeight: 1.45,
    whiteSpace: 'pre-wrap',
  } as CSSProperties,
};
