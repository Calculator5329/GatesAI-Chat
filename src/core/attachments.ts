// Defines shared attachments domain contracts and pure helpers for chat, models, tokens, or workspace paths.
// Called by stores, services, components, and tests; depends on stable TypeScript data shapes.
// Invariant: core modules stay side-effect free except for explicit cache helpers.
import type { DraftAttachment, MessageAttachmentRef, UserMessage } from './types';
import { messageAttachments, messageText } from './messageParts';

/** True when a MIME type names an image (case-insensitive `image/*`). */
export function isImageMime(mime: string | undefined | null): boolean {
  return typeof mime === 'string' && /^image\//i.test(mime);
}

export interface RenderedAttachment {
  /** Stable upload id when available. Legacy parsed footer attachments omit it. */
  id?: string;
  /** Stable UI/cache identity. Falls back to path/size/index for legacy refs. */
  cacheKey: string;
  path: string;
  name: string;
  kind: string;
  size: string;
  /** Original MIME type (retained so the UI can pick a thumbnail renderer). */
  mime: string;
  /** Convenience: true when {@link mime} starts with `image/`. */
  isImage: boolean;
}

/**
 * Convert an upload-time attachment into the persisted ref that lives on the
 * user message. Drops transient fields (the draft id) and re-derives the
 * display name from the path so we store a single source of truth.
 */
export function toMessageAttachmentRef(
  a: Pick<DraftAttachment, 'path' | 'mime' | 'size' | 'filename'> & { id?: string },
): MessageAttachmentRef {
  const name = a.filename || a.path.split(/[\\/]/).pop() || a.path;
  return { ...(a.id ? { id: a.id } : {}), path: a.path, name, mime: a.mime, size: a.size };
}

/**
 * Prefer canonical image/artifact parts when present; fall back to structured
 * legacy attachments or parsing the legacy text footer. Returns both
 * the visible body (footer stripped) and a render-ready attachment list.
 */
export function resolveUserAttachments(message: Pick<UserMessage, 'content' | 'attachments' | 'parts'>): {
  body: string;
  attachments: RenderedAttachment[];
} {
  const fullMessage: UserMessage = { id: '', role: 'user', createdAt: 0, ...message };
  const parsed = splitAttachmentFooter(messageText(fullMessage));
  const attachments = messageAttachments(fullMessage);
  if (attachments.length > 0) {
    return {
      body: parsed.body,
      attachments: attachments.map(renderAttachment),
    };
  }
  return parsed;
}

function renderAttachment(ref: MessageAttachmentRef, index: number): RenderedAttachment {
  return {
    ...(ref.id ? { id: ref.id } : {}),
    cacheKey: ref.id ?? `${ref.path}:${ref.size}:${index}`,
    path: ref.path,
    name: ref.name,
    size: formatSize(ref.size),
    kind: attachmentKind(ref.name, ref.mime),
    mime: ref.mime,
    isImage: isImageMime(ref.mime),
  };
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

function parseAttachmentLine(line: string, index: number): RenderedAttachment | null {
  const match = line.trim().match(/^-\s+(.+?)\s+·\s+(.+?)\s+·\s+(.+)$/);
  if (!match) return null;
  const [, path, size, mime] = match;
  const name = path.split(/[\\/]/).pop() || path;
  return {
    cacheKey: `${path}:${size}:${index}:legacy`,
    path,
    name,
    size,
    kind: attachmentKind(name, mime),
    mime,
    isImage: isImageMime(mime),
  };
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
