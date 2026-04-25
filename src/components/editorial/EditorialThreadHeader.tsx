import type { ThreadHeaderKey, Thread } from '../../core/types';

interface Props {
  variant: ThreadHeaderKey;
  thread: Thread;
}

export function EditorialThreadHeader({ variant, thread }: Props) {
  if (variant === 'none') return null;

  const meta = '12 msgs · $0.0412';
  const dateMeta = 'Tue Apr 22';
  const baseLeft = {
    position: 'absolute' as const, top: 18, left: 20,
    fontSize: 10, color: 'var(--text-faint)',
    letterSpacing: '0.14em', textTransform: 'uppercase' as const,
    fontFamily: '"Geist Mono", monospace',
    lineHeight: 1.4,
  };
  const baseRight = { ...baseLeft, left: undefined, right: 20, textAlign: 'right' as const };

  if (variant === 'topLeft') {
    return (
      <div style={baseLeft}>
        <div>{dateMeta}</div>
        <div style={{ marginTop: 2 }}>{meta}</div>
      </div>
    );
  }

  if (variant === 'topRight') {
    return (
      <div style={baseRight}>
        <div>{dateMeta}</div>
        <div style={{ marginTop: 2, color: 'var(--accent)' }}>{meta}</div>
      </div>
    );
  }

  if (variant === 'spine') {
    return (
      <div style={{
        position: 'absolute', top: '50%', left: 14,
        transform: 'translateY(-50%) rotate(-90deg)',
        transformOrigin: 'center',
        fontFamily: '"Source Serif 4", Georgia, serif',
        fontStyle: 'italic', fontSize: 13,
        color: 'var(--text-faint)',
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
        pointerEvents: 'none',
      }}>
        {thread.title}
      </div>
    );
  }

  if (variant === 'chip') {
    return (
      <div style={{
        position: 'absolute', top: 16, right: 20,
        padding: '4px 10px', borderRadius: 99,
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        fontSize: 10.5, color: 'var(--text-dim)',
        fontFamily: '"Geist Mono", monospace',
        letterSpacing: '0.08em', textTransform: 'uppercase',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />
        {meta}
      </div>
    );
  }

  // 'both'
  return (
    <>
      <div style={baseLeft}>{dateMeta}</div>
      <div style={baseRight}>{meta}</div>
    </>
  );
}
