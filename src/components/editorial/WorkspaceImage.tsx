import { observer } from 'mobx-react-lite';
import { useEditorial } from '../../stores/context';
import { useImageDataUrl } from '../media/useImageDataUrl';

/**
 * Renders a workspace-attached image as a data URL thumbnail. Bytes are
 * fetched once via the bridge facade and cached in a shared LRU. Falls
 * back to a tiny label when the bridge is offline or the read fails.
 *
 * Clicking the thumbnail asks the bridge to open the underlying file
 * with the OS default handler — the same workspace-link affordance the
 * markdown renderer exposes for arbitrary paths.
 */
export const WorkspaceImage = observer(function WorkspaceImage({
  path,
  alt,
  kind,
  cacheKey,
}: {
  path: string;
  alt: string;
  kind: string;
  cacheKey?: string;
}) {
  const { bridge } = useEditorial();
  const { src, failed } = useImageDataUrl(path, cacheKey);

  return (
    <button
      type="button"
      className="user-attachment-thumb"
      title={`${alt} — click to open`}
      aria-label={`Open ${alt}`}
      onClick={() => { void bridge.openWorkspacePath(path); }}
    >
      {src
        ? <img src={src} alt={alt} />
        : <span className="user-attachment-thumb-fallback">{failed ? kind : '…'}</span>}
    </button>
  );
});
