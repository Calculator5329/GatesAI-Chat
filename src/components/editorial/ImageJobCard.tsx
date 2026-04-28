import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useBridgeStore, useImageJobStore } from '../../stores/context';
import type { BridgeStore } from '../../stores/BridgeStore';
import type { CompletedJob, ImageJob } from '../../services/image/jobs/types';
import { Lightbox } from './Lightbox';

interface ImageJobCardProps {
  jobId: string;
  expectedCount: number;
}

export type CardVariant = 'missing' | 'running' | 'failed' | 'cancelled' | 'done-empty' | 'done-single' | 'done-grid';

export function pickCardVariant(job: ImageJob | CompletedJob | null): CardVariant {
  if (!job) return 'missing';
  if (job.status === 'pending' || job.status === 'running') return 'running';
  if (job.status === 'failed') return 'failed';
  if (job.status === 'cancelled') return 'cancelled';
  if (job.results.length === 0) return 'done-empty';
  if (job.results.length === 1) return 'done-single';
  return 'done-grid';
}

/**
 * Embeds an image-generation job into a chat message. Observes the job
 * state from {@link ImageJobStore} and dispatches its rendering to a
 * status-specific sub-card. Done jobs render their results in a single
 * preview (count=1) or a uniform grid (count>1); a click on any tile
 * opens the {@link Lightbox}.
 */
export const ImageJobCard = observer(function ImageJobCard({ jobId, expectedCount }: ImageJobCardProps) {
  const jobs = useImageJobStore();
  const job = jobs.findById(jobId);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);

  if (!job) {
    return <PlaceholderRect label={`Lost track of job (${expectedCount} expected)`} />;
  }

  if (job.status === 'pending' || job.status === 'running') {
    return <RunningCard job={job as ImageJob} onCancel={() => jobs.cancel(jobId)} />;
  }

  if (job.status === 'failed') {
    return <FailedCard job={job as CompletedJob} onRetry={() => jobs.retry(jobId)} />;
  }

  if (job.status === 'cancelled') {
    return <CancelledCard job={job as CompletedJob} onRetry={() => jobs.retry(jobId)} />;
  }

  // status === 'done'
  const results = job.results;
  if (results.length === 0) {
    return <PlaceholderRect label="No images produced" />;
  }
  return (
    <>
      {results.length === 1
        ? <BigImage path={results[0]} alt="Generated image" onOpen={() => setLightboxIdx(0)} />
        : <ImageGrid paths={results} onOpen={(i) => setLightboxIdx(i)} />}
      {lightboxIdx !== null && (
        <Lightbox
          images={results.map(p => ({ path: p, alt: 'Generated image' }))}
          startIndex={lightboxIdx}
          prompt={job.prompt}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </>
  );
});

const PlaceholderRect = observer(function PlaceholderRect({ label }: { label: string }) {
  return (
    <div style={{ ...rectBase, color: 'var(--text-faint)', fontSize: 12 }}>
      {label}
    </div>
  );
});

const RunningCard = observer(function RunningCard({ job, onCancel }: { job: ImageJob; onCancel: () => void }) {
  const value = job.progress?.value ?? 0;
  const max = job.progress?.max ?? 100;
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  const backendLabel = job.backend === 'local-comfy' ? 'ComfyUI' : 'AUTOMATIC1111';
  return (
    <div style={{ ...rectBase, position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 12 }}>
        <span>generating · {pct}% · {backendLabel}</span>
        {job.count > 1 && <span style={{ marginTop: 4 }}>{job.results.length} / {job.count} done</span>}
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 3, background: 'var(--border)' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: 'var(--accent)', transition: 'width 0.2s ease' }} />
      </div>
      <button
        type="button"
        onClick={onCancel}
        title="Cancel render"
        aria-label="Cancel render"
        style={cancelBtn}
      >×</button>
    </div>
  );
});

const FailedCard = observer(function FailedCard({ job, onRetry }: { job: CompletedJob; onRetry: () => void }) {
  return (
    <div style={{ ...rectBase, padding: 12, color: 'var(--text-dim)', fontSize: 12, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
      <div style={{ color: 'var(--text)' }}>Image render failed</div>
      <div style={{ fontSize: 11.5, opacity: 0.85 }}>{job.error ?? 'Unknown error'}</div>
      <div><button type="button" onClick={onRetry} style={inlineBtn}>↻ Retry</button></div>
    </div>
  );
});

const CancelledCard = observer(function CancelledCard({ job, onRetry }: { job: CompletedJob; onRetry: () => void }) {
  return (
    <div style={{ ...rectBase, padding: 12, color: 'var(--text-faint)', fontSize: 12, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
      <div>Render cancelled</div>
      {job.results.length > 0 && <div style={{ fontSize: 11.5 }}>({job.results.length} of {job.count} completed before cancel)</div>}
      <div><button type="button" onClick={onRetry} style={inlineBtn}>↻ Retry</button></div>
    </div>
  );
});

const BigImage = observer(function BigImage({ path, alt, onOpen }: { path: string; alt: string; onOpen: () => void }) {
  const bridge = useBridgeStore();
  const [dataUrl, setDataUrl] = useState<string | null>(() => imageCache.get(path) ?? null);
  useEffect(() => {
    if (dataUrl) return;
    let cancelled = false;
    void loadImage(bridge, path).then(url => { if (!cancelled && url) setDataUrl(url); });
    return () => { cancelled = true; };
  }, [bridge, path, dataUrl]);
  return (
    <button
      type="button"
      onClick={onOpen}
      style={{
        display: 'block',
        padding: 0,
        border: '1px solid var(--border)',
        borderRadius: 6,
        overflow: 'hidden',
        background: 'transparent',
        cursor: 'pointer',
        maxWidth: 600,
      }}
      title="Click to open"
      aria-label={alt}
    >
      {dataUrl
        ? <img src={dataUrl} alt={alt} style={{ display: 'block', width: '100%', height: 'auto' }} />
        : <div style={{ width: 320, height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)' }}>…</div>}
    </button>
  );
});

const ImageGrid = observer(function ImageGrid({ paths, onOpen }: { paths: string[]; onOpen: (idx: number) => void }) {
  const cols = paths.length <= 4 ? 2 : 3;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 4, maxWidth: 600 }}>
      {paths.map((p, i) => <GridTile key={`${p}-${i}`} path={p} onClick={() => onOpen(i)} />)}
    </div>
  );
});

const GridTile = observer(function GridTile({ path, onClick }: { path: string; onClick: () => void }) {
  const bridge = useBridgeStore();
  const [dataUrl, setDataUrl] = useState<string | null>(() => imageCache.get(path) ?? null);
  useEffect(() => {
    if (dataUrl) return;
    let cancelled = false;
    void loadImage(bridge, path).then(url => { if (!cancelled && url) setDataUrl(url); });
    return () => { cancelled = true; };
  }, [bridge, path, dataUrl]);
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ padding: 0, border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden', cursor: 'pointer', background: 'transparent', aspectRatio: '1 / 1' }}
      title="Click to open"
      aria-label="Open image"
    >
      {dataUrl
        ? <img src={dataUrl} alt="Generated image" style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
        : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)' }}>…</div>}
    </button>
  );
});

const rectBase: React.CSSProperties = {
  width: 320,
  height: 240,
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--surface-soft, rgba(0,0,0,0.04))',
};

const cancelBtn: React.CSSProperties = {
  position: 'absolute',
  top: 6,
  right: 6,
  width: 22,
  height: 22,
  borderRadius: 11,
  border: '1px solid var(--border)',
  background: 'var(--surface, #fff)',
  cursor: 'pointer',
  fontSize: 14,
  lineHeight: 1,
  color: 'var(--text-dim)',
};

const inlineBtn: React.CSSProperties = {
  padding: '3px 10px',
  fontSize: 12,
  background: 'transparent',
  border: '1px solid var(--border)',
  borderRadius: 4,
  cursor: 'pointer',
  color: 'var(--text-dim)',
};

/**
 * LRU image cache cap. Each entry holds a base64 data URL — typically
 * 2–7 MB for an SDXL/FLUX render. With the previous unbounded Map, a
 * single long session would balloon WebView memory past the per-process
 * limit (~1–2 GB on Chromium) and crash the renderer with no visible
 * warning. 32 × 7 MB ≈ 220 MB cap is a safe ceiling for a session that
 * stays scrollable in the chat surface.
 */
const IMAGE_CACHE_LIMIT = 32;

/**
 * Map preserves insertion order, so we use it as an LRU: every cache
 * read deletes-then-re-sets the entry to bump it to most-recent; every
 * miss-eviction drops the oldest key once we exceed the cap.
 */
const imageCache = new Map<string, string>();

function cacheGet(path: string): string | undefined {
  const url = imageCache.get(path);
  if (url === undefined) return undefined;
  // Refresh recency: re-insert at the end.
  imageCache.delete(path);
  imageCache.set(path, url);
  return url;
}

function cacheSet(path: string, url: string): void {
  if (imageCache.has(path)) imageCache.delete(path);
  imageCache.set(path, url);
  while (imageCache.size > IMAGE_CACHE_LIMIT) {
    const oldest = imageCache.keys().next().value;
    if (oldest === undefined) break;
    imageCache.delete(oldest);
  }
}

async function loadImage(bridge: BridgeStore, path: string): Promise<string | null> {
  // Hosted URLs (e.g. ComfyUI's /view) load directly via <img src> — skip
  // the bridge round-trip and the data-URL cache entirely.
  if (/^https?:\/\//i.test(path)) return path;
  const cached = cacheGet(path);
  if (cached) return cached;
  const result = await bridge.readAttachmentBase64(path);
  if (!result) return null;
  const url = `data:${result.mime};base64,${result.base64}`;
  cacheSet(path, url);
  return url;
}

/** Test/diagnostic hooks — exported for unit tests; not part of the public API. */
export const __imageCacheTestApi = {
  reset: () => imageCache.clear(),
  size: () => imageCache.size,
  has: (path: string) => imageCache.has(path),
  set: (path: string, url: string) => cacheSet(path, url),
  get: (path: string) => cacheGet(path),
  limit: IMAGE_CACHE_LIMIT,
};
