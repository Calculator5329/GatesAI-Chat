import { memo, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import ReactMarkdown from 'react-markdown';
import { observer } from 'mobx-react-lite';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { PluggableList } from 'unified';
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
import { splitMarkdownChunks } from './markdownChunks';
import { HtmlArtifactPreview, isHtmlWorkspacePath } from './HtmlArtifactPreview';
import { MermaidDiagram } from './MermaidDiagram';

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
}

type CopyState = 'idle' | 'hint' | 'copied' | 'failed';

let copyHintSeen = false;
const EMPTY_TOOL_CALLS: NonNullable<AssistantMessage['toolCalls']> = [];
const EMPTY_TOOL_RESULTS: NonNullable<AssistantMessage['toolResults']> = [];
const EMPTY_WORK_NOTES: NonNullable<AssistantMessage['workNotes']> = [];

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
  const workNotes = !isUser ? visibleWorkNotes(message.workNotes ?? EMPTY_WORK_NOTES) : EMPTY_WORK_NOTES;
  const resultByCallId = useMemo(
    () => new Map(results.map(r => [r.toolCallId, r])),
    [results],
  );
  const hasContent = message.content.trim().length > 0;
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
      {hasWorkNotes && (
        <div style={{ marginBottom: hasCalls || hasContent || streaming ? 10 : 0 }}>
          {workNotes.map((note, idx) => (
            <WorkNote key={`${idx}-${note.slice(0, 24)}`} content={note} />
          ))}
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
            hasLoadingImageJob
              ? 'generating'
              : (preTokenLabel ?? message.preTokenLabel ?? 'thinking')
          } />
        ) : null}
      </div>
    </div>
  );
});

function visibleWorkNotes(notes: readonly string[]): string[] {
  return notes
    .map(note => note.trim())
    .filter(note => note.length > 0);
}

function WorkNote({ content }: { content: string }) {
  return (
    <div
      style={{
        borderLeft: '2px solid color-mix(in srgb, var(--accent) 38%, transparent)',
        padding: '2px 0 2px 12px',
        color: 'var(--text-dim)',
        fontFamily: '"Source Serif 4", Iowan Old Style, Georgia, serif',
        fontSize: 14,
        fontStyle: 'italic',
        lineHeight: 1.55,
        opacity: 0.86,
      }}
    >
      <MarkdownBody content={content} />
    </div>
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
