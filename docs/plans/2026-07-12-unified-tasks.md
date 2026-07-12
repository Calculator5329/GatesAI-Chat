# W-3 implementation plan — unified background-task framework

Parent design: `2026-07-12-workbench-vision-design.md` (Phase 3). Strategy:
strangler around `ImageJobStore` — its lifecycle (queue → active → history,
persist/recover/cancel/retry, cost, terminal notification) is already the
right shape. Do NOT rewrite it first; generalize around it, then fold.

## Step 1 — Task ledger (read-only unification)

- `src/services/tasks/types.ts`: `TaskKind = 'image' | 'agent' | 'command'`;
  `TaskView` = the ImageJob shape promoted (id, kind, title, threadId?,
  status, progress?, results, error?, timestamps, costUsd?).
- `TaskStore` v1 is a **facade**: adapts `ImageJobStore` (queue/active/
  history → `TaskView[]`) and the existing spawn-task/agent runs into one
  observable ledger. Zero behavior change; ImageJobStore's 22 tests
  untouched.
- Dock "Task center" panel (W-1 registry kind `task-center`): live list
  grouped by state, progress bars, cancel/retry/cost, click-through to the
  producing thread. Replaces scroll-hunting for image cards.

## Step 2 — Agent tasks as first-class

- Promote `spawnTask`/`agentTasks` runs into the ledger with real lifecycle
  events (running/round N/done/failed), per-kind concurrency cap (agents:
  2), and boot recovery using the interrupted-job pattern (mark orphaned
  runs failed with a retry affordance).
- Terminal events log structured payloads to the error trail on failure,
  same as image dispatch.

## Step 3 — Command tasks (design now, ship behind the bridge)

- `command` kind = a long-running allowlisted command with live output.
  Reuses `ExecStreamStore`'s streaming; the task ledger entry owns
  cancel (bridge kill op). Exec allowlist + path jail unchanged; every
  command task is user-visible in the task center while it runs.
- Bridge gap: needs a kill/stream-detach op — file as a `../gatesai-bridge`
  roadmap item (sibling-repo rule; not part of this repo's lane).

## Step 4 — Fold (only after 1–3 are stable)

- Move the generic queue/history/persistence into `TaskStore`; `ImageJobStore`
  becomes the image runner plugged into it, public surface preserved until
  UI callers migrate, then deprecated. Persistence schema change ships with a
  migration + tests (`schemaVersion` bump) per repo rules.

## Non-goals (v1)

Cross-thread task dependencies, scheduling (SchedulesStore stays separate),
remote workers, task priorities beyond FIFO-per-kind.

## Tests / done

TaskStore facade mapping tests (image jobs mirror correctly), agent-task
lifecycle + recovery tests, task-center panel render test, e2e: image job
appears and completes in the task center. Architecture doc section, changelog,
roadmap tick per step — steps 1–2 are one lane, 3–4 are their own.
