// Renders an image-generation job in the chat: live progress, the result
// gallery, and per-image actions (open, save, delete).
// Failed/cancelled multi-image jobs may still show partial `results[]` saved before
// abort; missing workspace files surface via `useImageDataUrl` failed state (Batch D).
import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useImageJobStore } from '../../stores/context';
import type { CompletedJob, ImageJob } from '../../stores/ImageJobStore';
import { Lightbox } from '../media/Lightbox';
import { useImageDataUrl } from '../media/useImageDataUrl';

interface ImageJobCardProps {
  jobId: string;
  expectedCount: number;
}

export type ImageJobCardVariant = 'missing' | 'running' | 'failed' | 'cancelled' | 'done-empty' | 'done-single' | 'done-grid';

export function pickImageJobCardVariant(job: ImageJob | CompletedJob | null): ImageJobCardVariant {
  if (!job) return 'missing';
  if (job.status === 'pending' || job.status === 'running') return 'running';
  if (job.status === 'failed') return 'failed';
  if (job.status === 'cancelled') return 'cancelled';
  if (job.results.length === 0) return 'done-empty';
  if (job.results.length === 1) return 'done-single';
  return 'done-grid';
}

export function imageFailureAdvice(job: CompletedJob): string {
  const error = (job.error ?? '').toLowerCase();
  if (!error.trim()) return 'No error details were reported by the image backend.';
  if (error.includes('api key') || error.includes('401') || error.includes('403') || error.includes('unauthorized')) {
    return job.backend === 'openrouter-image'
      ? 'Check the OpenRouter API key in Models, then retry.'
      : 'Check the local backend credentials or proxy settings, then retry.';
  }
  if (error.includes('rate limit') || error.includes('429')) {
    return 'The provider is rate limiting requests. Wait a little, then retry.';
  }
  if (error.includes('timed out') || error.includes('timeout') || error.includes('abort')) {
    return 'The render timed out before the backend returned an image. Retry with a simpler prompt or smaller batch.';
  }
  if (error.includes('no generated image') || error.includes('no image')) {
    return 'The provider answered, but did not include image data. Retry, or switch image backend.';
  }
  if (error.includes('base url') || error.includes('fetch') || error.includes('network') || error.includes('failed to fetch')) {
    return job.backend === 'local-comfy'
      ? 'Check that ComfyUI is online and reachable from Local settings.'
      : 'Check network/provider availability, then retry.';
  }
  return 'The backend rejected or failed the render. Review the error, then retry or switch backend.';
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
  const backendLabel = job.backend === 'local-comfy' ? 'ComfyUI' : 'OpenRouter';
  const elapsedSeconds = job.startedAt ? Math.max(0, Math.floor((Date.now() - job.startedAt) / 1000)) : 0;
  const remote = job.backend === 'openrouter-image';
  return (
    <div style={{ ...rectBase, position: 'relative' }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', fontSize: 12 }}>
        <span>{remote ? 'waiting on' : 'generating'} · {pct}% · {backendLabel}</span>
        {remote && <span style={{ marginTop: 4 }}>remote render · {elapsedSeconds}s elapsed</span>}
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
  const [copied, setCopied] = useState(false);
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const advice = imageFailureAdvice(job);
  const copyError = async () => {
    try {
      await navigator.clipboard.writeText(job.error ?? 'Unknown image render error');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard may be unavailable; the visible error remains selectable.
    }
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 600 }}>
      {job.results.length > 0 && (
        <>
          {job.results.length === 1
            ? <BigImage path={job.results[0]} alt="Partial render" onOpen={() => setLightboxIdx(0)} />
            : <ImageGrid paths={job.results} onOpen={(i) => setLightboxIdx(i)} />}
          {lightboxIdx !== null && (
            <Lightbox
              images={job.results.map(p => ({ path: p, alt: 'Partial render' }))}
              startIndex={lightboxIdx}
              prompt={job.prompt}
              onClose={() => setLightboxIdx(null)}
            />
          )}
        </>
      )}
      <div style={{ ...rectBase, padding: 12, color: 'var(--text-dim)', fontSize: 12, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 7 }}>
        <div style={{ color: 'var(--text)' }}>Image render failed</div>
        <div style={{ fontSize: 11.5, opacity: 0.9 }}>{advice}</div>
        <div title={job.error ?? 'Unknown error'} style={{ fontSize: 11, opacity: 0.75, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {job.error ?? 'Unknown error'}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={onRetry} style={inlineBtn}>Retry</button>
          <button type="button" onClick={copyError} style={inlineBtn}>{copied ? 'Copied' : 'Copy error'}</button>
        </div>
      </div>
    </div>
  );
});

const CancelledCard = observer(function CancelledCard({ job, onRetry }: { job: CompletedJob; onRetry: () => void }) {
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 600 }}>
      {job.results.length > 0 && (
        <>
          {job.results.length === 1
            ? <BigImage path={job.results[0]} alt="Partial render" onOpen={() => setLightboxIdx(0)} />
            : <ImageGrid paths={job.results} onOpen={(i) => setLightboxIdx(i)} />}
          {lightboxIdx !== null && (
            <Lightbox
              images={job.results.map(p => ({ path: p, alt: 'Partial render' }))}
              startIndex={lightboxIdx}
              prompt={job.prompt}
              onClose={() => setLightboxIdx(null)}
            />
          )}
        </>
      )}
      <div style={{ ...rectBase, padding: 12, color: 'var(--text-faint)', fontSize: 12, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 6 }}>
        <div>Render cancelled</div>
        {job.results.length > 0 && <div style={{ fontSize: 11.5 }}>({job.results.length} of {job.count} completed before cancel)</div>}
        <div><button type="button" onClick={onRetry} style={inlineBtn}>Retry</button></div>
      </div>
    </div>
  );
});

const BigImage = observer(function BigImage({ path, alt, onOpen }: { path: string; alt: string; onOpen: () => void }) {
  const { src: dataUrl, failed } = useImageDataUrl(path);
  return (
    <button
      type="button"
      onClick={onOpen}
      disabled={failed}
      style={{
        display: 'block',
        padding: 0,
        border: '1px solid var(--border)',
        borderRadius: 6,
        overflow: 'hidden',
        background: 'transparent',
        cursor: failed ? 'default' : 'pointer',
        maxWidth: 600,
      }}
      title={failed ? 'Image file missing' : 'Click to open'}
      aria-label={alt}
    >
      {failed
        ? <div style={{ width: 320, height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 12 }}>Image file missing</div>
        : dataUrl
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
  const { src: dataUrl, failed } = useImageDataUrl(path);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={failed}
      style={{ padding: 0, border: '1px solid var(--border)', borderRadius: 4, overflow: 'hidden', cursor: failed ? 'default' : 'pointer', background: 'transparent', aspectRatio: '1 / 1' }}
      title={failed ? 'Image file missing' : 'Click to open'}
      aria-label="Open image"
    >
      {failed
        ? <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-faint)', fontSize: 10, padding: 4, textAlign: 'center' }}>Missing</div>
        : dataUrl
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

