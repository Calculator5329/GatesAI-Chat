import type { ReactNode } from 'react';
import type { HeaderKey } from '../../core/types';

interface HeaderDef {
  label: string;
  render: () => ReactNode;
}

export const EDITORIAL_HEADERS: Record<HeaderKey, HeaderDef> = {
  reading: {
    label: 'Reading Room',
    render: () => (
      <>
        <div style={{ fontFamily: '"Source Serif 4", Georgia, serif', fontSize: 18, fontStyle: 'italic', color: 'var(--text)', letterSpacing: '-0.01em' }}>GatesAI</div>
        <div style={{ fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 4 }}>a reading room</div>
      </>
    ),
  },
  wordmark: {
    label: 'Wordmark',
    render: () => (
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <div style={{ fontFamily: '"Source Serif 4", Georgia, serif', fontSize: 22, fontWeight: 500, color: 'var(--text)', letterSpacing: '-0.02em' }}>GatesAI</div>
        <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', alignSelf: 'center', marginBottom: 2 }} />
      </div>
    ),
  },
  monogram: {
    label: 'Monogram',
    render: () => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 6,
          background: 'var(--accent)', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: '"Source Serif 4", Georgia, serif', fontStyle: 'italic', fontSize: 18,
          boxShadow: '0 0 14px var(--accent-glow)',
        }}>g</div>
        <div>
          <div style={{ fontFamily: '"Geist", system-ui, sans-serif', fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>GatesAI</div>
          <div style={{ fontSize: 10, color: 'var(--text-faint)' }}>claude · gpt-4 · llama</div>
        </div>
      </div>
    ),
  },
  rule: {
    label: 'Masthead',
    render: () => (
      <>
        <div style={{ fontSize: 9, color: 'var(--text-faint)', letterSpacing: '0.2em', textTransform: 'uppercase', marginBottom: 6 }}>Vol. 1 · No. 47</div>
        <div style={{ fontFamily: '"Source Serif 4", Georgia, serif', fontSize: 24, fontWeight: 400, color: 'var(--text)', letterSpacing: '-0.02em', lineHeight: 1 }}>GatesAI</div>
        <div style={{ height: 1, background: 'var(--border)', margin: '8px 0 0' }} />
      </>
    ),
  },
};
