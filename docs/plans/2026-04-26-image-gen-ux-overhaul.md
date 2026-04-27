# Image-Gen UX Overhaul Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detach `image_generate` from the chat turn into a background job with live progress, multi-image batches, a Gallery menu, a Lightbox, and a fixed workspace-link click-through. Remove the unused fal.ai backend on the way.

**Architecture:** New `ImageJobStore` owns a serial queue, an active job, and a persisted completed-job history. A new `JobRunner` (a method on the store) pulls jobs, dispatches via the existing `imageBackend` layer, threads per-backend progress events back into observable state, and writes pixels via the bridge. Chat messages embed `image-job` artifacts (jobId references) instead of synchronous image paths; the new `ImageJobCard` component observes the store and dispatches on status. A new `Gallery` menu section reads completed history. ComfyUI progress comes over its WebSocket; A1111 progress polls `/sdapi/v1/progress`. Cancellation flows through the runner's AbortController plus a backend-specific interrupt call.

**Tech Stack:** TypeScript (strict), MobX 6, React 19 + mobx-react-lite, Vitest 3 + jsdom, ESLint 9. Tauri host unchanged. No new runtime deps.

**Reference:** Design doc at [docs/plans/2026-04-26-image-gen-ux-overhaul-design.md](2026-04-26-image-gen-ux-overhaul-design.md).

---

## Task ordering principle

Bottom-up so each task is independently testable:

1. **Cleanup:** remove fal.ai (shrinks the surface before adding new code)
2. **Job model:** types + storage adapter + store with no runner
3. **Progress adapters:** ComfyUI WS, A1111 poll
4. **Runner:** orchestrate queue → dispatch → progress → file write
5. **Tool integration:** `image_generate` enqueues; add `count` arg, `image-job` artifact, system-prompt addendum
6. **UI components:** ImageJobCard, Lightbox
7. **Wire UI into chat:** EditorialMessage renders the new artifact kind, "generating" label
8. **Gallery menu** + MenuSectionKey + router update
9. **Anchor interceptor** in MarkdownBody
10. **Docs sync**

Each task ends with a green test run, typecheck pass, and one commit.

---

## Task 1: Remove fal.ai backend

**Files:**
- Delete: `src/services/image/fluxClient.ts`
- Delete: `tests/services/image/fluxClient.test.ts`
- Modify: `src/services/image/types.ts` (remove `'fal'` and `'bfl'` from `ImageBackendId`, drop `FluxVariant` if only flux uses it)
- Modify: `src/services/image/imageBackend.ts` (drop `'fal'` and `'bfl'` cases in `resolveBackend`; drop the cloud-fallback path in `dispatchImageGenerate` — on local failure, throw)
- Modify: `src/services/imageGenStorage.ts` (drop `falApiKey`, `bflApiKey`, `defaultVariant` fields and from `OLLAMA_DEFAULTS`/`DEFAULT_IMAGE_GEN_CONFIG`; storage key migration: stale fields are simply ignored on load)
- Modify: `src/services/tools/types.ts` (drop `falApiKey`, `bflApiKey`, `defaultVariant` from `ImageBackendSnapshot` re-export — actually they live in image/types.ts)
- Modify: `src/stores/ImageGenStore.ts` (drop `setFalKey`, `setBflKey`, `setDefaultVariant`, `setFallbackBackend`; update `toBackendConfig` accordingly)
- Modify: `src/services/tools/imageGenerate.ts` (drop `variant` arg from schema; update description)
- Modify: `src/components/menu/sections/api/ImageGenCard.tsx` (delete `FalBackendFields`, drop the `bfl` `<option>`, drop the cloud-fallback row)
- Modify: `src/components/menu/sections/api/ApiSection.tsx` (the section currently sits in API panel — confirm whether to leave it there or move it; for now leave it but only show local backends)

Note: the user's WIP may have already moved image-gen settings into the Local menu. Read both `ApiSection.tsx` and `Local.tsx` first; whichever currently renders `ImageGenCard` is the one to update.

**Step 1: Drop the types**

Edit `src/services/image/types.ts`:

```ts
// Replace
export type ImageBackendId = 'fal' | 'bfl' | 'local-comfy' | 'local-a1111';
// with
export type ImageBackendId = 'local-comfy' | 'local-a1111';

// Drop the entire FluxVariant export (search for usages first; if any
// non-fal callers reference it, keep but rename — they shouldn't).
```

Drop `falApiKey`, `bflApiKey`, `defaultVariant` from `ImageBackendSnapshot`.

**Step 2: Delete the FluxClient and its test**

```bash
git rm src/services/image/fluxClient.ts tests/services/image/fluxClient.test.ts
```

**Step 3: Update the dispatcher**

Edit `src/services/image/imageBackend.ts`:
- Remove `import { FluxClient }`
- Remove `case 'fal':` and `case 'bfl':` from `resolveBackend`
- Remove the entire fallback path in `dispatchImageGenerate` — when the primary backend throws, just rethrow. The `fallbackNote` and `runFallback` helpers can go too, along with `isLocalBackend` and `shouldAttemptFallback` if they have no other callers.

**Step 4: Update storage + store + tool schema**

`src/services/imageGenStorage.ts`: drop the dropped fields from `ImageGenConfig` and `DEFAULT_IMAGE_GEN_CONFIG`. The `loadImageGenConfig` merge already ignores unknown keys, so old persisted snapshots from the fal era will silently lose the dead fields on next save.

`src/stores/ImageGenStore.ts`: drop `setFalKey`, `setBflKey`, `setDefaultVariant`, `setFallbackBackend`. Update `toBackendConfig()` to remove the dropped fields. The `backend` setter still accepts only `'local-comfy' | 'local-a1111'`.

`src/services/tools/imageGenerate.ts`:
- Drop `variant` from `parameters`
- Drop the `flux-2-pro` default variant logic
- Update tool `description` to: `'Generate an image using the configured local backend (ComfyUI or AUTOMATIC1111). Returns a workspace path the user can click to open.'`

**Step 5: Update the UI**

In whichever file currently renders `ImageGenCard`:
- Remove the `<option value="fal">` and `<option value="bfl" disabled>`
- Default `backend` to `'local-comfy'` if a stale config still has `'fal'` (handled in `loadImageGenConfig`'s merge — set the default to `'local-comfy'`)
- Delete the entire `FalBackendFields` component
- Delete the cloud-fallback `<SettingsRow label="Cloud fallback" last>` block

**Step 6: Update tests that reference fal**

Search:
```bash
grep -rn "fal\\.ai\\|FluxClient\\|falApiKey\\|FluxVariant\\|flux-2-pro\\|flux-2-flex\\|flux-2-dev\\|defaultVariant" src/ tests/
```

For each hit, either remove the test entirely (if it's fal-specific) or update the assertion. The big one is `tests/services/tools/imageGenerate.test.ts` which has fal-keyed setup paths.

**Step 7: Verify**

```bash
npm run typecheck
NODE_OPTIONS="--max-old-space-size=12288" npm test
```

Expected: clean. All remaining tests pass.

**Step 8: Commit**

```bash
git add -A
git commit -m "refactor(image-gen): remove unused fal.ai backend

Cloud image-gen will route through OpenRouter when that lands. Until
then, image_generate is local-only via ComfyUI / AUTOMATIC1111.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: ImageJob types + storage adapter

**Files:**
- Create: `src/services/image/jobs/types.ts`
- Create: `src/services/imageJobsStorage.ts`
- Test: `tests/services/imageJobsStorage.test.ts`

**Step 1: Define the job types**

`src/services/image/jobs/types.ts`:

```ts
import type { ImageBackendId } from '../types';

export type ImageJobStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface ImageJobInput {
  threadId: string;
  prompt: string;
  count: number;          // 1..10
  width: number;
  height: number;
  seed?: number;
  backend: ImageBackendId;
}

export interface ImageJob extends ImageJobInput {
  id: string;
  status: ImageJobStatus;
  /** Set while status === 'running'. */
  progress?: { value: number; max: number };
  /** Workspace paths of completed images in the batch. Grows during a multi-image run. */
  results: string[];
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

/**
 * Subset of {@link ImageJob} that survives across app restarts. Pending /
 * running jobs are dropped on save — only terminal states (done, failed,
 * cancelled) make it to disk.
 */
export interface CompletedJob extends ImageJob {
  status: 'done' | 'failed' | 'cancelled';
}
```

**Step 2: Write the failing storage test**

`tests/services/imageJobsStorage.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadImageJobsHistory,
  saveImageJobsHistory,
  clearImageJobsHistory,
  IMAGE_JOBS_KEY,
} from '../../src/services/imageJobsStorage';
import type { CompletedJob } from '../../src/services/image/jobs/types';

const ONE: CompletedJob = {
  id: 'job-1',
  threadId: 't1',
  prompt: 'a sunset',
  count: 1,
  width: 1024,
  height: 1024,
  backend: 'local-comfy',
  status: 'done',
  results: ['/workspace/artifacts/foo.png'],
  createdAt: 1,
  completedAt: 2,
};

describe('imageJobsStorage', () => {
  beforeEach(() => localStorage.removeItem(IMAGE_JOBS_KEY));
  afterEach(() => localStorage.removeItem(IMAGE_JOBS_KEY));

  it('returns [] when no entry exists', () => {
    expect(loadImageJobsHistory()).toEqual([]);
  });

  it('round-trips a single job', () => {
    saveImageJobsHistory([ONE]);
    expect(loadImageJobsHistory()).toEqual([ONE]);
  });

  it('returns [] when the entry is malformed JSON', () => {
    localStorage.setItem(IMAGE_JOBS_KEY, '{not json');
    expect(loadImageJobsHistory()).toEqual([]);
  });

  it('returns [] when the entry is the wrong shape', () => {
    localStorage.setItem(IMAGE_JOBS_KEY, JSON.stringify({ wrong: true }));
    expect(loadImageJobsHistory()).toEqual([]);
  });

  it('clearImageJobsHistory removes the entry', () => {
    saveImageJobsHistory([ONE]);
    clearImageJobsHistory();
    expect(loadImageJobsHistory()).toEqual([]);
  });
});
```

**Step 3: Run test to verify it fails**

Run: `NODE_OPTIONS="--max-old-space-size=12288" npm test -- tests/services/imageJobsStorage.test.ts`
Expected: FAIL — module not found.

**Step 4: Implement**

`src/services/imageJobsStorage.ts`:

```ts
import type { CompletedJob } from './image/jobs/types';

export const IMAGE_JOBS_KEY = 'gatesai.imagejobs.v1';

interface PersistedShape {
  history: CompletedJob[];
}

function isPersistedShape(v: unknown): v is PersistedShape {
  if (!v || typeof v !== 'object') return false;
  const arr = (v as { history?: unknown }).history;
  return Array.isArray(arr);
}

export function loadImageJobsHistory(): CompletedJob[] {
  try {
    const raw = localStorage.getItem(IMAGE_JOBS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!isPersistedShape(parsed)) return [];
    return parsed.history;
  } catch {
    return [];
  }
}

export function saveImageJobsHistory(history: CompletedJob[]): void {
  try {
    const payload: PersistedShape = { history };
    localStorage.setItem(IMAGE_JOBS_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota / privacy-mode failures
  }
}

export function clearImageJobsHistory(): void {
  try {
    localStorage.removeItem(IMAGE_JOBS_KEY);
  } catch {
    // ignore
  }
}
```

**Step 5: Update test storage helper**

Edit `tests/helpers/storage.ts` to also clear `gatesai.imagejobs.v1`.

**Step 6: Verify**

```bash
NODE_OPTIONS="--max-old-space-size=12288" npm test -- tests/services/imageJobsStorage.test.ts
npm run typecheck
```

Expected: 5 tests pass; typecheck clean.

**Step 7: Commit**

```bash
git add src/services/image/jobs/types.ts src/services/imageJobsStorage.ts tests/services/imageJobsStorage.test.ts tests/helpers/storage.ts
git commit -m "feat(image-jobs): job types + persistence adapter

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: ImageJobStore (queue + history + cancel, no runner yet)

**Files:**
- Create: `src/stores/ImageJobStore.ts`
- Test: `tests/stores/ImageJobStore.test.ts`

The runner method exists but is a stub that immediately marks pending jobs as `failed` with `'runner not implemented yet'`. The next task replaces it with the real runner.

**Step 1: Write the failing tests**

`tests/stores/ImageJobStore.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ImageJobStore } from '../../src/stores/ImageJobStore';
import type { ImageJobInput } from '../../src/services/image/jobs/types';
import { clearAppStorage } from '../helpers/storage';

const INPUT: ImageJobInput = {
  threadId: 't1',
  prompt: 'a sunset',
  count: 1,
  width: 1024,
  height: 1024,
  backend: 'local-comfy',
};

describe('ImageJobStore', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => clearAppStorage());

  it('starts with empty queue and history', () => {
    const store = new ImageJobStore();
    expect(store.queue).toEqual([]);
    expect(store.history).toEqual([]);
    expect(store.active).toBeNull();
  });

  it('enqueue() returns a stable id and pushes onto the queue', () => {
    const store = new ImageJobStore();
    const { jobId, count } = store.enqueue(INPUT);
    expect(typeof jobId).toBe('string');
    expect(count).toBe(1);
    const job = store.findById(jobId);
    expect(job?.status).toBe('pending');
    expect(job?.prompt).toBe('a sunset');
  });

  it('cancel() on a pending job removes it and marks cancelled in history', () => {
    const store = new ImageJobStore();
    const { jobId } = store.enqueue(INPUT);
    store.cancel(jobId);
    expect(store.queue).toEqual([]);
    expect(store.history.find(j => j.id === jobId)?.status).toBe('cancelled');
  });

  it('history rehydrates from localStorage on next construction', () => {
    const store = new ImageJobStore();
    const { jobId } = store.enqueue(INPUT);
    store.cancel(jobId);
    // history is persisted on every move into terminal state
    const store2 = new ImageJobStore();
    expect(store2.history.find(j => j.id === jobId)?.status).toBe('cancelled');
  });

  it('delete() removes a job from history', () => {
    const store = new ImageJobStore();
    const { jobId } = store.enqueue(INPUT);
    store.cancel(jobId);
    store.delete(jobId);
    expect(store.history.find(j => j.id === jobId)).toBeUndefined();
  });

  it('clearHistory() empties history and storage', () => {
    const store = new ImageJobStore();
    const { jobId } = store.enqueue(INPUT);
    store.cancel(jobId);
    store.clearHistory();
    expect(store.history).toEqual([]);
    const store2 = new ImageJobStore();
    expect(store2.history).toEqual([]);
  });
});
```

**Step 2: Run, see failure**

Run: `NODE_OPTIONS="--max-old-space-size=12288" npm test -- tests/stores/ImageJobStore.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement (with stub runner)**

`src/stores/ImageJobStore.ts`:

```ts
import { autorun, makeAutoObservable, runInAction, toJS } from 'mobx';
import type {
  CompletedJob,
  ImageJob,
  ImageJobInput,
  ImageJobStatus,
} from '../services/image/jobs/types';
import {
  loadImageJobsHistory,
  saveImageJobsHistory,
  clearImageJobsHistory,
} from '../services/imageJobsStorage';

const HISTORY_LIMIT = 200;

/**
 * Owns the image-generation queue, the active job, and the persisted
 * completed-job history. Only completed (terminal-state) jobs persist —
 * if the user closes the app mid-render, the in-flight work is lost.
 *
 * The runner method drives one job at a time. Task 5 of the plan
 * replaces the stub `runNext` with the real runner.
 */
export class ImageJobStore {
  queue: ImageJob[] = [];
  active: ImageJob | null = null;
  history: CompletedJob[] = [];

  private idCounter = 0;
  private inflight: AbortController | null = null;

  constructor() {
    this.history = loadImageJobsHistory();
    makeAutoObservable<this, 'idCounter' | 'inflight'>(this, {
      idCounter: false,
      inflight: false,
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

  /** Stub runner — Task 5 replaces this. */
  private async runNext(): Promise<void> {
    if (this.active) return;
    const next = this.queue.shift();
    if (!next) return;
    runInAction(() => {
      this.active = next;
      next.status = 'running';
      next.startedAt = Date.now();
    });
    // Stub: fail immediately so the rest of the system can be wired.
    await new Promise(r => setTimeout(r, 0));
    runInAction(() => {
      next.status = 'failed';
      next.error = 'Image runner not implemented yet (image-gen UX overhaul Task 5)';
      next.completedAt = Date.now();
      this.active = null;
    });
    this.moveToHistory(next, 'failed');
    void this.runNext();
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
```

**Step 4: Run tests**

```bash
NODE_OPTIONS="--max-old-space-size=12288" npm test -- tests/stores/ImageJobStore.test.ts
NODE_OPTIONS="--max-old-space-size=12288" npm test
npm run typecheck
```

Expected: 6 tests pass; full suite green; typecheck clean.

**Step 5: Wire into RootStore + context**

`src/stores/RootStore.ts`:
```ts
import { ImageJobStore } from './ImageJobStore';
// ...
readonly imageJobs: ImageJobStore;
// in constructor, after this.imageGen:
this.imageJobs = new ImageJobStore();
```

`src/stores/context.tsx`:
```ts
import type { ImageJobStore } from './ImageJobStore';
// ...
export function useImageJobStore(): ImageJobStore {
  return useRootStore().imageJobs;
}
```

**Step 6: Verify + commit**

```bash
NODE_OPTIONS="--max-old-space-size=12288" npm test
npm run typecheck
git add src/stores/ImageJobStore.ts src/stores/RootStore.ts src/stores/context.tsx tests/stores/ImageJobStore.test.ts
git commit -m "feat(image-jobs): ImageJobStore with queue + history + stub runner

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Per-backend progress adapters

**Files:**
- Create: `src/services/image/jobs/progress.ts` (interface + factory)
- Create: `src/services/image/jobs/comfyProgress.ts` (WebSocket adapter)
- Create: `src/services/image/jobs/a1111Progress.ts` (poll adapter)
- Test: `tests/services/image/jobs/comfyProgress.test.ts`
- Test: `tests/services/image/jobs/a1111Progress.test.ts`

The interface:

```ts
// src/services/image/jobs/progress.ts
export interface ProgressEvent {
  value: number;
  max: number;
}

/**
 * Per-backend progress + cancel adapter. Created by the runner before
 * dispatch; subscribed for the duration of the backend call. Cancel is
 * idempotent and safe to call after `dispose`.
 */
export interface JobProgress {
  /** Subscribe to events. Returns the disposer. */
  subscribe(onEvent: (e: ProgressEvent) => void): () => void;
  /** Send an interrupt request to the backend. */
  cancel(): Promise<void>;
  /** Tear down the underlying connection. Idempotent. */
  dispose(): void;
}
```

**Step 1: Write ComfyUI WS test**

`tests/services/image/jobs/comfyProgress.test.ts` should mock the global `WebSocket` constructor and assert:
- The adapter opens `ws://<host>/ws?clientId=<...>`
- A `progress` frame `{type:'progress', data:{value, max}}` calls the listener
- `cancel()` POSTs to `<baseUrl>/queue` with `{clear: true}` (and/or POSTs `<baseUrl>/interrupt` — Comfy accepts both)
- `dispose()` closes the socket

Use a small test double for `WebSocket`:

```ts
class FakeWS {
  static last: FakeWS | null = null;
  url: string;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeWS.last = this;
  }
  emit(data: unknown) { this.onmessage?.({ data: JSON.stringify(data) }); }
  close() { this.closed = true; this.onclose?.(); }
}
```

Inject by `vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket)`.

Tests:
- `creates a WebSocket pointing at the configured baseUrl`
- `forwards progress frames to subscribers`
- `ignores non-progress frames`
- `cancel() POSTs to /interrupt`
- `dispose() closes the WebSocket`

**Step 2: Implement ComfyUI adapter**

```ts
// src/services/image/jobs/comfyProgress.ts
import type { JobProgress, ProgressEvent } from './progress';

export interface ComfyProgressOptions {
  baseUrl: string;
  clientId: string;
  /** Optional injectable for tests; defaults to global fetch. */
  fetch?: typeof fetch;
}

interface ComfyFrame {
  type?: string;
  data?: { value?: number; max?: number };
}

export function createComfyProgress(opts: ComfyProgressOptions): JobProgress {
  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const wsUrl = opts.baseUrl.replace(/^http/, 'ws').replace(/\/+$/, '') + `/ws?clientId=${encodeURIComponent(opts.clientId)}`;
  const ws = new WebSocket(wsUrl);
  const listeners = new Set<(e: ProgressEvent) => void>();
  let disposed = false;

  ws.onmessage = (ev: MessageEvent) => {
    if (disposed) return;
    let frame: ComfyFrame;
    try { frame = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
    if (frame.type !== 'progress') return;
    const value = frame.data?.value;
    const max = frame.data?.max;
    if (typeof value !== 'number' || typeof max !== 'number') return;
    for (const fn of listeners) fn({ value, max });
  };

  return {
    subscribe(onEvent) {
      listeners.add(onEvent);
      return () => listeners.delete(onEvent);
    },
    async cancel() {
      try {
        await fetchImpl(`${opts.baseUrl.replace(/\/+$/, '')}/interrupt`, { method: 'POST' });
      } catch {
        // best-effort; the abort signal in the runner handles the rest
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try { ws.close(); } catch { /* ignore */ }
      listeners.clear();
    },
  };
}
```

**Step 3: Write A1111 poll test**

`tests/services/image/jobs/a1111Progress.test.ts`:
- Use `vi.useFakeTimers()`
- Stub `fetch` to return progressing values
- Assert subscribers get fired on each tick
- `cancel()` calls `/sdapi/v1/interrupt`

**Step 4: Implement A1111 adapter**

```ts
// src/services/image/jobs/a1111Progress.ts
import type { JobProgress, ProgressEvent } from './progress';

export interface A1111ProgressOptions {
  baseUrl: string;
  apiKey?: string;
  intervalMs?: number;
  fetch?: typeof fetch;
}

interface A1111ProgressResp { progress?: number; eta_relative?: number }

export function createA1111Progress(opts: A1111ProgressOptions): JobProgress {
  const fetchImpl = opts.fetch ?? globalThis.fetch.bind(globalThis);
  const interval = opts.intervalMs ?? 500;
  const headers: Record<string, string> = {};
  if (opts.apiKey) headers.Authorization = `Bearer ${opts.apiKey}`;
  const listeners = new Set<(e: ProgressEvent) => void>();
  let disposed = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const tick = async () => {
    if (disposed) return;
    try {
      const resp = await fetchImpl(`${opts.baseUrl.replace(/\/+$/, '')}/sdapi/v1/progress?skip_current_image=true`, { headers });
      if (!resp.ok) return;
      const json = await resp.json() as A1111ProgressResp;
      const p = json.progress;
      if (typeof p !== 'number' || disposed) return;
      const value = Math.max(0, Math.min(1, p));
      for (const fn of listeners) fn({ value: Math.round(value * 100), max: 100 });
    } catch {
      // ignore — progress is best-effort
    }
  };
  timer = setInterval(() => { void tick(); }, interval);

  return {
    subscribe(onEvent) {
      listeners.add(onEvent);
      return () => listeners.delete(onEvent);
    },
    async cancel() {
      try {
        await fetchImpl(`${opts.baseUrl.replace(/\/+$/, '')}/sdapi/v1/interrupt`, { method: 'POST', headers });
      } catch { /* ignore */ }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (timer) { clearInterval(timer); timer = null; }
      listeners.clear();
    },
  };
}
```

**Step 5: Verify + commit**

```bash
NODE_OPTIONS="--max-old-space-size=12288" npm test -- tests/services/image/jobs/
NODE_OPTIONS="--max-old-space-size=12288" npm test
npm run typecheck
git add src/services/image/jobs/progress.ts src/services/image/jobs/comfyProgress.ts src/services/image/jobs/a1111Progress.ts tests/services/image/jobs/
git commit -m "feat(image-jobs): per-backend progress adapters (Comfy WS, A1111 poll)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Real JobRunner

Replace the stub `runNext` in `ImageJobStore` with the real runner. The runner needs the bridge (for `fs.write`), the `ImageGenStore` (for the snapshot), and the progress factory.

**Files:**
- Modify: `src/stores/ImageJobStore.ts` (constructor takes deps; real `runNext`)
- Modify: `src/stores/RootStore.ts` (pass deps when constructing)
- Modify: `tests/stores/ImageJobStore.test.ts` (add runner tests with fakes)

**Step 1: Update the store constructor**

```ts
export interface ImageJobStoreDeps {
  bridge: BridgeStore;
  imageGen: ImageGenStore;
  /** Injectable for tests; defaults to factories that pick by backend. */
  progressFactory?: (cfg: ImageBackendConfig) => JobProgress | null;
}
```

**Step 2: Implement the real runner**

In `runNext`:

1. Take `next = this.queue.shift()`
2. Build `ImageBackendConfig` from `imageGen.toBackendConfig()` (matches today's `image_generate` tool flow)
3. If `backend === 'local-comfy'` and the user has a workflow path, load the workflow JSON via `bridge.client.request('fs.read', ...)` and attach it to `config.comfyWorkflowTemplate`
4. Create the progress adapter (Comfy or A1111). Subscribe to update `next.progress`.
5. Loop `count` times. For each iteration:
   a. Compute `seed = next.seed != null ? next.seed + i : Math.floor(Math.random() * 2**31)`
   b. Call `dispatchImageGenerate({ prompt, width, height, seed }, config)`. This now respects the inflight `AbortController` — pass `signal` through (will need a small extension to `dispatchImageGenerate` to accept a signal).
   c. Compute filename from prompt + index. Write via `bridge.client.request('fs.write', { path, content: base64, encoding: 'base64' })`.
   d. Push the resulting path onto `next.results`.
6. On success: `next.status = 'done'`, `moveToHistory(next, 'done')`.
7. On error: catch + `next.status = 'failed'`, set `error`, `moveToHistory(next, 'failed')`.
8. Always: `dispose()` the progress adapter, `runInAction(() => this.active = null)`, recurse.

**Step 3: Plumb the abort signal**

`dispatchImageGenerate` and `ImageBackend.generate` don't accept `AbortSignal` today. Extend the signatures so the runner can pass `this.inflight.signal` and propagate aborts to the underlying fetches in `ComfyClient.generate` and `A1111Client.generate`.

For `ComfyClient`: pass `signal` into the `fetch(url, { signal, ... })` calls in its existing methods.

For `A1111Client`: same.

**Step 4: Add runner tests**

In `tests/stores/ImageJobStore.test.ts`, add tests:

- `runs a queued job to completion via the injected progress factory + dispatcher`
- `cancel() during a running job aborts and marks cancelled`
- `multi-image (count: 3) writes three files and accumulates results`
- `failed dispatch lands the job in history with status='failed'`

These tests inject a fake `dispatch` (or stub `globalThis.fetch`) to avoid hitting real HTTP. Suggested approach: have the store accept a `dispatcher` injection alongside the progress factory; the production wiring uses the real `dispatchImageGenerate` from `imageBackend.ts`.

```ts
export interface ImageJobStoreDeps {
  bridge: BridgeFacade;
  imageGen: ImageGenFacade;
  dispatcher?: typeof dispatchImageGenerate;       // for tests
  progressFactory?: (id: ImageBackendId, config: ImageBackendConfig) => JobProgress | null;
}
```

This keeps the runner testable without spinning up a real backend.

**Step 5: Verify + commit**

```bash
NODE_OPTIONS="--max-old-space-size=12288" npm test
npm run typecheck
git add -A
git commit -m "feat(image-jobs): real JobRunner with progress + cancel + multi-image

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: image_generate tool enqueues + count + image-job artifact

**Files:**
- Modify: `src/core/types.ts` (extend `ToolResultArtifact` union)
- Modify: `src/services/tools/types.ts` (extend `ToolContext` with `imageJobs`)
- Modify: `src/services/tools/imageGenerate.ts`
- Modify: `src/stores/ChatStore.ts` (pass `imageJobs` through `setToolStoresProvider`)
- Modify: `tests/services/tools/imageGenerate.test.ts`

**Step 1: Extend the artifact union**

`src/core/types.ts`:
```ts
export type ToolResultArtifact =
  | { kind: 'image'; path: string; mime: string }
  | { kind: 'image-job'; jobId: string; count: number };
```

The `kind: 'image'` variant stays for the rare synchronous case (or test fixtures). Real image_generate now emits `image-job`.

**Step 2: Extend ToolContext**

`src/services/tools/types.ts`:
```ts
export interface ImageJobsFacade {
  enqueue(input: ImageJobInput): { jobId: string; count: number };
}
// add to ToolContext
imageJobs?: ImageJobsFacade;
```

**Step 3: Rewrite the tool**

`src/services/tools/imageGenerate.ts` becomes much shorter:

```ts
async execute(args, ctx) {
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
  if (!prompt) return 'Error: `prompt` is required.';
  if (!ctx.imageGen) return 'Error: image-generation is not configured in this session.';
  if (!ctx.imageJobs) return 'Error: image-jobs subsystem is not available in this session.';
  if (!ctx.bridge?.isOnline) return 'Error: bridge is offline. Start the gatesai-bridge companion process and try again.';

  const snapshot = ctx.imageGen.toBackendConfig();
  const aspect = typeof args.aspect_ratio === 'string' ? (args.aspect_ratio as ImageAspectRatio) : '1:1';
  const { width, height } = resolveDims(args, aspect);   // helper that respects explicit width/height for local
  const seed = typeof args.seed === 'number' && Number.isFinite(args.seed) ? Math.floor(args.seed) : undefined;
  const count = clampCount(args.count);

  const { jobId, count: scheduledCount } = ctx.imageJobs.enqueue({
    threadId: ctx.threadId,
    prompt,
    count,
    width,
    height,
    seed,
    backend: snapshot.primary,
  });

  return {
    content: `Queued ${scheduledCount === 1 ? 'an image render' : `${scheduledCount} image renders`} (job ${jobId}).`,
    artifacts: [{ kind: 'image-job', jobId, count: scheduledCount }],
  };
}

function clampCount(raw: unknown): number {
  const n = typeof raw === 'number' ? Math.floor(raw) : 1;
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(10, n));
}
```

Add `count: { type: 'number', description: 'How many images to generate (1–10). Default 1.' }` to the JSON schema.

Update the description to mention `count` and that the call returns immediately while the render runs in the background.

**Step 4: Update the system prompt addendum**

In `ChatStore.buildTurnRequest`, when `image_generate` is in the tools list, append to systemPrompt:

```
When you call image_generate, don't repeat the tool result back. The user already sees the image inline. Just say briefly what you made.
```

The cleanest place is `services/tools/registry.ts` — expose a `systemPromptAddendumForTurn(ctx: ToolSelectionContext): string | undefined` and call it from ChatStore. But to keep this task small: hardcode a check in `ChatStore.buildTurnRequest` that, if `tools.some(t => t.name === 'image_generate')`, appends the line to systemPrompt.

**Step 5: Wire imageJobs into the tool context**

`src/stores/RootStore.ts`:
```ts
this.chat.setToolStoresProvider(() => ({
  notes: this.notes,
  summary: this.summary,
  bridge: this.bridge,
  execStream: this.execStream,
  imageGen: this.imageGen,
  imageJobs: this.imageJobs,        // NEW
}));
```

**Step 6: Update tests**

`tests/services/tools/imageGenerate.test.ts` is going to need a rewrite since the tool no longer dispatches. The test now:
- Provides a fake `imageJobs` with a stub `enqueue` returning `{ jobId: 'job-x', count: 1 }`
- Asserts the tool returns `{ content, artifacts: [{kind:'image-job', jobId:'job-x', count:1}] }`
- Asserts `enqueue` was called with the right shape (prompt, dims, seed, count, threadId)
- Drop the existing fal-routing tests (already gone in Task 1)

Also add tests for `count` clamping (negative, 0, 11 → clamped) and for the explicit `width`/`height` precedence over aspect_ratio (local backends only).

**Step 7: Verify + commit**

```bash
NODE_OPTIONS="--max-old-space-size=12288" npm test
npm run typecheck
git add -A
git commit -m "feat(image-jobs): image_generate enqueues; count + image-job artifact + system-prompt addendum

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: ImageJobCard + Lightbox UI components

**Files:**
- Create: `src/components/editorial/ImageJobCard.tsx`
- Create: `src/components/editorial/Lightbox.tsx`
- Test: `tests/components/editorial/ImageJobCard.test.tsx`

This task introduces the components but doesn't yet wire them into `EditorialMessage`. That's Task 8.

**Step 1: Lightbox**

`src/components/editorial/Lightbox.tsx` is a presentational component:

```tsx
interface LightboxProps {
  images: { path: string; alt: string }[];
  startIndex: number;
  prompt?: string;
  onClose: () => void;
}
```

Render at `position: fixed; inset: 0; background: rgba(0,0,0,0.92); zIndex: 1000`. Use `WorkspaceImage`'s underlying byte-fetch (or extract a hook) to get a data URL for the current index. ESC and backdrop click call `onClose`. For multi-image, render `‹ ›` arrows and bind ArrowLeft / ArrowRight. Footer: prompt (truncated) + an "Open in OS" button that calls `bridge.openWorkspacePath`.

**Step 2: ImageJobCard**

`src/components/editorial/ImageJobCard.tsx`:

```tsx
export const ImageJobCard = observer(function ImageJobCard({ jobId, expectedCount, aspect }: { jobId: string; expectedCount: number; aspect: { w: number; h: number } }) {
  const jobs = useImageJobStore();
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null);
  const job = jobs.findById(jobId);
  if (!job) return <PlaceholderRect ratio={aspect} label="Lost track of job" />;

  switch (job.status) {
    case 'pending':
    case 'running':
      return <RunningCard job={job} aspect={aspect} onCancel={() => jobs.cancel(jobId)} />;
    case 'done':
      if (job.results.length === 1) {
        return <>
          <BigImage path={job.results[0]} alt="Generated image" onOpen={() => setLightboxIdx(0)} />
          {lightboxIdx !== null && <Lightbox images={job.results.map(p => ({ path: p, alt: 'Generated image' }))} startIndex={lightboxIdx} prompt={job.prompt} onClose={() => setLightboxIdx(null)} />}
        </>;
      }
      return <>
        <ImageGrid paths={job.results} onOpen={(i) => setLightboxIdx(i)} />
        {lightboxIdx !== null && <Lightbox ... />}
      </>;
    case 'failed':
      return <FailedCard job={job} onRetry={() => jobs.enqueue({ ...job })} />;
    case 'cancelled':
      return <CancelledCard job={job} onRetry={() => jobs.enqueue({ ...job })} />;
  }
});
```

Sub-components (all in the same file or split — implementer's choice):
- `RunningCard`: thin progress bar at the bottom of a placeholder rect, label like `generating · 47% · ComfyUI`, `✕` cancel button
- `BigImage`: clickable, max-width 600px, native aspect from `aspect` prop
- `ImageGrid`: 2-column on count<=4, 3-column on count>=5; uniform tile heights
- `FailedCard` / `CancelledCard`: muted styling, error/status, ↻ retry that calls `jobs.enqueue({...job})`

**Step 3: Tests**

`tests/components/editorial/ImageJobCard.test.tsx` covers the render branches. Use a real `ImageJobStore` with manual `enqueue` and synthesized state:

```tsx
import { render, screen, fireEvent } from '@testing-library/react';   // already a dev dep (check)
// ...
it('shows running state with progress', () => {
  const jobs = new ImageJobStore();
  // Manually push an active job into observable state
  jobs.queue.push({...}); jobs.runNext();   // or directly mutate via a test helper
  // ...
});
```

If `@testing-library/react` isn't already wired, the alternative is to test by checking which sub-component would render for each state — e.g. extract a pure `pickCardVariant(job)` helper and unit-test that. The implementer should pick whichever pattern is already used elsewhere in `tests/components/`.

**Step 4: Verify + commit**

```bash
NODE_OPTIONS="--max-old-space-size=12288" npm test
npm run typecheck
git add -A
git commit -m "feat(image-jobs): ImageJobCard + Lightbox components

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Wire ImageJobCard into EditorialMessage; "generating" pre-token label

**Files:**
- Modify: `src/components/editorial/EditorialMessage.tsx`
- Modify: `src/stores/ChatStore.ts` (compute pre-token label based on running job state)

**Step 1: Render the new artifact**

In `EditorialMessage`, where the existing `image` artifact is rendered, dispatch:

```tsx
{result.artifacts?.map((a, i) => {
  if (a.kind === 'image') {
    return <WorkspaceImage key={i} path={a.path} alt="Generated image" kind="image" />;
  }
  if (a.kind === 'image-job') {
    return <ImageJobCard key={i} jobId={a.jobId} expectedCount={a.count} aspect={...} />;
  }
  return null;
})}
```

(Aspect comes from the job itself once available; before then, fall back to a square placeholder. The card looks up the job by id and uses its `width`/`height`.)

**Step 2: "generating" pre-token label**

In `ChatStore` or `EditorialMessage`'s pre-token label resolver: when the assistant message is mid-stream AND `imageJobs.active?.threadId === message.threadId`, swap `'thinking'` → `'generating'`. Easiest place is the `preTokenLabel` computation:

```ts
// In ChatStore.runTurn, when setting preTokenLabel for the assistant message:
const hasRunningJob = this.toolStoresProvider?.().imageJobs?.active != null;
this.appendMessage(threadId, {
  ...,
  preTokenLabel: hasRunningJob ? 'generating' : 'thinking',
});
```

Add `'generating'` to the `preTokenLabel` union in `core/types.ts`.

**Step 3: Verify + commit**

```bash
NODE_OPTIONS="--max-old-space-size=12288" npm test
npm run typecheck
git add -A
git commit -m "feat(image-jobs): render ImageJobCard inline; add 'generating' label

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Gallery menu section

**Files:**
- Modify: `src/core/types.ts` (`MenuSectionKey` adds `'gallery'`)
- Modify: `src/services/router.ts` (`MENU_SECTIONS` adds `'gallery'`)
- Create: `src/components/menu/sections/Gallery.tsx`
- Modify: `src/components/menu/GatesMenu.tsx` (add the Gallery entry to the sidebar nav and route to the section)

**Step 1: Type + router**

```ts
export type MenuSectionKey = 'profile' | 'agent' | 'workspace' | 'settings' | 'usage' | 'local' | 'api' | 'appearance' | 'gallery';
```

Update the const list in `services/router.ts` and the `tests/services/router.test.ts` expectation.

**Step 2: Build the Gallery section**

`src/components/menu/sections/Gallery.tsx`:

```tsx
export const GallerySection = observer(function GallerySection() {
  const jobs = useImageJobStore();
  const completed = jobs.history.filter(j => j.status === 'done' && j.results.length > 0);
  const [lightboxStart, setLightboxStart] = useState<{ paths: string[]; index: number; prompt: string } | null>(null);

  if (completed.length === 0) {
    return <EmptyState>No images generated yet.</EmptyState>;
  }

  return (
    <>
      <h1>Gallery</h1>
      <div className="gallery-grid">
        {completed.flatMap(job => job.results.map((path, i) => (
          <GalleryTile
            key={`${job.id}-${i}`}
            path={path}
            prompt={job.prompt}
            onClick={() => setLightboxStart({ paths: job.results, index: i, prompt: job.prompt })}
            onOpenInOs={() => /* bridge.openWorkspacePath(path) */}
            onDelete={() => jobs.delete(job.id)}
          />
        )))}
      </div>
      {lightboxStart && <Lightbox images={lightboxStart.paths.map(p => ({path:p, alt:'gallery image'}))} startIndex={lightboxStart.index} prompt={lightboxStart.prompt} onClose={() => setLightboxStart(null)} />}
    </>
  );
});
```

**Step 3: Wire into GatesMenu**

Add a sidebar nav entry and route the new section.

**Step 4: Tests**

A focused `tests/components/menu/sections/Gallery.test.tsx` if @testing-library is wired; otherwise a minimal smoke test that the empty-state branch renders.

**Step 5: Verify + commit**

```bash
NODE_OPTIONS="--max-old-space-size=12288" npm test
npm run typecheck
git add -A
git commit -m "feat(image-jobs): Gallery menu section

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Workspace anchor interceptor

**Files:**
- Modify: `src/components/editorial/EditorialMessage.tsx` (add `a:` override in `MarkdownBody`)

**Step 1: Add the override**

In the `<ReactMarkdown components={...}>` map inside `MarkdownBody`, add:

```tsx
a: (props) => {
  const href = (props as { href?: string }).href ?? '';
  if (isWorkspacePath(href)) {
    return <WorkspacePathLink path={href} bridge={bridge} />;
  }
  return <a {...props} target="_blank" rel="noreferrer" />;
}
```

**Step 2: Test**

Add to `tests/components/editorial/EditorialMessage.test.ts` (or add a new focused file):
- Markdown `[here](/workspace/foo.png)` renders the workspace-link button, NOT a normal anchor
- Markdown `[here](https://example.com)` still renders a normal anchor

**Step 3: Verify + commit**

```bash
NODE_OPTIONS="--max-old-space-size=12288" npm test
npm run typecheck
git add -A
git commit -m "fix(chat): markdown anchor links to /workspace/ paths now open in OS viewer

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Docs sync

**Files:**
- Modify: `docs/changelog.md` (new entry at the top)
- Modify: `docs/architecture.md` (jobs section, persistence row)
- Modify: `docs/tech_spec.md` (storage row, `MenuSectionKey` value list, new Image jobs section)

**Step 1: Changelog entry**

```markdown
## 2026-04-26 — Feature: Image-gen UX overhaul

`image_generate` is now a background job. The tool returns immediately with a
job id; the chat message renders a live progress card that fills in with the
final image when the render completes. Switching threads, sending more turns,
or kicking off a second image-gen call works fine — jobs run serially in the
background.

- New `ImageJobStore` owns the queue, the active job, and a persisted
  completed-job history under `gatesai.imagejobs.v1`.
- `image_generate` accepts a new `count` arg (1–10). Multi-image jobs land as
  a uniform-height grid in the chat message; click any tile to open in the
  Lightbox with arrow navigation.
- ComfyUI progress streams over its WebSocket (`/ws`); A1111 progress polls
  `/sdapi/v1/progress` every 500ms. Both expose a Cancel button on the card.
- New **Gallery** menu section shows every completed image across threads
  with click-to-Lightbox.
- Markdown links to `/workspace/...` paths now open in the OS viewer (the
  `<a>` interceptor mirrors the existing inline-code workspace-path link).
- The system prompt now tells models not to repeat tool results in their
  prose when `image_generate` is in scope, killing the
  `{ "action": "image_generate", "result": "Saved: …" }` echo from Gemini.
- Removed the unused fal.ai cloud backend; cloud image-gen will route through
  OpenRouter when that lands. `image_generate` is local-only for now
  (ComfyUI / AUTOMATIC1111).
```

**Step 2: Architecture + tech_spec updates**

- Add `gatesai.imagejobs.v1` to the persistence tables in both docs
- Add a small "Image jobs" section to architecture.md describing the
  store + runner + progress adapter shape
- Update the `MenuSectionKey` value list in tech_spec.md to include
  `'gallery'`

**Step 3: Commit**

```bash
git add docs/
git commit -m "docs: image-gen UX overhaul

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Verification (whole plan)

```bash
npm run typecheck
NODE_OPTIONS="--max-old-space-size=12288" npm test
npm run lint
```

Expected: clean. Test count grows by ~30 (storage round-trip, store queue/cancel/history, two progress adapters, runner, tool, card, gallery, anchor).

**Manual smoke (after Task 11):**

1. Settings → Local → ComfyUI must be running with the FP8 final workflow.
2. Compose: "make me a sunset over a lake, count 3"
3. Chat shows the placeholder progress card; switch to another thread and back; the card keeps progressing.
4. When done, three thumbnails appear in a grid. Click → Lightbox opens with arrow nav.
5. Open the Gallery menu; same three images show up, newest first.
6. Click a workspace-path link in any message → opens in the OS viewer.
7. Send a `image_generate` request and click ✕ on the running card → cancellation lands cleanly, status flips to `cancelled`.

## Out of scope

- Cloud image-gen (deferred until OpenRouter image integration)
- Regenerate-with-tweaks / variant sliders / seed locking UI
- Inpainting / img2img
- `image_schedule` background scheduler tool
- Cross-device gallery sync
- OS notifications when long jobs finish
- Per-thread gallery filter (global only for v1)
