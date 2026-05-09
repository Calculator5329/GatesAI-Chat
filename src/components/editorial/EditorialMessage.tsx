import { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { observer } from 'mobx-react-lite';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { ComponentPropsWithoutRef, ReactNode } from 'react';
import type { AssistantMessage, Message } from '../../core/types';
import { resolveUserAttachments, type RenderedAttachment } from '../../core/attachments';
import { isWorkspacePath } from '../../core/workspacePaths';
import { ToolCallView, ToolResultView } from '../ui';
import { useBridgeStore, useUiStore, useExecStreamStore, useImageJobStore } from '../../stores/context';
import type { BridgeStore } from '../../stores/BridgeStore';
import { LiveExecTail } from './LiveExecTail';
import { hasActiveTextSelection, shouldCopyMessageFromClick } from './messageCopy';
import { WorkspaceImage } from './WorkspaceImage';
import { ImageJobCard } from './ImageJobCard';

interface MessageProps {
  message: Message;
  modelName: string | undefined;
  streaming: boolean;
  preTokenLabel?: 'thinking' | 'responding' | 'compacting' | 'generating';
}

type CopyState = 'idle' | 'hint' | 'copied' | 'failed';

let copyHintSeen = false;
const EMPTY_TOOL_CALLS: NonNullable<AssistantMessage['toolCalls']> = [];
const EMPTY_TOOL_RESULTS: NonNullable<AssistantMessage['toolResults']> = [];

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
export const EditorialMessage = observer(function EditorialMessage({ message, modelName, streaming, preTokenLabel }: MessageProps) {
  const ui = useUiStore();
  const execStream = useExecStreamStore();
  const imageJobs = useImageJobStore();
  const [copyState, setCopyState] = useState<CopyState>('idle');
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
  const resultByCallId = useMemo(
    () => new Map(results.map(r => [r.toolCallId, r])),
    [results],
  );
  const hasContent = message.content.trim().length > 0;
  const hasCalls = calls.length > 0;
  const userContent = isUser && message.role === 'user' ? resolveUserAttachments(message) : null;
  const hasLoadingImageJob = !isUser && results.some(result => (
    result.artifacts?.some(artifact => {
      if (artifact.kind !== 'image-job') return false;
      const job = imageJobs.findById(artifact.jobId);
      return job?.status === 'pending' || job?.status === 'running';
    }) ?? false
  ));
  const hasUnsuccessfulImageJob = !isUser && results.some(result => (
    result.artifacts?.some(artifact => {
      if (artifact.kind !== 'image-job') return false;
      const job = imageJobs.findById(artifact.jobId);
      return job?.status === 'failed'
        || job?.status === 'cancelled'
        || (job?.status === 'done' && job.results.length === 0);
    }) ?? false
  ));
  const shouldHideAssistantTextForImageJob = hasContent && (hasLoadingImageJob || hasUnsuccessfulImageJob);

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

  async function copyMessage() {
    if (!message.content) return;
    try {
      await navigator.clipboard.writeText(message.content);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
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
      {hasCalls && (
        <div style={{ marginBottom: hasContent || streaming ? 10 : 0 }}>
          {calls.map(call => {
            const result = resultByCallId.get(call.id);
            const showLiveTail = !result && call.name === 'terminal';
            const artifacts = result?.artifacts ?? [];
            return (
              <div key={call.id}>
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
        {isUser ? (
          <UserMessageContent body={userContent?.body ?? message.content} attachments={userContent?.attachments ?? []} />
        ) : shouldHideAssistantTextForImageJob ? (
          null
        ) : hasContent && streaming ? (
          <>
            <MarkdownBody content={message.content} />
            <WorkingIndicator />
          </>
        ) : hasContent ? (
          <MarkdownBody content={message.content} />
        ) : streaming ? (
          <ThinkingIndicator label={
            imageJobs.active
              ? 'generating'
              : (preTokenLabel ?? message.preTokenLabel ?? 'thinking')
          } />
        ) : null}
      </div>
    </div>
  );
});

function MarkdownBody({ content }: { content: string }) {
  const bridge = useBridgeStore();
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
        rehypePlugins={[rehypeHighlight, [rehypeKatex, { throwOnError: false, strict: 'ignore' }]]}
        components={{
          // Inline code that's a /workspace/... path becomes a clickable
          // link the system handler can open. Block code (anything with
          // a language class from rehype-highlight) renders normally.
          code: (props) => <CodeOrWorkspaceLink {...props} bridge={bridge} />,
          // Anchor links pointing at /workspace/ paths reroute to the OS
          // viewer through the bridge — the same affordance as inline-code
          // workspace paths. Other links open in a new tab.
          a: (props) => <AnchorOrWorkspaceLink {...props} bridge={bridge} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

interface CodeProps extends ComponentPropsWithoutRef<'code'> {
  bridge: BridgeStore;
}

function CodeOrWorkspaceLink({ bridge, className, children, ...rest }: CodeProps) {
  const isInline = !className;
  if (isInline) {
    const text = childrenToString(children);
    if (isWorkspacePath(text)) {
      return <WorkspacePathLink path={text} bridge={bridge} />;
    }
  }
  return <code className={className} {...rest}>{children}</code>;
}

interface AnchorProps extends ComponentPropsWithoutRef<'a'> {
  bridge: BridgeStore;
}

function AnchorOrWorkspaceLink({ bridge, href, children, ...rest }: AnchorProps) {
  const target = typeof href === 'string' ? href : '';
  if (target && isWorkspacePath(target)) {
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
  return (
    <>
      {body.trim() && <p className="user-message-body">{body.trim()}</p>}
      {attachments.length > 0 && (
        <div className="user-attachments" aria-label="Attached files">
          {attachments.map(file => (
            file.isImage
              ? <WorkspaceImage key={`${file.path}-${file.size}`} path={file.path} alt={file.name} kind={file.kind} />
              : (
                <div className="user-attachment-chip" key={`${file.path}-${file.size}`}>
                  <span className="user-attachment-kind">{file.kind}</span>
                  <span className="user-attachment-separator"> · </span>
                  <span className="user-attachment-size">{file.size}</span>
                </div>
              )
          ))}
        </div>
      )}
    </>
  );
}

/**
 * Pre-token streaming state. Reads as part of the typographic system
 * (matches the `YOU` / `CLAUDE SONNET 4.6` kicker style above) rather than
 * a generic spinner — uppercase mono label + three pulsing dots in the
 * accent color so it's noticeable but not loud.
 */
type StreamStatusLabel = 'thinking' | 'responding' | 'compacting' | 'working' | 'generating';

function ThinkingIndicator({ label }: { label: StreamStatusLabel }) {
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
      <span className="thinking-dots" aria-hidden="true">
        <span /><span /><span />
      </span>
    </span>
  );
}

function WorkingIndicator() {
  return <ThinkingIndicator label="working" />;
}
