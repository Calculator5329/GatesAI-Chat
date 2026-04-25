import type { FsListResp, FsReadResp } from '../../core/workspace';

const ARTIFACT_README_ROOT = '/workspace/artifacts';
const ARTIFACT_README_PER_FILE_CHARS = 6_000;
const ARTIFACT_README_TOTAL_CHARS = 18_000;

interface ArtifactBridge {
  readonly client: {
    request<T = unknown>(op: string, data: unknown): Promise<T>;
  };
}

export async function loadArtifactReadmeInstructions(bridge: ArtifactBridge, signal: AbortSignal): Promise<string> {
  try {
    const listed = await bridge.client.request<FsListResp>('fs.list', {
      path: ARTIFACT_README_ROOT,
      recursive: true,
    });
    if (signal.aborted) return '';

    const paths = (Array.isArray(listed.entries) ? listed.entries : [])
      .filter(e => e.kind === 'file' && isArtifactReadmePath(e.path))
      .map(e => e.path)
      .sort((a, b) => a.localeCompare(b));

    const parts: string[] = [];
    let remaining = ARTIFACT_README_TOTAL_CHARS;
    for (const path of paths) {
      if (signal.aborted || remaining <= 0) break;
      try {
        const read = await bridge.client.request<FsReadResp>('fs.read', { path });
        if (signal.aborted) return '';
        if (read.encoding !== 'utf8') continue;
        const content = read.content.trim();
        if (!content) continue;
        const capped = content.slice(0, Math.min(ARTIFACT_README_PER_FILE_CHARS, remaining));
        parts.push(`[${read.path}]\n${capped}${content.length > capped.length ? '\n[truncated]' : ''}`);
        remaining -= capped.length;
      } catch {
        // A README can disappear between list and read; skip it rather than blocking the turn.
      }
    }
    return parts.join('\n\n');
  } catch {
    return '';
  }
}

export function isArtifactReadmePath(path: string): boolean {
  const normalized = path.replace(/\\/g, '/');
  if (!normalized.startsWith(`${ARTIFACT_README_ROOT}/`)) return false;
  return normalized.split('/').pop()?.toLowerCase() === 'readme.md';
}
