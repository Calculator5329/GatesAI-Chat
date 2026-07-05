import type { ButtonHTMLAttributes, CSSProperties } from 'react';
import { tokens } from '../../core/styleTokens';

type ButtonVariant = 'default' | 'accent' | 'danger';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

const VARIANT: Record<ButtonVariant, CSSProperties> = {
  default: {
    background: 'transparent',
    border: '1px solid var(--border)',
    color: 'var(--text)',
  },
  accent: {
    background: 'var(--accent)',
    border: '1px solid var(--accent)',
    color: 'var(--accent-contrast)',
    fontWeight: 500,
  },
  danger: {
    background: 'transparent',
    border: '1px solid var(--danger-border-subtle)',
    color: 'var(--danger)',
  },
};

export function Button({ variant = 'default', style, className, disabled, ...rest }: ButtonProps) {
  const classes = ['ui-button', `ui-button--${variant}`, className].filter(Boolean).join(' ');
  return (
    <button
      {...rest}
      className={classes}
      disabled={disabled}
      data-variant={variant}
      style={{
        borderRadius: 6,
        padding: '6px 11px',
        fontSize: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
        transition: tokens.motion.interactive,
        ...VARIANT[variant],
        ...style,
      }}
    />
  );
}
