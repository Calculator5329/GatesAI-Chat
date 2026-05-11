import type { ReactNode } from 'react';

interface SettingsRowProps {
  label: string;
  last?: boolean;
  disabled?: boolean;
  children: ReactNode;
}

export function SettingsRow({ label, last, disabled, children }: SettingsRowProps) {
  return (
    <div
      className="settings-row"
      style={{
        display: 'grid', gridTemplateColumns: '180px 1fr',
        gap: 24, padding: '12px 0',
        borderBottom: last ? 'none' : '1px solid var(--border)',
        alignItems: 'center',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      <div className="settings-row__label" style={{ fontSize: 12.5, color: disabled ? 'var(--text-faint)' : 'var(--text-dim)' }}>{label}</div>
      <div className="settings-row__content" style={{ fontSize: 13, color: disabled ? 'var(--text-dim)' : 'var(--text)' }}>{children}</div>
    </div>
  );
}
