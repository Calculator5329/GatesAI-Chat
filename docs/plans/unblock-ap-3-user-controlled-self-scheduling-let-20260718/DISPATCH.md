# DISPATCH — implement AP-3 consented self-scheduling

Read [PLAN.md](./PLAN.md) first; it is the authoritative approved execution
contract. This task replaces the live legacy scheduler by wiring the already-
tested `agentSchedules`/`ScheduleLedger` foundation into AP-2's durable agent
task ledger and adding the selected proposal/management surfaces.

## Task spec

- **title:** AP-3 — consented self-scheduling on the AP-2 task ledger
- **model tier:** smart
- **depends on:** AP-2 source implementation merged and green. Do not dispatch
  concurrently with AP-2; rebase onto its verified result before claiming the
  paths below.
- **goal:** |
    Implement
    `docs/plans/unblock-ap-3-user-controlled-self-scheduling-let-20260718/PLAN.md`
    exactly.

    Replace the live `core/schedules` + active-on-tool-call v1 path with a
    MobX `SchedulesStore` wrapper around the existing schema-v2
    `agentSchedules` and `ScheduleLedger` modules. Keep one 30-second timer.
    Every due wake must enqueue one ordinary AP-2 `AgentTaskSpec` through the
    verified AP-2 TaskStore facade; never call the old loose spawn path, create
    another run queue, or switch provider/model.

    Before persistence, correct the unwired schema-v2 foundation as PLAN.md
    specifies: nullable route only for migrated `needs_review`; preserve
    `legacy_model_id`; add origin thread, revision/consented revision,
    activation anchor, and recoverable `archived_at`; bind approval to an
    expected revision/canonical definition; delays begin at activation; a past
    once-at cannot activate; archive preserves the record and audit.

    Add `gatesai.schedules.v2` ledger persistence. If v2 is absent, read v1
    once and migrate every legacy schedule paused as `needs_review`, with no
    fabricated default route and no automatic catch-up. Leave the v1 key
    intact. Reconcile orphaned wakes as interrupted, never replayed.

    Replace the model tool actions with inert `propose` and read-only `list`.
    The model cannot approve/edit/pause/run/archive. `propose` emits a persisted
    `{kind:'schedule-proposal', scheduleId, revision}` tool artifact. Add an
    inline approval card plus the selected compact Agent-menu surface, both
    projecting the same schedule. Show exact route, local+UTC time/timezone,
    grants, pins, catch-up, per-wake/runtime/round/token/wake caps, next wake,
    last result/skip, and “Runs only while GatesAI is open.” Implement stale-
    revision rejection, pause/edit/run-now/recoverable archive, and global
    pause. User form Save is explicit consent; broadening edits require renewed
    consent.

    Implement action-scoped unattended grants. Read-only whole tools may use
    their tool ID; mixed tools use `<tool>.<action>`. Derive the AP-2 base tool
    allowlist, then enforce the exact grant again before tool execution.
    Scheduled public posting, deploy, purchase, secret access, permanent
    deletion, OS-critical mutations, nested spawning, schedule approval/
    creation, and unclassified dynamic mutations are hard-denied even if
    persisted state asks for them. Tests must prove denied calls have zero
    side effects.

    Preserve default/hard rails: 4 wakes per schedule per rolling 24h, 24
    global; `$0.50` cloud per wake, AP-2 `$5` daily and `$100` hard ceiling;
    no overlap; one catch-up at most; unknown-price cloud routes cannot run
    unattended. Slot waiting enqueues once and never mints retry wakes.

    Web Lite renders honest desktop-only state and never ticks, approves,
    runs-now, enqueues, or invokes a provider/bridge for schedules. Use in-app
    aria-live/task status; do not add OS notification permissions.

    Add the complete PLAN.md test matrix. Update architecture, handbook
    capabilities, and changelog. Do not edit `docs/roadmap.md`; the harvesting
    session closes the Item.
- **owns:**
    - src/core/agentSchedules.ts
    - src/core/schedules.ts
    - src/core/types.ts
    - src/services/tasks/scheduleLedger.ts
    - src/services/tasks/types.ts
    - src/services/schedulesStorage.ts
    - src/services/tools/schedules.ts
    - src/services/tools/types.ts
    - src/services/tools/registry.ts
    - src/services/persistence.ts
    - src/services/chat/toolBatchExecutor.ts
    - src/services/chat/libraryExport.ts
    - src/stores/SchedulesStore.ts
    - src/stores/TaskStore.ts
    - src/stores/RootStore.ts
    - src/components/menu/sections/Agent.tsx
    - src/components/editorial/activity/ActivityRow.tsx
    - src/components/editorial/activity/ScheduleProposalCard.tsx
    - src/components/dock/TaskCenterPanel.tsx
    - src/styles/menu.css
    - tests/core/agentSchedules.test.ts
    - tests/core/schedules.test.ts
    - tests/services/tasks/scheduleLedger.test.ts
    - tests/services/schedulesStorage.test.ts
    - tests/services/tools/schedules.test.ts
    - tests/services/tools/registry.test.ts
    - tests/services/chat/toolBatchExecutor.test.ts
    - tests/services/libraryExport.test.ts
    - tests/stores/SchedulesStore.test.ts
    - tests/stores/TaskStore.test.ts
    - tests/stores/RootStore.ollama.test.ts
    - tests/components/menu/AgentSchedules.test.tsx
    - tests/components/editorial/ScheduleProposalCard.test.tsx
    - tests/components/editorial/ActivityRow.test.tsx
    - tests/components/dock/TaskCenterPanel.test.ts
    - tests/services/persistence.test.ts
    - tests/e2e/schedules.spec.ts
    - tests/e2e/fixtures/harness.ts
    - docs/architecture.md
    - docs/handbook/capabilities.md
    - docs/changelog.md
- **test-cmd:** `npm run ci && npm run test:e2e`

## Acceptance essentials

- Agent proposals are persisted but inert until a user approves the exact,
  current revision; stale cards and past one-shot times cannot activate.
- User Save carries explicit consent; broadening edits return to consent;
  pause/lower/archive do not broaden authority.
- Legacy v1 records migrate intact to paused review with no default route; the
  v1 key remains recoverable.
- Archive never deletes. Delay anchors at activation. DST gap/ambiguity and
  timezone display are deterministic and audited.
- One tick creates one AP-2 task. Waiting slots, overlap, missed intervals, and
  restart never create duplicates or fan-out catch-up.
- Exact route/pins/grants/caps survive into the immutable task policy. Missing
  route/plugin/grant/budget produces a distinct visible state and zero provider
  or tool side effects; no fallback route exists.
- Default/hard wake and spend rails are enforced. Terminal cost/result updates
  the originating wake and links Task Center back to the schedule.
- Action-scoped grant tests cover safe read, explicitly approved workspace
  write, ungranted mutation, and every hard-denied class.
- Inline and Agent-menu cards display exact approval facts and app-open-only
  truth; global pause is always visible; Web Lite performs zero automation.
- `npm run ci` and `npm run test:e2e` are green; no second timer/queue,
  dependency, Rust/Tauri/bridge/sibling-repo, secret, deploy, or roadmap change.

## Dispatcher notes

- No Ethan decision remains; `APPROVED` is authoritative.
- This is a large sequential integration. The orchestrator may split it along
  PLAN.md's five ordered slices, but must preserve dependency order and cannot
  run overlapping slices or AP-2 concurrently.
- Reconcile the exact post-AP-2 TaskStore facade after rebasing; adapting the
  method name is allowed, bypassing the AP-2 ledger is not.
- Playwright requires the normal outside-sandbox verifier because Codex cannot
  bind the Vite listener. Do not weaken or skip it.
