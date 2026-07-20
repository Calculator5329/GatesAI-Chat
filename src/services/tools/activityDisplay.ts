// Defines the activityDisplay tool contract, validation, execution, or display formatting.
// Called by ChatStore tool rounds via the registry; depends on ToolContext facades and bridge/store services.
// Invariant: tools validate inputs first and return deterministic, user-readable results.
import type { ToolActivityUi, ToolExecuteResult } from './types';

export const TOOL_DISPLAY_TEXT_ARGUMENT = 'display_text';
const MAX_TOOL_DISPLAY_TEXT_CHARS = 120;

/** Bounded plain text authored by the model for the user-facing activity row. */
export function toolDisplayText(args: Record<string, unknown>): string | undefined {
  const value = args[TOOL_DISPLAY_TEXT_ARGUMENT];
  if (typeof value !== 'string') return undefined;
  const printable = Array.from(value, character => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : character;
  }).join('');
  const oneLine = printable.replace(/\s+/g, ' ').trim();
  if (!oneLine) return undefined;
  return compactText(oneLine, MAX_TOOL_DISPLAY_TEXT_CHARS);
}

export function defaultToolUi(name: string): ToolActivityUi {
  const ui = TOOL_UI[name];
  return ui ?? {
    verb: () => 'Using',
    target: () => formatToolName(name),
    summary: result => summarizeToolResult(name, result),
  };
}

export function summarizeToolResult(name: string, result: Pick<ToolExecuteResult, 'summary' | 'content' | 'ok' | 'errorCode'>): string {
  if (result.summary?.trim()) return compactText(result.summary, 120);
  if (name === 'web_search') {
    const count = Array.from(result.content.matchAll(/^url:\s+/gm)).length;
    if (count > 0) return `Found ${count} source${count === 1 ? '' : 's'}`;
    if (result.ok === false || result.errorCode) return 'Search returned an error';
    return 'Search complete';
  }
  const parsed = result.content.match(/^summary:\s*(.+)$/im)?.[1]?.trim();
  if (parsed) return compactText(parsed, 120);
  if (result.ok === false || result.errorCode) return `${formatToolName(name)} failed`;
  const first = result.content.replace(/\s+/g, ' ').trim();
  return first ? compactText(first, 120) : `${formatToolName(name)} complete`;
}

export function shortWorkspacePath(path: string): string {
  const clean = path.replace(/\\/g, '/').replace(/^\/workspace\//, '');
  const parts = clean.split('/').filter(Boolean);
  return parts.at(-1) ?? path;
}

function stringArg(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringArrayArg(args: Record<string, unknown>, key: string): string[] {
  const value = args[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map(item => item.trim())
    : [];
}

function compactText(value: string, max: number): string {
  const oneLine = value.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 1)}…` : oneLine;
}

function domainForUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).hostname || value;
  } catch {
    return value;
  }
}

function formatToolName(name: string): string {
  return name.replace(/_/g, ' ');
}

const workspaceTarget = (args: Record<string, unknown>) => {
  const path = stringArg(args, 'path') ?? stringArg(args, 'from') ?? stringArg(args, 'to');
  return path ? shortWorkspacePath(path) : undefined;
};

const TOOL_UI: Record<string, ToolActivityUi> = {
  memory: {
    verb: args => args.action === 'list' ? 'Reading memory' : 'Updating memory',
    summary: result => summarizeToolResult('memory', result),
  },
  time: {
    verb: () => 'Checking time',
    summary: result => summarizeToolResult('time', result),
  },
  notes: {
    verb: args => args.action === 'search' ? 'Searching notes' : args.action === 'read' || args.action === 'list' ? 'Reading notes' : 'Updating notes',
    target: args => stringArg(args, 'title') ?? stringArg(args, 'query') ?? stringArg(args, 'id'),
    summary: result => summarizeToolResult('notes', result),
  },
  thread: {
    verb: args => args.action === 'list' || args.action === 'get_context' ? 'Reading thread' : 'Updating thread',
    target: args => stringArg(args, 'title') ?? stringArg(args, 'id'),
    summary: result => summarizeToolResult('thread', result),
  },
  chat_history: {
    verb: args => args.action === 'search' ? 'Searching chats' : args.action === 'read_thread' ? 'Reading chat' : 'Checking chats',
    target: args => stringArg(args, 'query') ?? stringArg(args, 'id'),
    summary: result => summarizeToolResult('chat_history', result),
  },
  workspace: {
    verb: () => 'Checking workspace',
    summary: result => summarizeToolResult('workspace', result),
  },
  fs: {
    verb: args => {
      const action = stringArg(args, 'action');
      if (action === 'write') return 'Writing';
      if (action === 'append') return 'Appending';
      if (action === 'search') return 'Searching';
      if (action === 'mkdir') return 'Creating';
      if (action === 'move') return 'Moving';
      if (action === 'copy') return 'Copying';
      if (action === 'delete') return 'Deleting';
      return 'Reading';
    },
    target: args => stringArg(args, 'query') ?? workspaceTarget(args),
    summary: result => summarizeToolResult('fs', result),
  },
  inspect_file: {
    verb: args => stringArg(args, 'action') === 'search' ? 'Searching' : 'Inspecting',
    target: args => stringArg(args, 'query') ?? workspaceTarget(args),
    summary: result => summarizeToolResult('inspect_file', result),
  },
  artifact: {
    verb: args => stringArg(args, 'action') === 'validate_html' ? 'Checking' : 'Creating',
    target: workspaceTarget,
    summary: result => summarizeToolResult('artifact', result),
  },
  terminal: {
    verb: () => 'Running',
    target: args => [stringArg(args, 'cmd'), ...stringArrayArg(args, 'args')].filter(Boolean).join(' ') || undefined,
    summary: result => summarizeToolResult('terminal', result),
  },
  python_inline: {
    verb: () => 'Running Python',
    summary: result => summarizeToolResult('python_inline', result),
  },
  sqlite_query: {
    verb: () => 'Querying SQLite',
    target: workspaceTarget,
    summary: result => summarizeToolResult('sqlite_query', result),
  },
  library: {
    verb: () => 'Searching the local library',
    target: args => typeof args.query === 'string' ? args.query : typeof args.source_id === 'string' ? args.source_id : 'approved sources',
    summary: result => summarizeToolResult('library', result),
  },
  query_script: {
    verb: () => 'Preparing script',
    target: args => stringArg(args, 'topic'),
    summary: result => summarizeToolResult('query_script', result),
  },
  git: {
    verb: args => stringArg(args, 'action') === 'commit' ? 'Committing' : 'Checking Git',
    target: args => stringArg(args, 'ref') ?? stringArg(args, 'branch') ?? stringArg(args, 'cwd'),
    summary: result => summarizeToolResult('git', result),
  },
  image_generate: {
    verb: args => (typeof args.count === 'number' && args.count > 1) ? 'Generating images' : 'Generating image',
    target: args => stringArg(args, 'filename') ?? stringArg(args, 'prompt') ?? workspaceTarget(args),
    summary: result => summarizeToolResult('image_generate', result),
  },
  describe_image: {
    verb: () => 'Describing image',
    target: workspaceTarget,
    summary: result => summarizeToolResult('describe_image', result),
  },
  web_search: {
    verb: () => 'Searching',
    target: args => stringArrayArg(args, 'queries')[0],
    summary: result => summarizeToolResult('web_search', result),
  },
  fetch_page: {
    verb: () => 'Reading',
    target: args => domainForUrl(stringArg(args, 'url')),
    summary: result => domainForUrl(result.content.match(/^Source:\s*(.+)$/m)?.[1]?.trim()) ?? summarizeToolResult('fetch_page', result),
  },
};
