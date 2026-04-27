/**
 * Pure helpers for the model-facing `/workspace/...` path namespace.
 *
 * The bridge maps `/workspace/...` to its real local workspace root (which
 * is platform-specific). The chat app needs to translate the model-facing
 * path back to an absolute OS path when the user clicks something — e.g.
 * a `/workspace/artifacts/pi.html` link in the markdown stream that
 * should open in the system browser.
 *
 * Kept dependency-free so both `core/` and `services/` can import it.
 */

const WORKSPACE_PREFIX = '/workspace/';
const WORKSPACE_ROOT_TOKEN = '/workspace';

/**
 * Heuristic test for "is this string a workspace path the user could click?"
 * Conservative on purpose: only matches `/workspace/` followed by at least
 * one printable non-space character. Avoids matching code paths the model
 * incidentally wrote (e.g. `/workspace` alone, `/workspaces/foo`).
 */
export function isWorkspacePath(value: string): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed.startsWith(WORKSPACE_PREFIX)) return false;
  const rel = trimmed.slice(WORKSPACE_PREFIX.length);
  if (!rel) return false;
  // Reject things that are obviously not paths (whitespace, control chars).
  return ![...rel].some(ch => ch.trim() === '' || ch.charCodeAt(0) < 32);
}

/**
 * Resolve `/workspace/foo/bar.html` against the bridge's reported root.
 * Returns null if inputs are missing/invalid so callers can short-circuit
 * cleanly when the bridge is offline.
 */
export function resolveWorkspacePath(
  workspacePath: string,
  workspaceRoot: string | undefined,
  platform: string | undefined,
): string | null {
  if (!workspaceRoot) return null;
  if (!isWorkspacePath(workspacePath)) return null;
  const rel = workspacePath.trim().slice(WORKSPACE_PREFIX.length);
  const sep = platform === 'windows' ? '\\' : '/';
  const native = rel.split(/[/\\]/).join(sep);
  const root = workspaceRoot.replace(/[/\\]+$/, '');
  return `${root}${sep}${native}`;
}

/**
 * Strip the `/workspace` prefix without resolving against a root. Useful
 * when we want to display a relative path or pass it back to the bridge.
 */
export function stripWorkspacePrefix(workspacePath: string): string {
  const trimmed = workspacePath.trim();
  if (trimmed === WORKSPACE_ROOT_TOKEN) return '';
  if (trimmed.startsWith(WORKSPACE_PREFIX)) return trimmed.slice(WORKSPACE_PREFIX.length);
  return trimmed;
}
