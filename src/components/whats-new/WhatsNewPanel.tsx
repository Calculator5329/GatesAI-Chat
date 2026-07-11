// Renders the version-change release notes; all visibility and persistence
// decisions remain in WhatsNewStore.
import { useEffect, type CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { useWhatsNewStore } from '../../stores/context';
import { Button } from '../ui/Button';
import { Icons } from '../ui/icons';

const BACKDROP_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1250,
  display: 'grid',
  placeItems: 'center',
  padding: 20,
  boxSizing: 'border-box',
  background: 'var(--overlay-scrim)',
  backdropFilter: 'blur(8px)',
  WebkitBackdropFilter: 'blur(8px)',
};

const PANEL_STYLE: CSSProperties = {
  width: 'min(510px, 100%)',
  maxHeight: 'min(680px, calc(100dvh - 40px))',
  overflowY: 'auto',
  padding: '28px',
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--panel)',
  color: 'var(--text)',
  boxShadow: '0 28px 90px rgba(0,0,0,0.58)',
};

export const WhatsNewPanel = observer(function WhatsNewPanel() {
  const whatsNew = useWhatsNewStore();
  const release = whatsNew.release;

  useEffect(() => {
    if (!release) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') whatsNew.dismiss();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [release, whatsNew]);

  if (!release) return null;

  return (
    <div
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget) whatsNew.dismiss();
      }}
      style={BACKDROP_STYLE}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="whats-new-title"
        style={PANEL_STYLE}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 18, alignItems: 'flex-start' }}>
          <div>
            <div style={{ color: 'var(--accent)', fontSize: 12, fontWeight: 650, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              GatesAI Chat {release.version}
            </div>
            <h2 id="whats-new-title" style={{ margin: '6px 0 0', fontSize: 25, letterSpacing: '-0.03em' }}>What’s new</h2>
          </div>
          <button
            type="button"
            aria-label="Dismiss what’s new"
            title="Dismiss"
            onClick={whatsNew.dismiss}
            style={{ border: 0, padding: 3, background: 'transparent', color: 'var(--text-faint)', cursor: 'pointer', display: 'flex' }}
          >
            <Icons.Close />
          </button>
        </div>

        <div style={{ display: 'grid', gap: 18, margin: '25px 0 28px' }}>
          {release.items.map(item => (
            <article key={item.title} style={{ paddingLeft: 15, borderLeft: '2px solid var(--accent)' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 650 }}>{item.title}</h3>
              <p style={{ margin: '5px 0 0', color: 'var(--text-dim)', fontSize: 14, lineHeight: 1.55 }}>{item.detail}</p>
            </article>
          ))}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <Button variant="accent" onClick={whatsNew.dismiss}>Got it</Button>
        </div>
      </section>
    </div>
  );
});
