interface ToggleProps {
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ on, onChange, disabled }: ToggleProps) {
  return (
    <div
      role="switch"
      aria-checked={on}
      aria-disabled={disabled || undefined}
      onClick={() => !disabled && onChange(!on)}
      style={{
        width: 32, height: 18, borderRadius: 9,
        background: on ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.15s',
      }}
    >
      <div
        style={{
          width: 14, height: 14, borderRadius: '50%',
          background: on ? '#06120a' : '#e4e7ef',
          position: 'absolute', top: 2,
          left: on ? 16 : 2,
          transition: 'left 0.15s',
        }}
      />
    </div>
  );
}
