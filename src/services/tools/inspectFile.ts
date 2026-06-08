// Defines the inspectFile tool contract, validation, execution, or display formatting.
// Called by ChatStore tool rounds via the registry; depends on ToolContext facades and bridge/store services.
// Invariant: tools validate inputs first and return deterministic, user-readable results.
import type { FsEntry, FsListResp, FsReadResp, FsSearchResp } from '../../core/workspace';
import { BridgeOfflineError } from '../bridge/client';
import { decodeFsRead, stripBom } from './textDecode';
import { isProtectedChatHistoryPath, isProtectedChatHistoryScope } from './protectedWorkspacePaths';
import type { Tool, ToolContext } from './types';

type InspectFormat = 'csv' | 'json' | 'txt';
type CsvRow = Record<string, string>;
type CsvDelimiter = ',' | '\t' | ';' | '|';

interface DecodedReadResp extends FsReadResp {
  content: string;
  detectedEncoding: string;
}

interface CsvTable {
  headers: string[];
  rows: CsvRow[];
  delimiter: CsvDelimiter;
  emptyRowCount: number;
  raggedRowCount: number;
}

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const MAX_CELL_CHARS = 240;
const MAX_LINE_CHARS = 320;
const MAX_JSON_STRING_CHARS = 320;

/**
 * inspect_file - semantic, read-only inspection for data/text files.
 *
 * This intentionally sits above `fs`: `fs` moves bytes, this tool turns
 * supported file types into compact answers the model can reason over.
 */
export const inspectFileTool: Tool = {
  def: {
    name: 'inspect_file',
    description: [
      'Inspect CSV, JSON, and text files without loading the whole file into model context.',
      '',
      'Use this before `fs.read` when the user asks questions about attached or workspace data files.',
      'Artifact-first workflow: call `workspace_profile` before raw attachment reads, check /workspace/artifacts for existing processed JSON summaries, then inspect /workspace/attachments only if artifacts do not answer the question.',
      '',
      'Actions:',
      '- `workspace_profile` - compact artifact-first listing of artifacts, attachments, notes/scripts, and optional search hints.',
      '- `profile` - summarize structure: CSV columns/row count, JSON shape, text line count.',
      '- `preview` - return a small sample of rows, records, or lines.',
      '- `search` - search within parsed rows, JSON values, or text lines.',
      '- `extract` - select CSV columns, a JSON path, or a text line range.',
      '- `aggregate` - CSV only: count, sum, avg, min, max with optional group_by.',
      '',
      'Supported day-one formats: csv, json, txt. Later: py/js/ts/go structure, then pdf/docx/xlsx.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['workspace_profile', 'profile', 'preview', 'search', 'extract', 'aggregate'] },
        path: { type: 'string', description: 'Workspace-relative or /workspace/-prefixed path.' },
        format: { type: 'string', enum: ['csv', 'json', 'txt'], description: 'Override format detection.' },
        limit: { type: 'number', description: 'Max rows/records/lines to return. Default 10, max 100.' },
        query: { type: 'string', description: 'Search query for search or workspace_profile hints.' },
        columns: { type: 'array', items: { type: 'string' }, description: 'CSV columns to extract.' },
        start_line: { type: 'number', description: '1-based text start line for extract.' },
        end_line: { type: 'number', description: '1-based text end line for extract.' },
        json_path: { type: 'string', description: 'Simple JSON path like $.items[0].name or $.items.' },
        op: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'], description: 'CSV aggregate operation.' },
        column: { type: 'string', description: 'CSV column for aggregate operation.' },
        group_by: { type: 'string', description: 'Optional CSV grouping column for aggregate.' },
      },
      required: ['action'],
    },
  },
  meta: {
    category: 'filesystem',
    isReadOnly: () => true,
    hasSideEffects: () => false,
    resultPolicy: { maxChars: 16_000, summarizeLargeOutput: true },
    validate: args => {
      const action = typeof args.action === 'string' ? args.action : '';
      const path = typeof args.path === 'string' ? args.path.trim() : '';
      if (action !== 'workspace_profile' && !path) {
        return {
          errorCode: 'missing_required_argument',
          summary: '`path` is required for inspect_file unless action is "workspace_profile".',
          fix: 'Retry with a /workspace path, or use action "workspace_profile" to inspect workspace-level artifacts without a path.',
          retryable: true,
        };
      }
      return null;
    },
  },

  async execute(args, ctx) {
    if (!ctx.bridge) return 'Error: bridge unavailable in this context.';
    if (!ctx.bridge.isOnline) return 'Error: bridge offline. Start gatesai-bridge.';

    const action = strArg(args, 'action');
    const path = strArg(args, 'path');
    if (!action) return 'Error: `action` is required for inspect_file.';
    if (action === 'workspace_profile') return inspectWorkspaceProfile(args, ctx);
    if (!path) return 'Error: `path` is required for inspect_file.';
    if (isProtectedChatHistoryPath(path) || isProtectedChatHistoryScope(path)) {
      return 'Error: app-managed chat history files are not exposed through inspect_file. Use the `chat_history` tool instead.';
    }

    try {
      const resp = await ctx.bridge.client.request<FsReadResp>('fs.read', { path });
      const decoded = decodeReadResponse(resp);
      if (!decoded.ok) return `Error: ${decoded.error}`;

      const format = detectFormat(args, decoded.resp);
      if (!format) {
        return `Error: unsupported file format for ${resp.path}. Supported: csv, json, txt.`;
      }

      switch (format) {
        case 'csv':
          return inspectCsv(action, args, decoded.resp);
        case 'json':
          return inspectJson(action, args, decoded.resp);
        case 'txt':
          return inspectText(action, args, decoded.resp);
      }
    } catch (err) {
      if (err instanceof BridgeOfflineError) return `Error: ${err.message}`;
      return `Error: ${(err as Error).message}`;
    }
  },
};

async function inspectWorkspaceProfile(args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  if (!ctx.bridge) return 'Error: bridge unavailable in this context.';
  if (!ctx.bridge.isOnline) return 'Error: bridge offline. Start gatesai-bridge.';

  const sections = [
    { title: 'artifacts', path: '/workspace/artifacts' },
    { title: 'attachments', path: '/workspace/attachments' },
    { title: 'notes/scripts', path: '/workspace/notes' },
  ];
  const lines = [
    'Workspace profile',
    'Artifacts first: inspect /workspace/artifacts for processed JSON summaries before opening raw attachments.',
    '',
  ];

  for (const section of sections) {
    try {
      const resp = await ctx.bridge.client.request<FsListResp>('fs.list', { path: section.path });
      lines.push(`${section.title}:`);
      lines.push(...formatEntries(resp.entries ?? []));
      if (resp.truncated) lines.push('- truncated: true');
      lines.push('');
    } catch (err) {
      lines.push(`${section.title}:`);
      lines.push(`- unavailable: ${(err as Error).message}`);
      lines.push('');
    }
  }

  const query = strArg(args, 'query');
  if (query) {
    try {
      const resp = await ctx.bridge.client.request<FsSearchResp>('fs.search', { path: '/workspace/artifacts', query, max_hits: 8 });
      lines.push('search hints:');
      const hits = resp.hits ?? [];
      if (hits.length === 0) {
        lines.push(`- No artifact matches for "${query}".`);
      } else {
        lines.push(...hits.slice(0, 8).map(hit => `- ${hit.path}:${hit.line}: ${truncate(hit.snippet, MAX_LINE_CHARS)}`));
      }
      if (resp.truncated) lines.push('- truncated: true');
    } catch (err) {
      lines.push('search hints:');
      lines.push(`- unavailable: ${(err as Error).message}`);
    }
  }

  return lines.join('\n').trimEnd();
}

function formatEntries(entries: FsEntry[]): string[] {
  if (entries.length === 0) return ['- (empty or missing)'];
  return entries
    .slice(0, 40)
    .map(entry => `- ${entry.kind === 'dir' ? 'dir ' : 'file'} ${entry.size ?? '-'} ${entry.path}`);
}

function inspectCsv(action: string, args: Record<string, unknown>, resp: DecodedReadResp): string {
  const table = parseCsv(resp.content);
  if (typeof table === 'string') return `Error: ${table}`;
  const { headers, rows, delimiter, emptyRowCount, raggedRowCount } = table;
  const limit = limitArg(args);

  switch (action) {
    case 'profile':
      return [
        `path: ${resp.path}`,
        'format: csv',
        `detected_encoding: ${resp.detectedEncoding}`,
        `detected_delimiter: ${delimiterName(delimiter)}`,
        `size: ${resp.size}`,
        `rows: ${rows.length}`,
        `column_count: ${headers.length}`,
        `columns: ${headers.join(', ')}`,
        `likely_date_columns: ${likelyDateColumns(rows, headers).join(', ') || '(none)'}`,
        `empty_rows: ${emptyRowCount}`,
        `ragged_rows: ${raggedRowCount}`,
        '',
        'column profile:',
        ...headers.map(h => `- ${h}: ${profileCsvColumn(rows, h)}`),
      ].join('\n');
    case 'preview':
      return [
        `path: ${resp.path}`,
        'format: csv',
        `detected_encoding: ${resp.detectedEncoding}`,
        `detected_delimiter: ${delimiterName(delimiter)}`,
        `showing: ${Math.min(limit, rows.length)} of ${rows.length} rows`,
        '',
        renderCsvRows(headers, rows.slice(0, limit)),
      ].join('\n');
    case 'search':
      return searchCsv(args, headers, rows, limit);
    case 'extract':
      return extractCsv(args, headers, rows, limit);
    case 'aggregate':
      return aggregateCsv(args, headers, rows, limit);
    default:
      return `Error: unknown action "${action}" for CSV.`;
  }
}

function inspectJson(action: string, args: Record<string, unknown>, resp: DecodedReadResp): string {
  let value: unknown;
  try {
    value = JSON.parse(resp.content);
  } catch (err) {
    return `Error: invalid JSON: ${(err as Error).message}`;
  }
  const limit = limitArg(args);

  switch (action) {
    case 'profile':
      return [
        `path: ${resp.path}`,
        'format: json',
        `detected_encoding: ${resp.detectedEncoding}`,
        `size: ${resp.size}`,
        `root: ${jsonKind(value)}`,
        '',
        ...profileJson(value, '$', 0, new Set()),
      ].join('\n');
    case 'preview':
      return [
        `path: ${resp.path}`,
        'format: json',
        `detected_encoding: ${resp.detectedEncoding}`,
        '',
        JSON.stringify(compactJson(value, limit), null, 2),
      ].join('\n');
    case 'search':
      return searchJson(args, value, limit);
    case 'extract': {
      const path = strArg(args, 'json_path') || '$';
      const extracted = readJsonPath(value, path);
      if (!extracted.ok) return `Error: ${extracted.error}`;
      return [
        `path: ${resp.path}`,
        'format: json',
        `detected_encoding: ${resp.detectedEncoding}`,
        `json_path: ${path}`,
        '',
        JSON.stringify(compactJson(extracted.value, limit), null, 2),
      ].join('\n');
    }
    default:
      return `Error: action "${action}" is not supported for JSON.`;
  }
}

function inspectText(action: string, args: Record<string, unknown>, resp: DecodedReadResp): string {
  const lines = splitLines(resp.content);
  const limit = limitArg(args);

  switch (action) {
    case 'profile':
      return [
        `path: ${resp.path}`,
        'format: txt',
        `detected_encoding: ${resp.detectedEncoding}`,
        `size: ${resp.size}`,
        `lines: ${lines.length}`,
        `characters: ${resp.content.length}`,
      ].join('\n');
    case 'preview':
      return renderNumberedLines(lines.slice(0, limit), 1);
    case 'search':
      return searchText(args, lines, limit);
    case 'extract': {
      const start = Math.max(1, numberArg(args, 'start_line') ?? 1);
      const end = Math.min(lines.length, numberArg(args, 'end_line') ?? Math.min(lines.length, start + limit - 1));
      if (end < start) return 'Error: `end_line` must be greater than or equal to `start_line`.';
      return renderNumberedLines(lines.slice(start - 1, end), start);
    }
    default:
      return `Error: action "${action}" is not supported for text.`;
  }
}

function detectFormat(args: Record<string, unknown>, resp: FsReadResp): InspectFormat | null {
  const explicit = strArg(args, 'format').toLowerCase();
  if (explicit === 'csv' || explicit === 'json' || explicit === 'txt') return explicit;
  const path = resp.path.toLowerCase();
  const mime = resp.mime.toLowerCase();
  if (path.endsWith('.csv') || mime.includes('csv')) return 'csv';
  if (path.endsWith('.json') || mime.includes('json')) return 'json';
  if (path.endsWith('.txt') || mime.startsWith('text/')) return 'txt';
  return null;
}

function parseCsv(content: string): CsvTable | string {
  const delimiter = detectCsvDelimiter(content);
  const parsedRows = parseCsvRows(content, delimiter);
  const emptyRowCount = parsedRows.filter(row => row.every(cell => cell.trim().length === 0)).length;
  const rawRows = parsedRows.filter(row => row.some(cell => cell.trim().length > 0));
  if (rawRows.length === 0) return 'CSV file is empty.';
  const rawHeaders = rawRows[0].map(h => stripBom(h).trim());
  // Excel-exported CSVs often have trailing empty columns or sparse header
  // rows. Auto-name those slots instead of failing the whole inspection.
  const headers = rawHeaders.map((h, i) => h || `column_${i + 1}`);
  const seen = new Set<string>();
  for (let i = 0; i < headers.length; i++) {
    let name = headers[i];
    let n = 2;
    while (seen.has(name)) name = `${headers[i]}_${n++}`;
    headers[i] = name;
    seen.add(name);
  }
  const raggedRowCount = rawRows.slice(1).filter(raw => raw.length !== headers.length).length;
  const rows = rawRows.slice(1).map(raw => {
    const out: CsvRow = {};
    headers.forEach((h, i) => { out[h] = raw[i] ?? ''; });
    return out;
  });
  return { headers, rows, delimiter, emptyRowCount, raggedRowCount };
}

function parseCsvRows(content: string, delimiter: CsvDelimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];
    if (ch === '"') {
      if (quoted && next === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (ch === delimiter && !quoted) {
      row.push(cell);
      cell = '';
      continue;
    }
    if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }

  row.push(cell);
  rows.push(row);
  return rows;
}

function profileCsvColumn(rows: CsvRow[], column: string): string {
  const values = rows.map(r => r[column]).filter(v => v !== '');
  const nums = values.map(parseNumber).filter((n): n is number => n !== null);
  const numeric = values.length > 0 && nums.length === values.length;
  const unique = new Set(values).size;
  const empty = rows.length - values.length;
  const range = numeric ? `, min ${Math.min(...nums)}, max ${Math.max(...nums)}` : '';
  const sample = values.length > 0 ? `, sample ${truncate(values[0], 60)}` : '';
  return `${numeric ? 'numeric' : 'text'}, unique ${unique}, empty ${empty}${range}${sample}`;
}

function renderCsvRows(headers: string[], rows: CsvRow[]): string {
  return [headers.join(','), ...rows.map(row => headers.map(h => csvCell(row[h])).join(','))].join('\n');
}

function csvCell(value: string): string {
  const capped = truncate(value, MAX_CELL_CHARS);
  return /[",\n\r]/.test(capped) ? `"${capped.replace(/"/g, '""')}"` : capped;
}

function searchCsv(args: Record<string, unknown>, headers: string[], rows: CsvRow[], limit: number): string {
  const query = strArg(args, 'query').toLowerCase();
  if (!query) return 'Error: `query` is required for search.';
  const hits = rows.filter(row => headers.some(h => row[h].toLowerCase().includes(query))).slice(0, limit);
  if (hits.length === 0) return `No CSV rows matched "${query}".`;
  return [`matches: ${hits.length}`, '', renderCsvRows(headers, hits)].join('\n');
}

function extractCsv(args: Record<string, unknown>, headers: string[], rows: CsvRow[], limit: number): string {
  const requested = stringArrayArg(args, 'columns');
  const columns = requested.length > 0 ? requested : headers;
  const missing = columns.filter(c => !headers.includes(c));
  if (missing.length > 0) return `Error: unknown CSV columns: ${missing.join(', ')}. Available: ${headers.join(', ')}.`;
  return renderCsvRows(columns, rows.slice(0, limit));
}

function aggregateCsv(args: Record<string, unknown>, headers: string[], rows: CsvRow[], limit: number): string {
  const op = strArg(args, 'op') || 'count';
  const column = strArg(args, 'column');
  const groupBy = strArg(args, 'group_by');
  const needsColumn = ['sum', 'avg', 'min', 'max'].includes(op);
  if (needsColumn && !column) return 'Error: `column` is required for sum/avg/min/max.';
  if (column && !headers.includes(column)) return `Error: unknown CSV column "${column}". Available: ${headers.join(', ')}.`;
  if (groupBy && !headers.includes(groupBy)) return `Error: unknown CSV column "${groupBy}". Available: ${headers.join(', ')}.`;

  const groups = new Map<string, CsvRow[]>();
  for (const row of rows) {
    const key = groupBy ? row[groupBy] ?? '' : 'all';
    const group = groups.get(key);
    if (group) {
      group.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  const entries = [...groups.entries()];
  const lines = [
    `op: ${op}${column ? ` column: ${column}` : ''}${groupBy ? ` group_by: ${groupBy}` : ''}`,
    `groups: ${entries.length}`,
  ];
  for (const [key, group] of entries.slice(0, limit)) {
    lines.push(`${truncate(key, MAX_CELL_CHARS)}: ${aggregateGroup(op, column, group)}`);
  }
  if (entries.length > limit) lines.push(`truncated: true (showing ${limit} of ${entries.length} groups)`);
  return lines.join('\n');
}

function aggregateGroup(op: string, column: string, rows: CsvRow[]): string {
  if (op === 'count') return String(rows.length);
  const nums = rows.map(r => parseNumber(r[column])).filter((n): n is number => n !== null);
  if (nums.length === 0) return 'no numeric values';
  if (op === 'sum') return String(nums.reduce((a, b) => a + b, 0));
  if (op === 'avg') return String(nums.reduce((a, b) => a + b, 0) / nums.length);
  if (op === 'min') return String(Math.min(...nums));
  if (op === 'max') return String(Math.max(...nums));
  return `Error: unknown aggregate op "${op}".`;
}

function profileJson(value: unknown, path: string, depth: number, seen: Set<string>): string[] {
  if (depth > 3) return [`${path}: ${jsonKind(value)}`];
  if (Array.isArray(value)) {
    const lines = [`${path}: array(${value.length})`];
    if (value.length > 0) lines.push(...profileJson(value[0], `${path}[]`, depth + 1, seen));
    return lines;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    const signature = `${path}:${keys.join(',')}`;
    if (seen.has(signature)) return [`${path}: object keys ${keys.join(', ')}`];
    seen.add(signature);
    const lines = [`${path}: object keys ${keys.join(', ')}`];
    for (const key of keys.slice(0, 12)) {
      const child = obj[key];
      if (child && typeof child === 'object') lines.push(...profileJson(child, `${path}.${key}`, depth + 1, seen));
    }
    return lines;
  }
  return [`${path}: ${jsonKind(value)}`];
}

function compactJson(value: unknown, limit: number): unknown {
  if (Array.isArray(value)) return value.slice(0, limit).map(v => compactJson(v, limit));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value).slice(0, 30)) out[key] = compactJson(child, limit);
    return out;
  }
  if (typeof value === 'string') return truncate(value, MAX_JSON_STRING_CHARS);
  return value;
}

function searchJson(args: Record<string, unknown>, value: unknown, limit: number): string {
  const query = strArg(args, 'query').toLowerCase();
  if (!query) return 'Error: `query` is required for search.';
  const hits: string[] = [];
  visitJson(value, '$', (path, node) => {
    if (hits.length >= limit) return;
    if (typeof node === 'string' && node.toLowerCase().includes(query)) hits.push(`${path}: ${node}`);
    if (typeof node === 'number' || typeof node === 'boolean') {
      const text = String(node);
      if (text.toLowerCase().includes(query)) hits.push(`${path}: ${text}`);
    }
  });
  return hits.length > 0 ? hits.join('\n') : `No JSON values matched "${query}".`;
}

function visitJson(value: unknown, path: string, visit: (path: string, value: unknown) => void): void {
  visit(path, value);
  if (Array.isArray(value)) {
    value.forEach((child, i) => visitJson(child, `${path}[${i}]`, visit));
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) visitJson(child, `${path}.${key}`, visit);
  }
}

function readJsonPath(value: unknown, path: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (path !== '$' && !path.startsWith('$.')) return { ok: false, error: '`json_path` must start with $.' };
  const tokens = path === '$' ? [] : path.slice(2).split('.');
  let current = value;
  for (const token of tokens) {
    const match = /^([A-Za-z0-9_$-]+)(?:\[(\d+)])?$/.exec(token);
    if (!match) return { ok: false, error: `unsupported JSON path segment "${token}".` };
    const [, key, index] = match;
    if (!current || typeof current !== 'object' || Array.isArray(current)) return { ok: false, error: `path segment "${key}" is not an object.` };
    current = (current as Record<string, unknown>)[key];
    if (index !== undefined) {
      if (!Array.isArray(current)) return { ok: false, error: `path segment "${key}" is not an array.` };
      current = current[Number(index)];
    }
  }
  return { ok: true, value: current };
}

function jsonKind(value: unknown): string {
  if (Array.isArray(value)) return `array(${value.length})`;
  if (value === null) return 'null';
  return typeof value;
}

function searchText(args: Record<string, unknown>, lines: string[], limit: number): string {
  const query = strArg(args, 'query').toLowerCase();
  if (!query) return 'Error: `query` is required for search.';
  const hits: string[] = [];
  lines.forEach((line, i) => {
    if (hits.length < limit && line.toLowerCase().includes(query)) hits.push(`${i + 1}: ${line}`);
  });
  return hits.length > 0 ? hits.join('\n') : `No text lines matched "${query}".`;
}

function renderNumberedLines(lines: string[], startLine: number): string {
  return lines.map((line, i) => `${startLine + i}: ${truncate(line, MAX_LINE_CHARS)}`).join('\n');
}

function splitLines(content: string): string[] {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
}

function decodeReadResponse(resp: FsReadResp): { ok: true; resp: DecodedReadResp } | { ok: false; error: string } {
  const decoded = decodeFsRead(resp);
  if (decoded.kind === 'binary') {
    return { ok: false, error: `${resp.path} is not a text file (${decoded.reason}); inspect_file only supports csv, json, txt.` };
  }
  return { ok: true, resp: { ...resp, content: decoded.text, detectedEncoding: decoded.encoding } };
}

function detectCsvDelimiter(content: string): CsvDelimiter {
  const candidates: CsvDelimiter[] = [',', '\t', ';', '|'];
  const lines = splitLines(content).filter(line => line.trim()).slice(0, 10);
  let best: CsvDelimiter = ',';
  let bestScore = -1;
  for (const candidate of candidates) {
    const counts = lines.map(line => countDelimiter(line, candidate));
    const score = counts.reduce((sum, count) => sum + count, 0);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function countDelimiter(line: string, delimiter: CsvDelimiter): number {
  let quoted = false;
  let count = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (ch === delimiter && !quoted) {
      count++;
    }
  }
  return count;
}

function delimiterName(delimiter: CsvDelimiter): string {
  if (delimiter === '\t') return 'tab';
  if (delimiter === ',') return 'comma';
  if (delimiter === ';') return 'semicolon';
  return 'pipe';
}

function likelyDateColumns(rows: CsvRow[], headers: string[]): string[] {
  return headers.filter(header => {
    const values = rows.map(row => row[header]).filter(Boolean);
    if (values.length === 0) return false;
    const dateLike = values.filter(value => /^\d{4}-\d{1,2}-\d{1,2}$/.test(value) || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(value)).length;
    return dateLike / values.length >= 0.8;
  });
}

function parseNumber(value: string): number | null {
  const cleaned = value.replace(/[$,%\s,]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function strArg(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  return typeof v === 'string' ? v.trim() : '';
}

function numberArg(args: Record<string, unknown>, key: string): number | null {
  const v = args[key];
  return typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : null;
}

function limitArg(args: Record<string, unknown>): number {
  const n = numberArg(args, 'limit') ?? DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, n));
}

function stringArrayArg(args: Record<string, unknown>, key: string): string[] {
  const v = args[key];
  return Array.isArray(v) ? v.filter(item => typeof item === 'string').map(item => item.trim()).filter(Boolean) : [];
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...[truncated ${value.length - maxChars} chars]`;
}
