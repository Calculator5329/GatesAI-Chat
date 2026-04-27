import { autorun, makeAutoObservable, runInAction, toJS } from 'mobx';
import type { FsReadResp, FsWriteResp } from '../core/workspace';
import {
  dispatchImageGenerate,
  type ImageBackendConfig,
} from '../services/image/imageBackend';
import { createA1111Progress } from '../services/image/jobs/a1111Progress';
import { createComfyProgress } from '../services/image/jobs/comfyProgress';
import type { JobProgress } from '../services/image/jobs/progress';
import type {
  CompletedJob,
  ImageJob,
  ImageJobInput,
} from '../services/image/jobs/types';
import type { ImageBackendId } from '../services/image/types';
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
  /** Injectable for tests; defaults to per-backend factories. */
  progressFactory?: (id: ImageBackendId, config: ImageBackendConfig) => JobProgress | null;
}

const defaultProgressFactory = (id: ImageBackendId, config: ImageBackendConfig): JobProgress | null => {
  if (id === 'local-comfy' && config.comfyBaseUrl) {
    return createComfyProgress({ baseUrl: config.comfyBaseUrl, clientId: 'gatesai-chat' });
  }
  if (id === 'local-a1111' && config.a1111BaseUrl) {
    return createA1111Progress({ baseUrl: config.a1111BaseUrl, apiKey: config.a1111ApiKey });
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
 * and writes each finished image into `/workspace/artifacts/`.
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
    const config: ImageBackendConfig = { ...snapshot };

    if (
      snapshot.primary === 'local-comfy'
      && snapshot.comfyQualityPreset !== 'draft'
      && deps.imageGen.comfyWorkflowPath
    ) {
      const template = await loadComfyWorkflow(deps.bridge, deps.imageGen.comfyWorkflowPath);
      if (typeof template === 'string') {
        throw new Error(template);
      }
      config.comfyWorkflowTemplate = template;
    }

    const progressFactory = deps.progressFactory ?? defaultProgressFactory;
    const progress = progressFactory(snapshot.primary, config);
    const progressUnsub = progress?.subscribe((e) => {
      runInAction(() => { job.progress = { value: e.value, max: e.max }; });
    });

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

        runInAction(() => { job.progress = { value: 0, max: 100 }; });

        const { result } = await dispatcher(
          { prompt: job.prompt, width: job.width, height: job.height, seed },
          config,
        );

        if (ac.signal.aborted) throw new Error('cancelled');

        const filename = `${defaultFilenameStem(snapshot.primary)}-${i + 1}${extensionForMime(result.mime)}`;
        const path = `/workspace/artifacts/${filename}`;
        const resp = await deps.bridge.client.request<FsWriteResp>('fs.write', {
          path,
          content: result.base64,
          encoding: 'base64',
          append: false,
        });
        runInAction(() => {
          job.results.push(resp.path);
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
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const prefix = backend === 'local-comfy' ? 'comfy' : 'a1111';
  return `${prefix}-${stamp}`;
}

function extensionForMime(mime: string): string {
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  return '.png';
}
