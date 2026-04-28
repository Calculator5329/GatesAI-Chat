import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useBridgeStore } from '../../stores/context';
import type { BridgeStore } from '../../stores/BridgeStore';

/**
 * Renders a workspace-attached image as a data URL thumbnail. Fetches
 * bytes once on mount via the bridge facade and caches them in a
 * module-local map so re-mounts (scroll recycle, thread switch) don't
 * re-read from disk. Falls back to a tiny label when the bridge is
 * offline or the read fails.
 *
 * Clicking the thumbnail asks the bridge to open the underlying file
 * with the OS default handler — the same workspace-link affordance the
 * markdown renderer exposes for arbitrary paths.
 */
export const WorkspaceImage = observer(function WorkspaceImage({
  path,
  alt,
  kind,
}: {
  path: string;
  alt: string;
  kind: string;
}) {
  const bridge = useBridgeStore();
  const [dataUrl, setDataUrl] = useState<string | null>(() => imageCache.get(path) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (dataUrl || failed) return;
    let cancelled = false;
    void loadImage(bridge, path).then(url => {
      if (cancelled) return;
      if (url) setDataUrl(url);
      else setFailed(true);
    });
    return () => {
      cancelled = true;
    };
  }, [bridge, path, dataUrl, failed]);

  return (
    <button
      type="button"
      className="user-attachment-thumb"
      title={`${alt} — click to open`}
      aria-label={`Open ${alt}`}
      onClick={() => { void bridge.openWorkspacePath(path); }}
    >
      {dataUrl
        ? <img src={dataUrl} alt={alt} />
        : <span className="user-attachment-thumb-fallback">{failed ? kind : '…'}</span>}
    </button>
  );
});

const imageCache = new Map<string, string>();

async function loadImage(bridge: BridgeStore, path: string): Promise<string | null> {
  if (/^https?:\/\//i.test(path)) return path;
  const cached = imageCache.get(path);
  if (cached) return cached;
  const result = await bridge.readAttachmentBase64(path);
  if (!result) return null;
  const url = `data:${result.mime};base64,${result.base64}`;
  imageCache.set(path, url);
  return url;
}
