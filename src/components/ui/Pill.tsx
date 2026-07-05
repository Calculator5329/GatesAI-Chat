import type { CSSProperties, ReactNode } from 'react';

type PillTone = 'accent' | 'muted' | 'warning' | 'danger';

interface PillProps {
  children: ReactNode;
  tone?: PillTone;
  style?: CSSProperties;
  title?: string;
}

const TONE: Record<PillTone, CSSProperties> = {
  accent:  { background: 'var(--success-pill-bg)', color: 'var(--accent)' },
  muted:   { background: 'var(--surface-wash-5)', color: 'var(--text-faint)' },
  warning: { background: 'var(--warning-pill-bg)', color: 'var(--warning-2)' },
  danger:  { background: 'var(--danger-pill-bg)', color: 'var(--danger-alt)' },
};

export function Pill({ children, tone = 'accent', style, title }: PillProps) {
  return (
    <span
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 8px', borderRadius: 99,
        fontSize: 11,
        fontFamily: '"Geist Mono", monospace',
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
        ...TONE[tone],
        ...style,
      }}
    >
      {children}
    </span>
  );
}
