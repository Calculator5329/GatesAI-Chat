# AP-3 — user-controlled self-scheduling execution plan

Date: 2026-07-18  
Decision input: **APPROVED**  
Canonical Item: `docs/roadmap.md` → **AP-3 — User-controlled self-scheduling**  
Story source: [`../07-16-agentic-platform-design.md`](../07-16-agentic-platform-design.md#story-ap-3--self-scheduling-with-visible-wakes)  
Implementation handoff: [DISPATCH.md](./DISPATCH.md)

This is a design-and-dispatch deliverable. The leased lane may write only this
folder, so it intentionally makes no runtime or roadmap change.

## Outcome

Agents may propose one-shot, delayed, interval, and daily wakes, but an agent
proposal is inert until the user approves the exact route, instructions,
timezone, tool/data grants, cadence, catch-up choice, and caps. User-created
schedules are consented by their explicit Save action. A due wake enqueues one
ordinary AP-2 `AgentTaskSpec`; the existing two agent slots, linked runner
thread, task ledger, cancellation, route validation, and budgets own execution.

The result is intentionally honest automation:

- it works only while GatesAI is open (including minimized/tray-resident);
- closing the process stops timers and never claims an OS wake;
- launch catch-up is `skip` or at most one coalesced run;
- a schedule never overlaps itself or silently switches provider/model;
- every proposal, wake, skip, result, cap stop, and edit-consent transition is
  visible and locally persisted.

Roadmap disposition: keep AP-3 open until the follow-up source task is verified.
The harvesting session, not this lane, owns the checkbox transition.

## Corrected baseline

AP-3 is integration and replacement work, not green-field scheduling.

### Live legacy path

- `src/core/schedules.ts`, `src/stores/SchedulesStore.ts`,
  `src/services/schedulesStorage.ts`, and `src/services/tools/schedules.ts`
  implement recurring interval/daily schedules in `gatesai.schedules.v1`.
- The model can currently create an **active** schedule, delete it, and run it
  immediately without a separate consent step.
- Route selection is a loose optional model ID; there is no persisted provider,
  locality, grants, consent, per-wake spend, wake cap, DST audit, or global
  pause.
- The store starts work directly with `ChatStore.spawnTask()`. It does not hand
  a policy snapshot to the TaskStore/AP-2 ledger.
- The Agent menu says app-open-only, but its delete confirmation says the
  action cannot be undone. That conflicts with the workspace no-permanent-
  deletion rule and AP-3's required **archive** action.

### Shipped but unwired AP-3 foundation

- `src/core/agentSchedules.ts` already defines schema-v2 triggers, consent
  states, exact route/data/tool/cap fields, DST-aware calculations, v1
  migration, wake caps, and policy projection.
- `src/services/tasks/scheduleLedger.ts` already implements proposal/activation,
  edit re-consent, pause/resume, global pause, overlap prevention, one catch-up,
  wake audit, spend lock, run-now, and `AgentTaskSpec` creation.
- Their unit tests are green, but no store, persistence provider, tool, menu,
  TaskStore, or runtime constructs these modules. The legacy system remains the
  only live path.

### Required dependency

AP-3 source integration starts **after AP-2's source implementation is merged**.
AP-2 supplies the durable agent-task spec/attempt ledger, exact-route launch,
budget enforcement, FIFO two-slot queue, and a public store facade that accepts
an `AgentTaskSpec`. AP-3 must call that facade. It must not recreate AP-2 inside
`SchedulesStore`, call the old loose `spawnTask()` path, or run concurrently on
the same AP-2-owned files.

If AP-2's final facade name differs from this plan's illustrative
`TaskStore.enqueueAgentSpec(spec, source)`, adapt to that verified API while
preserving the invariant: **one ScheduleLedger tick → one ordinary AP-2 task
enqueue → no second run queue**.

## Product and interaction contract

### Creation and consent

1. The model-facing `schedules.propose` action validates and persists a
   schedule with `created_by: "agent"`, `consent_state: "proposed"`, and no
   consent reference. It returns a structured `schedule-proposal` artifact.
   It cannot approve, pause, edit, run, or archive schedules.
2. The inline proposal card and Agent-menu proposal card show the same durable
   definition: instructions, normalized local and UTC wake, timezone, exact
   provider/model/locality, skill/data pins, action-scoped tool grants, catch-up,
   runtime/round/token/spend caps, wake cap, and “Runs only while GatesAI is
   open.”
3. `Approve schedule` supplies the card's expected revision. The store mints a
   consent record bound to that revision and canonical definition. A stale card
   cannot approve a subsequently edited proposal.
4. A user-created form may save directly to `active`: the explicit Save action
   is the consent event and displays the same summary before commit.
5. Rejecting a proposal archives it with an audit reason; it does not erase it.

### Ongoing controls

- `Pause` and the always-visible `Pause all` stop future enqueues immediately.
  They do not cancel an already running AP-2 task; that task is cancelled from
  Task Center.
- `Resume` is allowed only while the persisted consent still covers the exact
  current revision and no budget lock is active.
- `Edit` compares the old and new authority. Instructions, route, skill/data
  pins, any new action grant, faster/changed cadence, enabling catch-up, or a
  raised limit returns the schedule to `needs_consent`. Rename, pause, archive,
  slower cadence, removal of grants/pins, and lower limits do not broaden
  authority.
- `Run now` is a user-only action. It uses the current exact policy snapshot,
  requires valid consent and route, respects global pause, overlap, daily spend,
  the hard spend ceiling, and the per-wake cost cap. It may bypass the natural
  due time, but **not** safety/budget rails or the AP-2 slot queue.
- `Archive` is recoverable. It sets `archived_at`, disables future wakes, keeps
  its audit/results, and moves it to a collapsed Archive view. No schedule UI
  or tool permanently deletes a definition.

### Visual choice

The required six-layout visual round is preserved at
[mockups/schedule-layouts.png](./mockups/schedule-layouts.png); the exact prompt
and selection record are in [MOCKUP-PROMPT.md](./MOCKUP-PROMPT.md).

Use variant A for the Agent menu and variant F for conversation-inline
approval. At 11pm, the default surface is a short list, not an automation
dashboard: pending consent is amber and prominent; active schedules are quiet;
route/cadence/next wake are visible; deeper grants and caps expand on demand;
red is reserved for failed/budget-stopped states. Cron syntax is never the
primary interface.

```text
Agent · Schedules                                      [Pause all]

Pending approval
┌ Daily research digest                         Pending approval ┐
│ Every day · 9:00 AM · America/Chicago                    │
│ Ollama · qwen2.5:7b · local · $0.50/wake · 4/24h         │
│ Read files, web search · skip missed wakes                │
│ Runs only while GatesAI is open                           │
│ [Review details]                         [Approve schedule] │
└──────────────────────────────────────────────────────────┘

Active schedules
  Morning brief · next tomorrow 7:30 AM          Pause Edit Run now Archive
```

## Durable schema adjustments before wiring

The current schema-v2 code is unwired, so make the following compatibility and
safety corrections before it becomes persisted state:

- `route` is nullable only for migrated `needs_review` records. V1 schedules
  without an exact provider/locality must not receive a fabricated default
  route. Preserve their old optional model as `legacy_model_id`; the review
  form requires a valid exact route before activation.
- Add `origin_thread_id?: string` so an agent proposal and wake result can link
  to the originating conversation. A user form uses the active ordinary thread
  or creates one through the existing chat facade. Never put a schedule ID in
  `AgentTaskSpec.origin_thread_id`.
- Add monotonically increasing `revision` and `consented_revision?: number`.
  Activation accepts an expected revision and binds the consent reference to
  its canonical normalized definition. Any authority-broadening edit increments
  the revision and clears `consented_revision`.
- Add `activated_at?: number`. A `delay` begins when consent activates the
  schedule, not when an agent first proposed it. A direct user Save sets
  `activated_at = created_at`. An already-past `once-at` proposal cannot be
  approved until the user changes the time.
- Add `archived_at?: number` and retain archived records. Replace the ledger's
  current destructive `archive()` removal with a state transition.
- Preserve `last_result_task_id`, wake/skip audit, global pause, spend locks,
  and in-flight links in the snapshot. Restore marks an orphaned in-flight task
  interrupted; it never silently replays it.

Keep `AGENT_SCHEDULE_SCHEMA_VERSION = 2`: these additions precede any live v2
writer. The storage envelope remains separately versioned by
`ScheduleLedgerSnapshot.schema_version`.

## Action-scoped unattended tool grants

Tool names alone are too broad for mixed tools such as `fs`, `notes`, `git`,
and `thread`. AP-3 therefore treats `allowed_tools[]` as stable grant IDs:

- a read-only whole-tool grant uses the tool name, e.g. `web_search`,
  `fetch_page`, `recall`, `inspect_file`, or `library_search`;
- a mixed-action grant uses `<tool>.<action>`, e.g. `fs.read`, `fs.list`,
  `fs.stat`, `fs.search`, `notes.read`, `notes.search`, or an explicitly
  consented `fs.write`;
- the AP-2 task's base tool-definition allowlist is the distinct tool-name
  projection, while the batch executor checks the exact grant ID again against
  the actual call arguments **before execution**.

Default proposals expose read-only calls only. The approval card spells out
every mutation grant, not merely “workspace access.” V1 hard-denies scheduled
calls that publish externally, deploy, purchase, access secrets, perform
permanent deletion, change OS-critical state, spawn nested tasks, create or
approve another schedule, or use an unclassified dynamic/MCP mutation. These
remain blocked even if a malformed persisted grant asks for them.

Add one service-layer classifier using existing `ToolMetadata.isReadOnly` /
`hasSideEffects` plus exact action enums. Do not scatter string checks across
the store and components. Tests must prove an ungranted or hard-denied action
returns a typed failure and performs zero tool side effects.

## Runtime architecture

```text
agent tool / user form
        │
        ▼
SchedulesStore ── create/propose/approve/edit/archive
        │
        ▼
ScheduleLedger + gatesai.schedules.v2
        │  tick (one 30s timer, launch flag once)
        ▼
AgentTaskSpec + schedule source/revision/grants
        │
        ▼
AP-2 TaskStore enqueue + exact-route/policy validation
        │
        ▼
ChatStore / TurnRunner linked task thread
        │
        └── terminal outcome/cost ──► ScheduleLedger.recordWakeOutcome
```

`SchedulesStore` owns one timer and wraps `ScheduleLedger` in MobX actions and
computed projections. It receives narrow dependencies for clock, persistence,
route resolution, TaskStore enqueue, task lookup/outcome subscription, tool
grant classification, and runtime mode. It never invokes providers directly.

At boot:

1. Load `gatesai.schedules.v2`; if absent, read v1 once and migrate every record
   paused as `needs_review`, with no default route and no automatic catch-up.
2. Persist the v2 envelope to the new key. Leave the v1 key intact as a
   recoverable source; never erase it automatically.
3. Reconcile orphaned wake/task links to `interrupted`.
4. Call exactly one `tick(now, { launch: true })`. `catch_up: once` may enqueue
   one coalesced wake per eligible schedule; `skip` records the missed reason
   and advances. Subsequent 30-second ticks use `launch: false`.

When AP-2 returns `waiting_for_slot`, retain the single enqueued task and do not
mint another wake, increment retry counters, or charge a wake again. When exact
route, plugin pin, consent, grants, wake cap, or budget validation fails, append
a distinct skip/pending reason and never substitute a route. Completion updates
the same wake event with terminal state/cost and links the task/result thread.

## Persistence, rendering, and Web Lite

- `gatesai.schedules.v2` stores the ledger snapshot. The v1 parser remains
  read-only migration code with tests.
- Add `{ kind: "schedule-proposal", scheduleId, revision }` to
  `ToolResultArtifact`; persist and export the reference without embedding the
  full instructions or policy twice. The card reads current state by ID and
  rejects stale revision approval.
- The Agent menu shows pending/needs-review/active/paused/budget-locked/archive
  groups; route, next wake with timezone, last result, last skip, and wake/task
  history are accessible. Task Center shows each fired wake as the AP-2 agent
  task with a link back to its schedule.
- Use in-app `aria-live` notices and Task Center state for fired, skipped,
  waiting, completed, failed, budget-stopped, and consent-expired events. Do not
  add an OS-notification permission or claim native wake support in this Item.
- Web Lite may render persisted/exported proposal metadata and the honest
  desktop-only explanation, but `SchedulesStore.start`, tick, approve, run-now,
  and TaskStore enqueue are disabled there. It performs no provider/bridge
  request for unattended automation.

## Ordered implementation slices

1. **Foundation corrections + v2 persistence.** Make route migration nullable,
   add origin/revision/activation/archive state, make archive recoverable, add
   storage-envelope migration, and extend pure/service tests.
2. **AP-2 wiring.** Replace the live legacy store with a MobX wrapper over
   `ScheduleLedger`; inject the AP-2 enqueue/outcome facade; handle slot, route,
   boot, catch-up, overlap, cap, spend-lock, and result linkage.
3. **Tool grants + proposal tool.** Add action-scoped grant classification and
   executor enforcement; replace model mutations with `propose` + `list`; add
   the proposal artifact and persistence/export handling.
4. **User surface.** Implement selected A/F layouts, exact approval summary,
   stale-revision rejection, pause/edit/run-now/archive/global pause, audit and
   last-result links, keyboard/ARIA behavior, desktop/Web Lite copy.
5. **Acceptance and docs.** Run the unit/component gate, desktop-mocked E2E,
   full E2E outside the sandbox, then update architecture, handbook capability
   truth, and changelog. The harvest lane updates the roadmap.

Slices are sequential because they overlap core/store files. Keep every slice
green; do not run this source task concurrently with AP-2 integration.

## Required test matrix

### Pure timing and consent

- once-at, delay-from-activation, interval, and daily triggers;
- local/UTC display and IANA timezone validation;
- spring-forward gap advances with audit reason; fall-back ambiguity fires once;
- agent proposal cannot fire; stale revision cannot activate;
- broadening edit requires new consent; narrowing/pause/archive does not;
- archived schedules remain persisted and restorable.

### Migration and restart

- v1 migrates to disabled `needs_review`, preserves title/instructions/cadence/
  catch-up/legacy model, and never chooses a default route;
- v1 key remains intact after v2 save;
- future/invalid envelope fails closed without overwriting recoverable data;
- launch catch-up produces zero (`skip`) or one (`once`) wake, never N missed
  intervals; orphaned in-flight work becomes interrupted, not replayed.

### TaskStore and caps

- each due wake enqueues exactly one ordinary AP-2 spec with exact route,
  canonical policy snapshot, origin thread, grants, pins, caps, consent, and
  schedule/revision linkage;
- two-slot exhaustion produces one waiting task and no duplicate wake;
- overlap, per-schedule 4/24h default, global 24/24h hard cap, `$0.50` default
  per-wake cap, `$5/day`, and `$100` hard ceiling fail closed with distinct UI
  reasons; unknown-price cloud routes cannot activate unattended;
- route/plugin/grant unavailability performs zero provider/tool calls and never
  falls back; terminal cost/result updates the original wake.

### Tool and UI

- model `propose` creates inert state plus one persisted proposal artifact;
- the model cannot approve, run-now, archive, or broaden a schedule;
- default grants permit only read-only calls; exact approved `fs.write` works;
  ungranted and permanently forbidden actions perform zero side effects;
- inline and Agent-menu approval cards show exact route/timezone/grants/caps and
  app-open limitation; stale approval is rejected visibly;
- pause/edit/run-now/archive/global pause and last-result navigation work;
- dark/light and narrow layout remain legible; keyboard focus and `aria-live`
  states are covered;
- Web Lite shows honest unavailable copy and performs zero wake/enqueue calls.

### Full gates

`npm run ci` and `npm run test:e2e` pass. No Rust/bridge change is required.
Playwright needs the orchestrator's outside-sandbox verifier because the Codex
sandbox cannot bind the Vite listener; do not weaken the test.

## Explicit non-goals

OS wake timers, login autostart, powered-off/logged-out execution, a background
daemon, calendar/event/webhook triggers, quiet-hours automation, cloud schedule
sync, remote workers, task DAGs, schedule-created nested tasks, public posting,
deploy/purchase/secret/OS-critical automation, permanent deletion, or silent
provider switching. Each requires separate scope and (where applicable) a new
threat model.

## Definition of done

1. The legacy active-on-tool-call scheduler is no longer live; existing v1
   definitions are reviewable but cannot run until explicitly consented.
2. Every approved wake is an ordinary AP-2 task with exact route, immutable
   policy, action-scoped grants, caps, audit, and result linkage.
3. Proposal/approval, pause/edit/run-now/recoverable archive, global pause,
   catch-up, DST, overlap, and budget behavior pass the matrix.
4. Desktop and Web Lite tell the truth; no second timer/queue, dependency,
   bridge/Rust/sibling-repo, secret, deploy, or roadmap edit is introduced.
5. Architecture, handbook capabilities, and changelog are updated after green
   verification; the harvesting session may then close AP-3.

