// Read-only workspace media viewer for the dock: images via the shared
// workspace-image machinery (useImageDataUrl LRU + bridge round-trip),
// video/audio via native elements fed a data URL from the bridge facade.
import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { classifyDockFile } from '../../core/dock';
import { useBridgeStore } from '../../stores/context';
import { useImageDataUrl } from '../media/useImageDataUrl';
import type { DockPanelProps } from './panelRegistry';

export const MediaViewerPanel = observer(function MediaViewerPanel({ params }: DockPanelProps) {
  const path = params.path ?? '';
  if (!path) {
    return <div className="dock-panel__notice" data-testid="dock-media-viewer-notice">No media selected.</div>;
  }
  const kind = classifyDockFile(path);
  if (kind === 'video' || kind === 'audio') {
    return <AvViewer path={path} kind={kind} />;
  }
  return <ImageViewer path={path} />;
});

const ImageViewer = observer(function ImageViewer({ path }: { path: string }) {
  const { src, failed } = useImageDataUrl(path);
  if (failed) {
    return <div className="dock-panel__notice" data-testid="dock-media-viewer-notice">Could not load {path}.</div>;
  }
  if (!src) {
    return <div className="dock-panel__notice" data-testid="dock-media-viewer-notice">Loading media...</div>;
  }
  return (
    <div className="dock-media-viewer" data-testid="dock-media-viewer-image">
      <img src={src} alt={path} />
    </div>
  );
});

const AvViewer = observer(function AvViewer({ path, kind }: { path: string; kind: 'video' | 'audio' }) {
  const bridge = useBridgeStore();
  const bridgeOnline = bridge.isOnline;
  const [state, setState] = useState<{ src: string | null; failed: boolean }>({ src: null, failed: false });

  useEffect(() => {
    if (!bridgeOnline) {
      setState({ src: null, failed: false });
      return;
    }
    let cancelled = false;
    setState({ src: null, failed: false });
    void bridge.readAttachmentBase64(path).then(result => {
      if (cancelled) return;
      setState(result
        ? { src: `data:${result.mime};base64,${result.base64}`, failed: false }
        : { src: null, failed: true });
    });
    return () => { cancelled = true; };
  }, [bridge, bridgeOnline, path]);

  if (state.failed) {
    return <div className="dock-panel__notice" data-testid="dock-media-viewer-notice">Could not load {path}.</div>;
  }
  if (!state.src) {
    return <div className="dock-panel__notice" data-testid="dock-media-viewer-notice">Loading media...</div>;
  }
  return (
    <div className="dock-media-viewer" data-testid={`dock-media-viewer-${kind}`}>
      {kind === 'video'
        ? <video src={state.src} controls />
        : <audio src={state.src} controls />}
    </div>
  );
});
