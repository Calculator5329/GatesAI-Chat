interface ToggleProps {
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  /**
   * Accessible name. Required: a `role="switch"` with no name is announced as
   * an unlabeled control, and the visible label next to these lives in a
   * sibling `<div>` that screen readers never associate with the switch.
   */
  label: string;
}

/**
 * Presentation lives in editorial.css (`.ui-toggle`), not inline. Inline
 * styles beat non-`!important` stylesheet rules, so an inline `transform` on
 * the thumb silently killed the `:active` press animation written for it.
 */
export function Toggle({ on, onChange, disabled, label }: ToggleProps) {
  return (
    <button
      type="button"
      className="ui-toggle"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      data-on={on || undefined}
      onClick={() => !disabled && onChange(!on)}
    >
      <span className="ui-toggle__thumb" />
    </button>
  );
}
