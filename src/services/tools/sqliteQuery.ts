// Defines the sqliteQuery tool contract, validation, execution, or display formatting.
// Called by ChatStore tool rounds via the registry; depends on ToolContext facades and bridge/store services.
// Invariant: tools validate inputs first and return deterministic, user-readable results.
import type { ExecRunResp } from '../../core/workspace';
import { describeBridgeError, requireBridge } from './requireBridge';
import { denyProtectedChatHistoryPath } from './protectedWorkspacePaths';
import type { Tool } from './types';

const SQLITE_HELPER = String.raw`
import json, sqlite3, sys
from pathlib import Path

payload = json.loads(sys.stdin.read() or "{}")
root = Path.cwd().resolve()
db_path = (root / payload["path"]).resolve()
try:
    db_path.relative_to(root)
except ValueError:
    raise SystemExit("database path escapes workspace")

params = payload.get("params") or []
max_rows = int(payload.get("max_rows") or 200)
conn = sqlite3.connect(str(db_path))
conn.row_factory = sqlite3.Row
try:
    cur = conn.execute(payload["sql"], params)
    rows = cur.fetchmany(max_rows + 1)
    truncated = len(rows) > max_rows
    rows = rows[:max_rows]
    columns = [d[0] for d in (cur.description or [])]
    out_rows = [[row[c] for c in columns] for row in rows]
    print(json.dumps({"columns": columns, "rows": out_rows, "row_count": len(out_rows), "truncated": truncated}, default=str))
finally:
    conn.close()
`.trim();

export const sqliteQueryTool: Tool = {
  def: {
    name: 'sqlite_query',
    description: [
      'Run a scoped read-only SQLite query against a workspace-relative .sqlite/.db file.',
      '',
      'Safety contract:',
      '  Uses Python sqlite3 through cmd "python" and args ["-c", helper]. It does not call sqlite3 shell, PowerShell, cmd.exe, pipes, redirects, or dot-commands.',
      '  `path` must be workspace-relative and must not contain `..`.',
      '  `sql` must be a single read-only SELECT/WITH/PRAGMA statement. SQLite dot-commands such as .shell are rejected.',
      '',
      'Returns compact JSON-shaped rows with columns, row count, and truncation status.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Workspace-relative SQLite database path, e.g. artifacts/data.db.' },
        sql: { type: 'string', description: 'Single read-only SELECT/WITH/PRAGMA statement. No dot-commands.' },
        params: { type: 'array', items: { type: 'string' }, description: 'Optional positional parameters.' },
        max_rows: { type: 'number', description: 'Maximum rows to return. Default 200, cap 1000.' },
        timeout_ms: { type: 'number', description: 'Kill the process after this many ms. Default 10000.' },
      },
      required: ['path', 'sql'],
    },
  },
  meta: {
    category: 'filesystem',
    isReadOnly: () => true,
    hasSideEffects: () => false,
    resultPolicy: { maxChars: 12_000, summarizeLargeOutput: true },
  },

  async execute(args, ctx) {
    const guard = requireBridge(ctx);
    if (!guard.ok) return guard.error;

    const path = typeof args.path === 'string' ? args.path.trim() : '';
    const sql = typeof args.sql === 'string' ? args.sql.trim() : '';
    if (!path) return 'Error: `path` is required.';
    if (!sql) return 'Error: `sql` is required.';
    const pathError = validateWorkspaceRelativePath(path);
    if (pathError) return `Error: ${pathError}`;
    const protectedDenial = denyProtectedChatHistoryPath(
      'sqlite_query',
      path,
      'Error: app-managed chat history files are not exposed through sqlite_query. Use the `chat_history` tool instead.',
    );
    if (protectedDenial) return protectedDenial;
    const sqlError = validateSql(sql);
    if (sqlError) return `Error: ${sqlError}`;

    const params = Array.isArray(args.params) ? args.params : [];
    const maxRows = typeof args.max_rows === 'number'
      ? Math.min(1000, Math.max(1, Math.floor(args.max_rows)))
      : 200;
    const timeout_ms = typeof args.timeout_ms === 'number' ? args.timeout_ms : 10_000;

    try {
      const resp = await guard.bridge.client.request<ExecRunResp>('exec.run', {
        cmd: 'python',
        args: ['-c', SQLITE_HELPER],
        cwd: undefined,
        stdin: JSON.stringify({ path, sql, params, max_rows: maxRows }),
        timeout_ms,
      });
      return formatSqliteResult(path, resp);
    } catch (err) {
      return describeBridgeError(err);
    }
  },
};

function validateWorkspaceRelativePath(path: string): string | null {
  if (path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path)) return '`path` must be workspace-relative.';
  if (path.split(/[\\/]+/).includes('..')) return '`path` must not contain `..`.';
  if (!/\.(sqlite|sqlite3|db)$/i.test(path)) return '`path` must point to a .sqlite, .sqlite3, or .db file.';
  return null;
}

function validateSql(sql: string): string | null {
  if (sql.trimStart().startsWith('.')) return 'SQLite dot-commands are not allowed.';
  const withoutTrailingSemicolon = sql.replace(/;\s*$/, '');
  if (withoutTrailingSemicolon.includes(';')) return '`sql` must be a single statement.';
  if (!/^\s*(select|with|pragma)\b/i.test(sql)) return '`sql` must be read-only (SELECT, WITH, or PRAGMA).';
  return null;
}

function formatSqliteResult(path: string, resp: ExecRunResp): string {
  if (resp.exit_code !== 0) {
    return [
      `$ sqlite_query ${path}`,
      `[exit ${resp.exit_code}, ${resp.duration_ms}ms${resp.truncated ? ', truncated' : ''}]`,
      resp.stderr.trim() ? `--- stderr ---\n${resp.stderr.trimEnd()}` : '',
      resp.stdout.trim() ? `--- stdout ---\n${resp.stdout.trimEnd()}` : '',
    ].filter(Boolean).join('\n');
  }
  try {
    const parsed = parseSqliteJsonResult(JSON.parse(resp.stdout));
    const columns = Array.isArray(parsed.columns) ? parsed.columns.join(', ') : '';
    const rows = Array.isArray(parsed.rows) ? parsed.rows : [];
    return [
      `path: ${path}`,
      `columns: ${columns}`,
      `row_count: ${parsed.row_count ?? rows.length}${parsed.truncated ? ' (truncated)' : ''}`,
      '',
      ...rows.map(row => JSON.stringify(row)),
    ].join('\n');
  } catch {
    return [
      `$ sqlite_query ${path}`,
      `[exit ${resp.exit_code}, ${resp.duration_ms}ms${resp.truncated ? ', truncated' : ''}]`,
      resp.stdout.trimEnd(),
    ].join('\n');
  }
}

function parseSqliteJsonResult(value: unknown): { columns?: unknown[]; rows?: unknown[]; row_count?: number; truncated?: boolean } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    columns: Array.isArray(record.columns) ? record.columns : undefined,
    rows: Array.isArray(record.rows) ? record.rows : undefined,
    row_count: typeof record.row_count === 'number' && Number.isFinite(record.row_count) ? record.row_count : undefined,
    truncated: typeof record.truncated === 'boolean' ? record.truncated : undefined,
  };
}
