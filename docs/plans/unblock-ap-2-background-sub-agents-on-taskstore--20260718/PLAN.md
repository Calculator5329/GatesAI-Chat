# AP-2 — background sub-agents on TaskStore (execution plan)

*Roadmap Item: "AP-2 — Background sub-agents on TaskStore. Make agent runs
durable." Ethan's decision: **APPROVED** (authoritative, verbatim). Story
context: [`../07-16-agentic-platform-design.md`](../07-16-agentic-platform-design.md#story-ap-2--background-sub-agents-on-taskstore).
Foundation: W-3 unified TaskStore, [`../2026-07-12-unified-tasks.md`](../2026-07-12-unified-tasks.md).*

This is a **design + dispatch** deliverable. It requires source changes, so the
implementation is specified here and handed off as `DISPATCH.md` in this folder.
Per lease rules, no source or roadmap file is touched by this lane.

## Outcome

Background agent runs become **durable, first-class tasks** backed by a
persisted spec + policy snapshot, with a **fail-closed exact route** (no silent
provider/model substitution), **live budget enforcement** (round / token /
runtime / spend), and full task-center visibility of route, grants, budget, and
consent — all inside W-3's existing two-slot cap, linked threads, and
cancel/retry/interruption. No parallel queue, no second timer.

## Corrected baseline — two disjoint systems exist today

The single most important fact driving this plan: the repo already contains
**two systems**, and AP-2 is mostly **wiring**, not green-field authoring.

- **System A — LIVE (thread-based).** Agent tasks are `Thread`s flagged
  `agentTask: true`, run by `ChatStore` + `TurnRunner`, projected read-only by
  the strangler-facade `TaskStore`. This is what executes today.
  - `ChatStore.spawnTask` (`src/stores/ChatStore.ts:581`) writes loose thread
    fields (`agentTaskStatus`, `agentTaskMaxRounds`, `agentTaskSystemPrompt`,
    `agentTaskScheduledStartAt`, `agentTaskOriginThreadId`). Threads persist, so
    live agent tasks **are durable across restart** — but only as loose fields.
  - `resolveAgentTaskModelId` (`ChatStore.ts:710`) **falls through** an
    unavailable requested model → origin model → background/default model. This
    is exactly the silent substitution AP-2 forbids.
  - Round caps are enforced (`turnRunner.ts:215` loop; clamp ≤10 in
    `agentTasks.ts:5-6`). Cost is **display-only** (`TaskStore.ts:125` reads
    `threadLlmSpendUsd`); no token/runtime/spend limit halts a run.
  - Two-slot cap `MAX_CONCURRENT_AGENT_TASKS = 2` (`agentTasks.ts:4`), enforced
    at spawn/retry/schedule. Origin↔result linking and boot recovery
    (`reconcileAgentTasksOnBoot`, `ChatStore.ts:1442`) work.
- **System B — SCAFFOLDED, UNWIRED (`src/services/tasks/` + `src/core/`).**
  `createAgentTaskSpec`/`AgentTaskAttempt` (`agentTaskSpec.ts`),
  `AgentTaskPolicy` + `evaluateAgentTaskLaunch` (`core/agentTaskPolicy.ts`),
  `AgentTaskLedgerEntry` + `fifoPending`/`pendingReason`/`projectAttemptUsage`/
  `remainingTaskBudget` (`budgets.ts`), plus `subAgents`/`scheduleLedger`/
  `outcomeLedger`. These are **fully unit-tested pure domain modules** but
  imported by **no store**, wired into **no persistence**, and instantiated
  **nowhere** (`RootStore.ts:157` builds only `TaskStore(imageJobs, chat)`).

**AP-2 = connect System B to the live path**, replace the fail-open route,
enforce budgets live, persist the spec/attempt ledger with a schema bump, add
two missing fields, and surface everything in the task center.

## Design decisions (all decidable now — APPROVED covers scope)

### D1. Wire the ledger; keep ChatStore/TurnRunner as the runner

Per the Story: "Keep `TaskStore` as the shared ledger and `ChatStore`/
`TurnRunner` as the agent runner for V1. Add a persisted `AgentTaskSpec`/policy
snapshot rather than a second queue." Each agent task becomes:

- **one `AgentTaskLedgerEntry`** (durable spec + policy snapshot + attempts) —
  the authoritative source of route, grants, budgets, consent, and lifecycle;
- **one linked runner `Thread`** — unchanged as the transcript/result surface.

The ledger lives on `ChatStore` (the persistence authority; avoids a second
store and cross-store race). `TaskStore` projects from it. This preserves the
strangler shape: no fold of the runner, no parallel queue.

### D2. Fail-closed exact route (replaces `resolveAgentTaskModelId`)

Resolve the route **once at creation**, persist `route{model_id, provider_id,
locality}` on the spec, and **never substitute** after:

- Explicit requested model **unavailable** → block. No fall-through to origin or
  background default. (This is the behavior change the Story mandates.)
- No model requested → use the **configured background default**, resolved once
  and pinned; if that is unavailable → block.
- If the pinned route becomes unavailable at launch/wake → enter the visible
  `waiting_for_route` pending reason (or `failed` with a recovery action), never
  a substitute route.

A migration/behavior test must prove an unavailable explicit route blocks
**before any provider request is issued**.

### D3. Live budget enforcement in the turn loop

Before each model round, check remaining **round / token / runtime / spend**
against the policy snapshot using `budgets.ts` helpers (`remainingTaskBudget`,
`projectAttemptUsage`). Record per-attempt `actual_cost_usd` and `used_tokens`
after each round. Stop with a typed `stop_reason` drawn from
`AgentTaskPolicyFailureCode` (`round_limit` | `token_limit` | `runtime_limit` |
`run_spend_limit` | `daily_spend_limit` | `hard_spend_limit`). Defaults:
`$1.00`/task, `$5.00`/agent-tasks/local-day, `$100` hard ceiling
(`agentTaskPolicy.ts:2-4`). Because usage can arrive after a provider response,
enforcement may overshoot by **at most the already-started request**; the UI
says so. Unknown-price cloud models may run interactively with a token cap and a
warning, but not unattended (defer the unattended path to AP-3).

### D4. Durable persistence + schema bump 3→4

Add an `agentTasks` ledger array (specs + attempts) to the chat snapshot.

- `src/services/persistence.ts`: serialize/parse the ledger alongside threads.
- `src/services/persistence/migrations.ts`: additive `3→4` that initializes
  `agentTasks: []`; bump `CURRENT_CHAT_SCHEMA_VERSION`. The migration is
  **non-destructive** — it does not fabricate policy for pre-AP-2 agent threads.
- **Legacy reconciliation:** on boot, an agent-task thread with no matching
  ledger spec (pre-upgrade run) is reconciled `interrupted` (existing
  `reconcileAgentTasksOnBoot` behavior) and shown as a retryable legacy task;
  retry creates a fresh spec via D2. Boot never auto-replays a cloud call.

### D5. Two missing fields: `created_by` and `skill_id`

- Add `created_by: 'user' | 'agent'` to `AgentTaskSpec`. V1: direct delegation =
  `'user'` (launch consent). Agent-suggested follow-on tasks require a visible
  proposal and are **out of V1 scope** — the field exists for AP-4/AP-3 to fill.
- Add `skill_id?: string | null` to `AgentTaskPolicy`; thread the selected
  skill's tool allowlist through `evaluateAgentTaskLaunch` so the child gets the
  **intersection** of requested tools ∩ skill allowlist ∩ runtime availability ∩
  parent policy — never broader authority than the parent.

Because schema-1 policy/spec were **never persisted** (System B is unwired),
these fields are added to schema 1 directly; no policy-schema bump is needed.

### D6. Task-center surfacing

Extend `TaskView` (`src/services/tasks/types.ts`) with an optional projection of
route (provider/model), tool/data grants, budget usage (cost/tokens/rounds vs
caps), consent ref, and the pending reason. `TaskCenterPanel.tsx` renders them.
Pending reasons (`waiting_for_slot` | `waiting_for_route` | `waiting_for_consent`)
are **visible reasons on the `pending` state**, not new terminal states.

### D7. Consent, grants, and safety rails (unchanged invariants)

- Direct user delegation is launch consent, recorded as `consent_ref`. No new
  consent modal for direct delegation in V1.
- One policy snapshot per run: a later settings change cannot broaden a running
  task. Retry creates a **new attempt** linked to the prior one; cost/evidence
  are never overwritten.
- Side-effecting tools keep their own path jail / allowlist / protected-path
  rules. Background execution is not a privileged bridge mode.
- Local data stays local except content sent to the exact pinned cloud route or
  an explicitly configured MCP server.

## Data model summary

`AgentTaskSpec` (extend): add `created_by: 'user' | 'agent'`. Keep
`schema_version, id, title, instructions, origin_thread_id, created_at, policy,
policy_snapshot`.

`AgentTaskPolicy` (extend): add `skill_id?: string | null`. Keep
`route{model_id, provider_id, locality}, requested_tools[], database_pins[],
max_rounds, max_tokens, max_runtime_ms, max_cost_usd, consent_ref`.

`AgentTaskLedgerEntry` (persisted, from `budgets.ts`): `spec, enqueue_sequence,
state, pending_reason, attempts[]`. Add `result_thread_id` link to the runner
thread (V1: the runner thread *is* the result thread).

`TaskView` (extend, optional): `route?, grants?, budget?, consentRef?,
pendingReason?` — projection only; the ledger stays authoritative.

## Implementation slices (ordered; may be dispatched sequentially)

This is a **large** Item. `DISPATCH.md` specifies it as one coherent lane, but
the orchestrator may split it into these ordered sub-lanes if it prefers smaller
verified increments. Each slice is independently green.

1. **Spec/policy/ledger + persistence.** Add `created_by`/`skill_id`; build
   `agentTaskLedger.ts` (a store-facing wrapper over the `budgets.ts` entry
   shape with serialize/restore); wire the ledger onto `ChatStore`; persist it
   (`persistence.ts` + `3→4` migration). Spawn builds a spec; `TaskStore`
   projects from the ledger. Legacy reconciliation on boot.
2. **Fail-closed route + budget enforcement.** Replace `resolveAgentTaskModelId`
   fall-through with D2; add `waiting_for_route`; enforce round/token/runtime/
   spend per round in `TurnRunner` with typed `stop_reason` and per-attempt
   usage accounting; daily-spend aggregation.
3. **Task-center surfacing.** Extend `TaskView` + `TaskCenterPanel` to show
   route, grants, budget usage, consent, and pending reason; e2e coverage.

## Required test matrix

- **Route fail-close:** an unavailable explicit model blocks **before any
  provider request**; no fall-through to origin/background default; a route that
  becomes unavailable enters `waiting_for_route`, never a substitute.
- **Budget enforcement:** run stops at each of round / token / runtime / run-spend
  / daily-spend limits with the correct typed `stop_reason`; overshoot bounded to
  one in-flight request; daily spend aggregates across agent tasks.
- **Grants intersection:** child tools = requested ∩ skill allowlist ∩ runtime ∩
  parent; a denied tool yields `tool_not_allowed`; no broadening on a settings
  change mid-run.
- **Spec/ledger:** `created_by`/`skill_id` parse and freeze; retry creates a new
  linked attempt without overwriting prior cost/evidence.
- **Persistence:** `3→4` additive migration; ledger serialize/restore round-trip;
  legacy pre-AP-2 agent thread reconciles to a retryable `interrupted` task;
  boot never auto-replays a cloud call.
- **Two-slot cap unchanged:** excess work queues FIFO with `waiting_for_slot`;
  cap stays `2`.
- **TaskStore/panel:** route/grants/budget/consent/pending-reason projected and
  rendered (desktop + Web Lite honest degradation).
- **e2e (desktop):** an agent task shows its route + budget and cancels from the
  task center.

## Non-goals (V1) — carried from the Story

Nested/child task spawning (one level of delegation only); unattended scheduled
runs of unknown-price models (AP-3); task DAGs/dependencies; remote workers;
priority/fair scheduling beyond FIFO-per-kind; agent-initiated follow-on tasks
without a visible proposal; checkpoint/resume of a partial run. None may bypass
the two-slot/user cap.

## Verification

`npm run ci` (995+ vitest, typecheck, lint) + `npm run test:e2e` green. No Rust
touched (no `cargo test` needed). Both runtimes honest: durable agent automation
is desktop-first; Web Lite renders task metadata but does not pretend to run
unattended.

## Definition of done

1. `npm run ci` and `npm run test:e2e` green; new behavior tested at the right
   layer per the matrix above.
2. Fail-closed route, live budget enforcement, durable ledger + `3→4` migration,
   `created_by`/`skill_id`, and task-center surfacing all shipped and wired.
3. Docs true: `docs/architecture.md` agent-task section updated (including the
   two-slot correction — the Story flags that architecture.md currently says
   three); `docs/changelog.md` entry; roadmap checkbox left for the harvesting
   session (this lane does not edit the roadmap).
4. No parallel queue, no second timer, no silent provider switching, no secrets,
   no sibling-repo or Rust/bridge change.
