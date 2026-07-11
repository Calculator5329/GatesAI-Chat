// Renders the Gallery menu section and the controls for its store-backed workflow.
// Called by GatesMenu; depends on MobX stores, bridge services, and shared UI primitives.
// Invariant: menu components present state and delegate side effects to stores/services.
import { useEffect, useMemo, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../core/styleTokens';
import { useBridgeStore, useImageJobStore } from '../../../stores/context';
import type { CompletedJob } from '../../../stores/ImageJobStore';
import { Button } from '../../ui';
import { Lightbox } from '../../media/Lightbox';
import { loadImageSource } from '../../media/useImageDataUrl';
import { WebLiteNotice } from '../../ui/WebLiteNotice';
import { isWebLite } from '../../../core/runtime';

interface LightboxState {
  paths: string[];
  index: number;
  prompt: string;
}

export const GallerySection = observer(function GallerySection() {
  const jobs = useImageJobStore();
  const webLite = isWebLite();
  const completed = jobs.history.filter(j => j.status === 'done' && j.results.length > 0) as CompletedJob[];
  const imageCount = completed.reduce((sum, job) => sum + job.results.length, 0);
  const tiles = useMemo(
    () => completed.flatMap(job => job.results.map((path, index) => ({ job, path, index }))),
    [completed],
  );
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);

  if (webLite) {
    return (
      <>
        <WebLiteNotice show={webLite}>
          <strong style={{ color: 'var(--text)' }}>Web Lite:</strong>{' '}
          image generation and the artifact gallery are desktop-only today.
        </WebLiteNotice>
        <h1 style={{ ...tokens.h1, margin: 0 }}>Gallery</h1>
        <div style={{ ...tokens.kicker, marginTop: 4, marginBottom: 16 }}>generated images appear here on desktop</div>
        <div style={{
          padding: '44px 28px', textAlign: 'center',
          color: 'var(--text-faint)', fontSize: 13,
          border: '1px dashed var(--border)', borderRadius: 8,
        }}>
          <div style={{ fontFamily: '"Source Serif 4", Georgia, serif', fontSize: 18, color: 'var(--text-dim)', marginBottom: 8 }}>
            Desktop-only feature
          </div>
          <div style={{ lineHeight: 1.55, maxWidth: 440, margin: '0 auto' }}>
            The <strong style={{ color: 'var(--text-dim)' }}>image_generate</strong> tool runs against a local
            ComfyUI backend in the installed desktop app, and finished images are saved under{' '}
            <code style={tokens.mono}>/workspace/artifacts/images</code>. The hosted web app can't reach a local
            backend, so the gallery is empty here. Cloud image persistence can be added in a future backend phase.
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: completed.length > 0 ? 16 : 0 }}>
        <div>
          <h1 style={{ ...tokens.h1, margin: 0 }}>Gallery</h1>
          <div style={{ ...tokens.kicker, marginTop: 4 }}>
            {imageCount > 0
              ? `${imageCount} image${imageCount === 1 ? '' : 's'} from ${completed.length} job${completed.length === 1 ? '' : 's'} · click to open`
              : 'generated images appear here'}
          </div>
        </div>
        {completed.length > 0 && (
          <div style={{ flexShrink: 0 }}>
            <Button onClick={() => { if (window.confirm('Clear gallery history? Image files on disk (ComfyUI output / workspace artifacts) are not deleted.')) jobs.clearHistory(); }}>
              Clear history
            </Button>
          </div>
        )}
      </div>

      {completed.length === 0
        ? <EmptyState />
        : (
          <div className="gallery-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
            {tiles.map(({ job, path, index }) => (
              <GalleryTile
                key={`${job.id}-${index}`}
                path={path}
                prompt={job.prompt}
                onClick={() => setLightbox({ paths: job.results, index, prompt: job.prompt })}
                onDelete={() => jobs.removeImage(job.id, path)}
              />
            ))}
          </div>
        )}

      {lightbox && (
        <Lightbox
          images={lightbox.paths.map(p => ({ path: p, alt: 'gallery image' }))}
          startIndex={lightbox.index}
          prompt={lightbox.prompt}
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
});

function EmptyState() {
  return (
    <div className="editorial-empty-copy" style={{
      padding: '44px 28px', textAlign: 'center',
      border: '1px dashed var(--border)', borderRadius: 8,
    }}>
      Generated images will collect here after a prompt produces a result.
    </div>
  );
}

const GalleryTile = observer(function GalleryTile({ path, prompt, onClick, onDelete }: {
  path: string;
  prompt: string;
  onClick: () => void;
  onDelete: () => void;
}) {
  const bridge = useBridgeStore();
  const bridgeOnline = bridge.isOnline;
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    setDataUrl(null);
    setMissing(false);
    loadedRef.current = false;
  }, [path]);

  useEffect(() => {
    let cancelled = false;
    if (dataUrl) { loadedRef.current = true; return; }
    // Bridge startup is asynchronous. If Gallery mounts first, wait for the
    // online transition instead of permanently caching the initial offline
    // read as a missing artifact.
    if (!bridgeOnline) return;
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadedRef.current) {
          loadedRef.current = true;
          observer.disconnect();
          void loadImageSource(bridge, path).then(url => {
            if (cancelled) return;
            if (url) setDataUrl(url);
            else setMissing(true);
          });
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [bridge, bridgeOnline, path, dataUrl]);

  return (
    <div ref={ref} className="gallery-tile" style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
      <button
        type="button"
        className="gallery-tile__image"
        onClick={onClick}
        title={prompt}
        aria-label={prompt}
        style={{
          padding: 0, margin: 0, border: 'none', background: 'transparent',
          width: '100%', aspectRatio: '1 / 1', cursor: 'pointer', display: 'block',
        }}
      >
        {dataUrl
          ? <img src={dataUrl} alt={prompt} style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
          : <div style={{ width: '100%', height: '100%', background: 'var(--surface-raised)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: missing ? 11 : 18, textAlign: 'center', padding: 8 }}>{missing ? 'Image file missing' : '⋯'}</div>}
      </button>
      <div style={{
        position: 'absolute', left: 0, right: 0, bottom: 0,
        padding: '6px 8px',
        background: 'linear-gradient(to top, rgba(0,0,0,0.65), rgba(0,0,0,0))',
        color: '#fff', fontSize: 11,
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
      }}>{prompt}</div>
      <button
        type="button"
        className="gallery-tile__remove"
        onClick={(e) => { e.stopPropagation(); if (window.confirm('Remove from gallery?')) onDelete(); }}
        title="Remove from gallery"
        aria-label="Remove from gallery"
        style={{
          position: 'absolute', top: 4, right: 4,
          width: 20, height: 20, borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.3)',
          background: 'rgba(0,0,0,0.55)', color: '#fff',
          fontSize: 12, lineHeight: 1, cursor: 'pointer',
        }}
      >×</button>
    </div>
  );
});
