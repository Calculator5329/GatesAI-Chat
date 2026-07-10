// The composer input row: hidden file input + attach button, the autosizing
// text area, and the send/stop control. Presentational — draft value, send
// gating, and handlers are supplied by EditorialComposer.
import type { ChangeEvent, ClipboardEvent, CSSProperties, KeyboardEvent, ReactNode, RefObject } from 'react';
import { Icons } from '../../ui/icons';
import {
  ATTACH_BTN_STYLE,
  ROW_STYLE,
  SEND_BTN_STYLE,
  STOP_BTN_INNER_STYLE,
  STOP_BTN_OUTER_STYLE,
  SUPPORTS_FIELD_SIZING,
  TEXTAREA_BASE_STYLE,
} from './composerStyles';

interface ComposerInputProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  fileInputRef: RefObject<HTMLInputElement | null>;
  value: string;
  placeholder: string;
  dragActive: boolean;
  bridgeOnline: boolean;
  streaming: boolean;
  hasText: boolean;
  canSend: boolean;
  sendTitle: string;
  onFileChange: (e: ChangeEvent<HTMLInputElement>) => void;
  onAttachClick: () => void;
  onDraftChange: (next: string) => void;
  onFlushDraft: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste: (e: ClipboardEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
  onStop: () => void;
}

export function ComposerInput({
  textareaRef,
  fileInputRef,
  value,
  placeholder,
  dragActive,
  bridgeOnline,
  streaming,
  hasText,
  canSend,
  sendTitle,
  onFileChange,
  onAttachClick,
  onDraftChange,
  onFlushDraft,
  onKeyDown,
  onPaste,
  onSend,
  onStop,
}: ComposerInputProps) {
  // The only per-render-derived bit: italic when empty (placeholder voice).
  const textareaStyle: CSSProperties = value
    ? TEXTAREA_BASE_STYLE
    : { ...TEXTAREA_BASE_STYLE, fontStyle: 'italic' };

  return (
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
        onChange={onFileChange}
      />
      <AttachButton
        onClick={onAttachClick}
        disabled={!bridgeOnline}
        title={bridgeOnline ? 'Attach file' : 'Bridge offline - cannot attach files'}
      />
      <textarea
        ref={textareaRef}
        className="composer-textarea"
        value={value}
        onChange={e => onDraftChange(e.target.value)}
        onBlur={onFlushDraft}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        placeholder={placeholder}
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
        data-ready={(streaming || canSend) || undefined}
        data-mode={streaming && !hasText ? 'stop' : 'send'}
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
  );
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
