const WORKSPACE_PREFIX = '/workspace/';
const WORKSPACE_ROOT = '/workspace';

export function isProtectedChatHistoryPath(path: string): boolean {
  return isProtectedChatHistoryScope(path);
}

export function isProtectedChatHistoryScope(path: string): boolean {
  const rel = workspaceRelative(path);
  return rel === '.gatesai/chat' || rel.startsWith('.gatesai/chat/');
}

export function filterProtectedChatHistoryEntries<T extends { path: string }>(entries: T[]): T[] {
  return entries.filter(entry => !isProtectedChatHistoryPath(entry.path));
}

export function filterProtectedChatHistoryHits<T extends { path: string }>(hits: T[]): T[] {
  return hits.filter(hit => !isProtectedChatHistoryPath(hit.path));
}

function workspaceRelative(path: string): string {
  const normalized = path.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '');
  if (normalized === WORKSPACE_ROOT) return '';
  if (normalized.startsWith(WORKSPACE_PREFIX)) return normalized.slice(WORKSPACE_PREFIX.length);
  return normalized.replace(/^\/+/, '');
}
