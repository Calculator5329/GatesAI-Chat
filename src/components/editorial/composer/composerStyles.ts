// Shared presentation constants for the chat composer surface. Kept in one
// place so the split-out composer subcomponents (input row, meta row,
// attachment tray) render byte-for-byte the same styling they did when this
// all lived in EditorialComposer.tsx.
import type { CSSProperties } from 'react';
import { tokens } from '../../../core/styleTokens';

/** Browsers without `field-sizing: content` need the JS height-recalc fallback. */
export const SUPPORTS_FIELD_SIZING = typeof CSS !== 'undefined'
  && typeof CSS.supports === 'function'
  && CSS.supports('field-sizing', 'content');

export const DRAFT_FLUSH_MS = 120;

export const ATTACH_BTN_STYLE: CSSProperties = {
  width: 28, height: 28, borderRadius: 6,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: 'var(--text-faint)',
  flex: 'none',
  alignSelf: 'center',
  transition: `background-color ${tokens.motion.fast}`,
};

export const SEND_BTN_STYLE: CSSProperties = {
  width: 28, height: 28, borderRadius: 6,
  color: 'var(--accent)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  transition: `background-color ${tokens.motion.fast}, opacity ${tokens.motion.fast}`,
};

export const STOP_BTN_OUTER_STYLE: CSSProperties = {
  width: 28, height: 28, borderRadius: 7,
  border: '1px solid var(--border)',
  background: 'var(--panel-2)',
  color: 'var(--text-dim)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

export const STOP_BTN_INNER_STYLE: CSSProperties = {
  width: 10, height: 10, borderRadius: 2,
  background: 'currentColor', display: 'block',
};

export const ROW_STYLE: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '8px 12px 8px 8px',
  background: 'var(--panel)',
  borderRadius: 10,
  transition: `border-color ${tokens.motion.fast}`,
};

export const META_ROW_STYLE: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, marginTop: 8,
  fontSize: 11.5, color: 'var(--accent)',
  position: 'relative',
  minHeight: 18,
  minWidth: 0,
};

export const MODEL_LABEL_STYLE: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 6,
  color: 'var(--accent)',
  cursor: 'pointer', padding: '2px 6px', borderRadius: 4,
  maxWidth: 220,
  minWidth: 0,
};

export const ACCENT_DOT_STYLE: CSSProperties = {
  width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)',
};

export const SEP_STYLE: CSSProperties = {
  color: 'var(--accent)', opacity: 0.5, flex: 'none',
};

export const LOCAL_CONTEXT_SELECT_STYLE: CSSProperties = {
  appearance: 'none',
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  borderRadius: 5,
  color: 'var(--accent)',
  fontFamily: '"Geist Mono", monospace',
  fontSize: 10.5,
  height: 22,
  padding: '0 8px',
  outline: 'none',
};

export const TEXTAREA_BASE_STYLE: CSSProperties = {
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
