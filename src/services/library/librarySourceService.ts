import type { ExecRunResp, FsReadResp, FsStatResp } from '../../core/workspace';
import { isWorkspacePath, stripWorkspacePrefix } from '../../core/workspacePaths';
import type { BridgeClientFacade } from '../tools/types';
import type { LibraryDocument, LibrarySourceKind } from './types';

export const LIBRARY_MAX_DOCUMENT_BYTES = 2_000_000;
const DOCUMENT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'json', 'jsonl', 'csv', 'tsv', 'yaml', 'yml', 'xml', 'html', 'htm']);
const DATABASE_EXTENSIONS = new Set(['db', 'sqlite', 'sqlite3']);

const SQLITE_SCHEMA_HELPER = String.raw`
import json, sqlite3, sys
from pathlib import Path

payload = json.loads(sys.stdin.read() or "{}")
root = Path.cwd().resolve()
db_path = (root / payload["path"]).resolve()
try:
    db_path.relative_to(root)
except ValueError:
    raise SystemExit("database path escapes workspace")

conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
try:
    rows = conn.execute("""
      SELECT type, name, tbl_name, sql
      FROM sqlite_master
      WHERE type IN ('table', 'view', 'index', 'trigger')
        AND name NOT LIKE 'sqlite_%'
      ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 ELSE 2 END, name
      LIMIT 300
    """).fetchall()
    print(json.dumps({"objects": rows}, default=str))
finally:
    conn.close()
`.trim();

export function normalizeLibraryPath(value: string): string {
  const trimmed = value.trim().replace(/\\/g, '/');
  const workspacePath = trimmed.startsWith('/workspace/') ? trimmed : `/workspace/${trimmed.replace(/^\/+/, '')}`;
  if (!isWorkspacePath(workspacePath)) throw new Error('Choose a file inside the GatesAI workspace.');
  if (stripWorkspacePrefix(workspacePath).split('/').includes('..')) throw new Error('Library paths cannot contain "..".');
  sourceKindForPath(workspacePath);
  return workspacePath;
}

export function workspacePathFromAbsolute(
  value: string,
  workspaceRoot: string | undefined,
  platform?: string,
): string | null {
  if (!workspaceRoot) return null;
  const path = value.replace(/\\/g, '/').replace(/\/+$/, '');
  const root = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const caseInsensitive = platform?.toLowerCase().startsWith('win') ?? false;
  const comparablePath = caseInsensitive ? path.toLowerCase() : path;
  const comparableRoot = caseInsensitive ? root.toLowerCase() : root;
  if (comparablePath !== comparableRoot && !comparablePath.startsWith(`${comparableRoot}/`)) return null;
  const relative = path.slice(root.length).replace(/^\/+/, '');
  return relative ? `/workspace/${relative}` : null;
}

export function sourceKindForPath(path: string): LibrarySourceKind {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  if (DATABASE_EXTENSIONS.has(extension)) return 'database';
  if (DOCUMENT_EXTENSIONS.has(extension)) return 'document';
  throw new Error('Supported library files: text, Markdown, JSON, JSONL, CSV, TSV, YAML, XML, HTML, and SQLite.');
}

export function librarySourceId(path: string): string {
  let hash = 2166136261;
  for (const char of path.toLowerCase()) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `library-${(hash >>> 0).toString(36)}`;
}

export async function loadLibraryDocument(
  client: BridgeClientFacade,
  input: { id: string; path: string; title: string; kind: LibrarySourceKind },
): Promise<{ document: LibraryDocument; size: number }> {
  const stat = await client.request<FsStatResp>('fs.stat', { path: input.path });
  if (stat.kind !== 'file') throw new Error('Library sources must be files.');
  if (stat.size > LIBRARY_MAX_DOCUMENT_BYTES && input.kind === 'document') {
    throw new Error(`Document is larger than the ${Math.round(LIBRARY_MAX_DOCUMENT_BYTES / 1_000_000)} MB library limit.`);
  }
  const text = input.kind === 'database'
    ? await readDatabaseSchema(client, input.path)
    : (await client.request<FsReadResp>('fs.read', { path: input.path, encoding: 'utf8' })).content;
  return {
    size: stat.size,
    document: {
      id: input.id,
      path: input.path,
      title: input.title,
      kind: input.kind,
      text: input.kind === 'database'
        ? `# Database schema: ${input.title}\n\nPath: ${input.path}\n\n${text}`
        : text,
      updatedAt: stat.mtime,
    },
  };
}

async function readDatabaseSchema(client: BridgeClientFacade, path: string): Promise<string> {
  const response = await client.request<ExecRunResp>('exec.run', {
    cmd: 'python',
    args: ['-c', SQLITE_SCHEMA_HELPER],
    stdin: JSON.stringify({ path: stripWorkspacePrefix(path) }),
    timeout_ms: 10_000,
  });
  if (response.exit_code !== 0) throw new Error(response.stderr.trim() || 'Could not inspect the SQLite schema.');
  const body = JSON.parse(response.stdout) as { objects?: unknown };
  if (!Array.isArray(body.objects)) throw new Error('SQLite schema response was invalid.');
  if (body.objects.length === 0) return 'No public tables, views, indexes, or triggers.';
  return body.objects.map(value => {
    if (!Array.isArray(value)) return '';
    const [type, name, table, sql] = value;
    return [`## ${String(type)}: ${String(name)}`, table && table !== name ? `Table: ${String(table)}` : '', String(sql ?? 'Definition unavailable.')]
      .filter(Boolean).join('\n');
  }).filter(Boolean).join('\n\n');
}
