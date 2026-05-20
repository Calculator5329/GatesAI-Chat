import { useCallback, useEffect, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { observer } from 'mobx-react-lite';
import { Icons } from '../ui/icons';
import { useBridgeStore, useChatStore, useImageJobStore, useLocalRuntimeStore, useModelRegistry, useProviderStore, useRouterStore, useUiStore } from '../../stores/context';
import { threadLlmSpendUsd, type ChatContextMode } from '../../stores/ChatStore';
import { modelSupportsVision } from '../../core/modelCapabilities';
import { isImageMime } from '../../core/attachments';
import { DEFAULT_MODEL_ID } from '../../core/models';
import { ModelPopover } from './ModelPopover';
import { WorkspaceImage } from './WorkspaceImage';

/** Browsers without `field-sizing: content` need the JS height-recalc fallback. */
const SUPPORTS_FIELD_SIZING = typeof CSS !== 'undefined'
  && typeof CSS.supports === 'function'
  && CSS.supports('field-sizing', 'content');

const DRAFT_FLUSH_MS = 120;
const PASTED_IMAGE_NAME_PREFIX = 'pasted-image';

const ATTACH_BTN_STYLE: CSSProperties = {
  width: 28, height: 28, borderRadius: 6,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--text-faint)',
  flex: 'none',
  alignSelf: 'center',
  transition: 'background 100ms ease',
};

const SEND_BTN_STYLE: CSSProperties = {
  width: 28, height: 28, borderRadius: 6,
  color: 'var(--accent)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  transition: 'background 100ms ease, opacity 100ms ease',
};

const STOP_BTN_OUTER_STYLE: CSSProperties = {
  width: 28, height: 28, borderRadius: 7,
  border: '1px solid var(--border)',
  background: 'var(--panel-2)',
  color: 'var(--text-dim)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const STOP_BTN_INNER_STYLE: CSSProperties = {
  width: 10, height: 10, borderRadius: 2,
  background: 'currentColor', display: 'block',
};

const ROW_STYLE: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '9px 13px 9px 8px',
  background: 'var(--panel)',
  borderRadius: 10,
  transition: 'border-color 120ms ease',
};

const META_ROW_STYLE: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, marginTop: 7,
  fontSize: 11.5, color: 'var(--accent)',
  position: 'relative',
  minHeight: 18,
  minWidth: 0,
};

const MODEL_LABEL_STYLE: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  color: 'var(--accent)',
  cursor: 'pointer', padding: '2px 6px', borderRadius: 4,
  maxWidth: 220,
  minWidth: 0,
};

const ACCENT_DOT_STYLE: CSSProperties = {
  width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)',
};

const LOCAL_CONTEXT_SELECT_STYLE: CSSProperties = {
  appearance: 'none',
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  borderRadius: 5,
  color: 'var(--accent)',
  fontFamily: '"Geist Mono", monospace',
  fontSize: 10.5,
  height: 22,
  padding: '0 7px',
  outline: 'none',
};

const TEXTAREA_BASE_STYLE: CSSProperties = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  resize: 'none',
  color: 'var(--text)',
  fontSize: 15,
  fontFamily: '"Source Serif 4", Georgia, serif',
  lineHeight: 1.5,
  maxHeight: 200,
  minHeight: 24,
  padding: '2px 0 3px',
};

interface ComposerProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

function AttachButton({
  onClick, disabled, title,
}: { onClick: () => void; disabled: boolean; title: string }) {
  return (
    <button
      type="button"
      className="composer-attach-btn"
      onClick={onClick}
      title={title}
      aria-label="Attach file"
      disabled={disabled}
      data-disabled={disabled || undefined}
      style={{
        ...ATTACH_BTN_STYLE,
        border: 'none',
        background: 'transparent',
        padding: 0,
        opacity: disabled ? 0.35 : 0.85,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    ><Icons.Paperclip /></button>
  );
}

function SendButton(): ReactNode {
  return <div style={SEND_BTN_STYLE}><Icons.ArrowUp /></div>;
}

/** Square stop control shown in place of the send button while streaming
 *  with an empty composer - a clear "halt the model" affordance. Once the
 *  user types, this swaps back to the normal send button (which now behaves
 *  as interrupt-and-send). */
function StopButton(): ReactNode {
  return (
    <div style={STOP_BTN_OUTER_STYLE}>
      <span style={STOP_BTN_INNER_STYLE} />
    </div>
  );
}

export const EditorialComposer = observer(function EditorialComposer({ textareaRef }: ComposerProps) {
  const chat = useChatStore();
  const ui = useUiStore();
  const bridge = useBridgeStore();
  const registry = useModelRegistry();
  const providers = useProviderStore();
  const localRuntime = useLocalRuntimeStore();
  const [modelOpen, setModelOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeThread = chat.activeThread;
  const activeThreadId = activeThread?.id ?? null;
  const currentModel = registry.findById(activeThread?.modelId) ?? registry.findById(DEFAULT_MODEL_ID);
  const localContextMode = activeThread?.contextMode ?? (currentModel?.providerId === 'ollama' ? 'micro' : 'full');

  // Decouple textarea visual value from the MobX store: typing updates
  // local state instantly (no observers fire), and a 120ms trailing debounce
  // mirrors to ui.setDraft so the ContextMeter and any other observers see
  // at most ~8 updates per second while typing. We resync from ui.draft
  // when it changes externally (thread switch, programmatic clear after send).
  const [localDraft, setLocalDraft] = useState(ui.draft);
  const localDraftRef = useRef(localDraft);
  localDraftRef.current = localDraft;
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushDraft = useCallback(() => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (ui.draft !== localDraftRef.current) {
      ui.setDraft(localDraftRef.current);
    }
  }, [ui]);

  // Resync when the store changes externally (thread switch, send-clear, etc.)
  useEffect(() => {
    if (ui.draft !== localDraftRef.current) {
      setLocalDraft(ui.draft);
    }
  }, [ui.draft]);

  // Flush on unmount.
  useEffect(() => {
    return () => { flushDraft(); };
  }, [flushDraft]);

  const onDraftChange = (next: string) => {
    setLocalDraft(next);
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      if (ui.draft !== localDraftRef.current) ui.setDraft(localDraftRef.current);
    }, DRAFT_FLUSH_MS);
  };

  const value = localDraft;
  const streaming = chat.isStreaming;
  const hasText = value.trim().length > 0;
  const hasAttachments = ui.attachments.length > 0;
  const directImageMode = currentModel?.providerId === 'local-image';
  const directImageReady = directImageMode && localRuntime.comfyReady;
  const routeReady = currentModel
    ? (directImageMode ? directImageReady : providers.isConnected(currentModel.providerId))
    : false;
  // Send is enabled whenever there's text or at least one attachment. While
  // streaming, sending interrupts the in-flight reply and starts a new turn.
  // Direct-image mode is offline and only needs text; attachments are ignored
  // by the image job enqueue path.
  const canSend = (hasText || (!directImageMode && hasAttachments)) && routeReady;

  const onSend = () => {
    if (!canSend) return;
    // Cancel any pending flush; we're committing the final value now.
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    chat.sendMessage(value, ui.attachments);
    ui.clearDraft();
    setLocalDraft('');
    if (!SUPPORTS_FIELD_SIZING && textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files.length > 0) void ui.uploadFiles(e.dataTransfer.files, bridge);
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = imageFilesFromClipboard(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    void ui.uploadFiles(files, bridge);
  };

  const onStop = () => {
    chat.stopStreaming();
  };

  const closeModelPopover = useCallback(() => {
    setModelOpen(false);
  }, []);

  const pickModel = useCallback((modelId: string) => {
    if (!activeThreadId) return;
    chat.setThreadModel(activeThreadId, modelId);
  }, [activeThreadId, chat]);
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const sendTitle = streaming
    ? (hasText ? 'Interrupt and send' : 'Stop')
    : 'Send';

  // The only per-render-derived bit: italic when empty (placeholder voice).
  const textareaStyle: CSSProperties = value
    ? TEXTAREA_BASE_STYLE
    : { ...TEXTAREA_BASE_STYLE, fontStyle: 'italic' };

  return (
    <div
      className="editorial-composer"
      style={{ padding: '0 48px 16px', fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif' }}
      onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
      onDragLeave={() => setDragActive(false)}
      onDrop={onDrop}
    >
      <div className="editorial-composer__inner" style={{ width: 'min(750px, 70%)', margin: '0 auto', paddingTop: 4 }}>
        {!routeReady && (directImageMode ? <LocalImageBanner /> : <ApiKeyBanner />)}
        {chat.lastError && (
          <div className="chat-error-banner" role="status">
            <span>{chat.lastError}</span>
            <button type="button" onClick={() => chat.clearLastError()} aria-label="Dismiss chat error">×</button>
          </div>
        )}
        {hasAttachments && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8, alignItems: 'center' }}>
            {ui.attachments.map(a => (
              isImageMime(a.mime) ? (
                <span
                  key={a.id}
                  style={{ position: 'relative', display: 'inline-block' }}
                  title={a.filename}
                >
                  <WorkspaceImage path={a.path} alt={a.filename} kind={a.filename.split('.').pop()?.toUpperCase() || 'IMG'} />
                  <button
                    type="button"
                    onClick={() => ui.removeAttachment(a.id)}
                    title="Remove"
                    aria-label={`Remove ${a.filename}`}
                    style={{
                      position: 'absolute',
                      top: -6,
                      right: -6,
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      border: '1px solid var(--border)',
                      background: 'var(--panel)',
                      color: 'var(--text-dim)',
                      cursor: 'pointer',
                      padding: 0,
                      lineHeight: 1,
                      fontSize: 13,
                    }}
                  >×</button>
                </span>
              ) : (
                <span
                  key={a.id}
                  title={a.path}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                    padding: '4px 8px',
                    border: '1px solid var(--border)',
                    borderRadius: 4,
                    fontSize: 11, fontFamily: '"Geist Mono", monospace',
                    color: 'var(--text-dim)',
                    background: 'var(--panel)',
                  }}
                >
                  <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />
                  {a.filename}
                  <span
                    onClick={() => ui.removeAttachment(a.id)}
                    style={{ cursor: 'pointer', opacity: 0.5, marginLeft: 2 }}
                    title="Remove"
                  >×</span>
                </span>
              )
            ))}
          </div>
        )}
        {hasImageAttachment(ui.attachments) && currentModel && !modelSupportsVision(currentModel) && (
          <div style={{
            fontSize: 11,
            fontFamily: '"Geist Mono", monospace',
            color: 'var(--text-faint)',
            marginBottom: 6,
          }}>
            {currentModel.name} is text-only - the image won't be sent as vision input. Switch to a vision-capable model to have it described.
          </div>
        )}
        {(ui.uploadError || ui.uploading) && (
          <div style={{ fontSize: 11, color: ui.uploadError ? '#c96a6a' : 'var(--text-faint)', marginBottom: 6 }}>
            {ui.uploadError ?? 'Uploading...'}
          </div>
        )}
        <div
          className="composer-row"
          data-drag-active={dragActive || undefined}
          style={ROW_STYLE}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) void ui.uploadFiles(e.target.files, bridge);
              e.target.value = '';
            }}
          />
          <AttachButton
            onClick={() => bridge.isOnline && fileInputRef.current?.click()}
            disabled={!bridge.isOnline}
            title={bridge.isOnline ? 'Attach file' : 'Bridge offline - cannot attach files'}
          />
          <textarea
            ref={textareaRef}
            className="composer-textarea"
            value={value}
            onChange={e => onDraftChange(e.target.value)}
            onBlur={flushDraft}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder="Continue the thought..."
            rows={1}
            style={textareaStyle}
            // CSS field-sizing: content handles autoresize natively when
            // supported. Older browsers fall back to JS height-recalc.
            {...(SUPPORTS_FIELD_SIZING ? {} : {
              onInput: (e: React.FormEvent<HTMLTextAreaElement>) => {
                const target = e.currentTarget;
                target.style.height = 'auto';
                target.style.height = Math.min(target.scrollHeight, 200) + 'px';
              },
            })}
          />
          <button
            type="button"
            className="composer-send-control"
            onClick={streaming && !hasText ? onStop : onSend}
            title={sendTitle}
            aria-label={sendTitle}
            disabled={!streaming && !canSend}
            style={{
              alignSelf: 'center',
              border: 'none',
              background: 'transparent',
              padding: 0,
              cursor: (streaming || canSend) ? 'pointer' : 'default',
              opacity: (streaming || canSend) ? 1 : 0.45,
            }}
          >
            {streaming && !hasText
              ? <StopButton />
              : <SendButton />}
          </button>
        </div>
<div className="editorial-composer__meta" style={META_ROW_STYLE}>
          <div style={{ position: 'relative' }}>
            <span
              className="composer-model-label"
              onClick={() => setModelOpen(o => !o)}
              style={MODEL_LABEL_STYLE}
            >
              <span style={ACCENT_DOT_STYLE} />
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {currentModel?.name ?? 'Select model'}
              </span>
              <Icons.Chevron />
            </span>
            {modelOpen && activeThread && (
              <ModelPopover
                currentModelId={currentModel?.id ?? DEFAULT_MODEL_ID}
                onPick={pickModel}
                onClose={closeModelPopover}
              />
            )}
          </div>
          <span style={{ color: 'var(--accent)', opacity: 0.5, flex: 'none' }}>·</span>
          {activeThread && currentModel?.providerId === 'ollama' && (
            <>
              <select
                value={localContextMode}
                onChange={e => chat.setThreadContextMode(activeThread.id, e.currentTarget.value as ChatContextMode)}
                title="Local context mode"
                style={LOCAL_CONTEXT_SELECT_STYLE}
              >
                <option value="full">full context</option>
                <option value="system-tools">system + tools</option>
                <option value="bare">bare prompt</option>
                <option value="micro">micro tools</option>
              </select>
              <span style={{ color: 'var(--accent)', opacity: 0.5, flex: 'none' }}>·</span>
            </>
          )}
          <ContextMeter />
          <span style={{
            marginLeft: 'auto',
            flex: 'none',
            fontFamily: '"Geist Mono", monospace',
            color: 'var(--accent)',
            opacity: streaming ? 0.85 : 0,
            transition: 'opacity 160ms ease',
            letterSpacing: '0.06em',
          }}>
            {streaming ? (hasText ? 'Enter to interrupt' : 'streaming...') : ''}
          </span>
        </div>
      </div>
    </div>
  );
});

/** Per-thread spend indicator kept quiet unless there is spend to show. */
const ContextMeter = observer(function ContextMeter() {
  const chat = useChatStore();
  const imageJobs = useImageJobStore();
  const llmSpend = threadLlmSpendUsd(chat.activeThread);
  const imageSpend = imageJobs.threadCostUsd(chat.activeThreadId);
  const totalSpend = llmSpend + imageSpend;
  if (totalSpend <= 0) return <span style={{ flex: '1 1 auto' }} />;

  return (
    <div
      className="context-meter"
      title={`Spent in this chat: ${formatUsd(totalSpend)} (${formatUsd(llmSpend)} LLM, ${formatUsd(imageSpend)} images)`}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
        flex: '1 1 auto',
        fontFamily: '"Geist Mono", monospace',
        letterSpacing: '0.03em',
        fontSize: 11,
        lineHeight: '16px',
        color: 'var(--accent)',
        minWidth: 0,
        overflow: 'hidden',
      }}
    >
      <span className="context-meter__spend" style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
        {formatUsd(totalSpend)}
      </span>
    </div>
  );
});

const ApiKeyBanner = observer(function ApiKeyBanner() {
  const router = useRouterStore();
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12,
      padding: '8px 12px',
      marginBottom: 8,
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--panel)',
      color: 'var(--text-dim)',
      fontSize: 13,
      fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif',
    }}>
      <span>Add an API key to start chatting.</span>
      <button
        onClick={() => router.goMenu('models')}
        style={{
          padding: '4px 10px',
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'transparent',
          color: 'var(--accent)',
          cursor: 'pointer',
          fontSize: 12,
          fontFamily: 'inherit',
        }}
      >
        Open API settings
      </button>
    </div>
  );
});

const LocalImageBanner = observer(function LocalImageBanner() {
  const router = useRouterStore();
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12,
      padding: '8px 12px',
      marginBottom: 8,
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--panel)',
      color: 'var(--text-dim)',
      fontSize: 13,
      fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif',
    }}>
      <span>Start and connect ComfyUI to use local image generation.</span>
      <button
        onClick={() => router.goMenu('local')}
        style={{
          padding: '4px 10px',
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'transparent',
          color: 'var(--accent)',
          cursor: 'pointer',
          fontSize: 12,
          fontFamily: 'inherit',
        }}
      >
        Open Local settings
      </button>
    </div>
  );
});

function hasImageAttachment(attachments: { mime: string }[]): boolean {
  return attachments.some(a => isImageMime(a.mime));
}

function imageFilesFromClipboard(data: DataTransfer): File[] {
  const files: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (!file) continue;
    files.push(normalizePastedImageFile(file, files.length));
  }
  return files;
}

function normalizePastedImageFile(file: File, index: number): File {
  if (file.name && file.name.trim()) return file;
  const extension = extensionForImageMime(file.type);
  const suffix = index > 0 ? `-${index + 1}` : '';
  return new File([file], `${PASTED_IMAGE_NAME_PREFIX}-${timestampForPasteName()}${suffix}${extension}`, {
    type: file.type || 'image/png',
    lastModified: Date.now(),
  });
}

function extensionForImageMime(mime: string): string {
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  return '.png';
}

function timestampForPasteName(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function formatUsd(value: number): string {
  if (value < 0.001) return `$${value.toFixed(5)}`;
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}
