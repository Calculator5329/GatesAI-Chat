// Defines the chatHistory tool contract, validation, execution, or display formatting.
// Called by ChatStore tool rounds via the registry; depends on ToolContext facades and bridge/store services.
// Invariant: tools validate inputs first and return deterministic, user-readable results.
import type { AssistantMessage, Message, Thread } from '../../core/types';
import type { Tool } from './types';

const DEFAULT_LIMIT = 10;
const MAX_RECENT = 30;
const MAX_SEARCH = 50;
const MAX_READ_MESSAGES = 80;
const SNIPPET_CHARS = 260;
const MESSAGE_CHARS = 1200;

export const chatHistoryTool: Tool = {
  def: {
    name: 'chat_history',
    description: [
      'Search and read bounded slices of persisted chat history.',
      '',
      'Actions:',
      '- `recent` - list recent visible threads with id, title, timestamps, message count, summary, and context when present.',
      '- `search` - search thread titles, user/assistant text, tool names/results, and workspace paths. Requires `query`.',
      '- `read_thread` - read a bounded transcript slice. Optional `id` defaults to the current thread. Returns the latest messages unless `offset` is provided.',
      '',
      'Use this instead of reading app-managed history files from the workspace.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['recent', 'search', 'read_thread'] },
        id: { type: 'string', description: 'Thread id for read_thread. Defaults to current thread.' },
        query: { type: 'string', description: 'Search query for search.' },
        limit: { type: 'number', description: 'Maximum rows/messages. Defaults to 10.' },
        offset: { type: 'number', description: '0-based message offset for read_thread. If omitted, returns the latest messages.' },
      },
      required: ['action'],
    },
  },
  meta: {
    category: 'thread',
    isReadOnly: () => true,
    hasSideEffects: () => false,
    resultPolicy: { maxChars: 12_000, summarizeLargeOutput: true },
    validate: args => {
      if (args.action === 'search' && (typeof args.query !== 'string' || !args.query.trim())) {
        return {
          errorCode: 'missing_required_argument',
          summary: '`query` is required for chat_history search.',
          fix: 'Retry with { "action": "search", "query": "..." }.',
          retryable: true,
        };
      }
      return null;
    },
  },

  async execute(args, ctx) {
    const action = strArg(args, 'action');
    switch (action) {
      case 'recent':
        return recentThreads(ctx.chat.threads, limitArg(args, DEFAULT_LIMIT, MAX_RECENT));
      case 'search':
        return searchThreads(ctx.chat.threads, strArg(args, 'query'), limitArg(args, DEFAULT_LIMIT, MAX_SEARCH));
      case 'read_thread':
        return readThread(ctx.chat.threads, strArg(args, 'id') || ctx.threadId, limitArg(args, DEFAULT_LIMIT, MAX_READ_MESSAGES), offsetArg(args));
      default:
        return `Error: unknown action "${action}". Valid: recent, search, read_thread.`;
    }
  },
};

function recentThreads(threads: Thread[], limit: number): string {
  const visible = visibleThreads(threads)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
  if (visible.length === 0) return 'No visible threads.';
  return visible.map(thread => [
    `id: ${thread.id}`,
    `title: ${thread.title || 'Untitled conversation'}`,
    `created_at: ${new Date(thread.createdAt).toISOString()}`,
    `updated_at: ${new Date(thread.updatedAt).toISOString()}`,
    `messages: ${thread.messages.length}`,
    thread.summary?.trim() ? `summary: ${oneLine(thread.summary, SNIPPET_CHARS)}` : '',
    thread.threadContext?.trim() ? `context: ${oneLine(thread.threadContext, SNIPPET_CHARS)}` : '',
  ].filter(Boolean).join('\n')).join('\n\n');
}

function searchThreads(threads: Thread[], query: string, limit: number): string {
  const needle = query.trim().toLowerCase();
  if (!needle) return 'Error: `query` is required for chat_history search.';
  const hits: string[] = [];
  for (const thread of visibleThreads(threads).sort((a, b) => b.updatedAt - a.updatedAt)) {
    addThreadHit(hits, thread, needle, limit);
    if (hits.length >= limit) break;
    for (const message of thread.messages) {
      addMessageHits(hits, thread, message, needle, limit);
      if (hits.length >= limit) break;
    }
    if (hits.length >= limit) break;
  }
  return hits.length
    ? hits.join('\n\n')
    : `No chat history matches for "${query.trim()}".`;
}

function readThread(threads: Thread[], id: string, limit: number, offset: number | null): string {
  const thread = threads.find(t => t.id === id && t.deletedAt == null);
  if (!thread) return `Error: no visible thread with id "${id}".`;
  const start = offset == null ? Math.max(0, thread.messages.length - limit) : Math.min(Math.max(0, offset), thread.messages.length);
  const slice = thread.messages.slice(start, start + limit);
  const header = [
    `id: ${thread.id}`,
    `title: ${thread.title || 'Untitled conversation'}`,
    `updated_at: ${new Date(thread.updatedAt).toISOString()}`,
    `messages: ${thread.messages.length}`,
    `showing: ${slice.length} from offset ${start}`,
  ];
  if (thread.summary?.trim()) header.push(`summary: ${oneLine(thread.summary, SNIPPET_CHARS)}`);
  if (thread.threadContext?.trim()) header.push(`context: ${oneLine(thread.threadContext, SNIPPET_CHARS)}`);
  const transcript = slice.map((message, index) => formatMessage(message, start + index));
  return [...header, '', ...transcript].join('\n');
}

function addThreadHit(hits: string[], thread: Thread, needle: string, limit: number): void {
  const fields = [
    ['title', thread.title],
    ['summary', thread.summary ?? ''],
    ['context', thread.threadContext ?? ''],
  ] as const;
  for (const [field, value] of fields) {
    if (hits.length >= limit) return;
    const snippet = matchSnippet(value, needle);
    if (snippet) hits.push(formatHit(thread, field, null, snippet));
  }
}

function addMessageHits(hits: string[], thread: Thread, message: Message, needle: string, limit: number): void {
  const contentSnippet = matchSnippet(message.content, needle);
  if (contentSnippet && hits.length < limit) hits.push(formatHit(thread, `${message.role}.content`, message.id, contentSnippet));

  for (const path of workspacePaths(message.content)) {
    if (hits.length >= limit) return;
    if (path.toLowerCase().includes(needle)) hits.push(formatHit(thread, `${message.role}.workspace_path`, message.id, path));
  }

  if (message.role !== 'assistant') return;
  const assistant = message as AssistantMessage;
  for (const call of assistant.toolCalls ?? []) {
    if (hits.length >= limit) return;
    const haystack = `${call.name} ${safeJson(call.arguments)}`;
    const snippet = matchSnippet(haystack, needle);
    if (snippet) hits.push(formatHit(thread, `tool_call.${call.name}`, message.id, snippet));
  }
  for (const result of assistant.toolResults ?? []) {
    if (hits.length >= limit) return;
    const haystack = `${result.toolName} ${result.content}`;
    const snippet = matchSnippet(haystack, needle);
    if (snippet) hits.push(formatHit(thread, `tool_result.${result.toolName}`, message.id, snippet));
  }
}

function formatHit(thread: Thread, field: string, messageId: string | null, snippet: string): string {
  return [
    `thread_id: ${thread.id}`,
    `title: ${thread.title || 'Untitled conversation'}`,
    `field: ${field}`,
    messageId ? `message_id: ${messageId}` : '',
    `updated_at: ${new Date(thread.updatedAt).toISOString()}`,
    `snippet: ${snippet}`,
  ].filter(Boolean).join('\n');
}

function formatMessage(message: Message, index: number): string {
  const lines = [
    `#${index} ${message.role} ${message.id} ${new Date(message.createdAt).toISOString()}`,
    oneLine(message.content, MESSAGE_CHARS),
  ];
  if (message.role === 'assistant') {
    const assistant = message as AssistantMessage;
    if (assistant.toolCalls?.length) {
      lines.push(`tool_calls: ${assistant.toolCalls.map(call => call.name).join(', ')}`);
    }
    if (assistant.toolResults?.length) {
      lines.push(`tool_results: ${assistant.toolResults.map(result => `${result.toolName}(${result.content.length} chars)`).join(', ')}`);
    }
  }
  return lines.join('\n');
}

function visibleThreads(threads: Thread[]): Thread[] {
  return threads.filter(thread => thread.deletedAt == null);
}

function matchSnippet(value: string, needle: string): string | null {
  const haystack = value.toLowerCase();
  const index = haystack.indexOf(needle);
  if (index < 0) return null;
  const start = Math.max(0, index - 90);
  const end = Math.min(value.length, index + needle.length + 170);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < value.length ? '...' : '';
  return `${prefix}${oneLine(value.slice(start, end), SNIPPET_CHARS)}${suffix}`;
}

function workspacePaths(value: string): string[] {
  return value.match(/\/workspace\/[^\s)`'"]+/g) ?? [];
}

function oneLine(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > maxChars ? `${compact.slice(0, maxChars).trimEnd()}...` : compact;
}

function limitArg(args: Record<string, unknown>, fallback: number, max: number): number {
  return typeof args.limit === 'number' && Number.isFinite(args.limit)
    ? Math.min(max, Math.max(1, Math.floor(args.limit)))
    : fallback;
}

function offsetArg(args: Record<string, unknown>): number | null {
  return typeof args.offset === 'number' && Number.isFinite(args.offset)
    ? Math.max(0, Math.floor(args.offset))
    : null;
}

function strArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === 'string' ? value : '';
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}
