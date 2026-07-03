import type { CSSProperties, InputHTMLAttributes } from 'react';
import { tokens } from '../../core/styleTokens';

const BASE: CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '8px 10px',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: 13,
  width: '100%',
  outline: 'none',
  transition: tokens.motion.interactive,
};

export const fieldStyle = BASE;

export function Input({ style, className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  const classes = ['ui-field', 'ui-input', className].filter(Boolean).join(' ');
  return <input {...rest} className={classes} style={{ ...BASE, ...style }} />;
}
