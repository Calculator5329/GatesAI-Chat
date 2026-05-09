import { autorun, makeAutoObservable, runInAction, toJS } from 'mobx';
import type { FsReadResp, FsWriteResp } from '../core/workspace';
import {
  dispatchImageGenerate,
  type ImageBackendConfig,
} from '../services/image/imageBackend';
import { createComfyProgress } from '../services/image/jobs/comfyProgress';
import type { JobProgress } from '../services/image/jobs/progress';
import type {
  CompletedJob,
  ImageJob,
  ImageJobInput,
} from '../services/image/jobs/types';
import type { ImageBackendId } from '../services/image/types';
import { bytesToBase64, comfySettingsForMode, safeText } from '../services/image/types';
import {
  clearImageJobsHistory,
  loadImageJobsHistory,
  saveImageJobsHistory,
} from '../services/imageJobsStorage';

const HISTORY_LIMIT = 200;

interface BridgeRequestFacade {
  request<T = unknown>(op: string, data: unknown): Promise<T>;
}

export interface ImageJobBridgeFacade {
  readonly isOnline: boolean;
  readonly client: BridgeRequestFacade;
}

export interface ImageJobImageGenFacade {
  readonly comfyWorkflowPath?: string;
  toBackendConfig(): Omit<ImageBackendConfig, 'comfyWorkflowTemplate' | 'fetch'>;
}

export type ImageDispatcher = typeof dispatchImageGenerate;

export interface ImageJobStoreDeps {
  bridge: ImageJobBridgeFacade;
  imageGen: ImageJobImageGenFacade;
  /** Injectable for tests; defaults to the real dispatcher. */
  dispatcher?: ImageDispatcher;
  /** Injectable for tests; defaults to global fetch. */
  fetch?: typeof fetch;
  /** Injectable for tests; defaults to per-backend factories. */
  progressFactory?: (id: ImageBackendId, config: ImageBackendConfig) => JobProgress | null;
}

const defaultProgressFactory = (id: ImageBackendId, config: ImageBackendConfig): JobProgress | null => {
  if (id === 'local-comfy' && config.comfyBaseUrl) {
    return createComfyProgress({ baseUrl: config.comfyBaseUrl, clientId: 'gatesai-chat' });
  }
  return null;
};

/**
 * Owns the image-generation queue, the active job, and the persisted
 * completed-job history. Only completed (terminal-state) jobs persist —
 * if the user closes the app mid-render, the in-flight work is lost.
 *
 * The runner pulls one job at a time, opens a backend-specific progress
 * stream, dispatches `count` renders against the configured backend,
 * and writes each finished image into a backend-specific image artifact
 * folder: API images under `/workspace/artifacts/images/api/`, local images
 * under `/workspace/artifacts/images/local/`.
 */
export class ImageJobStore {
  queue: ImageJob[] = [];
  active: ImageJob | null = null;
  history: CompletedJob[] = [];

  private idCounter = 0;
  private inflight: AbortController | null = null;
  private readonly deps?: ImageJobStoreDeps;

  constructor(deps?: ImageJobStoreDeps) {
    this.deps = deps;
    this.history = loadImageJobsHistory();
    makeAutoObservable<this, 'idCounter' | 'inflight' | 'deps'>(this, {
      idCounter: false,
      inflight: false,
      deps: false,
    });
    autorun(() => {
      saveImageJobsHistory(toJS(this.history));
    });
  }

  enqueue(input: ImageJobInput): { jobId: string; count: number } {
    const job: ImageJob = {
      ...input,
      id: this.nextId(),
      status: 'pending',
      results: [],
      createdAt: Date.now(),
    };
    runInAction(() => {
      this.queue.push(job);
    });
    void this.runNext();
    return { jobId: job.id, count: job.count };
  }

  cancel(jobId: string): void {
    if (this.active?.id === jobId) {
      this.inflight?.abort();
      this.moveToHistory(this.active, 'cancelled');
      runInAction(() => { this.active = null; });
      void this.runNext();
      return;
    }
    const idx = this.queue.findIndex(j => j.id === jobId);
    if (idx >= 0) {
      const [job] = this.queue.splice(idx, 1);
      this.moveToHistory(job, 'cancelled');
    }
  }

  findById(jobId: string): ImageJob | CompletedJob | null {
    if (this.active?.id === jobId) return this.active;
    const pending = this.queue.find(j => j.id === jobId);
    if (pending) return pending;
    return this.history.find(j => j.id === jobId) ?? null;
  }

  delete(jobId: string): void {
    runInAction(() => {
      this.history = this.history.filter(j => j.id !== jobId);
    });
  }

  /**
   * Re-run a previously failed or cancelled job in place. Keeps the same
   * jobId so the chat-message artifact (which references that id) updates
   * live without needing to mint a new one.
   */
  retry(jobId: string): void {
    const idx = this.history.findIndex(j => j.id === jobId);
    if (idx < 0) return;
    const old = this.history[idx];
    if (old.status !== 'failed' && old.status !== 'cancelled') return;
    runInAction(() => {
      this.history = this.history.filter((_, i) => i !== idx);
    });
    const reset: ImageJob = {
      id: old.id,
      threadId: old.threadId,
      prompt: old.prompt,
      count: old.count,
      width: old.width,
      height: old.height,
      seed: old.seed,
      backend: old.backend,
      filenamePrefix: old.filenamePrefix,
      status: 'pending',
      results: [],
      createdAt: old.createdAt,
    };
    runInAction(() => { this.queue.push(reset); });
    void this.runNext();
  }

  clearHistory(): void {
    runInAction(() => { this.history = []; });
    clearImageJobsHistory();
  }

  private async runNext(): Promise<void> {
    if (this.active) return;
    const next = this.queue.shift();
    if (!next) return;

    runInAction(() => {
      this.active = next;
      next.status = 'running';
      next.startedAt = Date.now();
    });

    if (!this.deps) {
      // No production wiring — mark failed so the system stays consistent.
      this.fail(next, 'image-jobs deps not configured');
      void this.runNext();
      return;
    }

    const ac = new AbortController();
    this.inflight = ac;

    try {
      await this.runJob(next, this.deps, ac);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // Only record failure if the job is still active (not already cancelled).
      const stillActive = this.active as ImageJob | null;
      if (stillActive?.id === next.id) {
        console.error(`[image-jobs] dispatch ${next.id} failed: ${reason}`);
        this.fail(next, reason);
      }
    } finally {
      this.inflight = null;
    }
    void this.runNext();
  }

  private async runJob(
    job: ImageJob,
    deps: ImageJobStoreDeps,
    ac: AbortController,
  ): Promise<void> {
    const snapshot = deps.imageGen.toBackendConfig();
    const config: ImageBackendConfig = { ...snapshot, primary: job.backend };
    if (job.backend === 'local-comfy' && job.comfyMode) {
      Object.assign(config, comfySettingsForMode(job.comfyMode));
    }

    if (
      config.primary === 'local-comfy'
      && config.comfyQualityPreset !== 'quick'
      && !job.comfyMode
      && deps.imageGen.comfyWorkflowPath
    ) {
      const template = await loadComfyWorkflow(deps.bridge, deps.imageGen.comfyWorkflowPath);
      if (typeof template === 'string') {
        throw new Error(template);
      }
      config.comfyWorkflowTemplate = template;
    }

    // Progress is reported cumulatively across the whole job, not per
    // iteration. Each iteration contributes 100 units to a `count * 100`
    // total: iteration `i` starts at `i * 100`, and per-iteration backend
    // events (which arrive on a 0..max scale) are normalized into the
    // remaining 100-unit slice. Otherwise the bar would walk 0→100 once
    // per image and visibly "snap back" between iterations.
    const totalUnits = job.count * 100;
    let currentIter = 0;
    const progressFactory = deps.progressFactory ?? defaultProgressFactory;
    // The progress factory builds a WebSocket / poller. A synchronous
    // throw here (malformed URL, missing globalThis.WebSocket in some
    // webviews) must not abort the render — HTTP polling in the
    // backend client still drives the actual job. Surface it to the
    // console and continue with a null progress object.
    let progress: JobProgress | null = null;
    try {
      progress = progressFactory(job.backend, config);
    } catch (err) {
      console.warn('[image-jobs] progress adapter failed to initialize; render will run without live progress.', err);
    }
    const progressUnsub = progress?.subscribe((e) => {
      const fraction = e.max > 0 ? Math.min(1, Math.max(0, e.value / e.max)) : 0;
      const cumulative = currentIter * 100 + fraction * 100;
      runInAction(() => { job.progress = { value: cumulative, max: totalUnits }; });
    });
    const syntheticProgressTimer = progress || job.backend !== 'openrouter-image' ? null : setInterval(() => {
      const active = this.active as ImageJob | null;
      if (active?.id !== job.id || job.status !== 'running') return;
      const elapsedMs = Date.now() - (job.startedAt ?? Date.now());
      const fraction = Math.min(0.92, 0.04 + elapsedMs / 120_000);
      runInAction(() => {
        job.progress = { value: currentIter * 100 + fraction * 100, max: totalUnits };
      });
    }, 1000);

    const dispatcher = deps.dispatcher ?? dispatchImageGenerate;

    try {
      for (let i = 0; i < job.count; i++) {
        if (ac.signal.aborted) throw new Error('cancelled');
        // If a job was cancelled, this.active will have been reset.
        const stillActive = this.active as ImageJob | null;
        if (stillActive?.id !== job.id) throw new Error('cancelled');

        const seed = typeof job.seed === 'number'
          ? job.seed + i
          : Math.floor(Math.random() * 2 ** 31);

        currentIter = i;
        runInAction(() => { job.progress = { value: i * 100, max: totalUnits }; });

        const perIterPrefix = job.filenamePrefix
          ? (job.count > 1 ? `${job.filenamePrefix}-${i + 1}` : job.filenamePrefix)
          : undefined;
        console.info(`[image-jobs] dispatch ${job.id} (${i + 1}/${job.count}) backend=${job.backend} seed=${seed} dims=${job.width}x${job.height}${perIterPrefix ? ` prefix=${perIterPrefix}` : ''}`);
        const t0 = performance.now();
        const { result } = await dispatcher(
          { prompt: job.prompt, width: job.width, height: job.height, seed, filenamePrefix: perIterPrefix },
          config,
        );
        console.info(`[image-jobs] dispatch ${job.id} returned in ${Math.round(performance.now() - t0)}ms (mime=${result.mime})`);

        if (ac.signal.aborted) throw new Error('cancelled');

        // Always persist final bytes into workspace artifacts. ComfyUI returns
        // a transient /view URL, but Gallery should not depend on a live Comfy
        // server or a WebView policy allowing direct localhost images.
        let recordedPath: string;
        if (result.url) {
          const fetched = await fetchHostedImage(result.url, result.mime, deps.fetch);
          recordedPath = await writeArtifact(deps.bridge, job.backend, i, fetched.base64, fetched.mime, job.filenamePrefix);
          console.info(`[image-jobs] fetched hosted url ${job.id} -> ${recordedPath}`);
        } else if (result.base64) {
          recordedPath = await writeArtifact(deps.bridge, job.backend, i, result.base64, result.mime, job.filenamePrefix);
          console.info(`[image-jobs] fs.write ${job.id} -> ${recordedPath}`);
        } else {
          throw new Error('backend returned neither url nor base64');
        }
        runInAction(() => {
          job.results.push(recordedPath);
          // Advance the cumulative bar to the iteration boundary so it
          // doesn't sit at the previous fraction during the gap between
          // dispatch return and the next iteration's first progress event.
          job.progress = { value: (i + 1) * 100, max: totalUnits };
        });
      }

      runInAction(() => {
        job.status = 'done';
        job.completedAt = Date.now();
        job.progress = undefined;
        this.active = null;
      });
      this.moveToHistory(job, 'done');
    } finally {
      if (syntheticProgressTimer) clearInterval(syntheticProgressTimer);
      progressUnsub?.();
      progress?.dispose();
    }
  }

  private fail(job: ImageJob, error: string): void {
    runInAction(() => {
      job.status = 'failed';
      job.error = error;
      job.completedAt = Date.now();
      job.progress = undefined;
      this.active = null;
    });
    this.moveToHistory(job, 'failed');
  }

  private moveToHistory(job: ImageJob, finalStatus: 'done' | 'failed' | 'cancelled'): void {
    runInAction(() => {
      const completed: CompletedJob = {
        ...toJS(job),
        status: finalStatus,
        completedAt: job.completedAt ?? Date.now(),
        progress: undefined,
      };
      this.history = [completed, ...this.history].slice(0, HISTORY_LIMIT);
    });
  }

  private nextId(): string {
    this.idCounter++;
    return `imgjob-${Date.now().toString(36)}-${this.idCounter.toString(36)}`;
  }
}

async function loadComfyWorkflow(
  bridge: ImageJobBridgeFacade,
  path: string,
): Promise<Record<string, unknown> | string> {
  try {
    const resp = await bridge.client.request<FsReadResp>('fs.read', { path, encoding: 'utf8' });
    if (typeof resp.content !== 'string') {
      return `Error: ComfyUI workflow template at ${path} is not readable as text.`;
    }
    try {
      const parsed = JSON.parse(resp.content) as Record<string, unknown>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return `Error: ComfyUI workflow template at ${path} must be a JSON object.`;
      }
      return parsed;
    } catch (err) {
      return `Error: ComfyUI workflow template at ${path} is not valid JSON (${(err as Error).message}).`;
    }
  } catch (err) {
    return `Error reading ComfyUI workflow template at ${path}: ${(err as Error).message}`;
  }
}

function defaultFilenameStem(backend: ImageBackendId): string {
  const prefix = backendFilePrefix(backend);
  return `${prefix}-${timestampForFilename()}`;
}

function timestampForFilename(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const ms = d.getMilliseconds().toString().padStart(3, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${ms}`;
}

function artifactDirForBackend(backend: ImageBackendId): string {
  switch (backend) {
    case 'local-comfy': return '/workspace/artifacts/images/local';
    case 'openrouter-image': return '/workspace/artifacts/images/api';
  }
}

function backendFilePrefix(backend: ImageBackendId): string {
  switch (backend) {
    case 'local-comfy': return 'comfy';
    case 'openrouter-image': return 'openrouter';
  }
}

async function fetchHostedImage(url: string, fallbackMime: string, fetchImpl?: typeof fetch): Promise<{ base64: string; mime: string }> {
  const fetchFn = fetchImpl ?? globalThis.fetch;
  const resp = await fetchFn(url);
  if (!resp.ok) {
    const text = await safeText(resp);
    throw new Error(`failed to fetch generated image ${resp.status} ${resp.statusText}: ${text || '(no body)'}`);
  }
  const bytes = new Uint8Array(await resp.arrayBuffer());
  return {
    base64: bytesToBase64(bytes),
    mime: resp.headers.get('content-type')?.split(';')[0] || fallbackMime,
  };
}

async function writeArtifact(
  bridge: ImageJobBridgeFacade,
  backend: ImageBackendId,
  index: number,
  base64: string,
  mime: string,
  filenamePrefix?: string,
): Promise<string> {
  const stem = filenamePrefix ? `${filenamePrefix}-${timestampForFilename()}` : defaultFilenameStem(backend);
  const filename = `${stem}-${index + 1}${extensionForMime(mime)}`;
  const path = `${artifactDirForBackend(backend)}/${filename}`;
  const tWrite = performance.now();
  const resp = await bridge.client.request<FsWriteResp>('fs.write', {
    path,
    content: base64,
    encoding: 'base64',
    append: false,
  });
  console.info(`[image-jobs] fs.write -> ${resp.path} in ${Math.round(performance.now() - tWrite)}ms`);
  return resp.path;
}

function extensionForMime(mime: string): string {
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  return '.png';
}
