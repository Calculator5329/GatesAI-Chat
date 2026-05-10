import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { useBridgeStore } from '../../../stores/context';
import type { FsEntry, FsListResp } from '../../../core/workspace';
import { Card } from '../../ui/Card';
import { WebLiteNotice } from '../../ui/WebLiteNotice';
import { isWebLite } from '../../../services/system/runtime';

export const WorkspaceSection = observer(function WorkspaceSection() {
  const bridge = useBridgeStore();
  const webLite = isWebLite();
  const [tree, setTree] = useState<FsListResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setError(null);
    if (!bridge.isOnline) { setTree(null); return; }
    setLoading(true);
    try {
      const resp = await bridge.client.request<FsListResp>('fs.list', { path: '/workspace', recursive: true });
      setTree(resp);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [bridge.state]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <WebLiteNotice show={webLite}>
        <strong style={{ color: 'var(--text)' }}>Web Lite:</strong>{' '}
        the local /workspace bridge is not available in Firebase Hosting. Chats and settings stay in this browser for now.
      </WebLiteNotice>
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
          <button onClick={() => { void bridge.poll(); }} style={S.btn}>Re-poll</button>
        </div>
      </Card>

      {/* Workspace root */}
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={S.label}>Workspace root</div>
          <button
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
              onClick={() => { void bridge.openWorkspacePath('/workspace'); }}
              disabled={!bridge.isOnline}
              title={bridge.isOnline ? 'Open the workspace folder' : 'Bridge must be online to open the workspace.'}
              style={S.btn}
            >
              Open workspace
            </button>
            <button onClick={() => { void refresh(); }} style={S.btn}>
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

  return (
    <div>
      <div
        role={isDir ? 'button' : undefined}
        tabIndex={isDir ? 0 : undefined}
        onClick={() => {
          if (isDir) { setOpen(o => !o); return; }
          void bridge.openWorkspacePath(node.path);
        }}
        onKeyDown={e => { if (isDir && (e.key === 'Enter' || e.key === ' ')) setOpen(o => !o); }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '4px 6px',
          paddingLeft: `${6 + depth * 16}px`,
          borderRadius: 5,
          cursor: isDir ? 'pointer' : 'default',
          background: hovered ? 'rgba(255,255,255,0.05)' : 'transparent',
          userSelect: 'none',
          transition: 'background 0.1s',
        }}
      >
        {/* Chevron for dirs */}
        <span style={{
          width: 12,
          color: 'rgba(255,255,255,0.25)',
          fontSize: 9,
          flexShrink: 0,
          transform: isDir && open ? 'rotate(90deg)' : 'none',
          transition: 'transform 0.15s',
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
};
