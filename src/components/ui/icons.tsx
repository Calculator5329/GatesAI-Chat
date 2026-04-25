import type { CSSProperties, ReactNode } from 'react';

interface IconProps {
  d: string | ReactNode;
  size?: number;
  stroke?: number;
  fill?: string;
  style?: CSSProperties;
}

const Ico = ({ d, size = 16, stroke = 1.5, fill = 'none', style }: IconProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill={fill}
    stroke="currentColor"
    strokeWidth={stroke}
    strokeLinecap="round"
    strokeLinejoin="round"
    style={{ flexShrink: 0, ...style }}
  >
    {typeof d === 'string' ? <path d={d} /> : d}
  </svg>
);

export const Icons = {
  Search:    () => <Ico d={<><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14" /></>} />,
  Plus:      () => <Ico d="M8 3v10M3 8h10" />,
  ArrowUp:   () => <Ico d="M8 13V3M4 7l4-4 4 4" />,
  Paperclip: () => <Ico d="M11.5 6.5l-4.8 4.8a2 2 0 1 0 2.8 2.8L14 9.6a3.5 3.5 0 1 0-5-5L4.3 9.3" />,
  Chevron:   () => <Ico d="M4 6l4 4 4-4" />,
  Close:     () => <Ico d="M4 4l8 8M12 4l-8 8" />,
};
