// Aurora pack: the parameters a finished image render actually used, and a
// way to run it again with them adjusted.
// Rendered by ImageJobCard for a completed job; enqueues through ImageJobStore.
// Invariant: every field is seeded from the job's real input. Nothing here is
// inferred or defaulted on the model's behalf, and re-running always creates a
// new job rather than rewriting the one on screen.
import { useState } from 'react';
import type { CompletedJob, ImageJob, ImageJobInput } from '../../../stores/ImageJobStore';

/** Bounds mirror what the image tool accepts; a rejected job helps nobody. */
const MIN_SIZE = 128;
const MAX_SIZE = 2048;
const MAX_COUNT = 8;

export function FineTuneCard({
  job,
  onRerun,
}: {
  job: ImageJob | CompletedJob;
  onRerun: (input: ImageJobInput) => void;
}) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(String(job.count));
  const [width, setWidth] = useState(String(job.width));
  const [height, setHeight] = useState(String(job.height));
  const [seed, setSeed] = useState(job.seed === undefined ? '' : String(job.seed));

  function rerun(): void {
    const parsedSeed = seed.trim() === '' ? undefined : clampInt(seed, 0, Number.MAX_SAFE_INTEGER, 0);
    onRerun({
      threadId: job.threadId,
      prompt: job.prompt,
      count: clampInt(count, 1, MAX_COUNT, job.count),
      width: clampInt(width, MIN_SIZE, MAX_SIZE, job.width),
      height: clampInt(height, MIN_SIZE, MAX_SIZE, job.height),
      ...(parsedSeed === undefined ? {} : { seed: parsedSeed }),
      backend: job.backend,
      ...(job.comfyMode ? { comfyMode: job.comfyMode } : {}),
      ...(job.filenamePrefix ? { filenamePrefix: job.filenamePrefix } : {}),
    });
  }

  return (
    <div className="finetune-card" data-testid="finetune-card">
      <div className="finetune-card__head">
        <span className="finetune-card__title">
          {job.width}×{job.height} · {job.count} image{job.count === 1 ? '' : 's'} · {job.backend}
        </span>
        <button
          type="button"
          className="finetune-card__toggle"
          aria-expanded={open}
          onClick={() => setOpen(value => !value)}
        >
          {open ? 'Close' : 'Adjust'}
        </button>
      </div>
      {open && (
        <>
          <p className="finetune-card__prompt">{job.prompt}</p>
          <div className="finetune-card__fields">
            <NumberField label="Images" value={count} onChange={setCount} min={1} max={MAX_COUNT} />
            <NumberField label="Width" value={width} onChange={setWidth} min={MIN_SIZE} max={MAX_SIZE} step={64} />
            <NumberField label="Height" value={height} onChange={setHeight} min={MIN_SIZE} max={MAX_SIZE} step={64} />
            <NumberField label="Seed" value={seed} onChange={setSeed} min={0} placeholder="random" />
          </div>
          <div className="finetune-card__actions">
            <button type="button" onClick={rerun}>Render again</button>
            <button
              type="button"
              onClick={() => {
                setCount(String(job.count));
                setWidth(String(job.width));
                setHeight(String(job.height));
                setSeed(job.seed === undefined ? '' : String(job.seed));
              }}
            >
              Reset
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}) {
  return (
    <label className="finetune-card__field">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        min={min}
        max={max}
        step={step}
        placeholder={placeholder}
        onChange={event => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

/** Parses a field, falling back to the original job value rather than to zero. */
function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
