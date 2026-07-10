// Attachment helpers for the composer: clipboard-image extraction, pasted-image
// naming, and the vision-capability probe. Pure functions with no React or
// store dependencies so they stay easy to unit test in isolation.
import { isImageMime } from '../../../core/attachments';

const PASTED_IMAGE_NAME_PREFIX = 'pasted-image';

export function hasImageAttachment(attachments: { mime: string }[]): boolean {
  return attachments.some(a => isImageMime(a.mime));
}

export function imageFilesFromClipboard(data: DataTransfer): File[] {
  const files: File[] = [];
  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (!file) continue;
    files.push(normalizePastedImageFile(file, files.length));
  }
  return files;
}

function normalizePastedImageFile(file: File, index: number): File {
  if (file.name && file.name.trim()) return file;
  const extension = extensionForImageMime(file.type);
  const suffix = index > 0 ? `-${index + 1}` : '';
  return new File([file], `${PASTED_IMAGE_NAME_PREFIX}-${timestampForPasteName()}${suffix}${extension}`, {
    type: file.type || 'image/png',
    lastModified: Date.now(),
  });
}

function extensionForImageMime(mime: string): string {
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  return '.png';
}

function timestampForPasteName(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
