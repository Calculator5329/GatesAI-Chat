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
import type { LineDiffRow, SourceChangedFile, SourceChangedFiles, SourceWorkspaceStatus } from '../../../stores/SourceWorkspaceStore';
import type { SourceBuildCommand, SourceBuildStatus } from '../../../stores/SourceWorkspaceStore';
import { sourceTestFreshness } from '../../../stores/sourceWorkspaceSelectors';

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
  const [changedFiles, setChangedFiles] = useState<SourceChangedFiles | null>(null);
  const [changesLoading, setChangesLoading] = useState(false);
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
      const status = await source.status();
      setSourceStatus(status);
      if (status.prepared && !status.stale) void refreshChangedFiles();
      else setChangedFiles(null);
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
      const status = await source.prepare();
      setSourceStatus(status);
      if (status.prepared && !status.stale) void refreshChangedFiles();
    } catch (err) {
      setSourceError((err as Error).message);
    } finally {
      setSourceLoading(false);
    }
  };

  const refreshChangedFiles = async () => {
    setSourceError(null);
    if (webLite || !isTauri()) {
      setChangedFiles(null);
      return;
    }
    setChangesLoading(true);
    try {
      setChangedFiles(await source.changedFiles());
    } catch (err) {
      setSourceError((err as Error).message);
    } finally {
      setChangesLoading(false);
    }
  };

  const revertSourceFile = async (path: string) => {
    setSourceError(null);
    setSourceLoading(true);
    try {
      await source.revertFile(path);
      setChangedFiles(await source.changedFiles());
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

  const openBuildOutputFolder = async (artifactPath: string) => {
    setBuildError(null);
    try {
      await source.openOutputFolder(artifactPath);
    } catch (err) {
      setBuildError((err as Error).message);
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
          <span style={S.dot(bridge.state === 'online' ? 'var(--success)' : bridge.state === 'offline' ? 'var(--danger-muted)' : 'var(--text-faint)')} />
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
        changes={changedFiles}
        changesLoading={changesLoading}
        onRefreshChanges={refreshChangedFiles}
        onRevertFile={revertSourceFile}
        diffRowsForFile={source.diffRowsForFile}
      />

      <SourceBuildCard
        status={buildStatus}
        sourcePrepared={Boolean(sourceStatus?.prepared && !sourceStatus.stale)}
        changes={changedFiles}
        loading={buildLoading}
        error={buildError}
        unavailable={webLite || !isTauri()}
        onStart={startBuild}
        onRefresh={refreshSourceBuild}
        onClear={clearBuild}
        onOpenOutputFolder={openBuildOutputFolder}
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
        {error && <div style={{ ...S.empty, color: 'var(--danger-muted)' }}>{error}</div>}
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
  changes,
  changesLoading,
  onPrepare,
  onRefresh,
  onOpen,
  onRefreshChanges,
  onRevertFile,
  diffRowsForFile,
}: {
  status: SourceWorkspaceStatus | null;
  loading: boolean;
  error: string | null;
  unavailable: boolean;
  changes: SourceChangedFiles | null;
  changesLoading: boolean;
  onPrepare: () => void;
  onRefresh: () => void;
  onOpen: () => void;
  onRefreshChanges: () => void;
  onRevertFile: (path: string) => void;
  diffRowsForFile: (file: SourceChangedFile) => LineDiffRow[];
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
        <span style={S.statusChip(ready ? 'var(--success)' : needsPrepare ? 'var(--warning-muted)' : 'var(--text-faint)')}>
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
        <div style={{ ...S.empty, color: 'var(--danger-muted)', marginTop: 8 }}>{error ?? status?.lastError}</div>
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
      {status?.prepared && !status.stale && (
        <SourceChangesReview
          changes={changes}
          loading={changesLoading}
          disabled={unavailable || loading}
          onRefresh={onRefreshChanges}
          onRevertFile={onRevertFile}
          diffRowsForFile={diffRowsForFile}
        />
      )}
    </Card>
  );
}

export function SourceChangesReview({
  changes,
  loading,
  disabled,
  onRefresh,
  onRevertFile,
  diffRowsForFile,
}: {
  changes: SourceChangedFiles | null;
  loading: boolean;
  disabled: boolean;
  onRefresh: () => void;
  onRevertFile: (path: string) => void;
  diffRowsForFile: (file: SourceChangedFile) => LineDiffRow[];
}) {
  const files = changes?.files ?? [];
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [confirmPath, setConfirmPath] = useState<string | null>(null);
  const selected = files.find(file => file.path === selectedPath) ?? files[0] ?? null;

  return (
    <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div>
          <div style={S.label}>Changed files</div>
          <div style={S.sub}>{files.length ? `${files.length} file${files.length === 1 ? '' : 's'} differ from the bundled snapshot.` : 'No source changes detected.'}</div>
        </div>
        <button type="button" className="workspace-action-button" onClick={onRefresh} disabled={disabled || loading} style={S.btn}>
          {loading ? 'Refreshing...' : 'Refresh changes'}
        </button>
      </div>
      {files.length > 0 && (
        <div style={S.reviewGrid}>
          <div style={S.changedList}>
            {files.map(file => {
              const active = selected?.path === file.path;
              return (
                <button
                  key={file.path}
                  type="button"
                  onClick={() => { setSelectedPath(file.path); setConfirmPath(null); }}
                  style={S.changedFileButton(active)}
                >
                  <span style={S.changeKind(file.change)}>{file.change}</span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.path.replace(/^source:\/\//, '')}</span>
                </button>
              );
            })}
          </div>
          <div style={S.diffPanel}>
            {selected && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ ...S.label, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{selected.path}</div>
                    <div style={S.sub}>{changeSizeLabel(selected)}</div>
                  </div>
                  {confirmPath === selected.path ? (
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      <button type="button" onClick={() => { onRevertFile(selected.path); setConfirmPath(null); }} disabled={disabled} style={S.dangerBtn}>Confirm</button>
                      <button type="button" onClick={() => setConfirmPath(null)} style={S.btn}>Cancel</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirmPath(selected.path)} disabled={disabled} style={S.btn}>Revert</button>
                  )}
                </div>
                <DiffPreview file={selected} diffRowsForFile={diffRowsForFile} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function DiffPreview({
  file,
  diffRowsForFile,
}: {
  file: SourceChangedFile;
  diffRowsForFile: (file: SourceChangedFile) => LineDiffRow[];
}) {
  if (!file.previewAvailable) {
    return <div style={S.empty}>changed (no diff preview)</div>;
  }
  const rows = diffRowsForFile(file);
  if (rows.length === 0) {
    return <div style={S.empty}>No line-level text changes.</div>;
  }
  return (
    <pre style={S.diffCode}>
      {rows.map((row, index) => {
        const sign = row.type === 'added' ? '+' : row.type === 'removed' ? '-' : ' ';
        const lineNo = row.type === 'added' ? row.newLine : row.type === 'removed' ? row.oldLine : row.newLine;
        return (
          <div key={`${row.type}-${index}`} style={S.diffLine(row.type)}>
            <span style={S.diffGutter}>{String(lineNo).padStart(4, ' ')}</span>
            <span style={S.diffSign}>{sign}</span>
            <span>{row.text || ' '}</span>
          </div>
        );
      })}
    </pre>
  );
}

export function SourceBuildCard({
  status,
  sourcePrepared,
  changes,
  loading,
  error,
  unavailable,
  onStart,
  onRefresh,
  onClear,
  onOpenOutputFolder,
}: {
  status: SourceBuildStatus | null;
  sourcePrepared: boolean;
  changes: SourceChangedFiles | null;
  loading: boolean;
  error: string | null;
  unavailable: boolean;
  onStart: (command: SourceBuildCommand) => void;
  onRefresh: () => void;
  onClear: () => void;
  onOpenOutputFolder: (artifactPath: string) => void;
}) {
  const running = status?.status === 'running';
  const disabled = unavailable || loading || running || !sourcePrepared;
  const testFreshness = sourceTestFreshness(changes, status?.lastTest);
  const chipColor = status?.status === 'succeeded'
    ? 'var(--success)'
    : status?.status === 'failed'
      ? 'var(--danger-muted)'
      : running
        ? 'var(--warning-muted)'
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
        {status?.startedAtUnix ? ` · ${formatDuration(status)}` : ''}
      </div>
      <div style={S.summaryGrid}>
        <JobSummary label="Last test" summary={status?.lastTest} />
        <JobSummary label="Last build" summary={status?.lastBuild} />
      </div>
      {status?.steps?.length ? <StepStatusRow steps={status.steps} /> : null}
      {status?.installerPath && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
          <div style={{ ...S.code, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            artifact: {status.installerPath} {status.installerBytes ? `(${formatSize(status.installerBytes)})` : ''}
          </div>
          <button type="button" className="workspace-action-button" onClick={() => onOpenOutputFolder(status.installerPath!)} style={S.btn}>Open output folder</button>
        </div>
      )}
      {(error || status?.lastError) && (
        <div style={{ ...S.empty, color: 'var(--danger-muted)', marginTop: 8 }}>{error ?? status?.lastError}</div>
      )}
      {!sourcePrepared && !unavailable && (
        <div style={{ ...S.empty, marginTop: 8 }}>Prepare the source workspace before running builds.</div>
      )}
      {testFreshness.needsAttention && sourcePrepared && !unavailable && (
        <div style={{ ...S.empty, marginTop: 8, color: 'var(--warning-muted)' }}>{testFreshness.label}</div>
      )}
      {status?.logs?.length ? (
        <pre style={S.logTail}>{status.logs.join('\n')}</pre>
      ) : null}
      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="workspace-action-button"
          onClick={() => onStart('package')}
          disabled={disabled}
          title={testFreshness.needsAttention ? "Tests haven't passed since the last edit." : 'Run the installer build.'}
          style={testFreshness.needsAttention ? S.warningPrimaryBtn : S.primaryBtn}
        >
          Run build
        </button>
        <button type="button" className="workspace-action-button" onClick={() => onStart('test')} disabled={disabled} style={S.primaryBtn}>Run tests</button>
        <button type="button" className="workspace-action-button" onClick={() => onStart('install')} disabled={disabled} style={S.btn}>Install deps</button>
        <button type="button" className="workspace-action-button" onClick={() => onStart('build')} disabled={disabled} style={S.btn}>Build</button>
        <button type="button" className="workspace-action-button" onClick={onRefresh} disabled={unavailable || loading} style={S.btn}>Refresh</button>
        <button type="button" className="workspace-action-button" onClick={onClear} disabled={unavailable || loading || running} style={S.btn}>Clear</button>
      </div>
    </Card>
  );
}

// ── File explorer ──────────────────────────────────────────────────────────────

function JobSummary({
  label,
  summary,
}: {
  label: string;
  summary?: SourceBuildStatus['lastTest'];
}) {
  const color = summary?.status === 'succeeded'
    ? 'var(--success)'
    : summary?.status === 'failed'
      ? 'var(--danger-muted)'
      : summary?.status === 'running'
        ? 'var(--warning-muted)'
        : 'var(--text-faint)';
  return (
    <div style={S.summaryBox}>
      <div style={{ ...S.sub, color: 'var(--text-faint)' }}>{label}</div>
      <div style={{ ...S.label, color }}>{summary?.status ?? 'idle'}</div>
      <div style={S.sub}>
        {summary?.finishedAtUnix
          ? new Date(summary.finishedAtUnix * 1000).toLocaleString()
          : summary?.startedAtUnix
            ? `started ${new Date(summary.startedAtUnix * 1000).toLocaleString()}`
            : 'No run yet.'}
      </div>
    </div>
  );
}

function StepStatusRow({ steps }: { steps: SourceBuildStatus['steps'] }) {
  const visible = steps.filter(step => ['ci', 'test', 'typecheck', 'lint'].includes(step.id));
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
      {visible.map(step => (
        <span key={step.id} style={S.stepChip(step.status)}>
          {step.label}: {step.status}{step.startedAtUnix ? ` · ${formatStepDuration(step)}` : ''}
        </span>
      ))}
    </div>
  );
}

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
          background: hovered ? 'var(--surface-wash-5)' : 'transparent',
          userSelect: 'none',
          transition: `background-color ${tokens.motion.fast}`,
        }}
      >
        {/* Chevron for dirs */}
        <span style={{
          width: 12,
          color: 'var(--surface-faint)',
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
          color: isDir ? folderColor : 'var(--surface-file-text)',
          fontWeight: isDir ? 500 : 400,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {node.name}{isDir ? '/' : ''}
        </span>

        {/* Size */}
        {!isDir && node.size != null && (
          <span style={{ color: 'var(--surface-faint)', fontSize: 10, flexShrink: 0 }}>
            {formatSize(node.size)}
          </span>
        )}

        {/* File count for dirs */}
        {isDir && node.children.length > 0 && (
          <span style={{ color: 'var(--surface-fainter)', fontSize: 10, flexShrink: 0 }}>
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
  if (name === 'artifacts') return 'var(--diff-added)';
  if (name === 'attachments') return 'var(--folder-attachments)';
  if (name === 'notes') return 'var(--warning-muted)';
  return 'var(--surface-folder-text)';
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

function changeSizeLabel(file: SourceChangedFile): string {
  if (file.change === 'added') return `${formatSize(file.currentSize ?? 0)} added`;
  if (file.change === 'deleted') return `${formatSize(file.originalSize ?? 0)} deleted`;
  return `${formatSize(file.originalSize ?? 0)} -> ${formatSize(file.currentSize ?? 0)}`;
}

function formatDuration(status: SourceBuildStatus): string {
  if (!status.startedAtUnix) return 'idle';
  const end = status.finishedAtUnix ?? Math.floor(Date.now() / 1000);
  const seconds = Math.max(0, end - status.startedAtUnix);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}m ${rest}s`;
}

function formatStepDuration(step: SourceBuildStatus['steps'][number]): string {
  if (!step.startedAtUnix) return 'pending';
  const end = step.finishedAtUnix ?? Math.floor(Date.now() / 1000);
  const seconds = Math.max(0, end - step.startedAtUnix);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
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
  primaryBtn: {
    padding: '4px 10px', fontSize: 11,
    border: '1px solid var(--diff-added-border)', borderRadius: 4,
    background: 'var(--diff-added-bg-strong)', color: 'var(--text)',
    cursor: 'pointer',
  } as CSSProperties,
  warningPrimaryBtn: {
    padding: '4px 10px', fontSize: 11,
    border: '1px solid var(--warning-muted)', borderRadius: 4,
    background: 'var(--inset-bg-soft)', color: 'var(--text)',
    cursor: 'pointer',
  } as CSSProperties,
  dangerBtn: {
    padding: '4px 10px', fontSize: 11,
    border: '1px solid var(--diff-removed-border)', borderRadius: 4,
    background: 'var(--diff-removed-bg-soft)', color: 'var(--diff-removed-strong)',
    cursor: 'pointer',
  } as CSSProperties,
  reviewGrid: {
    display: 'grid',
    gridTemplateColumns: 'minmax(180px, 0.8fr) minmax(0, 1.2fr)',
    gap: 10,
  } as CSSProperties,
  changedList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    minWidth: 0,
    maxHeight: 320,
    overflow: 'auto',
  } as CSSProperties,
  changedFileButton: (active: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: 7,
    minWidth: 0,
    width: '100%',
    padding: '6px 7px',
    border: `1px solid ${active ? 'var(--surface-active-border)' : 'var(--border)'}`,
    borderRadius: 5,
    background: active ? 'var(--code-obsidian-bg-inline)' : 'transparent',
    color: 'var(--text-dim)',
    cursor: 'pointer',
    fontSize: 11,
    fontFamily: '"Geist Mono", monospace',
    textAlign: 'left',
  }),
  changeKind: (kind: SourceChangedFile['change']): CSSProperties => ({
    width: 58,
    flex: 'none',
    color: kind === 'added' ? 'var(--diff-added)' : kind === 'deleted' ? 'var(--diff-removed)' : 'var(--warning-muted)',
    fontSize: 10,
    textTransform: 'uppercase',
  }),
  diffPanel: {
    minWidth: 0,
    border: '1px solid var(--border)',
    borderRadius: 5,
    padding: 10,
    background: 'var(--inset-bg)',
  } as CSSProperties,
  diffCode: {
    margin: 0,
    maxHeight: 360,
    overflow: 'auto',
    border: '1px solid var(--border)',
    borderRadius: 4,
    background: 'var(--inset-bg-strong)',
    color: 'var(--text-dim)',
    fontFamily: '"Geist Mono", monospace',
    fontSize: 11,
    lineHeight: 1.45,
  } as CSSProperties,
  diffLine: (type: 'context' | 'added' | 'removed'): CSSProperties => ({
    display: 'grid',
    gridTemplateColumns: '42px 18px minmax(0, 1fr)',
    gap: 6,
    padding: '1px 8px',
    background: type === 'added'
      ? 'var(--diff-added-bg)'
      : type === 'removed'
        ? 'var(--diff-removed-bg)'
        : 'transparent',
    color: type === 'added' ? 'var(--diff-added-text)' : type === 'removed' ? 'var(--diff-removed-text)' : 'var(--text-dim)',
    whiteSpace: 'pre',
  }),
  diffGutter: { color: 'var(--text-faint)', userSelect: 'none', textAlign: 'right' } as CSSProperties,
  diffSign: { color: 'var(--text-faint)', userSelect: 'none' } as CSSProperties,
  cmdChip: {
    padding: '3px 8px', fontSize: 11,
    fontFamily: '"Geist Mono", monospace',
    border: '1px solid var(--border)', borderRadius: 3,
    color: 'var(--text-dim)',
  } as CSSProperties,
  summaryGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 8,
    marginTop: 10,
  } as CSSProperties,
  summaryBox: {
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: 8,
    background: 'var(--inset-bg-soft)',
    minWidth: 0,
  } as CSSProperties,
  stepChip: (status: SourceBuildStatus['steps'][number]['status']): CSSProperties => ({
    padding: '3px 8px',
    fontSize: 11,
    border: '1px solid var(--border)',
    borderRadius: 3,
    color: status === 'succeeded' || status === 'skipped'
      ? 'var(--success)'
      : status === 'failed'
        ? 'var(--danger-muted)'
        : status === 'running'
          ? 'var(--warning-muted)'
          : 'var(--text-faint)',
    fontFamily: '"Geist Mono", monospace',
  }),
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
    background: 'var(--inset-bg-soft)',
    color: 'var(--text-dim)',
    fontSize: 11,
    lineHeight: 1.45,
    whiteSpace: 'pre-wrap',
  } as CSSProperties,
};
