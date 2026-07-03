import type { TextareaHTMLAttributes } from 'react';
import { fieldStyle } from './Input';

export function Textarea({ style, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const classes = ['ui-field', 'ui-textarea', rest.className].filter(Boolean).join(' ');
  return <textarea {...rest} className={classes} style={{ ...fieldStyle, ...style }} />;
}
