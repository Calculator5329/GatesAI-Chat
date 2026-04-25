import { useEffect, useState, type CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { useBridgeStore } from '../../../stores/context';
import type { FsListResp } from '../../../core/workspace';
import { Card } from '../../ui/Card';

/**
 * Workspace settings: shows bridge status, connection details, the
 * workspace root path, allowlisted commands, and a flat tree of the
 * workspace folder.
 *
 * No editing here — this is a "what does the bridge see?" inspector.
 * To change the allowlist or workspace root, edit `~/.gatesai/bridge.json`
 * and restart the bridge. The intent is honest visibility: the user knows
 * exactly what the model can touch.
 */
export const WorkspaceSection = observer(function WorkspaceSection() {
  const bridge = useBridgeStore();
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
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

      <Card>
        <div style={S.label}>Workspace root</div>
        <div style={S.code}>{bridge.workspaceRoot ?? '— (offline)'}</div>
        <div style={{ ...S.sub, marginTop: 8 }}>
          Three folders inside this root: <code style={S.inlineCode}>attachments/</code> (your uploads), <code style={S.inlineCode}>notes/</code> (model scratchpad), <code style={S.inlineCode}>artifacts/</code> (final outputs).
        </div>
      </Card>

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

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <div style={S.label}>Workspace contents</div>
          <button onClick={() => { void refresh(); }} style={S.btn}>Refresh</button>
        </div>
        {error && <div style={{ ...S.empty, color: '#c96a6a' }}>{error}</div>}
        {loading && <div style={S.empty}>Loading…</div>}
        {!loading && !error && tree && (
          tree.entries.length === 0
            ? <div style={S.empty}>Workspace is empty.</div>
            : (
              <pre style={S.tree}>
                {tree.entries.map(e => `${e.kind === 'dir' ? 'd' : '-'}  ${e.path}${e.size != null ? `  (${formatSize(e.size)})` : ''}`).join('\n')}
                {tree.truncated ? '\n(truncated)' : ''}
              </pre>
            )
        )}
        {!loading && !error && !tree && <div style={S.empty}>Bridge offline.</div>}
      </Card>
    </div>
  );
});

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

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
  tree: {
    fontFamily: '"Geist Mono", monospace', fontSize: 11,
    color: 'var(--text-dim)',
    maxHeight: 320, overflow: 'auto',
    margin: 0,
    whiteSpace: 'pre',
  } as CSSProperties,
  empty: { fontSize: 12, color: 'var(--text-faint)', fontStyle: 'italic' } as CSSProperties,
};
