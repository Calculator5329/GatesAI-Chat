import type { SelectHTMLAttributes } from 'react';
import { fieldStyle } from './Input';

export function Select({ style, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...rest} style={{ ...fieldStyle, ...style }} />;
}
