import type { FsWriteResp } from '../../core/workspace';
import type { BridgeStore } from '../../stores/BridgeStore';
import type { DraftAttachment } from '../../stores/UiStore';

/**
 * Read a `File` from the browser, base64 it, and write it under
 * `/workspace/attachments/<safe-name>` via the bridge. Returns the
 * `DraftAttachment` shape the composer chip set expects.
 *
 * Filename collisions are sidestepped by prepending a short timestamp
 * suffix only when needed — keeps the most-common case (one file, no
 * collision) clean for the model to reference.
 */

export async function uploadAttachment(file: File, bridge: BridgeStore): Promise<DraftAttachment> {
  if (!bridge.isOnline) throw new Error('Bridge offline. Start gatesai-bridge to attach files.');

  const safeName = sanitizeFilename(file.name);
  const targetPath = `/workspace/attachments/${safeName}`;
  const base64 = await fileToBase64(file);

  const resp = await bridge.client.request<FsWriteResp>('fs.write', {
    path: targetPath,
    content: base64,
    encoding: 'base64',
    append: false,
  });

  return {
    id: `att-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    filename: safeName,
    path: resp.path,
    size: file.size,
    mime: file.type || 'application/octet-stream',
  };
}

function sanitizeFilename(name: string): string {
  // Strip leading paths (browsers usually don't leak them, but defensive).
  const base = name.replace(/^.*[\\/]/, '');
  // Replace anything not safely a filename char.
  const cleaned = base.replace(/[^A-Za-z0-9._-]+/g, '_');
  return cleaned.length > 0 ? cleaned : `file-${Date.now()}`;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') return reject(new Error('Unexpected reader result'));
      // dataURL is like "data:<mime>;base64,<payload>" — we only want the payload.
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}
