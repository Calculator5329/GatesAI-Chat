interface SegmentedControlProps<T extends string> {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}

export function SegmentedControl<T extends string>({ options, value, onChange }: SegmentedControlProps<T>) {
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      {options.map(opt => {
        const active = opt === value;
        return (
          <div
            key={opt}
            onClick={() => onChange(opt)}
            style={{
              padding: '5px 10px',
              fontSize: 11.5,
              borderRadius: 5,
              cursor: 'pointer',
              background: active ? 'rgba(62,207,142,0.1)' : 'transparent',
              color: active ? 'var(--accent)' : 'var(--text-dim)',
              border: active ? '1px solid rgba(62,207,142,0.4)' : '1px solid var(--border)',
              fontFamily: '"Geist Mono", monospace',
              letterSpacing: '0.04em',
            }}
          >
            {opt}
          </div>
        );
      })}
    </div>
  );
}
