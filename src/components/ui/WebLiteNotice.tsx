import type { CSSProperties, ReactNode } from 'react';

const noticeStyle: CSSProperties = {
  padding: '10px 12px',
  border: '1px solid color-mix(in srgb, var(--accent) 24%, var(--border))',
  borderRadius: 8,
  background: 'color-mix(in srgb, var(--accent) 7%, transparent)',
  color: 'var(--text-dim)',
  fontSize: 12.5,
  lineHeight: 1.5,
};

export function WebLiteNotice({ children, show }: { children?: ReactNode; show: boolean }) {
  if (!show) return null;
  return (
    <div style={noticeStyle} role="note">
      {children ?? (
        <>
          <strong style={{ color: 'var(--text)' }}>Web Lite:</strong>{' '}
          cloud chat runs in this browser. Desktop workspace tools, local runtimes,
          OS file opening, and local artifact persistence are available in the desktop app.
        </>
      )}
    </div>
  );
}
