# Image-gen UX overhaul — design

## Goal

Make `image_generate` feel like a proper background job with live feedback,
multi-image support, a gallery, and chat-friendly rendering. Stop blocking the
assistant turn while a render is in flight, fix the broken workspace path
links in markdown, and remove the unused fal.ai cloud backend (we'll route
cloud image-gen through OpenRouter later).

## Architecture

Image generation detaches from the chat turn. The tool no longer waits for
pixels — it enqueues a job, returns immediately, and the chat message renders
a live placeholder card that observes the job and flips to the final image
when done. Switching threads, sending more turns, or even kicking off a second
image-gen call is fine — the queue just lines them up.

```
ChatStore.runTurn → tool: image_generate
  ↓
image_generate → ImageJobStore.enqueue({ prompt, dims, seed, count, … })
  returns immediately with { jobId, count }
  ↓
ImageJobStore (serial queue, single runner)
  ↓
JobRunner → existing dispatcher (local-comfy or local-a1111)
  ↓ progress events
job.progress = { value, max, eta? }   // MobX-observable
  ↓
ImageJobCard observes the job, renders progress / final image
```

## Components

### `ImageJobStore` (new)

MobX store under `src/stores/`. Owns:

- `queue: ImageJob[]` — pending jobs, FIFO
- `active: ImageJob | null` — the one currently rendering
- `history: CompletedJob[]` — completed (incl. failed) jobs, sorted newest-first, persisted
- `enqueue(input): { jobId, count }` — adds a job, kicks the runner if idle
- `cancel(jobId)` — aborts the active job (if it matches), removes from queue otherwise
- `delete(jobId)` — removes from history (doesn't delete the file)
- `findById(jobId): ImageJob | CompletedJob | null`

Strict serial: one runner. The runner pulls the head of the queue, dispatches,
streams progress events back into `active.progress`, writes the file via the
bridge, moves the job to `history`, repeats.

### Job lifecycle

```ts
type ImageJobStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

interface ImageJob {
  id: string;
  threadId: string;          // back-pointer for gallery filtering
  prompt: string;
  count: number;
  width: number;
  height: number;
  seed?: number;
  backend: ImageBackendId;
  status: ImageJobStatus;
  progress?: { value: number; max: number };  // running only
  results: string[];         // workspace paths, one per completed image in the batch
  error?: string;            // failed only
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}
```

### Per-backend progress adapters (new)

- `services/image/jobs/comfyProgress.ts` — opens a WebSocket to ComfyUI's
  `/ws`, listens for `progress` events (`{value, max}`), forwards them to the
  runner. Closes when the prompt completes. Cancel calls `/queue` interrupt.
- `services/image/jobs/a1111Progress.ts` — polls `/sdapi/v1/progress` every
  500ms while the job is in flight. Cancel calls `/sdapi/v1/interrupt`.

Both implement a small `JobProgress` interface so the runner doesn't care
which backend it's wrapping.

### Tool-result artifact contract

`ToolResultArtifact` gains a second variant:

```ts
type ToolResultArtifact =
  | { kind: 'image'; path: string; mime: string }
  | { kind: 'image-job'; jobId: string; count: number };
```

`image_generate` now returns an `image-job` artifact (jobId + expected count).
The renderer observes `imageJobs.findById(jobId)` and dispatches on status.

The legacy `'image'` kind stays — it's still useful for tools that produce
images synchronously and don't want to go through the job queue.

### `ImageJobCard` (new component)

Replaces the current `WorkspaceImage` thumbnail for image_generate output.

- **Running**: placeholder at the requested aspect ratio, thin progress bar
  (`generating · 47% · ComfyUI`), small ✕ cancel button.
- **Done, 1 image**: big inline image (max-width fills the message column,
  ~600px), click → Lightbox.
- **Done, N images**: uniform-height grid, click any → Lightbox with arrow nav.
- **Failed**: muted card, error message, ↻ retry button (re-enqueues with the
  same args).
- **Cancelled**: muted card, "cancelled" label, ↻ retry button.

### `Lightbox` (new component)

- Black backdrop, fits image with 24px margin
- ESC / backdrop click to close
- Multi-image: arrow keys + on-screen `‹ ›`
- Footer: truncated prompt + `↗` "open in OS"

### `Gallery` menu section (new)

`MenuSectionKey` gains `'gallery'`. New `src/components/menu/sections/Gallery.tsx`:

- Grid of completed jobs across all threads, newest first
- Each tile: thumbnail + 1-line prompt
- Click → Lightbox
- Hover row: `↗` (open in OS) and `🗑` (delete from history)
- Empty: "No images generated yet."

### "Generating" pre-token label

When the assistant is mid-stream AND there's a running job whose `threadId`
matches the active thread, swap the existing `thinking` label to `generating`.
Same visual treatment, just the word changes.

## Data flow

**Sending a turn that calls `image_generate`:**

1. Model emits `image_generate` tool call.
2. Tool reads `args` → `imageJobs.enqueue({...})` → returns `{ jobId, count }`
   immediately.
3. Tool result content for the model: `"Queued image render (job <id>)"`.
   Tool result artifacts: `[{ kind: 'image-job', jobId, count }]`.
4. Chat message renders → `ImageJobCard` looks up the job, shows the running
   placeholder.
5. Runner picks up the job, dispatches to ComfyUI/A1111, streams progress.
6. On completion, runner writes file(s) via `bridge.fs.write`, sets
   `job.status='done'` and `job.results=[paths]`, moves to `history`,
   pulls next pending job.
7. Card re-renders → big inline image(s).

**User cancels:**

`ImageJobCard.X` → `imageJobs.cancel(jobId)`. If the job is `active`, runner's
`AbortController` fires + backend-specific interrupt is sent. If pending,
just removes from queue. Job moves to `history` with `status='cancelled'`.

**Switching threads mid-render:**

Nothing happens — the runner is store-owned. The card on the *other* thread
keeps observing the job and updates regardless.

## Markdown anchor interceptor

`MarkdownBody` already routes inline `<code>` to `WorkspacePathLink` when the
text matches `isWorkspacePath`. We add an `a:` override that does the same for
`<a href="/workspace/…">`: render a button that calls
`bridge.openWorkspacePath(href)` instead of a normal anchor. External
`http(s)://` links unchanged.

## System prompt addendum

When `image_generate` is in scope for the turn, the system prompt gains:

> When you call `image_generate`, don't repeat the tool result back. The user
> already sees the image. Just say briefly what you made.

This stops models like Gemini from echoing `{action, result}` JSON in their
prose.

## Cleanup: remove fal.ai

You're done with fal as a cloud image-gen path. OpenRouter image-gen will
land later as the cloud backend.

- Delete `src/services/image/fluxClient.ts` and its test
- `ImageBackendId` shrinks from `'fal' | 'bfl' | 'local-comfy' | 'local-a1111'`
  to `'local-comfy' | 'local-a1111'`
- Drop `falApiKey`, `bflApiKey`, `defaultVariant`, `FluxVariant` from snapshot,
  storage, store, tool snapshot
- Remove FalBackendFields, BFL option, cloud-fallback dropdown from
  `ImageGenCard`
- Drop the `variant` arg from `image_generate` tool schema
- Drop the fallback path in `dispatchImageGenerate`; on local failure, the
  tool result is just the error
- Update tool description ("Generate an image using the configured local
  backend (ComfyUI or AUTOMATIC1111)")

## Persistence

| Key                         | Shape                          | Owner            |
| --------------------------- | ------------------------------ | ---------------- |
| `gatesai.imagejobs.v1`      | `{ history: CompletedJob[] }`  | `ImageJobStore`  |

Only `history` persists. Pending and active jobs disappear on restart — if
the user closes the app mid-render, the local backend already lost the
request and trying to resume is fragile.

## Error handling

- **Backend offline / unreachable**: enqueue still succeeds (we don't probe
  on enqueue); the runner fails, marks `status='failed'`, error string lands
  on the card with a retry button.
- **Bridge offline**: enqueue fails synchronously with a clear tool-result
  string; no card is created. Same UX as today.
- **Cancel mid-flight**: `status='cancelled'`, no error.
- **App reload mid-job**: lost; user retries from gallery or composer.
- **Disk write fails**: `status='failed'` with the bridge error.

## Testing

- `tests/stores/ImageJobStore.test.ts` — enqueue, runner serial behavior,
  cancel (active and pending), persistence rehydrate.
- `tests/services/image/jobs/comfyProgress.test.ts` — WS frame parsing,
  progress event mapping, interrupt.
- `tests/services/image/jobs/a1111Progress.test.ts` — polling cadence,
  interrupt.
- `tests/services/tools/imageGenerate.test.ts` — verify tool now enqueues
  instead of awaiting; result content + artifacts shape.
- `tests/components/editorial/ImageJobCard.test.ts` — running / done /
  failed / cancelled states.
- `tests/components/menu/sections/Gallery.test.ts` — empty state, populated
  state, delete.
- Existing `flux*` tests deleted as part of the fal removal.

## Out of scope

- Cloud image-gen (deferred until OpenRouter image-gen integration)
- Regenerate-with-tweaks UI (variant sliders, seed locking)
- Inpainting / img2img
- `image_schedule` background scheduler tool (gallery-batch is covered by
  `count` on `image_generate`)
- Cross-device gallery sync
- OS toast / notification when a long job finishes
- Per-thread gallery filter (global gallery only for v1)
