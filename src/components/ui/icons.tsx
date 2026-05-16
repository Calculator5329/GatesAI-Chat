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
    style={{ flexShrink: 0, overflow: 'visible', ...style }}
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
  Back:      () => <Ico d="M10.5 3.5L6 8l4.5 4.5M6.5 8H13" />,
  Copy:      () => <Ico d={<><rect x="6" y="5" width="7" height="8" rx="1.2" /><path d="M3 10.5V3.8C3 3.4 3.4 3 3.8 3h5.7" /></>} />,
  Edit:      () => <Ico d={<><path d="M3.5 11.8l.7-2.7 6.6-6.6a1.4 1.4 0 0 1 2 2L6.2 11.1z" /><path d="M9.8 3.5l2.7 2.7M3.5 13h9" /></>} />,
  Refresh:   () => <Ico d={<><path d="M13 5.5A5 5 0 1 0 14 8" /><path d="M13 2.5v3h-3" /></>} />,
  Branch:    () => <Ico d={<><circle cx="4" cy="4" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="4" cy="12" r="1.5" /><path d="M4 5.5V12M5.4 4.6c3.2.7 5.2 2.7 6 5.9" /></>} />,
  Pin:       () => <Ico size={17} stroke={1.55} d={<g transform="rotate(-45 8 8)"><path d="M5.2 3.4h5.6" /><path d="M8 3.4v6.2" /><path d="M6.2 9.6h3.6" /><path d="M8 9.6v3.4" /></g>} />,
  Eye:       () => <Ico d={<><path d="M1.8 8s2.2-4 6.2-4 6.2 4 6.2 4-2.2 4-6.2 4-6.2-4-6.2-4z" /><circle cx="8" cy="8" r="1.7" /></>} />,
  Tool:      () => <Ico d={<><path d="M9.8 2.8a3 3 0 0 0 3.4 3.4l-6.8 6.8a1.6 1.6 0 0 1-2.3-2.3z" /><path d="M4.4 11.6l-1.7 1.7" /></>} />,
  Share:     () => <Ico d={<><circle cx="5" cy="8" r="1.7" /><circle cx="12" cy="4" r="1.7" /><circle cx="12" cy="12" r="1.7" /><path d="M6.5 7.1l4-2.2M6.5 8.9l4 2.2" /></>} />,
  More:      () => <Ico d={<><circle cx="8" cy="3.8" r=".7" fill="currentColor" stroke="none" /><circle cx="8" cy="8" r=".7" fill="currentColor" stroke="none" /><circle cx="8" cy="12.2" r=".7" fill="currentColor" stroke="none" /></>} />,
  Close:     () => <Ico d="M4 4l8 8M12 4l-8 8" />,
};
