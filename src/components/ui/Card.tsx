import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  style?: CSSProperties;
}

export function Card({ children, style, ...rest }: CardProps) {
  return (
    <div
      {...rest}
      style={{
        border: '1px solid var(--border)',
        borderRadius: 8,
        padding: '18px 20px',
        background: 'transparent',
        ...style,
      }}
    >
      {children}
    </div>
  );
}
