import type { TextareaHTMLAttributes } from 'react';
import { fieldStyle } from './Input';

export function Textarea({ style, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} style={{ ...fieldStyle, ...style }} />;
}
