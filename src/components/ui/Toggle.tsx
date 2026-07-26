import { tokens } from '../../core/styleTokens';

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
        background: on ? 'var(--accent)' : 'var(--surface-wash-10)',
        position: 'relative',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: `background-color ${tokens.motion.fast}, opacity ${tokens.motion.fast}, box-shadow ${tokens.motion.fast}`,
      }}
    >
      <span
        className="ui-toggle__thumb"
        style={{
          display: 'block',
          width: 14, height: 14, borderRadius: '50%',
          background: on ? 'var(--accent-contrast)' : 'var(--toggle-thumb-off)',
          // Travel on the compositor. `left` was laying out every frame, on the
          // most-toggled control in the app.
          position: 'absolute', top: 2, left: 2,
          transform: on ? 'translateX(14px)' : 'none',
          transition: `transform ${tokens.motion.fast}, background-color ${tokens.motion.fast}`,
        }}
      />
    </button>
  );
}
