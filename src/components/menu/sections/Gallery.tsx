import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../core/styleTokens';
import { useBridgeStore, useImageJobStore } from '../../../stores/context';
import type { BridgeStore } from '../../../stores/BridgeStore';
import type { CompletedJob } from '../../../services/image/jobs/types';
import { Button } from '../../ui';
import { Lightbox } from '../../editorial/Lightbox';

interface LightboxState {
  paths: string[];
  index: number;
  prompt: string;
}

export const GallerySection = observer(function GallerySection() {
  const jobs = useImageJobStore();
  const completed = jobs.history.filter(j => j.status === 'done' && j.results.length > 0) as CompletedJob[];
  const [lightbox, setLightbox] = useState<LightboxState | null>(null);

  return (
    <>
      <h1 style={tokens.h1}>Gallery</h1>
      <div style={tokens.kicker}>every image you've generated · click to open</div>

      {completed.length === 0
        ? <EmptyState />
        : (
          <>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <Button onClick={() => { if (window.confirm('Clear gallery history? Image files on disk (ComfyUI output / workspace artifacts) are not deleted.')) jobs.clearHistory(); }}>
                Clear history
              </Button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
              {completed.flatMap(job => job.results.map((path, i) => (
                <GalleryTile
                  key={`${job.id}-${i}`}
                  path={path}
                  prompt={job.prompt}
                  onClick={() => setLightbox({ paths: job.results, index: i, prompt: job.prompt })}
                  onDelete={() => jobs.delete(job.id)}
                />
              )))}
            </div>
          </>
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
      padding: '48px 24px', textAlign: 'center',
      color: 'var(--text-faint)', fontSize: 13,
      border: '1px dashed var(--border)', borderRadius: 8,
    }}>
      No images generated yet. Ask the assistant to render something to fill this page.
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
  const [dataUrl, setDataUrl] = useState<string | null>(() => cache.get(path) ?? null);
  useEffect(() => {
    if (dataUrl) return;
    let cancelled = false;
    void loadImage(bridge, path).then(url => { if (!cancelled && url) setDataUrl(url); });
    return () => { cancelled = true; };
  }, [bridge, path, dataUrl]);

  return (
    <div style={{ position: 'relative', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
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
          : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)' }}>…</div>}
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

const cache = new Map<string, string>();

async function loadImage(bridge: BridgeStore, path: string): Promise<string | null> {
  if (/^https?:\/\//i.test(path)) return loadHostedImage(path);
  const cached = cache.get(path);
  if (cached) return cached;
  const result = await bridge.readAttachmentBase64(path);
  if (!result) return null;
  const url = `data:${result.mime};base64,${result.base64}`;
  cache.set(path, url);
  return url;
}

async function loadHostedImage(url: string): Promise<string | null> {
  const cached = cache.get(url);
  if (cached) return cached;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const mime = resp.headers.get('content-type')?.split(';')[0] || 'image/png';
    const dataUrl = `data:${mime};base64,${bytesToBase64(new Uint8Array(await resp.arrayBuffer()))}`;
    cache.set(url, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
