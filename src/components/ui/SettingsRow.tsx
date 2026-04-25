import type { ReactNode } from 'react';

interface SettingsRowProps {
  label: string;
  last?: boolean;
  children: ReactNode;
}

export function SettingsRow({ label, last, children }: SettingsRowProps) {
  return (
    <div
      style={{
        display: 'grid', gridTemplateColumns: '180px 1fr',
        gap: 24, padding: '12px 0',
        borderBottom: last ? 'none' : '1px solid var(--border)',
        alignItems: 'center',
      }}
    >
      <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>{label}</div>
      <div style={{ fontSize: 13, color: 'var(--text)' }}>{children}</div>
    </div>
  );
}
