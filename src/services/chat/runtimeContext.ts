interface RuntimeBridgeInfo {
  isOnline: boolean;
  platform?: string;
  version?: string;
}

export function buildRuntimeContext(opts: {
  bridge?: RuntimeBridgeInfo;
  now?: Date;
  timeZone?: string;
} = {}): string {
  const now = opts.now ?? new Date();
  const tz = opts.timeZone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const local = now.toLocaleString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
    timeZone: tz,
  });
  const bridge = opts.bridge;
  const lines = [
    `local_time: ${local}`,
    `timezone: ${tz}`,
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
