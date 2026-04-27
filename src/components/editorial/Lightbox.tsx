import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useBridgeStore } from '../../stores/context';
import type { BridgeStore } from '../../stores/BridgeStore';

interface LightboxImage { path: string; alt: string }

interface LightboxProps {
  images: LightboxImage[];
  startIndex: number;
  prompt?: string;
  onClose: () => void;
}

/**
 * Modal image viewer used by ImageJobCard tiles and the Gallery menu.
 * Loads each image lazily on display, supports ESC + arrow-key
 * navigation, and exposes an "Open in OS" affordance that hands the
 * path to the bridge.
 */
export const Lightbox = observer(function Lightbox({ images, startIndex, prompt, onClose }: LightboxProps) {
  const bridge = useBridgeStore();
  const [index, setIndex] = useState(startIndex);
  const current = images[index];
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setDataUrl(null);
    void loadImage(bridge, current.path).then(url => {
      if (!cancelled) setDataUrl(url);
    });
    return () => { cancelled = true; };
  }, [bridge, current]);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') { ev.preventDefault(); onClose(); return; }
      if (ev.key === 'ArrowRight' && index < images.length - 1) { ev.preventDefault(); setIndex(i => Math.min(images.length - 1, i + 1)); }
      if (ev.key === 'ArrowLeft' && index > 0) { ev.preventDefault(); setIndex(i => Math.max(0, i - 1)); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, images.length, onClose]);

  if (!current) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.92)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, maxWidth: '92vw', maxHeight: '92vh' }}>
        {dataUrl
          ? <img src={dataUrl} alt={current.alt} style={{ maxWidth: '92vw', maxHeight: '78vh', objectFit: 'contain', borderRadius: 4 }} />
          : <div style={{ color: 'rgba(255,255,255,0.6)', padding: 40 }}>Loading…</div>}

        {images.length > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 18, color: 'rgba(255,255,255,0.85)', fontSize: 13 }}>
            <button
              type="button"
              onClick={() => setIndex(i => Math.max(0, i - 1))}
              disabled={index === 0}
              style={lbBtn}
            >‹</button>
            <span>{index + 1} / {images.length}</span>
            <button
              type="button"
              onClick={() => setIndex(i => Math.min(images.length - 1, i + 1))}
              disabled={index === images.length - 1}
              style={lbBtn}
            >›</button>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'rgba(255,255,255,0.7)', fontSize: 12, maxWidth: '80vw' }}>
          {prompt && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={prompt}>{prompt}</span>}
          <button
            type="button"
            onClick={() => { void bridge.openWorkspacePath(current.path); }}
            style={lbBtn}
          >Open in OS</button>
          <button type="button" onClick={onClose} style={lbBtn}>Close</button>
        </div>
      </div>
    </div>
  );
});

const lbBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.08)',
  color: 'rgba(255,255,255,0.9)',
  border: '1px solid rgba(255,255,255,0.18)',
  borderRadius: 4,
  padding: '4px 12px',
  fontSize: 13,
  cursor: 'pointer',
};

const cache = new Map<string, string>();

async function loadImage(bridge: BridgeStore, path: string): Promise<string | null> {
  const cached = cache.get(path);
  if (cached) return cached;
  const result = await bridge.readAttachmentBase64(path);
  if (!result) return null;
  const url = `data:${result.mime};base64,${result.base64}`;
  cache.set(path, url);
  return url;
}
