import type { CSSProperties, ReactNode } from 'react';

type PillTone = 'accent' | 'muted';

interface PillProps {
  children: ReactNode;
  tone?: PillTone;
  style?: CSSProperties;
}

const TONE: Record<PillTone, CSSProperties> = {
  accent: { background: 'rgba(62,207,142,0.1)', color: 'var(--accent)' },
  muted:  { background: 'rgba(255,255,255,0.05)', color: 'var(--text-faint)' },
};

export function Pill({ children, tone = 'accent', style }: PillProps) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        padding: '3px 8px', borderRadius: 99,
        fontSize: 11,
        fontFamily: '"Geist Mono", monospace',
        letterSpacing: '0.04em',
        ...TONE[tone],
        ...style,
      }}
    >
      {children}
    </span>
  );
}
