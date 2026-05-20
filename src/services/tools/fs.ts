// Defines the fs tool contract, validation, execution, or display formatting.
// Called by ChatStore tool rounds via the registry; depends on ToolContext facades and bridge/store services.
// Invariant: tools validate inputs first and return deterministic, user-readable results.
import type {
  FsListResp,
  FsReadResp,
  FsSearchResp,
  FsStatResp,
  FsWriteResp,
} from '../../core/workspace';
import { BridgeOfflineError } from '../bridge/client';
import { decodeFsRead } from './textDecode';
import {
  filterProtectedChatHistoryEntries,
  filterProtectedChatHistoryHits,
  isProtectedChatHistoryPath,
  isProtectedChatHistoryScope,
} from './protectedWorkspacePaths';
import type { Tool } from './types';

/**
 * fs — read and write files inside ~/GatesAI/workspace/ via the bridge.
 *
 * Every action is path-addressed; the bridge enforces the path jail
 * (rejects `..`, drive letters, symlinks pointing out of root). Paths
 * may be written either as `/workspace/notes/foo.md` or `notes/foo.md`
 * — both resolve identically.
 *
 * If the bridge is offline, every action returns a friendly error and
 * the model can decide whether to ask the user to start it. We don't
 * try to fall back to anything else — workspace is bridge-only.
 */
export const fsTool: Tool = {
  def: {
    name: 'fs',
    description: [
      'Read and write files inside the bridge workspace folder.',
      '',
      'Path contract:',
      '  /workspace/... is the model-facing namespace for this `fs` tool and for artifact paths you show the user.',
      '  The bridge maps those paths to its real local workspace root, which may be Windows, macOS, or Linux.',
      '  Do not put /workspace/... into scripts as an absolute OS path; scripts run from the workspace root and should use relative paths or cwd.',
      '',
      'Workspace layout:',
      '  /workspace/attachments/  — files the user uploaded; treat as read-only',
      '  /workspace/notes/        — your scratch space; write freely',
      '  /workspace/artifacts/    — final outputs you produced for the user',
      '    /workspace/artifacts/images/api/   — OpenRouter / hosted image-generation outputs',
      '    /workspace/artifacts/images/local/ — local ComfyUI image-generation outputs',
      '    /workspace/artifacts/data/         — reusable JSON/CSV/SQLite/data outputs',
      '    /workspace/artifacts/reports/      — user-facing docs, markdown, HTML, PDFs, and summaries',
      '    /workspace/artifacts/exports/      — finished deliverables that do not fit the categories above',
      '',
      'Actions:',
      '• `read` — read a file. Returns content (utf8 for text, base64 for binary), size, mime.',
      '• `write` — write/overwrite a file. `encoding: "base64"` for binary; default utf8 (`utf-8` is accepted as an alias).',
      '• `append` — append to a file. Same shape as `write`.',
      '• `list` — list a directory. `recursive: true` walks the tree (capped at 500 entries / depth 10).',
      '• `delete` — delete a file or recursively delete a folder.',
      '• `move` — rename/move from `from` to `to`.',
      '• `copy` — copy `from` to `to`.',
      '• `mkdir` — create a directory (recursive, no error if it exists).',
      '• `stat` — file info: kind, size, mtime, mime.',
      '• `search` — substring search across files in a path. Returns matching lines with line numbers.',
      '',
      'Bulk/performance guidance:',
      '  For large transforms, write scripts or generated data to files instead of pasting large content into chat.',
      '  Put final deliverables in a typed /workspace/artifacts/ subfolder instead of the artifact root, and validate them with stats, schema checks, ranges, or spot checks.',
      '  Only batch independent fs actions; if a later action depends on a write/copy/move, wait for that result first.',
      '',
      'Requires the gatesai-bridge companion process to be running locally. If you get a "bridge offline" error, ask the user to start it.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['read', 'write', 'append', 'list', 'delete', 'move', 'copy', 'mkdir', 'stat', 'search'],
        },
        path: { type: 'string', description: 'Workspace-relative or /workspace/-prefixed path.' },
        from: { type: 'string', description: 'Source path (for move / copy).' },
        to:   { type: 'string', description: 'Destination path (for move / copy).' },
        content: { type: 'string', description: 'File content (for write / append).' },
        encoding: { type: 'string', enum: ['utf8', 'utf-8', 'base64'], description: 'Content encoding for write/append/read. Default utf8; `utf-8` is accepted as an alias.' },
        recursive: { type: 'boolean', description: 'Recursive list (for list).' },
        query: { type: 'string', description: 'Search query (for search).' },
        max_hits: { type: 'number', description: 'Max matches to return (for search). Default 100.' },
        max_chars: { type: 'number', description: 'For read, max characters returned to the model before truncating.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    strict: true,
  },
  meta: {
    category: 'filesystem',
    isReadOnly: args => ['read', 'list', 'stat', 'search'].includes(String(args.action ?? '')),
    hasSideEffects: args => !['read', 'list', 'stat', 'search'].includes(String(args.action ?? '')),
    resultPolicy: { maxChars: 12_000, summarizeLargeOutput: true },
    validate: validateFsArgs,
  },

  async execute(args, ctx) {
    if (!ctx.bridge) return 'Error: bridge unavailable in this context.';
    if (!ctx.bridge.isOnline) return 'Error: bridge offline. Start gatesai-bridge.';

    const action = typeof args.action === 'string' ? args.action.trim() : '';
    if (!action) {
      return 'Error: `action` is required for fs. Valid: read, write, append, list, delete, move, copy, mkdir, stat, search.';
    }
    const protectedPathError = validateProtectedChatHistoryAccess(action, args);
    if (protectedPathError) return protectedPathError;
    try {
      switch (action) {
        case 'read':   return await doRead(args, ctx);
        case 'write':  return await doWrite(args, ctx, false);
        case 'append': return await doWrite(args, ctx, true);
        case 'list':   return await doList(args, ctx);
        case 'delete': return await doDelete(args, ctx);
        case 'move':   return await doMove(args, ctx, 'fs.move');
        case 'copy':   return await doMove(args, ctx, 'fs.copy');
        case 'mkdir':  return await doMkdir(args, ctx);
        case 'stat':   return await doStat(args, ctx);
        case 'search': return await doSearch(args, ctx);
        default:       return `Error: unknown action "${action}". Valid: read, write, append, list, delete, move, copy, mkdir, stat, search.`;
      }
    } catch (err) {
      if (err instanceof BridgeOfflineError) return `Error: ${err.message}`;
      return `Error: ${(err as Error).message}`;
    }
  },
};

function validateFsArgs(args: Record<string, unknown>) {
  const action = strArg(args, 'action').trim();
  switch (action) {
    case 'read':
    case 'delete':
    case 'mkdir':
    case 'stat':
      return requireStringArg(args, 'path', action);
    case 'write':
    case 'append':
      return requireStringArg(args, 'path', action)
        ?? requirePresentStringArg(args, 'content', action);
    case 'move':
    case 'copy':
      return requireStringArg(args, 'from', action)
        ?? requireStringArg(args, 'to', action);
    case 'search':
      return requireStringArg(args, 'query', action);
    case 'list':
      return null;
    default:
      return null;
  }
}

function requireStringArg(args: Record<string, unknown>, key: string, action: string) {
  const value = args[key];
  if (typeof value === 'string' && value.trim() !== '') return null;
  return {
    errorCode: 'missing_required_argument',
    summary: `\`${key}\` is required for fs action "${action}".`,
    fix: `Retry fs with { "action": "${action}", "${key}": "..." } and include any other required fields for that action.`,
    retryable: true,
  };
}

function requirePresentStringArg(args: Record<string, unknown>, key: string, action: string) {
  if (typeof args[key] === 'string') return null;
  return {
    errorCode: 'missing_required_argument',
    summary: `\`${key}\` is required for fs action "${action}".`,
    fix: `Retry fs with { "action": "${action}", "${key}": "..." } and include any other required fields for that action.`,
    retryable: true,
  };
}

async function doRead(args: Record<string, unknown>, ctx: Parameters<Tool['execute']>[1]): Promise<string> {
  const path = strArg(args, 'path');
  if (!path) return 'Error: `path` is required for read.';
  const wantsBase64 = args.encoding === 'base64';
  const resp = await ctx.bridge!.client.request<FsReadResp>('fs.read', {
    path,
    encoding: wantsBase64 ? 'base64' : undefined,
  });

  const header = [
    `path: ${resp.path}`,
    `mime: ${resp.mime}`,
    `size: ${resp.size}`,
  ];

  // Caller explicitly asked for base64 — they know what they're doing.
  if (wantsBase64) {
    const maxChars = readMaxChars(args);
    const truncated = resp.content.length > maxChars;
    const content = truncated ? resp.content.slice(0, maxChars) : resp.content;
    return [
      ...header,
      'encoding: base64',
      truncated ? `truncated: true (showing first ${maxChars} of ${resp.content.length} base64 chars)` : '',
      '',
      content,
    ].filter(line => line !== '').join('\n');
  }

  const decoded = decodeFsRead(resp);
  if (decoded.kind === 'binary') {
    return [
      ...header,
      `kind: binary (${decoded.reason})`,
      'No content shown. Use `inspect_file` for structured files, or call `fs.read` with `encoding: "base64"` only if you really need the raw bytes.',
    ].join('\n');
  }

  const maxChars = readMaxChars(args);
  const truncated = decoded.text.length > maxChars;
  const content = truncated ? decoded.text.slice(0, maxChars) : decoded.text;
  return [
    ...header,
    `encoding: ${decoded.encoding}`,
    truncated ? `truncated: true (showing first ${maxChars} of ${decoded.text.length} chars; use fs.search or read with a narrower max_chars)` : '',
    '',
    content,
  ].filter(line => line !== '').join('\n');
}

function readMaxChars(args: Record<string, unknown>): number {
  return typeof args.max_chars === 'number' && Number.isFinite(args.max_chars)
    ? Math.max(1, Math.floor(args.max_chars))
    : 12_000;
}

async function doWrite(args: Record<string, unknown>, ctx: Parameters<Tool['execute']>[1], append: boolean): Promise<string> {
  const path = strArg(args, 'path');
  if (!path) return `Error: \`path\` is required for ${append ? 'append' : 'write'}.`;
  if (typeof args.content !== 'string') return `Error: \`content\` is required for ${append ? 'append' : 'write'}.`;
  const encoding = args.encoding === 'base64' ? 'base64' : 'utf8';
  const resp = await ctx.bridge!.client.request<FsWriteResp>('fs.write', {
    path, content: args.content, encoding, append,
  });
  return `${append ? 'Appended' : 'Wrote'} ${resp.bytes} bytes to ${resp.path}`;
}

async function doList(args: Record<string, unknown>, ctx: Parameters<Tool['execute']>[1]): Promise<string> {
  const path = strArg(args, 'path') || '/workspace';
  const recursive = args.recursive === true;
  const resp = await ctx.bridge!.client.request<FsListResp>('fs.list', { path, recursive });
  const rawEntries = Array.isArray(resp.entries) ? resp.entries : [];
  const entries = recursive ? filterProtectedChatHistoryEntries(rawEntries) : rawEntries;
  if (entries.length === 0) return `${resp.path} is empty.`;
  const lines = entries.map(e => {
    const tag = e.kind === 'dir' ? 'd' : '-';
    const size = e.size != null ? `${e.size}b`.padStart(8) : '       -';
    return `${tag} ${size}  ${e.path}`;
  });
  if (resp.truncated) lines.push(`(truncated; showing first ${entries.length})`);
  return lines.join('\n');
}

async function doDelete(args: Record<string, unknown>, ctx: Parameters<Tool['execute']>[1]): Promise<string> {
  const path = strArg(args, 'path');
  if (!path) return 'Error: `path` is required for delete.';
  await ctx.bridge!.client.request('fs.delete', { path });
  return `Deleted ${path}`;
}

async function doMove(args: Record<string, unknown>, ctx: Parameters<Tool['execute']>[1], op: 'fs.move' | 'fs.copy'): Promise<string> {
  const from = strArg(args, 'from');
  const to = strArg(args, 'to');
  if (!from || !to) return `Error: \`from\` and \`to\` are required for ${op === 'fs.move' ? 'move' : 'copy'}.`;
  await ctx.bridge!.client.request(op, { from, to });
  return `${op === 'fs.move' ? 'Moved' : 'Copied'} ${from} → ${to}`;
}

async function doMkdir(args: Record<string, unknown>, ctx: Parameters<Tool['execute']>[1]): Promise<string> {
  const path = strArg(args, 'path');
  if (!path) return 'Error: `path` is required for mkdir.';
  await ctx.bridge!.client.request('fs.mkdir', { path });
  return `Created directory ${path}`;
}

async function doStat(args: Record<string, unknown>, ctx: Parameters<Tool['execute']>[1]): Promise<string> {
  const path = strArg(args, 'path');
  if (!path) return 'Error: `path` is required for stat.';
  const resp = await ctx.bridge!.client.request<FsStatResp>('fs.stat', { path });
  return [
    `path: ${resp.path}`,
    `kind: ${resp.kind}`,
    `size: ${resp.size}`,
    `mtime: ${new Date(resp.mtime).toISOString()}`,
    resp.mime ? `mime: ${resp.mime}` : '',
  ].filter(Boolean).join('\n');
}

async function doSearch(args: Record<string, unknown>, ctx: Parameters<Tool['execute']>[1]): Promise<string> {
  const query = strArg(args, 'query');
  if (!query) return 'Error: `query` is required for search.';
  const path = strArg(args, 'path') || '/workspace';
  const max_hits = typeof args.max_hits === 'number' ? args.max_hits : undefined;
  const resp = await ctx.bridge!.client.request<FsSearchResp>('fs.search', { query, path, max_hits });
  const hits = filterProtectedChatHistoryHits(Array.isArray(resp.hits) ? resp.hits : []);
  if (hits.length === 0) return `No matches for "${query}" under ${path}.`;
  const lines = hits.map(h => `${h.path}:${h.line}: ${h.snippet}`);
  if (resp.truncated) lines.push(`(truncated)`);
  return lines.join('\n');
}

function strArg(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === 'string' ? v : '';
}

function validateProtectedChatHistoryAccess(action: string, args: Record<string, unknown>): string | null {
  const path = strArg(args, 'path');
  const from = strArg(args, 'from');
  const to = strArg(args, 'to');
  const paths = [path, from, to].filter(Boolean);
  if (paths.some(isProtectedChatHistoryPath)) {
    return 'Error: app-managed chat history files are not exposed through fs. Use the `chat_history` tool instead.';
  }
  if (action === 'search' && path && isProtectedChatHistoryScope(path)) {
    return 'Error: app-managed chat history files are not exposed through fs.search. Use the `chat_history` tool instead.';
  }
  if (action === 'list' && path && isProtectedChatHistoryScope(path)) {
    return 'Error: app-managed chat history files are not exposed through fs.list. Use the `chat_history` tool instead.';
  }
  return null;
}
