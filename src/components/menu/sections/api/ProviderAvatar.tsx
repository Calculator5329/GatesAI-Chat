export function ProviderAvatar({ name }: { name: string }) {
  return (
    <div style={{
      width: 38, height: 38, borderRadius: 8,
      background: 'var(--panel)',
      border: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: '"Source Serif 4", Georgia, serif',
      fontStyle: 'italic', fontSize: 18,
      color: 'var(--text-dim)',
    }}>{name[0]}</div>
  );
}
