// Defines the sourceWorkspace tool contract, validation, execution, or display formatting.
// Called by ChatStore tool rounds via the registry; depends on ToolContext facades and bridge/store services.
// Invariant: tools validate inputs first and return deterministic, user-readable results.
import type {
  SourceWorkspaceList,
  SourceWorkspaceRead,
  SourceWorkspaceSearch,
  SourceWorkspaceStat,
  SourceWorkspaceStatus,
} from '../sourceWorkspace';
import type { Tool } from './types';

export const sourceWorkspaceTool: Tool = {
  def: {
    name: 'source_workspace',
    description: [
      'Inspect and edit the app-managed duplicate GatesAI Chat source codebase.',
      '',
      'This is NOT the bridge /workspace. Use source:// paths such as source://src/app/App.tsx.',
      'The source workspace must be prepared before file actions. Use action `prepare` when status says it is missing or stale.',
      '',
      'Actions:',
      '• `status` — report bundled snapshot version/hash and prepared duplicate-source location.',
      '• `prepare` — copy the bundled source snapshot into the managed writable source workspace.',
      '• `list` — list source files. `recursive: true` walks up to 500 entries.',
      '• `read` — read a UTF-8 source file. Use `max_chars` for large files.',
      '• `write` — overwrite a UTF-8 source file inside the duplicate source workspace.',
      '• `stat` — return file or directory metadata.',
      '• `search` — substring search over UTF-8 files under a source path.',
      '',
      'Safety contract:',
      '  Paths are always relative to the prepared duplicate source root.',
      '  Do not use this for user artifacts; use /workspace tools for those.',
      '  This tool does not run builds, regenerate installers, delete files, or modify the live installed app.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'prepare', 'list', 'read', 'write', 'stat', 'search'],
        },
        path: { type: 'string', description: 'source:// path or relative source path.' },
        content: { type: 'string', description: 'UTF-8 file content for write.' },
        recursive: { type: 'boolean', description: 'Recursive list.' },
        query: { type: 'string', description: 'Search query.' },
        max_hits: { type: 'number', description: 'Maximum search hits. Default 100.' },
        max_chars: { type: 'number', description: 'Maximum read characters returned. Default 12000.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    strict: true,
  },
  meta: {
    category: 'source',
    isReadOnly: args => ['status', 'list', 'read', 'stat', 'search'].includes(String(args.action ?? '')),
    hasSideEffects: args => ['prepare', 'write'].includes(String(args.action ?? '')),
    resultPolicy: { maxChars: 12_000, summarizeLargeOutput: true },
    validate: validateSourceWorkspaceArgs,
  },

  async execute(args) {
    const {
      getSourceWorkspaceStatus,
      listSourceWorkspace,
      prepareSourceWorkspace,
      readSourceWorkspace,
      searchSourceWorkspace,
      statSourceWorkspace,
      writeSourceWorkspace,
    } = await import('../sourceWorkspace');
    const action = typeof args.action === 'string' ? args.action : '';
    switch (action) {
      case 'status':
        return formatStatus(await getSourceWorkspaceStatus());
      case 'prepare':
        return formatStatus(await prepareSourceWorkspace());
      case 'list':
        return formatList(await listSourceWorkspace(strArg(args, 'path'), args.recursive === true));
      case 'read':
        return formatRead(await readSourceWorkspace(strArg(args, 'path'), numArg(args, 'max_chars')));
      case 'write': {
        const resp = await writeSourceWorkspace(strArg(args, 'path'), strArg(args, 'content'));
        return `Wrote ${resp.bytes} bytes to ${resp.path}`;
      }
      case 'stat':
        return formatStat(await statSourceWorkspace(strArg(args, 'path')));
      case 'search':
        return formatSearch(await searchSourceWorkspace(
          strArg(args, 'query'),
          strArg(args, 'path'),
          numArg(args, 'max_hits'),
        ));
      default:
        return 'Error: `action` is required for source_workspace. Valid: status, prepare, list, read, write, stat, search.';
    }
  },
};

function validateSourceWorkspaceArgs(args: Record<string, unknown>) {
  const action = strArg(args, 'action');
  switch (action) {
    case 'read':
    case 'write':
    case 'stat':
      return requireString(args, 'path', action)
        ?? (action === 'write' ? requirePresentString(args, 'content', action) : null);
    case 'search':
      return requireString(args, 'query', action);
    default:
      return null;
  }
}

function formatStatus(status: SourceWorkspaceStatus): string {
  return [
    `available: ${status.available ? 'true' : 'false'}`,
    `prepared: ${status.prepared ? 'true' : 'false'}`,
    `stale: ${status.stale ? 'true' : 'false'}`,
    `version: ${status.version ?? 'unknown'}`,
    `content_hash: ${status.contentHash ?? 'unknown'}`,
    `file_count: ${status.fileCount ?? 'unknown'}`,
    `total_bytes: ${status.totalBytes ?? 'unknown'}`,
    `source_root: ${status.sourceRoot || 'unknown'}`,
    status.preparedAtUnix ? `prepared_at: ${new Date(status.preparedAtUnix * 1000).toISOString()}` : '',
    status.lastError ? `last_error: ${status.lastError}` : '',
  ].filter(Boolean).join('\n');
}

function formatList(resp: SourceWorkspaceList): string {
  if (!resp.entries.length) return `${resp.path} is empty.`;
  const lines = resp.entries.map(entry => {
    const tag = entry.kind === 'dir' ? 'd' : '-';
    const size = entry.size != null ? `${entry.size}b`.padStart(8) : '       -';
    return `${tag} ${size}  ${entry.path}`;
  });
  if (resp.truncated) lines.push('(truncated)');
  return lines.join('\n');
}

function formatRead(resp: SourceWorkspaceRead): string {
  return [
    `path: ${resp.path}`,
    `size: ${resp.size}`,
    resp.truncated ? 'truncated: true' : '',
    '',
    resp.content,
  ].filter(line => line !== '').join('\n');
}

function formatStat(resp: SourceWorkspaceStat): string {
  return [
    `path: ${resp.path}`,
    `kind: ${resp.kind}`,
    `size: ${resp.size}`,
    `mtime: ${new Date(resp.mtime).toISOString()}`,
  ].join('\n');
}

function formatSearch(resp: SourceWorkspaceSearch): string {
  if (!resp.hits.length) return `No matches for "${resp.query}".`;
  const lines = resp.hits.map(hit => `${hit.path}:${hit.line}: ${hit.snippet}`);
  if (resp.truncated) lines.push('(truncated)');
  return lines.join('\n');
}

function strArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value : '';
}

function numArg(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function requireString(args: Record<string, unknown>, key: string, action: string) {
  if (strArg(args, key).trim()) return null;
  return {
    errorCode: 'missing_required_argument',
    summary: `\`${key}\` is required for source_workspace action "${action}".`,
    fix: `Retry source_workspace with { "action": "${action}", "${key}": "..." }.`,
    retryable: true,
  };
}

function requirePresentString(args: Record<string, unknown>, key: string, action: string) {
  if (typeof args[key] === 'string') return null;
  return {
    errorCode: 'missing_required_argument',
    summary: `\`${key}\` is required for source_workspace action "${action}".`,
    fix: `Retry source_workspace with { "action": "${action}", "${key}": "..." }.`,
    retryable: true,
  };
}
