// Builds chat-runtime support data for runtimeContext.
// Called by ChatStore before/after provider or tool work; depends on thread/tool result contracts.
// Invariant: helpers format diagnostics without mutating message history directly.
interface RuntimeBridgeInfo {
  isOnline: boolean;
  platform?: string;
  version?: string;
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
    `bridge: ${bridge?.isOnline ? 'online' : 'offline'}`,
  ];
  if (bridge?.platform) lines.push(`platform: ${bridge.platform}`);
  if (bridge?.version) lines.push(`bridge_version: ${bridge.version}`);
  lines.push('workspace_paths: /workspace/attachments, /workspace/notes, /workspace/artifacts');
  lines.push('workspace_readme: /workspace/README.md');
  lines.push('ai_operating_context: /workspace/notes/GatesAI-AI-Operating-Context.md');
  lines.push('artifact_layout: images/api for OpenRouter images, images/local for ComfyUI images, data for JSON/CSV/SQLite outputs, reports for docs/summaries, exports for other deliverables');
  lines.push('terminal_cwd: bridge workspace root');
  lines.push('/workspace/... is model-facing for tools and artifact references; scripts should use cwd-relative paths.');
  lines.push('When you need details about this app, its tools, user-visible behavior, or environment limits, read the AI operating context file.');
  return lines.join('\n');
}
