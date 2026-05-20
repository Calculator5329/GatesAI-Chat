// Renders the editorial chat Lightbox surface and its local interaction state.
// Called by EditorialChat, EditorialMessage, or the sidebar shell; depends on RootStore hooks, core message types, and UI primitives.
// Invariant: persisted chat state stays in stores while components derive view state from props/hooks.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { observer } from 'mobx-react-lite';
import { useBridgeStore } from '../../stores/context';
import { useImageDataUrl } from './useImageDataUrl';

interface LightboxImage { path: string; alt: string }

interface LightboxProps {
  images: LightboxImage[];
  startIndex: number;
  prompt?: string;
  onClose: () => void;
}

export const Lightbox = observer(function Lightbox({ images, startIndex, prompt, onClose }: LightboxProps) {
  const bridge = useBridgeStore();
  const [index, setIndex] = useState(startIndex);
  const current = images[index];
  const { src: dataUrl } = useImageDataUrl(current?.path ?? '');
  const [copied, setCopied] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(t);
  }, []);

  useEffect(() => {
    function onKey(ev: KeyboardEvent) {
      if (ev.key === 'Escape') { ev.preventDefault(); onClose(); return; }
      if (ev.key === 'ArrowRight') { ev.preventDefault(); setIndex(i => Math.min(images.length - 1, i + 1)); }
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); setIndex(i => Math.max(0, i - 1)); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [images.length, onClose]);

  if (!current) return null;

  const copyPrompt = async () => {
    if (!prompt) return;
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard may be unavailable in older WebViews.
    }
  };

  const overlay = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Image viewer"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: `rgba(0,0,0,${visible ? 0.88 : 0})`,
        backdropFilter: visible ? 'blur(6px)' : 'none',
        WebkitBackdropFilter: visible ? 'blur(6px)' : 'none',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        transition: 'background 0.18s ease, backdrop-filter 0.18s ease',
      }}
    >
      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        title="Close"
        aria-label="Close"
        style={{
          position: 'fixed',
          top: 16,
          right: 20,
          width: 36,
          height: 36,
          borderRadius: 18,
          border: '1px solid rgba(255,255,255,0.2)',
          background: 'rgba(0,0,0,0.5)',
          color: 'rgba(255,255,255,0.85)',
          fontSize: 20,
          lineHeight: 1,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1001,
        }}
      >×</button>

      {/* Prev/Next arrows */}
      {images.length > 1 && index > 0 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setIndex(i => Math.max(0, i - 1)); }}
          aria-label="Previous image"
          style={navArrow('left')}
        >‹</button>
      )}
      {images.length > 1 && index < images.length - 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setIndex(i => Math.min(images.length - 1, i + 1)); }}
          aria-label="Next image"
          style={navArrow('right')}
        >›</button>
      )}

      {/* Main content */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
          maxWidth: '90vw',
          maxHeight: '95vh',
          opacity: visible ? 1 : 0,
          transform: visible ? 'scale(1)' : 'scale(0.97)',
          transition: 'opacity 0.18s ease, transform 0.18s ease',
        }}
      >
        {/* Image */}
        <div style={{
          position: 'relative',
          borderRadius: 8,
          overflow: 'hidden',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
          background: 'rgba(255,255,255,0.04)',
          minWidth: 200,
          minHeight: 100,
        }}>
          {dataUrl
            ? <img
                src={dataUrl}
                alt={current.alt}
                style={{ display: 'block', maxWidth: '88vw', maxHeight: '68vh', objectFit: 'contain' }}
              />
            : <div style={{ width: 320, height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
                Loading…
              </div>}

          {images.length > 1 && (
            <div style={{
              position: 'absolute',
              bottom: 10,
              left: '50%',
              transform: 'translateX(-50%)',
              background: 'rgba(0,0,0,0.55)',
              backdropFilter: 'blur(4px)',
              borderRadius: 12,
              padding: '3px 10px',
              color: 'rgba(255,255,255,0.8)',
              fontSize: 12,
              pointerEvents: 'none',
            }}>
              {index + 1} / {images.length}
            </div>
          )}
        </div>

        {/* Bottom panel */}
        <div style={promptPanel}>
          {prompt && (
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>Prompt</div>
                <textarea
                  aria-label="Full prompt"
                  readOnly
                  value={prompt}
                  style={promptText}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingTop: 20, flexShrink: 0 }}>
                <button type="button" onClick={copyPrompt} style={actionBtn}>
                  {copied ? '✓ Copied' : 'Copy prompt'}
                </button>
                <button type="button" onClick={() => { void bridge.openWorkspacePath(current.path); }} style={actionBtn}>
                  Open in OS
                </button>
              </div>
            </div>
          )}
          {!prompt && (
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => { void bridge.openWorkspacePath(current.path); }} style={actionBtn}>
                Open in OS
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
});

function navArrow(side: 'left' | 'right'): React.CSSProperties {
  return {
    position: 'fixed',
    top: '50%',
    [side]: 16,
    transform: 'translateY(-50%)',
    width: 44,
    height: 72,
    borderRadius: 8,
    border: '1px solid rgba(255,255,255,0.15)',
    background: 'rgba(0,0,0,0.45)',
    backdropFilter: 'blur(4px)',
    color: 'rgba(255,255,255,0.85)',
    fontSize: 28,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1001,
    transition: 'background 0.12s',
  };
}

const actionBtn: React.CSSProperties = {
  background: 'rgba(255,255,255,0.08)',
  color: 'rgba(255,255,255,0.85)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 6,
  padding: '6px 14px',
  fontSize: 12,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const promptPanel: React.CSSProperties = {
  width: 'min(720px, 88vw)',
  maxHeight: '24vh',
  overflow: 'hidden',
  padding: '14px 16px',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 10,
  background: 'rgba(8,8,10,0.8)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
  boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
};

const promptText: React.CSSProperties = {
  width: '100%',
  height: 'min(90px, 15vh)',
  minHeight: 54,
  resize: 'none',
  overflow: 'auto',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 6,
  background: 'rgba(255,255,255,0.04)',
  color: 'rgba(255,255,255,0.85)',
  padding: '8px 10px',
  fontFamily: '"Geist Mono", ui-monospace, monospace',
  fontSize: 12,
  lineHeight: 1.5,
  boxSizing: 'border-box',
  wordBreak: 'break-word',
  outline: 'none',
};

