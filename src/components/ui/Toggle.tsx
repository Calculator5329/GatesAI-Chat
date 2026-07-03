interface ToggleProps {
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ on, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      className="ui-toggle"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      data-on={on || undefined}
      onClick={() => !disabled && onChange(!on)}
      style={{
        width: 32, height: 18, borderRadius: 9,
        border: 0,
        padding: 0,
        background: on ? 'var(--accent)' : 'rgba(255,255,255,0.1)',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background-color var(--motion-fast), opacity var(--motion-fast), box-shadow var(--motion-fast)',
      }}
    >
      <span
        className="ui-toggle__thumb"
        style={{
          display: 'block',
          width: 14, height: 14, borderRadius: '50%',
          background: on ? '#06120a' : '#e4e7ef',
          position: 'absolute', top: 2,
          left: on ? 16 : 2,
          transition: 'left var(--motion-fast), background-color var(--motion-fast)',
        }}
      />
    </button>
  );
}
