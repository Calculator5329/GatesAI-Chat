import type { FsReadResp } from '../../core/workspace';
import type { BridgeStore } from '../../stores/BridgeStore';
import { BridgeOfflineError } from './client';

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
  bridge: BridgeStore,
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
