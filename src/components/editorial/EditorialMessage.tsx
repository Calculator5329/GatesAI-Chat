// Renders a single chat message (user or assistant): prose, attachments, work
// notes, activity/tool rows, and image-job cards. Rendered by EditorialChat;
// reads RootStore via hooks and derives view state from props/hooks.
// Invariant: persisted chat state stays in stores; this surface is presentation only.
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import type { MouseEvent } from 'react';
import type { AssistantFinishReason, Message } from '../../core/types';
import { resolveUserAttachments, type RenderedAttachment } from '../../core/attachments';
import { useEditorial } from '../../stores/context';
import { hasActiveTextSelection, shouldCopyMessageFromClick } from './messageCopy';
import { WorkspaceImage } from './WorkspaceImage';
import {
  splitMarkdownChunksIncremental,
  type MarkdownChunkSnapshot,
} from './markdownChunks';
import { MarkdownFallback } from './MarkdownFallback';
import { Icons } from '../ui/icons';
import { ActivityStream } from './activity/ActivityStream';

const MarkdownChunk = lazy(() => import('./MarkdownChunk').then(m => ({ default: m.MarkdownChunk })));


interface MessageProps {
  message: Message;
  modelName: string | undefined;
  streaming: boolean;
  preTokenLabel?: 'thinking' | 'responding' | 'compacting' | 'generating';
  onRegenerate?: (messageId: string) => void;
  onBranch?: (messageId: string) => void;
  onEditAndResend?: (messageId: string, text: string) => void;
  actionsDisabled?: boolean;
  laterMessageCount?: number;
}

type CopyState = 'idle' | 'hint' | 'copied' | 'failed';
type ConfirmAction = 'regenerate' | 'edit' | null;

let copyHintSeen = false;
const STREAM_SMOOTH_FRAME_MS = 16;
const STREAM_SMOOTH_BASE_CHARS_PER_SECOND = 180;
const STREAM_SMOOTH_CATCHUP_CHARS_PER_SECOND = 540;
const STREAM_SMOOTH_CATCHUP_BACKLOG = 96;
const STREAM_SMOOTH_MAX_BACKLOG = 320;
const STREAM_SMOOTH_TARGET_BACKLOG = 180;

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
  laterMessageCount = 0,
}: MessageProps) {
  const { chat, router } = useEditorial();
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(message.content);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
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

  const hasContent = message.content.trim().length > 0;
  const visibleAssistantContent = useSmoothedStreamingText(
    message.content,
    !isUser && streaming && hasContent,
  );
  const userContent = isUser && message.role === 'user' ? resolveUserAttachments(message) : null;
  const activities = !isUser && message.role === 'assistant'
    ? chat.activitiesForMessage(preTokenLabel ? { ...message, preTokenLabel } : message, { streaming })
    : [];
  const visibleWorkNotes = !isUser && message.role === 'assistant'
    ? (message.workNotes ?? []).map(note => note.trim()).filter(Boolean)
    : [];
  const finishNotice = !isUser && message.role === 'assistant'
    ? finishNoticeForReason(message.finishReason)
    : null;

  useEffect(() => {
    if (copyState === 'idle') return;
    const timeout = window.setTimeout(() => setCopyState('idle'), copyState === 'hint' ? 2400 : 1200);
    return () => window.clearTimeout(timeout);
  }, [copyState]);

  useEffect(() => {
    if (!editing) setEditText(message.content);
    setConfirmAction(null);
  }, [editing, message.content, message.id]);

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
    if (!next || actionsDisabled || streaming || !onEditAndResend) return;
    if (laterMessageCount > 0 && confirmAction !== 'edit') {
      setConfirmAction('edit');
      return;
    }
    onEditAndResend(message.id, next);
    setEditing(false);
    setConfirmAction(null);
  }

  function requestRegenerate() {
    if (actionsDisabled || streaming || !onRegenerate) return;
    if (laterMessageCount > 0) {
      setConfirmAction('regenerate');
      return;
    }
    onRegenerate(message.id);
  }

  function confirmDestructiveAction() {
    if (actionsDisabled || streaming) return;
    if (confirmAction === 'regenerate') {
      onRegenerate?.(message.id);
      setConfirmAction(null);
      return;
    }
    const next = editText.trim();
    if (!next || !onEditAndResend) return;
    onEditAndResend(message.id, next);
    setEditing(false);
    setConfirmAction(null);
  }

  function cancelEdit() {
    setEditing(false);
    setConfirmAction(null);
  }

  const laterMessageLabel = `This removes ${laterMessageCount} later message${laterMessageCount === 1 ? '' : 's'}`;

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
      <div className="message-head-row">
        <div style={{
        fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase',
        color: isUser ? 'var(--text-faint)' : 'var(--accent)',
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
            onClick={requestRegenerate}
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
              setConfirmAction(null);
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
          onClick={() => {
            setConfirmAction(null);
            onBranch?.(message.id);
          }}
        >
          <Icons.Branch />
        </button>
        </div>
      </div>
      {confirmAction === 'regenerate' && (
        <div className="message-confirm-panel" onClick={event => event.stopPropagation()}>
          <span>{laterMessageLabel}</span>
          <button type="button" onClick={() => setConfirmAction(null)}>Cancel</button>
          <button type="button" disabled={actionsDisabled || streaming} onClick={confirmDestructiveAction}>Regenerate</button>
        </div>
      )}
      <div style={{
        fontFamily: '"Source Serif 4", Iowan Old Style, Georgia, serif',
        fontSize: 16,
        lineHeight: 1.65,
        color: 'var(--text)',
        letterSpacing: '-0.01em',
      }}>
        {visibleWorkNotes.length > 0 && (
          <div className="assistant-work-notes">
            {visibleWorkNotes.map((note, index) => (
              <MarkdownBody key={`${message.id}-work-note-${index}`} content={note} />
            ))}
          </div>
        )}
      </div>
      <ActivityStream
        items={activities}
        messageId={message.id}
        onOpenThread={threadId => {
          if (!chat.selectThread(threadId)) return;
          router.goThread(threadId);
        }}
      />
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
              onChange={event => {
                setEditText(event.target.value);
                if (confirmAction === 'edit') setConfirmAction(null);
              }}
              onKeyDown={event => {
                if (event.key === 'Escape') {
                  cancelEdit();
                  return;
                }
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey || !event.shiftKey)) {
                  event.preventDefault();
                  submitEdit();
                }
              }}
            />
            {confirmAction === 'edit' && (
              <div className="message-confirm-panel message-confirm-panel--edit">
                <span>{laterMessageLabel}</span>
                <button type="button" onClick={() => setConfirmAction(null)}>Cancel</button>
                <button type="button" disabled={actionsDisabled || streaming} onClick={confirmDestructiveAction}>Save &amp; resend</button>
              </div>
            )}
            <div>
              <button type="button" onClick={cancelEdit}>Cancel</button>
              <button type="button" onClick={submitEdit}>Save &amp; resend</button>
            </div>
          </div>
        ) : isUser ? (
          <UserMessageContent body={userContent?.body ?? message.content} attachments={userContent?.attachments ?? []} />
        ) : hasContent && streaming ? (
          <MarkdownBody content={visibleAssistantContent} incremental />
        ) : hasContent ? (
          <MarkdownBody content={message.content} />
        ) : null}
        {finishNotice && (
          <div className="message-finish-notice" data-tone={finishNotice.tone}>
            {finishNotice.label}
          </div>
        )}
      </div>
    </div>
  );
});

function finishNoticeForReason(reason: AssistantFinishReason | undefined): { label: string; tone: 'warn' | 'error' } | null {
  switch (reason) {
    case 'length':
      return { label: 'Response cut off because the model hit its token limit.', tone: 'warn' };
    case 'content_filter':
      return { label: 'Provider filtered this response before it finished.', tone: 'warn' };
    case 'error':
      return { label: 'Provider ended this response with an error.', tone: 'error' };
    default:
      return null;
  }
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

      let current = visibleRef.current;
      const target = targetRef.current;
      if (current === target) return;

      let remaining = target.length - current.length;
      if (remaining > STREAM_SMOOTH_MAX_BACKLOG) {
        current = target.slice(0, Math.max(current.length, target.length - STREAM_SMOOTH_TARGET_BACKLOG));
        visibleRef.current = current;
        remaining = target.length - current.length;
      }

      const rate = remaining > STREAM_SMOOTH_CATCHUP_BACKLOG
        ? STREAM_SMOOTH_CATCHUP_CHARS_PER_SECOND
        : STREAM_SMOOTH_BASE_CHARS_PER_SECOND;
      const nextSize = Math.max(1, Math.min(24, Math.ceil((elapsed / 1000) * rate)));
      const next = target.slice(0, current.length + Math.min(remaining, nextSize));
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

function MarkdownBody({ content, incremental = false }: { content: string; incremental?: boolean }) {
  const { bridge, ui } = useEditorial();
  const chunkSnapshotRef = useRef<MarkdownChunkSnapshot | undefined>(undefined);
  // Split on paragraph boundaries (respecting fenced code blocks) so closed
  // chunks can be memoized. While streaming, only the trailing chunk's
  // content string changes, so only it re-parses through remark/rehype.
  const chunks = useMemo(() => {
    // This ref is a render-local derived cache for append-only streaming text,
    // not UI state. It must be current before this render builds children.
    // eslint-disable-next-line react-hooks/refs
    const previous = incremental ? chunkSnapshotRef.current : undefined;
    return splitMarkdownChunksIncremental(
      content,
      previous,
    );
  }, [content, incremental]);
  // eslint-disable-next-line react-hooks/refs
  chunkSnapshotRef.current = incremental ? { content, chunks } : undefined;

  return (
    <div className="md-body">
      <Suspense fallback={<MarkdownFallback content={content} bridge={bridge} />}>
        {chunks.map(chunk => (
          // Skip whitespace-only chunks; ReactMarkdown produces nothing for
          // them and they'd just burn a render.
          chunk.content.trim() === '' ? null : (
            <MarkdownChunk
              key={chunk.key}
              content={chunk.content}
              bridge={bridge}
              lineNumbers={ui.codeLineNumbers}
              onLineNumbersChange={ui.setCodeLineNumbers.bind(ui)}
            />
          )
        ))}
      </Suspense>
    </div>
  );
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
          {imageAttachments.map((file, index) => (
            <WorkspaceImage
              key={file.cacheKey || `${file.path}-${file.size}-${index}`}
              path={file.path}
              alt={file.name}
              kind={file.kind}
              cacheKey={file.cacheKey}
            />
          ))}
          {visibleFiles.map((file, index) => (
            <FileAttachmentChip key={file.cacheKey || `${file.path}-${file.size}-${index}`} file={file} />
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
  const { bridge } = useEditorial();
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
