import { useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { observer } from 'mobx-react-lite';
import { Icons } from '../ui/icons';
import type { SendKey } from '../../core/types';
import { useBridgeStore, useChatStore, useModelRegistry, useProviderStore, useRouterStore, useUiStore } from '../../stores/context';
import { ModelPopover } from './ModelPopover';

interface ComposerProps {
  sendKey: SendKey;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

function renderSendButton(sendKey: SendKey): ReactNode {
  switch (sendKey) {
    case 'arrow':
      return (
        <div style={{
          width: 28, height: 28, borderRadius: 7,
          background: 'var(--accent)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 16px var(--accent-glow)',
        }}><Icons.ArrowUp /></div>
      );
    case 'ghost':
      return (
        <div style={{
          width: 28, height: 28,
          color: 'var(--accent)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}><Icons.ArrowUp /></div>
      );
    case 'circle':
      return (
        <div style={{
          width: 30, height: 30, borderRadius: '50%',
          background: 'var(--accent)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 0 20px var(--accent-glow)',
        }}><Icons.ArrowUp /></div>
      );
    case 'enter':
      return (
        <div style={{
          height: 26, padding: '0 10px', borderRadius: 6,
          background: 'transparent',
          border: '1px solid var(--border)',
          color: 'var(--accent)',
          display: 'flex', alignItems: 'center', gap: 6,
          fontFamily: '"Geist Mono", monospace', fontSize: 11,
          letterSpacing: '0.06em',
        }}>
          <span style={{ color: 'var(--text-faint)' }}>Send</span>
          <span style={{ fontSize: 13 }}>↵</span>
        </div>
      );
    case 'quill':
      return (
        <div style={{
          height: 26, padding: '0 12px',
          color: 'var(--accent)',
          display: 'flex', alignItems: 'center', gap: 6,
          fontFamily: '"Source Serif 4", Georgia, serif',
          fontStyle: 'italic', fontSize: 15,
          borderBottom: '1px solid var(--accent)',
        }}>send</div>
      );
  }
}

/** Square stop control shown in place of the send button while streaming
 *  with an empty composer — a clear "halt the model" affordance. Once the
 *  user types, this swaps back to the normal send button (which now behaves
 *  as interrupt-and-send). */
function StopButton(): ReactNode {
  return (
    <div
      style={{
        width: 28, height: 28, borderRadius: 7,
        border: '1px solid var(--border)',
        background: 'var(--panel-2)',
        color: 'var(--text-dim)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <span style={{
        width: 10, height: 10, borderRadius: 2,
        background: 'currentColor', display: 'block',
      }} />
    </div>
  );
}

export const EditorialComposer = observer(function EditorialComposer({ sendKey, textareaRef }: ComposerProps) {
  const chat = useChatStore();
  const ui = useUiStore();
  const bridge = useBridgeStore();
  const registry = useModelRegistry();
  const providers = useProviderStore();
  const [modelOpen, setModelOpen] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeThread = chat.activeThread;
  const currentModel = registry.findById(activeThread?.modelId);
  const value = ui.draft;
  const streaming = chat.isStreaming;
  const hasText = value.trim().length > 0;
  const hasAttachments = ui.attachments.length > 0;
  // Send is enabled whenever there's text or at least one attachment. While
  // streaming, sending interrupts the in-flight reply and starts a new turn.
  const canSend = (hasText || hasAttachments) && providers.hasUsableProvider;

  const onSend = () => {
    if (!canSend) return;
    chat.sendMessage(value, ui.attachments);
    ui.clearDraft();
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  const onUpload = async (files: FileList | File[]) => {
    setUploadError(null);
    if (!bridge.isOnline) {
      setUploadError('Bridge offline. Start gatesai-bridge to attach files.');
      return;
    }
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const att = await bridge.uploadAttachment(f);
        ui.addAttachment(att);
      }
    } catch (err) {
      setUploadError((err as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    if (e.dataTransfer.files.length > 0) void onUpload(e.dataTransfer.files);
  };

  const onStop = () => {
    chat.stopStreaming();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const sendTitle = streaming
    ? (hasText ? 'Interrupt and send' : 'Stop')
    : 'Send';

  const labelStyle: CSSProperties = {
    flex: 1,
    background: 'transparent',
    border: 'none',
    outline: 'none',
    resize: 'none',
    color: 'var(--text)',
    fontSize: 15,
    fontFamily: '"Source Serif 4", Georgia, serif',
    fontStyle: value ? 'normal' : 'italic',
    lineHeight: 1.5,
    maxHeight: 200,
    minHeight: 24,
    padding: 0,
  };

  return (
    <div
      style={{ padding: '0 48px 16px', fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif' }}
      onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
      onDragLeave={() => setDragActive(false)}
      onDrop={onDrop}
    >
      <div style={{ width: 'min(750px, 70%)', margin: '0 auto', paddingTop: 4 }}>
        {!providers.hasUsableProvider && <ApiKeyBanner />}
        {hasAttachments && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
            {ui.attachments.map(a => (
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
            ))}
          </div>
        )}
        {(uploadError || uploading) && (
          <div style={{ fontSize: 11, color: uploadError ? '#c96a6a' : 'var(--text-faint)', marginBottom: 6 }}>
            {uploadError ?? 'Uploading…'}
          </div>
        )}
        <div style={{
          display: 'flex', alignItems: 'flex-end', gap: 12,
          padding: '10px 14px',
          background: 'var(--panel)',
          border: dragActive ? '1px dashed var(--accent)' : '1px solid var(--border)',
          borderRadius: 10,
          transition: 'border-color 120ms ease',
        }}>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) void onUpload(e.target.files);
              e.target.value = '';
            }}
          />
          <div
            onClick={() => fileInputRef.current?.click()}
            title={bridge.isOnline ? 'Attach file' : 'Bridge offline — cannot attach files'}
            style={{
              width: 22, height: 22,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: bridge.isOnline ? 'pointer' : 'not-allowed',
              color: 'var(--text-faint)',
              opacity: bridge.isOnline ? 0.85 : 0.35,
              flex: 'none',
            }}
          >
            <Icons.Paperclip />
          </div>
          <textarea
            ref={textareaRef}
            value={value}
            onChange={e => ui.setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Continue the thought…"
            rows={1}
            style={labelStyle}
            onInput={(e) => {
              const target = e.currentTarget;
              target.style.height = 'auto';
              target.style.height = Math.min(target.scrollHeight, 200) + 'px';
            }}
          />
          <div
            onClick={streaming && !hasText ? onStop : onSend}
            title={sendTitle}
            style={{
              cursor: (streaming || canSend) ? 'pointer' : 'default',
              opacity: (streaming || canSend) ? 1 : 0.45,
            }}
          >
            {streaming && !hasText
              ? <StopButton />
              : renderSendButton(sendKey)}
          </div>
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginTop: 6,
          fontSize: 11.5, color: 'var(--text-faint)',
          position: 'relative',
        }}>
          <div style={{ position: 'relative' }}>
            <span
              onClick={() => setModelOpen(o => !o)}
              style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', padding: '2px 6px', borderRadius: 4 }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.04)'}
              onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
            >
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)' }} />
              {currentModel?.name ?? 'Select model'}
              <Icons.Chevron />
            </span>
            {modelOpen && activeThread && (
              <ModelPopover
                currentModelId={activeThread.modelId}
                onPick={(modelId) => chat.setThreadModel(activeThread.id, modelId)}
                onClose={() => setModelOpen(false)}
              />
            )}
          </div>
          <span style={{ color: 'var(--text-faint)', opacity: 0.5 }}>·</span>
          <ContextMeter />
          <span style={{
            marginLeft: 'auto',
            fontFamily: '"Geist Mono", monospace',
            color: streaming ? 'var(--accent)' : 'var(--text-faint)',
            opacity: streaming ? 0.85 : 0,
            transition: 'opacity 160ms ease',
            letterSpacing: '0.06em',
          }}>
            {streaming ? (hasText ? '↵ to interrupt' : 'streaming…') : ''}
          </span>
        </div>
      </div>
    </div>
  );
});

/**
 * Live context-window usage for the active thread, including the unsent draft.
 * Replaces the static "↵ send · ⇧↵ newline" hint — the meter teaches the same
 * keyboard idiom implicitly (you'll learn Enter sends because the bar grows
 * when you type and resets when you send), while surfacing genuinely useful
 * info: how close you are to the model's context limit.
 */
const ContextMeter = observer(function ContextMeter() {
  const chat = useChatStore();
  const ui = useUiStore();
  const usage = chat.tokenUsage(ui.draft);

  const tone = usage.fraction >= 0.9
    ? 'var(--text)' : usage.fraction >= 0.75
    ? 'var(--text-dim)' : 'var(--text-faint)';
  const fillColor = usage.fraction >= 0.9
    ? '#e06c75' : usage.fraction >= 0.75
    ? '#d19a66' : 'var(--accent)';

  return (
    <div
      title={`${formatTokens(usage.used)} of ${formatTokens(usage.window)} tokens used (estimated)`}
      style={{
        display: 'flex', alignItems: 'center', gap: 8,
        fontFamily: '"Geist Mono", monospace',
        letterSpacing: '0.04em',
        fontSize: 11,
        color: tone,
      }}
    >
      <div style={{
        width: 90, height: 4, borderRadius: 2,
        background: 'rgba(255,255,255,0.06)',
        overflow: 'hidden',
        flex: 'none',
      }}>
        <div style={{
          width: `${Math.round(usage.fraction * 100)}%`,
          height: '100%',
          background: fillColor,
          transition: 'width 160ms ease, background-color 160ms ease',
        }} />
      </div>
      <span>{formatTokens(usage.used)} / {formatTokens(usage.window)}</span>
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
        onClick={() => router.goMenu('api')}
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

function formatTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 100_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}
