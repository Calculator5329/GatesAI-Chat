// Context-mode wiring for a chat turn: which system prompt, wire messages,
// and tool defs go out for 'full' / 'system-tools' / 'bare' / 'micro' modes.
// Stateless — called by ChatStore when assembling an LlmRequest.
import type { Message, Thread } from '../../core/types';
import type { ToolDef } from '../../core/llm';
import { splitAttachmentFooter } from '../../core/attachments';
import { flattenForWire } from '../llm/wireFormat';
import { toolRegistry } from '../tools/registry';
import { isWebLite } from '../../core/runtime';

export type ChatContextMode = NonNullable<Thread['contextMode']>;

export const MICRO_LOCAL_MAX_TOKENS = 512;

const MICRO_LOCAL_SYSTEM_PROMPT = [
  'Minimal local mode.',
  'Answer briefly. No persona.',
  'If a tool is available, call it with valid JSON. Do not print fake tool calls.',
  'Workspace paths use /workspace. Put deliverables under /workspace/artifacts/.',
  'After a successful write, stop calling tools and summarize the saved path.',
].join('\n');

const MICRO_FS_TOOL_DEF: ToolDef = {
  name: 'fs',
  description: 'Read/write/list/search files in /workspace. For edits call fs with JSON, e.g. {"action":"write","path":"/workspace/artifacts/reports/out.html","content":"..."}',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['read', 'write', 'append', 'list', 'stat', 'search', 'mkdir'] },
      path: { type: 'string' },
      content: { type: 'string' },
      encoding: { type: 'string', enum: ['utf8', 'utf-8', 'base64'] },
      query: { type: 'string' },
      recursive: { type: 'boolean' },
      max_chars: { type: 'number' },
      max_hits: { type: 'number' },
    },
    required: ['action'],
    additionalProperties: false,
  },
  strict: true,
};

const IMAGE_GEN_ADDENDUM = 'When you call image_generate, treat the tool result as queued, not successful. Tell the user the render is queued, name the backend if useful, and set expectation that it may take roughly a minute. Do not say the image was generated, completed, or successful just because the tool returned. The inline image-job card is the source of truth for pending, success, failure, cancellation, and failure reason; the app will post a completion follow-up when the job finishes.';

export function latestUserMessageContent(thread: Thread): string {
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const message = thread.messages[i];
    if (message.role === 'user') return message.content;
  }
  return '';
}

export function latestUserMessage(thread: Thread): Message | null {
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const message = thread.messages[i];
    if (message.role === 'user') return message;
  }
  return null;
}

export function latestUserPromptBody(thread: Thread): string {
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const message = thread.messages[i];
    if (message.role === 'user') return splitAttachmentFooter(message.content).body;
  }
  return '';
}

export function effectiveContextMode(thread: Thread, model: { providerId: string } | undefined): ChatContextMode {
  if (model?.providerId !== 'ollama') return 'full';
  return thread.contextMode ?? 'micro';
}

export function systemPromptForContextMode(mode: ChatContextMode, normalPrompt: () => string | undefined): string | undefined {
  if (mode === 'bare') return undefined;
  if (mode === 'micro') return MICRO_LOCAL_SYSTEM_PROMPT;
  return normalPrompt();
}

export function wireMessagesForContextMode(thread: Thread, mode: ChatContextMode) {
  if (mode === 'full') return flattenForWire(thread.messages);
  const latest = latestUserMessage(thread);
  return latest ? flattenForWire([latest]) : [];
}

export function toolsForContextMode(args: {
  mode: ChatContextMode;
  toolsAllowed: boolean;
  userText: string;
  bridgeOnline: boolean;
  imageGenAvailable?: boolean;
  webSearchAvailable?: boolean;
  semanticRecallAvailable?: boolean;
  spawnTaskAvailable?: boolean;
  toolAllowlist?: string[];
}): ToolDef[] | undefined {
  if (!args.toolsAllowed || args.mode === 'bare') return undefined;
  if (args.mode === 'micro') {
    const tools: ToolDef[] = [];
    if (!isWebLite()) {
      const sourceWorkspace = toolRegistry.get('source_workspace')?.def;
      const sourceBuild = toolRegistry.get('source_build')?.def;
      const fetchPage = toolRegistry.get('fetch_page')?.def;
      if (sourceWorkspace) tools.push(sourceWorkspace);
      if (sourceBuild) tools.push(sourceBuild);
      if (fetchPage && (args.webSearchAvailable || isFetchPageRelevant(args.userText))) tools.push(fetchPage);
    }
    if (args.toolAllowlist) {
      const thread = toolRegistry.get('thread')?.def;
      if (thread) tools.push(thread);
    }
    if (args.bridgeOnline && isMicroFsRelevant(args.userText)) tools.push(MICRO_FS_TOOL_DEF);
    const webSearch = args.webSearchAvailable ? toolRegistry.get('web_search')?.def : undefined;
    if (webSearch) tools.push(webSearch);
    const recall = args.semanticRecallAvailable ? toolRegistry.get('recall')?.def : undefined;
    if (recall) tools.push(recall);
    tools.push(...toolRegistry.toolDefsByCategory('mcp'));
    const filtered = toolRegistry.filterToolDefsForAllowlist(tools, args.toolAllowlist);
    return filtered.length > 0 ? filtered : undefined;
  }
  return toolRegistry.toolDefsForTurn({
    userText: args.userText,
    bridgeOnline: args.bridgeOnline,
    desktopRuntime: !isWebLite(),
    imageGenAvailable: args.imageGenAvailable,
    webSearchAvailable: args.webSearchAvailable,
    semanticRecallAvailable: args.semanticRecallAvailable,
    spawnTaskAvailable: args.spawnTaskAvailable,
    toolAllowlist: args.toolAllowlist,
  });
}

function isMicroFsRelevant(userText: string): boolean {
  return /\b(file|files|folder|workspace|artifact|html|css|js|json|csv|txt|md|code|script|read|write|create|make|edit|save|open)\b/i.test(userText);
}

function isFetchPageRelevant(userText: string): boolean {
  return /\b(?:url|link|website|webpage|web page|page|article|fetch|browse)\b|https?:\/\//i.test(userText);
}

export function reservedOutputTokensForContextMode(mode: ChatContextMode): number | undefined {
  return mode === 'micro' ? MICRO_LOCAL_MAX_TOKENS : undefined;
}

export function appendImageGenAddendum(systemPrompt: string | undefined, tools: { name: string }[] | undefined): string | undefined {
  if (!tools || !tools.some(t => t.name === 'image_generate')) return systemPrompt;
  return systemPrompt ? `${systemPrompt}\n\n${IMAGE_GEN_ADDENDUM}` : IMAGE_GEN_ADDENDUM;
}
