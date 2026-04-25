import type { DraftAttachment } from './types';

export interface RenderedAttachment {
  path: string;
  name: string;
  kind: string;
  size: string;
}

export const ATTACHMENT_FOOTER_MARKER =
  '\n\n📎 Attached files (use `inspect_file` for CSV/JSON/text; use fs for byte-level reads/writes):\n';

export function formatAttachmentFooter(attachments: Pick<DraftAttachment, 'path' | 'size' | 'mime'>[]): string {
  if (attachments.length === 0) return '';
  return ATTACHMENT_FOOTER_MARKER +
    attachments.map(a => `  - ${a.path} · ${formatSize(a.size)} · ${a.mime}`).join('\n');
}

export function splitAttachmentFooter(content: string): { body: string; attachments: RenderedAttachment[] } {
  const idx = content.indexOf(ATTACHMENT_FOOTER_MARKER);
  if (idx < 0) return { body: content, attachments: [] };

  const body = content.slice(0, idx);
  const footer = content.slice(idx + ATTACHMENT_FOOTER_MARKER.length);
  const attachments = footer
    .split('\n')
    .map(parseAttachmentLine)
    .filter((file): file is RenderedAttachment => Boolean(file));

  return { body, attachments };
}

function parseAttachmentLine(line: string): RenderedAttachment | null {
  const match = line.trim().match(/^-\s+(.+?)\s+·\s+(.+?)\s+·\s+(.+)$/);
  if (!match) return null;
  const [, path, size, mime] = match;
  const name = path.split(/[\\/]/).pop() || path;
  return { path, name, size, kind: attachmentKind(name, mime) };
}

function attachmentKind(name: string, mime: string): string {
  const ext = name.includes('.') ? name.split('.').pop()?.toUpperCase() : '';
  if (mime.toLowerCase().includes('csv')) return 'CSV';
  if (mime.toLowerCase().includes('json')) return 'JSON';
  if (mime.toLowerCase().includes('pdf')) return 'PDF';
  return ext || 'FILE';
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes)) return '0B';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
