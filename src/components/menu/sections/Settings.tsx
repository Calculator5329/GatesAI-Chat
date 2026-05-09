import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../core/styleTokens';
import { Button, Card, SettingsRow } from '../../ui';
import { useChatStore } from '../../../stores/context';

/**
 * Real keyboard shortcuts the app actually binds. The previous version of
 * this file claimed ⌘K / ⌘N / ⌘L / ⌘\ — none of those existed. Keep this
 * list in sync with the actual `keydown` handlers in App, EditorialComposer,
 * Lightbox, and Local.
 */
const SHORTCUTS: Array<[string, string]> = [
  ['Send message', 'Enter'],
  ['Newline in composer', 'Shift+Enter'],
  ['Close menu / dismiss modal', 'Escape'],
  ['Lightbox: previous / next', '← / →'],
];

export const SettingsSection = observer(function SettingsSection() {
  return (
    <>
      <h1 style={tokens.h1}>Settings</h1>
      <div style={tokens.kicker}>app preferences · shortcuts · danger zone</div>

      <Card style={{ padding: '14px 18px', marginBottom: 20 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55 }}>
          Cloud model keys, catalog controls, and OpenRouter image generation are under{' '}
          <strong style={{ color: 'var(--text)' }}>Models</strong>. Installed runtimes live under{' '}
          <strong style={{ color: 'var(--text)' }}>Local</strong>. This page is just shortcuts and the danger zone.
        </div>
      </Card>

      <ShortcutsList />
      <DangerZone />
    </>
  );
});

function ShortcutsList() {
  return (
    <div style={tokens.section}>
      <div style={tokens.sectionTitle}>Shortcuts</div>
      {SHORTCUTS.map(([label, keys], i) => {
        const last = i === SHORTCUTS.length - 1;
        return (
          <div
            key={label}
            style={{
              display: 'grid', gridTemplateColumns: '220px 1fr',
              gap: 24, padding: '12px 0',
              borderBottom: last ? 'none' : '1px solid var(--border)',
              alignItems: 'center',
            }}
          >
            <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>{label}</div>
            <div>
              <span style={{
                ...tokens.mono, color: 'var(--text-dim)',
                padding: '2px 7px', background: 'var(--panel)',
                border: '1px solid var(--border)', borderRadius: 4,
                fontSize: 11.5,
              }}>{keys}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const DangerZone = observer(function DangerZone() {
  const chat = useChatStore();
  const [confirming, setConfirming] = useState(false);
  const visibleCount = chat.visibleThreads.length;

  const onDeleteAll = (): void => {
    chat.clearAllThreads();
    chat.createThread();
    setConfirming(false);
  };

  return (
    <div style={tokens.section}>
      <div style={tokens.sectionTitle}>Danger zone</div>
      <SettingsRow label="Delete all threads" last>
        {confirming ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              This permanently removes {visibleCount} thread{visibleCount === 1 ? '' : 's'}. There is no undo.
            </span>
            <Button variant="danger" onClick={onDeleteAll}>Delete everything</Button>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        ) : (
          <Button variant="danger" onClick={() => setConfirming(true)}>Delete…</Button>
        )}
      </SettingsRow>
    </div>
  );
});
