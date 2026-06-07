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

  return (
    <>
      <WebLiteNotice show={webLite}>
        <strong style={{ color: 'var(--text)' }}>Web Lite:</strong>{' '}
        image artifacts need the desktop bridge today. Cloud image persistence can be added in the Firebase backend phase.
      </WebLiteNotice>
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
                onDelete={() => jobs.delete(job.id)}
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
    <div style={{
      padding: '44px 28px', textAlign: 'center',
      color: 'var(--text-faint)', fontSize: 13,
      border: '1px dashed var(--border)', borderRadius: 8,
    }}>
      <div style={{ fontFamily: '"Source Serif 4", Georgia, serif', fontSize: 18, color: 'var(--text-dim)', marginBottom: 8 }}>
        No images yet
      </div>
      <div style={{ lineHeight: 1.55, maxWidth: 420, margin: '0 auto' }}>
        Ask the assistant to generate an image, or use <strong style={{ color: 'var(--text-dim)' }}>image_generate</strong>{' '}
        with the configured backend. Finished images are kept here and saved under{' '}
        <code style={tokens.mono}>/workspace/artifacts/images</code>.
      </div>
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
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const loadedRef = useRef(false);

  useEffect(() => {
    setDataUrl(null);
    loadedRef.current = false;
  }, [path]);

  useEffect(() => {
    let cancelled = false;
    if (dataUrl) { loadedRef.current = true; return; }
    const el = ref.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadedRef.current) {
          loadedRef.current = true;
          observer.disconnect();
          void loadImageSource(bridge, path).then(url => {
            if (!cancelled && url) setDataUrl(url);
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
  }, [bridge, path, dataUrl]);

  return (
    <div ref={ref} style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
      <button
        type="button"
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
          : <div style={{ width: '100%', height: '100%', background: 'var(--surface-raised)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 18 }}>⋯</div>}
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
