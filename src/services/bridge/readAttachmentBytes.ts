// Adapts browser UI requests to the local workspace bridge for readAttachmentBytes.
// Called by stores and tools; depends on BridgeClient envelopes, workspace path contracts, and abortable requests.
// Invariant: bridge failures are surfaced as typed errors or user-readable strings.
import type { FsReadResp } from '../../core/workspace';
import { BridgeOfflineError, type BridgeClient } from './client';

/**
 * Narrow dependencies for {@link readAttachmentBase64} — just the bridge
 * connection state and the request method. Defined here rather than
 * importing `BridgeStore` so the service stays free of store imports
 * (the service / store boundary is one-way).
 */
export interface AttachmentBytesReadDeps {
  isOnline: boolean;
  client: Pick<BridgeClient, 'request'>;
}

/**
 * Fetch the raw bytes of a workspace file as a base64 string. Used by
 * provider adapters at send time to inline image attachments into
 * multimodal content parts.
 *
 * Returns `null` when the bridge is offline or the request fails — callers
 * (provider adapters) should degrade gracefully to text-only rather than
 * throwing the whole turn away. The bridge itself is the path-jail; we do
 * not re-validate here.
 */
export async function readAttachmentBase64(
  bridge: AttachmentBytesReadDeps,
  workspacePath: string,
): Promise<{ base64: string; mime: string; size: number } | null> {
  if (!bridge.isOnline) return null;
  try {
    const resp = await bridge.client.request<FsReadResp>('fs.read', {
      path: workspacePath,
      encoding: 'base64',
    });
    if (resp.encoding !== 'base64') return null;
    return { base64: resp.content, mime: resp.mime, size: resp.size };
  } catch (err) {
    if (!(err instanceof BridgeOfflineError)) {
      console.warn('[readAttachmentBase64] failed', workspacePath, err);
    }
    return null;
  }
}
