import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { observer } from 'mobx-react-lite';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import type { Message } from '../../core/types';
import { useUiStore, useExecStreamStore } from '../../stores/context';
import { ToolCallView, ToolResultView } from './ToolCallRender';
import { LiveExecTail } from './LiveExecTail';
import { hasActiveTextSelection, shouldCopyMessageFromClick } from './messageCopy';

interface MessageProps {
  message: Message;
  modelName: string | undefined;
  streaming: boolean;
  preTokenLabel?: 'thinking' | 'responding' | 'compacting';
}

type CopyState = 'idle' | 'hint' | 'copied' | 'failed';
interface RenderedAttachment {
  path: string;
  name: string;
  kind: string;
  size: string;
}

let copyHintSeen = false;

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
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const isUser = message.role === 'user';
  const when = message.createdAt
    ? new Date(message.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';
  const headLabel = isUser
    ? `You${when ? ' · ' + when : ''}`
    : `${modelName ?? 'Assistant'}${when ? ' · ' + when : ''}`;

  const calls = !isUser ? message.toolCalls ?? [] : [];
  const results = !isUser ? message.toolResults ?? [] : [];
  const resultByCallId = new Map(results.map(r => [r.toolCallId, r]));
  const hasContent = message.content.trim().length > 0;
  const hasCalls = calls.length > 0;
  const userContent = isUser ? splitUserAttachmentFooter(message.content) : null;

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
      title="Ctrl/Cmd-click to copy this message"
      aria-label="Message. Ctrl or Command click to copy."
      onMouseEnter={showCopyHint}
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
            return (
              <div key={call.id}>
                <ToolCallView call={call} style={ui.toolCallStyle} />
                {result && <ToolResultView result={result} style={ui.toolCallStyle} />}
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
        ) : hasContent && streaming ? (
          <StreamingPlainText content={message.content} />
        ) : hasContent ? (
          <div className="md-body">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
              rehypePlugins={[rehypeHighlight, [rehypeKatex, { throwOnError: false, strict: 'ignore' }]]}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        ) : streaming ? (
          <ThinkingIndicator label={preTokenLabel ?? message.preTokenLabel ?? 'thinking'} />
        ) : null}
      </div>
    </div>
  );
});

function StreamingPlainText({ content }: { content: string }) {
  return (
    <>
      <p className="streaming-plain-text">{content}</p>
      <WorkingIndicator />
    </>
  );
}

function UserMessageContent({ body, attachments }: { body: string; attachments: RenderedAttachment[] }) {
  return (
    <>
      {body.trim() && <p className="user-message-body">{body.trim()}</p>}
      {attachments.length > 0 && (
        <div className="user-attachments" aria-label="Attached files">
          {attachments.map(file => (
            <div className="user-attachment-chip" key={`${file.path}-${file.size}`}>
              <span className="user-attachment-kind">{file.kind}</span>
              <span className="user-attachment-separator"> · </span>
              <span className="user-attachment-size">{file.size}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function splitUserAttachmentFooter(content: string): { body: string; attachments: RenderedAttachment[] } {
  const marker = '\n\n📎 Attached files (read with the `fs` tool):\n';
  const idx = content.indexOf(marker);
  if (idx < 0) return { body: content, attachments: [] };

  const body = content.slice(0, idx);
  const footer = content.slice(idx + marker.length);
  const attachments = footer
    .split('\n')
    .map(parseAttachmentLine)
    .filter((file): file is RenderedAttachment => Boolean(file));

  return { body, attachments };
}

function parseAttachmentLine(line: string): RenderedAttachment | null {
  const match = line.trim().match(/^-\s+(.+?)\s+·\s+(.+?)\s+·\s+(.+)$/);
  if (!match) return null;
  const [, path, size, mime] = match;
  const name = path.split(/[\\/]/).pop() || path;
  return { path, name, size, kind: attachmentKind(name, mime) };
}

function attachmentKind(name: string, mime: string): string {
  const ext = name.includes('.') ? name.split('.').pop()?.toUpperCase() : '';
  if (mime.toLowerCase().includes('csv')) return 'CSV';
  if (mime.toLowerCase().includes('json')) return 'JSON';
  if (mime.toLowerCase().includes('pdf')) return 'PDF';
  return ext || 'FILE';
}

/**
 * Pre-token streaming state. Reads as part of the typographic system
 * (matches the `YOU` / `CLAUDE SONNET 4.6` kicker style above) rather than
 * a generic spinner — uppercase mono label + three pulsing dots in the
 * accent color so it's noticeable but not loud.
 */
type StreamStatusLabel = 'thinking' | 'responding' | 'compacting' | 'working';

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
