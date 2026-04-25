import type { CSSProperties, InputHTMLAttributes } from 'react';

const BASE: CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '7px 10px',
  color: 'var(--text)',
  fontFamily: 'inherit',
  fontSize: 13,
  width: '100%',
  outline: 'none',
};

export const fieldStyle = BASE;

export function Input({ style, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} style={{ ...BASE, ...style }} />;
}
