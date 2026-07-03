import type { SelectHTMLAttributes } from 'react';
import { fieldStyle } from './Input';

export function Select({ style, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  const classes = ['ui-field', 'ui-select', rest.className].filter(Boolean).join(' ');
  return <select {...rest} className={classes} style={{ ...fieldStyle, ...style }} />;
}
