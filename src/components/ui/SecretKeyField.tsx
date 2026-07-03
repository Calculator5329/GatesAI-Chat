// Provides the shared SecretKeyField UI primitive used across menu and chat surfaces.
// Called by feature components; depends only on React props and global CSS variables.
// Invariant: primitives stay controlled, lightweight, and free of store side effects.
import { useState } from 'react';
import { tokens } from '../../core/styleTokens';
import { Button } from './Button';
import { Input } from './Input';

export interface SecretKeyFieldProps {
  /** The currently-stored key (empty / undefined → connect mode). */
  value: string;
  /** Called with the trimmed-non-empty key when the user submits. */
  onSet: (next: string) => void | Promise<void>;
  /** Called when the user clears the stored key. */
  onClear: () => void;
  placeholder?: string;
  /** When set and no key is stored, render a "Get a key →" hint below. */
  getKeyUrl?: string;
  /** Label on the connect button while in connect mode. Default "Connect". */
  connectLabel?: string;
  /** Label on the action button after connect (none renders by default). */
  removeLabel?: string;
  /** Submit immediately when a user pastes a non-empty value. */
  submitOnPaste?: boolean;
}

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '*'.repeat(key.length);
  return `${key.slice(0, 7)}${'*'.repeat(Math.max(0, key.length - 11))}${key.slice(-4)}`;
}

/**
 * Standard "API key" input with three modes baked in: connect (no value
 * yet, paste-and-Enter or click Connect), connected (masked, with reveal
 * and remove), and an optional "Get a key →" hint when the provider
 * exposes a signup URL. Used by every API card in Settings; previously
 * inlined three times in `Api.tsx` with subtly different markup.
 */
export function SecretKeyField({
  value,
  onSet,
  onClear,
  placeholder = 'Paste API key…',
  getKeyUrl,
  connectLabel = 'Connect',
  removeLabel = 'Remove',
  submitOnPaste = false,
}: SecretKeyFieldProps) {
  const [draft, setDraft] = useState('');
  const [revealed, setRevealed] = useState(false);

  if (value) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
        <Input
          readOnly
          value={revealed ? value : maskKey(value)}
          style={{ ...tokens.mono, fontSize: 12, flex: 1 }}
        />
        <Button onClick={() => setRevealed(v => !v)}>{revealed ? 'Hide' : 'Reveal'}</Button>
        <Button
          variant="danger"
          onClick={() => {
            onClear();
            setRevealed(false);
          }}
        >
          {removeLabel}
        </Button>
      </div>
    );
  }

  const submit = (): void => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    void onSet(trimmed);
    setDraft('');
  };

  const submitValue = (value: string): void => {
    const trimmed = value.trim();
    if (!trimmed) return;
    void onSet(trimmed);
    setDraft('');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
        <Input
          type="password"
          placeholder={placeholder}
          value={draft}
          onChange={e => setDraft(e.currentTarget.value)}
          style={{ flex: 1 }}
          onPaste={e => {
            if (!submitOnPaste) return;
            const pasted = e.clipboardData.getData('text');
            if (!pasted.trim()) return;
            e.preventDefault();
            submitValue(pasted);
          }}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
        />
        <Button variant="accent" onClick={submit} disabled={!draft.trim()}>{connectLabel}</Button>
      </div>
      {getKeyUrl && (
        <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
          Get a key →{' '}
          <a href={getKeyUrl} target="_blank" rel="noreferrer"
             style={{ color: 'var(--accent)', textDecoration: 'none' }}>
            {getKeyUrl.replace(/^https?:\/\//, '')}
          </a>
        </div>
      )}
    </div>
  );
}
