import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import ReactMarkdown from 'react-markdown';
import { observer } from 'mobx-react-lite';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { PluggableList } from 'unified';
import type { ComponentPropsWithoutRef, ReactNode, MouseEvent } from 'react';
import type { AssistantMessage, Message, ToolResult } from '../../core/types';
import type { ToolCall } from '../../core/llm';
import { resolveUserAttachments, type RenderedAttachment } from '../../core/attachments';
import { isWorkspacePath } from '../../core/workspacePaths';
import { ToolCallView, ToolResultView } from '../ui';
import { useBridgeStore, useUiStore, useExecStreamStore, useImageJobStore } from '../../stores/context';
import type { BridgeStore } from '../../stores/BridgeStore';
import { LiveExecTail } from './LiveExecTail';
import { hasActiveTextSelection, shouldCopyMessageFromClick } from './messageCopy';
import { WorkspaceImage } from './WorkspaceImage';
import { ImageJobCard } from './ImageJobCard';
import { splitMarkdownChunks } from './markdownChunks';
import { HtmlArtifactPreview, isHtmlWorkspacePath } from './HtmlArtifactPreview';
import { MermaidDiagram } from './MermaidDiagram';
import { Icons } from '../ui/icons';

/**
 * Lazy plugin loader for the heavy rehype plugins. `rehype-highlight` pulls
 * highlight.js (~120KB) and `rehype-katex` pulls katex (~56KB) plus its CSS
 * and font assets. Most messages have no code fences or math, so we only
 * load these when content actually needs them, then notify subscribed
 * MarkdownChunks to re-render with the new plugin set.
 *
 * Until each plugin is loaded, markdown still renders correctly — code blocks
 * just appear unstyled, and math renders as raw \\(...\\) text. The plugin
 * promise is kicked off on first detection and cached forever.
 */
type RehypePlugin = PluggableList[number];
let highlightPlugin: RehypePlugin | null = null;
let highlightLoading: Promise<void> | null = null;
let katexPlugin: RehypePlugin | null = null;
let katexLoading: Promise<void> | null = null;
let pluginVersion = 0;
const pluginListeners = new Set<() => void>();

function subscribePlugins(listener: () => void) {
  pluginListeners.add(listener);
  return () => { pluginListeners.delete(listener); };
}
function getPluginVersion() { return pluginVersion; }
function bumpPluginVersion() {
  pluginVersion += 1;
  for (const l of pluginListeners) l();
}

function ensureHighlight() {
  if (highlightPlugin || highlightLoading) return;
  highlightLoading = import('rehype-highlight').then(mod => {
    highlightPlugin = mod.default as RehypePlugin;
    bumpPluginVersion();
  }).catch(() => { /* swallow — markdown still renders without highlight */ });
}

function ensureKatex() {
  if (katexPlugin || katexLoading) return;
  katexLoading = Promise.all([
    import('rehype-katex'),
    import('katex/dist/katex.min.css'),
  ]).then(([mod]) => {
    katexPlugin = [mod.default, { throwOnError: false, strict: 'ignore' }] as RehypePlugin;
    bumpPluginVersion();
  }).catch(() => { /* swallow */ });
}

const HAS_CODE_FENCE = (s: string) => s.includes('```');
// Block math `$$...$$` or LaTeX-style \( \[ delimiters. Single-dollar inline math
// is disabled (`singleDollarTextMath: false` on remarkMath), so no `$...$` case here.
const MATH_RE = /\$\$[\s\S]+?\$\$|\\\(|\\\[/;
const HAS_MATH = (s: string) => MATH_RE.test(s);

interface MessageProps {
  message: Message;
  modelName: string | undefined;
  streaming: boolean;
  preTokenLabel?: 'thinking' | 'responding' | 'compacting' | 'generating';
  onRegenerate?: (messageId: string) => void;
  onBranch?: (messageId: string) => void;
  onEditAndResend?: (messageId: string, text: string) => void;
  actionsDisabled?: boolean;
}

type CopyState = 'idle' | 'hint' | 'copied' | 'failed';

let copyHintSeen = false;
const EMPTY_TOOL_CALLS: NonNullable<AssistantMessage['toolCalls']> = [];
const EMPTY_TOOL_RESULTS: NonNullable<AssistantMessage['toolResults']> = [];
const EMPTY_WORK_NOTES: NonNullable<AssistantMessage['workNotes']> = [];
const MAX_VISIBLE_TOOL_ACTIVITIES = 4;
const STREAM_SMOOTH_FRAME_MS = 24;
const STREAM_SMOOTH_MIN_CHARS = 2;
const STREAM_SMOOTH_MAX_CHARS = 48;

/**
 * One message = one user turn or one assistant turn (which may include
 * multiple internal tool round trips, all collapsed onto this single
 * `AssistantMessage`). Always renders as one frame with one kicker:
 *
 *   ┌ kicker (CLAUDE SONNET · 11:18 PM) ─────────────────────────────┐
 *   │ tool calls + their results, in execution order                  │
 *   │ markdown body (the model's closing prose)                       │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * Tools render ABOVE the prose because chronologically that's what
 * happened — the model reached for tools first, then composed its reply.
 * Calls and results are paired by `toolCallId`; results that haven't
 * landed yet (still executing) just don't render until they arrive.
 *
 * Wrapped in `observer` because `content`, `toolCalls`, and `toolResults`
 * all mutate in place during streaming.
 */
export const EditorialMessage = observer(function EditorialMessage({
  message,
  modelName,
  streaming,
  preTokenLabel,
  onRegenerate,
  onBranch,
  onEditAndResend,
  actionsDisabled = false,
}: MessageProps) {
  const ui = useUiStore();
  const execStream = useExecStreamStore();
  const imageJobs = useImageJobStore();
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);
  const isUser = message.role === 'user';
  const when = useMemo(
    () => message.createdAt
      ? new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : '',
    [message.createdAt],
  );
  const headLabel = isUser
    ? `You${when ? ' · ' + when : ''}`
    : `${modelName ?? 'Assistant'}${when ? ' · ' + when : ''}`;

  const calls = !isUser ? message.toolCalls ?? EMPTY_TOOL_CALLS : EMPTY_TOOL_CALLS;
  const results = !isUser ? message.toolResults ?? EMPTY_TOOL_RESULTS : EMPTY_TOOL_RESULTS;
  const workNotes = !isUser ? visibleWorkNotes(message.workNotes ?? EMPTY_WORK_NOTES) : EMPTY_WORK_NOTES;
  const pairedResults = useMemo(() => pairToolResults(calls, results), [calls, results]);
  const pendingCalls = useMemo(() => (
    calls.filter((_, index) => !pairedResults[index])
  ), [calls, pairedResults]);
  const hasContent = message.content.trim().length > 0;
  const visibleAssistantContent = useSmoothedStreamingText(
    message.content,
    !isUser && streaming && hasContent,
  );
  const toolActivities = !isUser
    ? activityForToolState({ pendingCalls: streaming ? pendingCalls : EMPTY_TOOL_CALLS, calls, results, streaming })
    : [];
  const hasCalls = calls.length > 0;
  const hasWorkNotes = workNotes.length > 0;
  const userContent = isUser && message.role === 'user' ? resolveUserAttachments(message) : null;
  const hasLoadingImageJob = !isUser && results.some(result => (
    result.artifacts?.some(artifact => {
      if (artifact.kind !== 'image-job') return false;
      const job = imageJobs.findById(artifact.jobId);
      return job?.status === 'pending' || job?.status === 'running';
    }) ?? false
  ));
  const shouldHideAssistantTextForImageJob = !isUser && results.some(result =>
    result.artifacts?.some(artifact => artifact.kind === 'image-job') ?? false
  );
  const hasRenderableArtifacts = !isUser && results.some(result => (result.artifacts?.length ?? 0) > 0);
  const hasPendingTerminal = !isUser && pendingCalls.some(call => call.name === 'terminal');
  const hasSearchCalls = !isUser && calls.some(call => call.name === 'web_search');
  const showToolTrace = hasCalls && !(toolActivities.length > 0 && hasSearchCalls && !hasRenderableArtifacts && !hasPendingTerminal);

  useEffect(() => {
    if (copyState === 'idle') return;
    const timeout = window.setTimeout(() => setCopyState('idle'), copyState === 'hint' ? 2400 : 1200);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  function showCopyHint() {
    if (copyHintSeen || copyState !== 'idle') return;
    copyHintSeen = true;
    setCopyState('hint');
  }

  const canCopy = message.content.trim().length > 0;

  async function copyMessage() {
    if (!canCopy) return;
    try {
      await navigator.clipboard.writeText(message.content);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  function onActionClick(event: MouseEvent) {
    event.stopPropagation();
  }

  function submitEdit() {
    const next = editText.trim();
    if (!next) return;
    onEditAndResend?.(message.id, next);
    setEditing(false);
  }

  return (
    <div
      className="editorial-message"
      aria-label="Message. Ctrl or Command click to copy."
      onFocus={showCopyHint}
      onClick={(event) => {
        if (!shouldCopyMessageFromClick({
          button: event.button,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          hasSelection: hasActiveTextSelection(),
        })) return;
        void copyMessage();
      }}
      style={{
        padding: '24px 0',
        ...(streaming ? {} : { borderBottom: '1px solid var(--border)' }),
        position: 'relative',
      }}
    >
      <div style={{
        fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: isUser ? 'var(--text-faint)' : 'var(--accent)',
        marginBottom: 10,
        fontFamily: '"Geist", sans-serif',
      }}>
        {headLabel}
        {copyState === 'copied' && <span className="message-copy-feedback"> · copied</span>}
        {copyState === 'failed' && <span className="message-copy-feedback"> · copy failed</span>}
      </div>
      {copyState === 'hint' && (
        <div className="message-copy-hint" aria-hidden="true">
          Ctrl/Cmd + click to copy
        </div>
      )}
      <div className="message-actions" onClick={onActionClick}>
        <button type="button" title={canCopy ? 'Copy message' : 'Nothing to copy yet'} aria-label="Copy message" disabled={!canCopy} onClick={() => void copyMessage()}>
          <Icons.Copy />
        </button>
        {!isUser && (
          <button
            type="button"
            title="Regenerate response"
            aria-label="Regenerate response"
            disabled={actionsDisabled || streaming || !onRegenerate}
            onClick={() => onRegenerate?.(message.id)}
          >
            <Icons.Refresh />
          </button>
        )}
        {isUser && (
          <button
            type="button"
            title="Edit and resend"
            aria-label="Edit and resend"
            disabled={actionsDisabled || streaming || !onEditAndResend}
            onClick={() => {
              setEditText(message.content);
              setEditing(true);
            }}
          >
            <Icons.Edit />
          </button>
        )}
        <button
          type="button"
          title="Branch conversation"
          aria-label="Branch conversation"
          disabled={actionsDisabled || streaming || !onBranch}
          onClick={() => onBranch?.(message.id)}
        >
          <Icons.Branch />
        </button>
      </div>
      {toolActivities.length > 0 && (
        <div
          style={{
            display: 'grid',
            gap: 6,
            marginBottom: showToolTrace || hasContent || streaming ? 10 : 0,
          }}
        >
          {toolActivities.map((activity, index) => (
            <LiveStatusIndicator
              key={`${activity.label}-${index}`}
              label={activity.label}
              title={activity.title}
              active={activity.active ?? false}
            />
          ))}
        </div>
      )}
      {hasWorkNotes && (
        <div style={{ marginBottom: showToolTrace || hasContent || streaming ? 10 : 0 }}>
          {workNotes.map((note, idx) => (
            <WorkNote key={`${idx}-${note.slice(0, 24)}`} content={note} />
          ))}
        </div>
      )}
      {showToolTrace && (
        <div style={{ marginBottom: hasContent || streaming ? 10 : 0 }}>
          {calls.map((call, idx) => {
            const result = pairedResults[idx];
            const showLiveTail = !result && call.name === 'terminal';
            const artifacts = result?.artifacts ?? [];
            return (
              <div key={`${call.id}-${idx}`}>
                <ToolCallView call={call} style={ui.toolCallStyle} />
                {result && <ToolResultView result={result} style={ui.toolCallStyle} />}
                {artifacts.map((artifact, idx) => {
                  if (artifact.kind === 'image') {
                    return (
                      <div key={`img-${artifact.path}`} style={{ marginTop: 8 }}>
                        <WorkspaceImage path={artifact.path} alt="Generated image" kind="image" />
                      </div>
                    );
                  }
                  if (artifact.kind === 'image-job') {
                    return (
                      <div key={`job-${artifact.jobId}-${idx}`} style={{ marginTop: 8 }}>
                        <ImageJobCard jobId={artifact.jobId} expectedCount={artifact.count} />
                      </div>
                    );
                  }
                  return null;
                })}
                {showLiveTail && <LiveExecTail store={execStream} />}
              </div>
            );
          })}
        </div>
      )}
      <div style={{
        fontFamily: '"Source Serif 4", Iowan Old Style, Georgia, serif',
        fontSize: 16,
        lineHeight: 1.65,
        color: 'var(--text)',
        letterSpacing: '-0.01em',
      }}>
        {editing && isUser ? (
          <div className="message-edit-panel" onClick={event => event.stopPropagation()}>
            <textarea
              aria-label="Edited message"
              value={editText}
              autoFocus
              onChange={event => setEditText(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape') setEditing(false);
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) submitEdit();
              }}
            />
            <div>
              <button type="button" onClick={() => setEditing(false)}>Cancel</button>
              <button type="button" onClick={submitEdit}>Send branch</button>
            </div>
          </div>
        ) : isUser ? (
          <UserMessageContent body={userContent?.body ?? message.content} attachments={userContent?.attachments ?? []} />
        ) : shouldHideAssistantTextForImageJob ? (
          null
        ) : hasContent && streaming ? (
          <>
            <MarkdownBody content={visibleAssistantContent} />
            {!hasCalls && <WorkingIndicator />}
          </>
        ) : hasContent ? (
          <MarkdownBody content={message.content} />
        ) : streaming ? (
          toolActivities.length > 0 ? null : (
            <ThinkingIndicator label={
              hasLoadingImageJob
                ? 'generating'
                : (preTokenLabel ?? message.preTokenLabel ?? 'thinking')
            } />
          )
        ) : null}
      </div>
    </div>
  );
});

function pairToolResults(
  calls: NonNullable<AssistantMessage['toolCalls']>,
  results: NonNullable<AssistantMessage['toolResults']>,
): Array<NonNullable<AssistantMessage['toolResults']>[number] | undefined> {
  const used = new Set<number>();
  return calls.map(call => {
    const index = results.findIndex((result, idx) => !used.has(idx) && result.toolCallId === call.id);
    if (index < 0) return undefined;
    used.add(index);
    return results[index];
  });
}

function visibleWorkNotes(notes: readonly string[]): string[] {
  return notes
    .map(note => note.trim())
    .filter(note => note.length > 0);
}

interface ToolActivity {
  label: string;
  title: string;
  active?: boolean;
}

function activityForToolState({
  pendingCalls,
  calls,
  results,
  streaming,
}: {
  pendingCalls: ToolCall[];
  calls: readonly ToolCall[];
  results: readonly ToolResult[];
  streaming: boolean;
}): ToolActivity[] {
  if (pendingCalls.length > 0) return pendingToolActivities(pendingCalls);
  if (calls.length === 0 || results.length === 0) return [];
  if (streaming) {
    const failed = results.some(result => result.ok === false || result.errorCode);
    const invalid = results.some(result => isValidationFailureResult(result));
    if (invalid) {
      return [{
        label: 'Tool arguments were invalid; asking the model to retry...',
        title: 'The model produced a malformed tool call. GatesAI returned the error to the model and is waiting for a corrected next step.',
        active: true,
      }];
    }
    if (failed) {
      return [{
        label: 'Tool returned an error; asking the model to recover...',
        title: 'A tool failed. GatesAI returned the failure to the model and is waiting for the next response.',
        active: true,
      }];
    }
    const summary = resultSummary(calls, results);
    const continuation = continuationSummary(calls, summary);
    return [{
      label: continuation,
      title: `${summary}. GatesAI returned the tool result to the model and is waiting for the final response.`,
      active: true,
    }];
  }

  const summary = resultSummary(calls, results);
  return [{
    label: summary,
    title: `${summary}. Tool results are in.`,
  }];
}

function pendingToolActivities(pendingCalls: ToolCall[]): ToolActivity[] {
  const activities = pendingCalls.flatMap(call => pendingCallActivities(call));
  if (activities.length <= MAX_VISIBLE_TOOL_ACTIVITIES) return activities;
  const visible = activities.slice(0, MAX_VISIBLE_TOOL_ACTIVITIES - 1);
  return [
    ...visible,
    {
      label: `${activities.length - visible.length} more tool actions...`,
      title: pendingToolTitle(pendingCalls),
    },
  ];
}

function pendingCallActivities(call: ToolCall): ToolActivity[] {
  if (call.name === 'web_search') {
    const queries = stringArrayArg(call.arguments.queries);
    if (queries.length > 0) {
      return queries.map(query => ({
        label: `Searching web for "${compactText(query, 34)}"...`,
        title: pendingToolTitle([call]),
        active: true,
      }));
    }
    return [{ label: 'Searching web...', title: pendingToolTitle([call]), active: true }];
  }
  if (call.name === 'inspect_file' || call.name === 'fs') {
    const action = stringArg(call.arguments.action);
    const query = stringArg(call.arguments.query);
    const path = stringArg(call.arguments.path) || stringArg(call.arguments.from) || stringArg(call.arguments.to);
    if (action === 'search' && query) {
      return [{ label: `Searching workspace for "${compactText(query, 30)}"...`, title: pendingToolTitle([call]), active: true }];
    }
    if (action === 'write' || action === 'append') {
      return [{ label: `${action === 'append' ? 'Appending to' : 'Writing'} ${path ? shortWorkspacePath(path) : 'workspace file'}...`, title: pendingToolTitle([call]), active: true }];
    }
    if (action === 'mkdir') {
      return [{ label: `Creating ${path ? shortWorkspacePath(path) : 'workspace directory'}...`, title: pendingToolTitle([call]), active: true }];
    }
    if (action === 'move' || action === 'copy') {
      return [{ label: `${action === 'move' ? 'Moving' : 'Copying'} ${path ? shortWorkspacePath(path) : 'workspace file'}...`, title: pendingToolTitle([call]), active: true }];
    }
    if (action === 'delete') {
      return [{ label: `Deleting ${path ? shortWorkspacePath(path) : 'workspace path'}...`, title: pendingToolTitle([call]), active: true }];
    }
    return [{
      label: path ? `Reading ${shortWorkspacePath(path)}...` : 'Reading workspace...',
      title: pendingToolTitle([call]),
      active: true,
    }];
  }
  if (call.name === 'artifact') {
    const action = stringArg(call.arguments.action);
    const path = stringArg(call.arguments.path);
    if (action === 'create_html_artifact') {
      return [{ label: `Creating ${path ? shortWorkspacePath(path) : 'HTML artifact'}...`, title: pendingToolTitle([call]), active: true }];
    }
    if (action === 'validate_html') {
      return [{ label: `Checking ${path ? shortWorkspacePath(path) : 'HTML artifact'}...`, title: pendingToolTitle([call]), active: true }];
    }
    return [{ label: 'Preparing artifact...', title: pendingToolTitle([call]), active: true }];
  }
  if (call.name === 'terminal' || call.name === 'git' || call.name === 'python_inline' || call.name === 'sqlite_query') {
    const cmd = stringArg(call.arguments.cmd) ?? stringArg(call.arguments.command);
    return [{ label: cmd ? `Running ${compactText(cmd, 28)}...` : 'Running command...', title: pendingToolTitle([call]), active: true }];
  }
  if (call.name === 'image_generate') {
    const count = numberArg(call.arguments.count) ?? 1;
    return [{ label: count > 1 ? `Starting ${count} image jobs...` : 'Starting image job...', title: pendingToolTitle([call]), active: true }];
  }
  if (call.name === 'chat_history') {
    const action = stringArg(call.arguments.action);
    return [{
      label: action === 'search' ? 'Searching past chats...' : action === 'read_thread' ? 'Reading past chat...' : 'Checking recent chats...',
      title: pendingToolTitle([call]),
      active: true,
    }];
  }
  if (call.name === 'memory' || call.name === 'notes' || call.name === 'thread') {
    return [{ label: 'Updating context...', title: pendingToolTitle([call]), active: true }];
  }
  return [{
    label: `Using ${formatToolName(call.name)}...`,
    title: pendingToolTitle([call]),
    active: true,
  }];
}

function resultSummary(calls: readonly ToolCall[], results: readonly ToolResult[]): string {
  if (calls.some(call => call.name === 'web_search')) {
    const sourceCount = results
      .filter(result => result.toolName === 'web_search')
      .reduce((sum, result) => sum + countMatches(result.content, /^url:\s+/gm), 0);
    const failed = results.some(result => result.toolName === 'web_search' && result.ok === false);
    if (sourceCount > 0) return `Found ${sourceCount} source${sourceCount === 1 ? '' : 's'}`;
    if (failed) return 'Search returned an error';
    return 'Search complete';
  }
  if (calls.some(call => call.name === 'inspect_file' || call.name === 'fs' || call.name === 'artifact')) {
    const failed = results.some(result => result.ok === false || result.errorCode);
    return failed ? 'Workspace tool returned an error' : 'Workspace context ready';
  }
  if (calls.some(call => call.name === 'terminal' || call.name === 'git' || call.name === 'python_inline' || call.name === 'sqlite_query')) {
    const failed = results.some(result => result.ok === false || result.errorCode);
    return failed ? 'Command finished with an error' : 'Command finished';
  }
  if (calls.some(call => call.name === 'image_generate')) {
    const imageCount = results.reduce((sum, result) => sum + (result.artifacts?.length ?? 0), 0);
    return imageCount > 0 ? 'Image job started' : 'Image request complete';
  }
  if (calls.some(call => call.name === 'chat_history')) {
    return 'Chat history ready';
  }
  if (calls.some(call => call.name === 'memory' || call.name === 'notes' || call.name === 'thread')) {
    return 'Context updated';
  }
  return 'Tool results ready';
}

function isValidationFailureResult(result: ToolResult): boolean {
  const code = result.errorCode ?? '';
  return code.includes('invalid')
    || code === 'missing_required_argument'
    || code === 'invalid_argument_type'
    || code === 'invalid_enum_value'
    || code === 'unknown_tool'
    || /error_code:\s*(invalid_tool_batch|malformed_arguments|missing_required_argument|invalid_argument_type|invalid_enum_value|unknown_tool)/i.test(result.content)
    || /not valid JSON/i.test(result.content);
}

function continuationSummary(calls: readonly ToolCall[], summary: string): string {
  if (calls.some(call => call.name === 'web_search')) return summary;
  if (calls.some(call => call.name === 'inspect_file' || call.name === 'fs' || call.name === 'artifact')) return 'Continuing with workspace results...';
  if (calls.some(call => call.name === 'terminal' || call.name === 'git' || call.name === 'python_inline' || call.name === 'sqlite_query')) return 'Continuing after command output...';
  if (calls.some(call => call.name === 'chat_history')) return 'Continuing with chat history...';
  return 'Continuing with tool results...';
}

function pendingToolTitle(calls: ToolCall[]): string {
  return calls.map(call => `${formatToolName(call.name)} (${call.id})`).join('\n');
}

function formatToolName(name: string): string {
  return name.replace(/_/g, ' ');
}

function stringArrayArg(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map(item => item.trim());
}

function stringArg(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberArg(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compactText(value: string, max: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length > max ? `${compact.slice(0, Math.max(0, max - 3))}...` : compact;
}

function shortWorkspacePath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 2) return normalized;
  return `.../${parts.slice(-2).join('/')}`;
}

function countMatches(value: string, pattern: RegExp): number {
  return Array.from(value.matchAll(pattern)).length;
}

function useSmoothedStreamingText(content: string, active: boolean): string {
  const [visible, setVisible] = useState(content);
  const visibleRef = useRef(visible);
  const targetRef = useRef(content);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef(0);

  useEffect(() => {
    targetRef.current = content;

    if (!active || !content.startsWith(visibleRef.current)) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      visibleRef.current = content;
      setVisible(content);
      return;
    }

    if (visibleRef.current !== content && rafRef.current === null) {
      rafRef.current = requestAnimationFrame(stepVisibleText);
    }

    function stepVisibleText(timestamp: number) {
      rafRef.current = null;
      const elapsed = timestamp - lastFrameRef.current;
      if (elapsed < STREAM_SMOOTH_FRAME_MS) {
        rafRef.current = requestAnimationFrame(stepVisibleText);
        return;
      }

      const current = visibleRef.current;
      const target = targetRef.current;
      if (current === target) return;

      const remaining = target.length - current.length;
      const nextSize = Math.min(
        STREAM_SMOOTH_MAX_CHARS,
        Math.max(STREAM_SMOOTH_MIN_CHARS, Math.ceil(remaining / 3)),
      );
      const next = target.slice(0, current.length + nextSize);
      visibleRef.current = next;
      lastFrameRef.current = timestamp;
      setVisible(next);

      if (next !== target) {
        rafRef.current = requestAnimationFrame(stepVisibleText);
      }
    }
  }, [active, content]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  return visible;
}

function WorkNote({ content }: { content: string }) {
  return (
    <details
      style={{
        borderLeft: '1px solid color-mix(in srgb, var(--accent) 35%, transparent)',
        padding: '2px 0 2px 10px',
        color: 'var(--accent)',
        opacity: 0.88,
      }}
    >
      <summary
        style={{
          cursor: 'pointer',
          fontFamily: '"Geist Mono", ui-monospace, monospace',
          fontSize: 10,
          letterSpacing: '0.16em',
          lineHeight: 1.6,
          textTransform: 'uppercase',
          color: 'var(--accent)',
        }}
      >
        thinking
      </summary>
      <div
        style={{
          marginTop: 6,
          fontFamily: '"Source Serif 4", Iowan Old Style, Georgia, serif',
          fontSize: 14,
          lineHeight: 1.55,
          color: 'color-mix(in srgb, var(--accent) 78%, var(--text))',
        }}
      >
        <MarkdownBody content={content} />
      </div>
    </details>
  );
}

function MarkdownBody({ content }: { content: string }) {
  const bridge = useBridgeStore();
  // Split on paragraph boundaries (respecting fenced code blocks) so closed
  // chunks can be memoized. While streaming, only the trailing chunk's
  // content string changes, so only it re-parses through remark/rehype.
  const chunks = useMemo(() => splitMarkdownChunks(content), [content]);
  return (
    <div className="md-body">
      {chunks.map((chunk, idx) => (
        // Skip whitespace-only chunks (e.g. a leading "\n\n" from the
        // splitter); ReactMarkdown produces nothing for them and they'd just
        // burn a render. The chunks themselves still preserve the original
        // string so the splitter's join() invariant holds elsewhere.
        chunk.trim() === '' ? null : (
          <MarkdownChunk key={idx} content={chunk} bridge={bridge} />
        )
      ))}
    </div>
  );
}

interface MarkdownChunkProps {
  content: string;
  bridge: BridgeStore;
}

/**
 * Memoized by content string. React.memo's default shallow compare on a
 * primitive `content` is exactly what we want: while streaming, closed
 * chunks pass identical strings on every token flush and skip re-rendering
 * the heavy remark/rehype tree (highlight + katex). The trailing chunk
 * keeps re-parsing as tokens arrive — that cost is unavoidable.
 *
 * `bridge` is a stable store reference (singleton from context) so it never
 * triggers re-renders in practice.
 */
const MarkdownChunk = memo(function MarkdownChunk({ content, bridge }: MarkdownChunkProps) {
  // Subscribe to plugin-loaded events so chunks needing a not-yet-loaded
  // plugin re-render once it lands. The version itself is unused; we just
  // need useSyncExternalStore to fire on bumpPluginVersion().
  useSyncExternalStore(subscribePlugins, getPluginVersion, getPluginVersion);

  const needsHighlight = HAS_CODE_FENCE(content);
  const needsKatex = HAS_MATH(content);
  if (needsHighlight && !highlightPlugin) ensureHighlight();
  if (needsKatex && !katexPlugin) ensureKatex();

  const rehypePlugins: PluggableList = [];
  if (needsHighlight && highlightPlugin) rehypePlugins.push(highlightPlugin);
  if (needsKatex && katexPlugin) rehypePlugins.push(katexPlugin);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
      rehypePlugins={rehypePlugins}
      components={{
        code: (props) => <CodeOrWorkspaceLink {...props} bridge={bridge} />,
        a: (props) => <AnchorOrWorkspaceLink {...props} bridge={bridge} />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
});

interface CodeProps extends ComponentPropsWithoutRef<'code'> {
  bridge: BridgeStore;
}

function CodeOrWorkspaceLink({ bridge, className, children, ...rest }: CodeProps) {
  const isInline = !className;
  const text = childrenToString(children).replace(/\n$/, '');
  if (isInline) {
    if (isWorkspacePath(text)) {
      if (isHtmlWorkspacePath(text)) {
        return <HtmlArtifactPreview path={text} />;
      }
      return <WorkspacePathLink path={text} bridge={bridge} />;
    }
  }
  if (/\blanguage-mermaid\b/.test(className ?? '')) {
    return <MermaidDiagram source={text} />;
  }
  return <code className={className} {...rest}>{children}</code>;
}

interface AnchorProps extends ComponentPropsWithoutRef<'a'> {
  bridge: BridgeStore;
}

function AnchorOrWorkspaceLink({ bridge, href, children, ...rest }: AnchorProps) {
  const target = typeof href === 'string' ? href : '';
  if (target && isWorkspacePath(target)) {
    if (isHtmlWorkspacePath(target)) {
      return <HtmlArtifactPreview path={target} label={childrenToString(children)} />;
    }
    return <WorkspacePathLink path={target} bridge={bridge} />;
  }
  return <a href={href} {...rest} target="_blank" rel="noreferrer">{children}</a>;
}

function WorkspacePathLink({ path, bridge }: { path: string; bridge: BridgeStore }) {
  return (
    <button
      type="button"
      className="workspace-path-link"
      title={`Open ${path}`}
      onClick={(event) => {
        event.stopPropagation();
        void bridge.openWorkspacePath(path);
      }}
    >
      <span className="workspace-path-link__glyph" aria-hidden="true">↗</span>
      <code>{path}</code>
    </button>
  );
}

function childrenToString(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(childrenToString).join('');
  return '';
}

function UserMessageContent({ body, attachments }: { body: string; attachments: RenderedAttachment[] }) {
  const imageAttachments = attachments.filter(file => file.isImage);
  const fileAttachments = attachments.filter(file => !file.isImage);
  const visibleFiles = fileAttachments.slice(0, 4);
  const hiddenFileCount = Math.max(0, fileAttachments.length - visibleFiles.length);
  return (
    <>
      {body.trim() && <p className="user-message-body">{body.trim()}</p>}
      {attachments.length > 0 && (
        <div className="user-attachments" aria-label="Attached files">
          {imageAttachments.map(file => (
            <WorkspaceImage key={`${file.path}-${file.size}`} path={file.path} alt={file.name} kind={file.kind} />
          ))}
          {visibleFiles.map(file => (
            <FileAttachmentChip key={`${file.path}-${file.size}`} file={file} />
          ))}
          {hiddenFileCount > 0 && (
            <div className="user-attachment-more" title={fileAttachments.slice(4).map(file => file.name).join('\n')}>
              +{hiddenFileCount} files
            </div>
          )}
        </div>
      )}
    </>
  );
}

function FileAttachmentChip({ file }: { file: RenderedAttachment }) {
  const bridge = useBridgeStore();
  return (
    <button
      type="button"
      className="user-attachment-chip"
      title={`${file.name}\n${file.path}`}
      aria-label={`Open attached file ${file.name}`}
      onClick={(event) => {
        event.stopPropagation();
        void bridge.openWorkspacePath(file.path);
      }}
    >
      <span className="user-attachment-kind">{file.kind}</span>
      <span className="user-attachment-detail">
        <span className="user-attachment-name">{file.name}</span>
        <span className="user-attachment-size">{file.size}</span>
      </span>
    </button>
  );
}

/**
 * Pre-token streaming state. Reads as part of the typographic system
 * (matches the `YOU` / `CLAUDE SONNET 4.6` kicker style above) rather than
 * a generic spinner — uppercase mono label + three pulsing dots in the
 * accent color so it's noticeable but not loud.
 */
type StreamStatusLabel = 'thinking' | 'responding' | 'compacting' | 'working' | 'generating' | 'drafting';

function ThinkingIndicator({ label }: { label: StreamStatusLabel }) {
  const elapsed = useElapsedLabel(true);
  const accessibleLabel = label[0].toUpperCase() + label.slice(1);
  return (
    <span
      aria-label={accessibleLabel}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 10,
        fontFamily: '"Geist Mono", ui-monospace, monospace',
        fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase',
        color: 'var(--accent)',
        opacity: 0.85,
      }}
    >
      <span>{label}</span>
      {elapsed && <span style={{ opacity: 0.62, letterSpacing: '0.08em' }}>{elapsed}</span>}
      <span className="thinking-dots" aria-hidden="true">
        <span /><span /><span />
      </span>
    </span>
  );
}

function LiveStatusIndicator({ label, title, active = false }: { label: string; title?: string; active?: boolean }) {
  const elapsed = useElapsedLabel(active);
  return (
    <span
      aria-label={label}
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 10,
        maxWidth: '100%',
        fontFamily: '"Geist Mono", ui-monospace, monospace',
        fontSize: 11,
        letterSpacing: '0.08em',
        color: 'var(--accent)',
        opacity: 0.86,
      }}
    >
      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {elapsed && <span style={{ flex: 'none', opacity: 0.62 }}>{elapsed}</span>}
      {active && (
        <span className="thinking-dots" aria-hidden="true">
          <span /><span /><span />
        </span>
      )}
    </span>
  );
}

function WorkingIndicator({ label = 'working' }: { label?: StreamStatusLabel }) {
  return <ThinkingIndicator label={label} />;
}

function useElapsedLabel(active: boolean): string {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const resetId = window.setTimeout(() => setSeconds(0), 0);
    if (!active) return () => window.clearTimeout(resetId);

    const intervalId = window.setInterval(() => {
      setSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => {
      window.clearTimeout(resetId);
      window.clearInterval(intervalId);
    };
  }, [active]);

  return active && seconds >= 4 ? `${seconds}s` : '';
}
