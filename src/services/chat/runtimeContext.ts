// Builds chat-runtime support data for runtimeContext.
// Called by ChatStore before/after provider or tool work; depends on thread/tool result contracts.
// Invariant: helpers format diagnostics without mutating message history directly.
import { isWebLite, runtimeMode } from '../../core/runtime';
import { clientPlatform } from '../../core/clientPlatform';
import { downloadLinks, recommendedDownload } from '../../core/downloads';

interface RuntimeBridgeInfo {
  isOnline: boolean;
  platform?: string;
  version?: string;
}

interface RuntimeSourceWorkspaceInfo {
  prepared: boolean;
  changedFileCount?: number;
  latestChangeAtUnix?: number;
  lastBuildStatus?: 'idle' | 'running' | 'succeeded' | 'failed' | 'interrupted';
  lastBuildFinishedAtUnix?: number;
  lastBuildStartedAtUnix?: number;
  lastTestStatus?: 'idle' | 'running' | 'succeeded' | 'failed' | 'interrupted';
  lastTestFinishedAtUnix?: number;
  lastTestStartedAtUnix?: number;
}

interface RuntimeContextCacheEntry {
  key: string;
  local: string;
  timeZone: string;
}

let cachedRuntimeContext: RuntimeContextCacheEntry | null = null;
let cachedDefaultTimeZone: string | null = null;

function defaultTimeZone(): string {
  if (cachedDefaultTimeZone) return cachedDefaultTimeZone;
  cachedDefaultTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  return cachedDefaultTimeZone;
}

export function buildRuntimeContext(opts: {
  bridge?: RuntimeBridgeInfo;
  sourceWorkspace?: RuntimeSourceWorkspaceInfo | null;
  now?: Date;
  timeZone?: string;
} = {}): string {
  const now = opts.now ?? new Date();
  const tz = opts.timeZone ?? defaultTimeZone();
  const bridge = opts.bridge;
  const minute = Math.floor(now.getTime() / 60_000);
  const cacheKey = [
    minute,
    tz,
    bridge?.isOnline ? 'online' : 'offline',
    bridge?.platform ?? '',
    bridge?.version ?? '',
  ].join('|');
  let local = cachedRuntimeContext?.key === cacheKey ? cachedRuntimeContext.local : '';
  if (!local) {
    local = now.toLocaleString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
      timeZone: tz,
    });
    cachedRuntimeContext = { key: cacheKey, local, timeZone: tz };
  }
  const timeZone = cachedRuntimeContext?.key === cacheKey ? cachedRuntimeContext.timeZone : tz;
  const lines = [
    `local_time: ${local}`,
    `timezone: ${timeZone}`,
    `iso: ${now.toISOString()}`,
    `runtime_mode: ${runtimeMode()}`,
  ];

  // Web Lite has no bridge/workspace; the bridge-contract lines below would be
  // misleading. Emit the download facts the model needs to recommend the app
  // for whatever the user is on, then stop.
  if (isWebLite()) {
    const { os, arch } = clientPlatform();
    const rec = recommendedDownload(os, arch);
    lines.push(`client_os: ${os}`);
    lines.push(`client_arch: ${arch}`);
    lines.push(`recommended_download: ${rec.label} — ${rec.url}`);
    lines.push(`download_runs_on: ${rec.runsOn}`);
    if (rec.note) lines.push(`download_note: ${rec.note}`);
    lines.push(`all_releases: ${downloadLinks.releases}`);
    lines.push(`repo_fallback: ${downloadLinks.repo} (build from source / other platforms)`);
    return lines.join('\n');
  }

  lines.push(`bridge: ${bridge?.isOnline ? 'online' : 'offline'}`);
  if (bridge?.platform) lines.push(`platform: ${bridge.platform}`);
  if (bridge?.version) lines.push(`bridge_version: ${bridge.version}`);
  lines.push('workspace_paths: /workspace/attachments, /workspace/notes, /workspace/artifacts');
  lines.push('workspace_readme: /workspace/README.md');
  lines.push('ai_operating_context: /workspace/notes/GatesAI-AI-Operating-Context.md');
  lines.push('artifact_layout: images/api for OpenRouter images, images/local for ComfyUI images, data for JSON/CSV/SQLite outputs, reports for docs/summaries, exports for other deliverables');
  lines.push('terminal_cwd: bridge workspace root');
  lines.push('/workspace/... is model-facing for tools and artifact references; scripts should use cwd-relative paths.');
  if (opts.sourceWorkspace?.prepared) {
    const changed = opts.sourceWorkspace.changedFileCount == null ? 'unknown' : String(opts.sourceWorkspace.changedFileCount);
    const buildStatus = opts.sourceWorkspace.lastBuildStatus ?? 'idle';
    const buildTime = formatSourceBuildTime(opts.sourceWorkspace);
    const testState = formatSourceTestState(opts.sourceWorkspace, now);
    lines.push(`source_workspace: prepared; changed_files: ${changed}; tests: ${testState}; user_review: Workspace menu shows changed files, diffs, and per-file revert.`);
    lines.push(`source_build: ${buildStatus}${buildTime}; install_handoff: open output folder only, user must approve any installer/update.`);
  }
  lines.push('When you need details about this app, its tools, user-visible behavior, or environment limits, read the AI operating context file.');
  return lines.join('\n');
}

function formatSourceBuildTime(info: RuntimeSourceWorkspaceInfo): string {
  const unix = info.lastBuildFinishedAtUnix ?? info.lastBuildStartedAtUnix;
  if (!unix) return '';
  return ` at ${new Date(unix * 1000).toISOString()}`;
}

function formatSourceTestState(info: RuntimeSourceWorkspaceInfo, now: Date): string {
  const status = info.lastTestStatus ?? 'idle';
  const unix = info.lastTestFinishedAtUnix ?? info.lastTestStartedAtUnix;
  if (status === 'succeeded' && unix) return `passed ${relativeAge(unix, now)} ago`;
  if (status === 'failed' && unix) return `failing since ${new Date(unix * 1000).toISOString()}`;
  if (status === 'running' && unix) return `running since ${new Date(unix * 1000).toISOString()}`;
  if (status === 'interrupted' && unix) return `interrupted at ${new Date(unix * 1000).toISOString()}`;
  return status;
}

function relativeAge(unix: number, now: Date): string {
  const seconds = Math.max(0, Math.floor(now.getTime() / 1000) - unix);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
