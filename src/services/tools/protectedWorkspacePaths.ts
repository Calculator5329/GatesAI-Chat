// App-side protection for chat state the model must not read through generic tools.
//
// Two protected trees under /workspace:
// - `.gatesai/chat/` — JSON envelope the app owns for crash-safe persistence
// - `chat-history/` — HTML/Markdown mirror for human reading
//
// Enforcement lives in app tools (fs, inspect_file, terminal, python_inline,
// sqlite_query). The bridge can still read these paths if invoked outside the
// tool layer — bridge-level enforcement is a planned follow-up (audit C3).
import { logger } from '../diagnostics/logger';

const WORKSPACE_PREFIX = '/workspace/';
const WORKSPACE_ROOT = '/workspace';

export const PROTECTED_CHAT_HISTORY_DENIAL =
  'Error: app-managed chat history files are not exposed through this tool. Use the `chat_history` tool instead.';

export function isProtectedChatHistoryScope(path: string): boolean {
  // Lower-cased compare: Windows/macOS filesystems are case-insensitive, so
  // `/workspace/Chat-History/...` must be blocked just like `chat-history`.
  // This matches the case-insensitive command-text scanner below.
  const rel = workspaceRelative(path).toLowerCase();
  return rel === '.gatesai/chat' || rel.startsWith('.gatesai/chat/')
    || rel === 'chat-history' || rel.startsWith('chat-history/');
}

/**
 * True when a command snippet references a protected chat-history path.
 * Scans normalized text for workspace-relative and absolute path patterns
 * before terminal/python/sqlite execution (audit C3 side-door closure).
 */
export function referencesProtectedChatHistory(text: string): boolean {
  const normalized = text.replace(/\\/g, '/');
  // Match the protected directory tokens wherever they appear, including via
  // `..` traversal (e.g. `notes/../chat-history`). Case-insensitive because
  // Windows filesystems are. These are heuristics: the path-based guards in
  // fs/inspect_file/sqlite are the authoritative checks.
  const patterns = [
    /\.gatesai\/chat(?:\/|$)/i,
    /(?:^|[\s"'`/])chat-history(?:\/|$)/i,
  ];
  return patterns.some(re => re.test(normalized));
}

export function denyIfReferencesProtectedChatHistory(parts: string[], tool?: string): string | null {
  const joined = parts.filter(Boolean).join(' ');
  if (!referencesProtectedChatHistory(joined)) return null;
  logger.warn('security', 'Blocked protected chat-history access', { tool: tool ?? 'unknown' });
  return PROTECTED_CHAT_HISTORY_DENIAL;
}

/** Log and return a tool-specific denial when a direct path hits protected scope. */
export function denyProtectedChatHistoryPath(tool: string, path: string, message: string): string | null {
  if (!isProtectedChatHistoryScope(path)) return null;
  logger.warn('security', 'Blocked protected chat-history access', {
    tool,
    pathHint: workspaceRelative(path) || path,
  });
  return message;
}

export function filterProtectedChatHistoryEntries<T extends { path: string }>(entries: T[]): T[] {
  return entries.filter(entry => !isProtectedChatHistoryScope(entry.path));
}

export function filterProtectedChatHistoryHits<T extends { path: string }>(hits: T[]): T[] {
  return hits.filter(hit => !isProtectedChatHistoryScope(hit.path));
}

function workspaceRelative(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '');
  const stripped = normalized === WORKSPACE_ROOT
    ? ''
    : normalized.startsWith(WORKSPACE_PREFIX)
      ? normalized.slice(WORKSPACE_PREFIX.length)
      : normalized.replace(/^\/+/, '');
  return canonicalizeRelative(stripped);
}

/**
 * Collapse `.`/`..` segments so a path like `notes/../chat-history/index.html`
 * resolves to `chat-history/index.html` and can't slip past the protected-scope
 * check. Leading `..` that would escape /workspace are dropped (the bridge path
 * jail rejects those independently).
 */
function canonicalizeRelative(rel: string): string {
  if (!rel) return '';
  const out: string[] = [];
  for (const segment of rel.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') { out.pop(); continue; }
    out.push(segment);
  }
  return out.join('/');
}
