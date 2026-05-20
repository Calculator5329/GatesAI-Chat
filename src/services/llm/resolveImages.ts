import type { LlmImagePart, LlmMessage } from '../../core/llm';
import type { Message } from '../../core/types';
import { isImageMime } from '../../core/attachments';

/**
 * Minimal surface the resolver needs from the bridge. Narrower than the
 * full `BridgeStore` so this file can stay in the service layer without
 * pulling in the store; accepts either the full store or any of the tool
 * facades that expose the same method.
 */
export interface AttachmentBytesReader {
  readAttachmentBase64(path: string): Promise<{ base64: string; mime: string; size: number } | null>;
}

/**
 * Walk a freshly-flattened wire message list and populate `images` on user
 * entries by reading base64 bytes from the bridge. Full-context requests
 * include every stored user turn, while reduced context modes usually include
 * only the latest user turn, so the two sequences are aligned from the end.
 *
 * Image attachments are skipped entirely when the target model does not
 * support vision (`supportsVision: false`) — the model wouldn't know what
 * to do with them, and we avoid spending base64 tokens. When the bridge
 * is offline or a read fails, the attachment is dropped from the payload
 * and the rest of the turn still goes through.
 *
 * Mutates `wire` in place for simplicity — callers build it fresh each
 * turn, so there's no aliasing concern. Returns the same reference.
 */
export async function resolveWireImages(
  wire: LlmMessage[],
  pending: Message[],
  bridge: AttachmentBytesReader | undefined,
  supportsVision: boolean,
): Promise<LlmMessage[]> {
  if (!supportsVision || !bridge) return wire;

  const userStored = pending.filter(m => m.role === 'user');
  const userWire = collectUserWireIndices(wire);
  if (userStored.length === 0 || userWire.length === 0) return wire;

  const pairs: Array<{ wireIdx: number; paths: string[] }> = [];
  const count = Math.min(userStored.length, userWire.length);
  const storedStart = userStored.length - count;
  const wireStart = userWire.length - count;
  for (let i = 0; i < count; i++) {
    const stored = userStored[storedStart + i];
    if (stored.role !== 'user') continue;
    const refs = stored.attachments ?? [];
    const imagePaths = refs.filter(a => isImageMime(a.mime)).map(a => a.path);
    if (imagePaths.length === 0) continue;
    pairs.push({ wireIdx: userWire[wireStart + i], paths: imagePaths });
  }
  if (pairs.length === 0) return wire;

  await Promise.all(
    pairs.map(async ({ wireIdx, paths }) => {
      const parts = await Promise.all(paths.map(p => readOne(bridge, p)));
      const resolved = parts.filter((p): p is LlmImagePart => p !== null);
      if (resolved.length > 0) wire[wireIdx].images = resolved;
    }),
  );

  return wire;
}

function collectUserWireIndices(wire: LlmMessage[]): number[] {
  const idxs: number[] = [];
  for (let i = 0; i < wire.length; i++) if (wire[i].role === 'user') idxs.push(i);
  return idxs;
}

async function readOne(bridge: AttachmentBytesReader, path: string): Promise<LlmImagePart | null> {
  try {
    const result = await bridge.readAttachmentBase64(path);
    if (!result) return null;
    return { mime: result.mime, base64: result.base64 };
  } catch {
    return null;
  }
}
