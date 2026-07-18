# DISPATCH — implement AP-2 background sub-agents on TaskStore

Immediately dispatchable. Read `PLAN.md` in this folder first — it is the
authoritative design and records the approved decision. The core work is
**wiring the already-built-but-unwired System B** (`src/services/tasks/` +
`src/core/agentTaskPolicy.ts`) into the live agent-task path, replacing the
fail-open route, enforcing budgets live, persisting a durable spec/attempt
ledger, and surfacing route/grants/budget/consent in the task center.

## Task spec

- **title:** AP-2 — durable background sub-agents (spec ledger, fail-closed route, live budgets)
- **model tier:** smart
- **goal:** |
    Implement
    `docs/plans/unblock-ap-2-background-sub-agents-on-taskstore--20260718/PLAN.md`
    exactly.

    Wire the existing unwired agent-task domain modules into the live path.
    Each agent task becomes one durable `AgentTaskLedgerEntry` (spec + policy
    snapshot + attempts) plus its existing linked runner thread; `ChatStore`
    remains the runner and persistence authority and `TaskStore` projects from
    the ledger. Do NOT build a second queue or a second timer.

    Fail-closed route (replaces `resolveAgentTaskModelId`): resolve the route
    once at creation and persist `route{model_id, provider_id, locality}` on the
    spec. An explicitly requested model that is unavailable BLOCKS — no
    fall-through to the origin model or background/background-default model. With
    no model requested, pin the configured background default; if it is
    unavailable, block. A pinned route that becomes unavailable at launch enters
    the visible `waiting_for_route` pending reason, never a substitute. Prove by
    test that an unavailable explicit route blocks before any provider request.

    Live budget enforcement: before each model round in `TurnRunner`, check
    remaining round/token/runtime/spend against the policy snapshot using the
    `budgets.ts` helpers; record per-attempt `actual_cost_usd` and `used_tokens`;
    stop with a typed `stop_reason` (`round_limit`|`token_limit`|`runtime_limit`|
    `run_spend_limit`|`daily_spend_limit`|`hard_spend_limit`). Defaults $1/task,
    $5/agent-tasks/local-day, $100 hard ceiling; daily spend aggregates across
    agent tasks. Overshoot is bounded to one already-started request and the UI
    says so. Unknown-price cloud models may run interactively with a token cap +
    warning but not unattended.

    Add the two missing fields: `created_by: 'user' | 'agent'` on
    `AgentTaskSpec` (direct delegation = `'user'`), and `skill_id?: string|null`
    on `AgentTaskPolicy` threaded through `evaluateAgentTaskLaunch` so the child
    receives the intersection of requested tools ∩ skill allowlist ∩ runtime
    availability ∩ parent policy — never broader authority than the parent.
    Because schema-1 spec/policy were never persisted, add these to schema 1
    without a policy-schema bump.

    Persist the ledger: serialize/parse `agentTasks` in `src/services/persistence.ts`;
    add an additive `3→4` chat-snapshot migration in
    `src/services/persistence/migrations.ts` that initializes `agentTasks: []`
    and bump `CURRENT_CHAT_SCHEMA_VERSION`. The migration must be
    non-destructive and must not fabricate policy for pre-AP-2 agent threads. On
    boot, an agent-task thread with no matching ledger spec reconciles to a
    retryable `interrupted` legacy task; boot never auto-replays a cloud call.
    Retry creates a new linked attempt without overwriting prior cost/evidence.

    Surface in the task center: extend `TaskView` with an optional projection of
    route, tool/data grants, budget usage (cost/tokens/rounds vs caps),
    `consentRef`, and `pendingReason`; render them in
    `src/components/dock/TaskCenterPanel.tsx`. Pending reasons
    (`waiting_for_slot`|`waiting_for_route`|`waiting_for_consent`) are visible
    reasons on the `pending` state, not new terminal states. Keep the two-slot
    cap at 2 with FIFO queueing.

    Add the full PLAN.md test matrix. Update `docs/architecture.md` (agent-task
    section, INCLUDING correcting the concurrent-agent count from three to two)
    and append a `docs/changelog.md` entry. Do NOT edit `docs/roadmap.md`; the
    harvesting session performs the verified checkbox transition.
- **owns:**
    - src/core/agentTaskPolicy.ts
    - src/core/types.ts
    - src/services/tasks/agentTaskSpec.ts
    - src/services/tasks/agentTaskLedger.ts
    - src/services/tasks/budgets.ts
    - src/services/tasks/types.ts
    - src/services/chat/agentTasks.ts
    - src/services/chat/turnRunner.ts
    - src/stores/ChatStore.ts
    - src/stores/TaskStore.ts
    - src/services/persistence.ts
    - src/services/persistence/migrations.ts
    - src/components/dock/TaskCenterPanel.tsx
    - tests/core/agentTaskPolicy.test.ts
    - tests/services/tasks/agentTaskSpec.test.ts
    - tests/services/tasks/agentTaskLedger.test.ts
    - tests/services/tasks/budgets.test.ts
    - tests/services/chat/turnRunner.test.ts
    - tests/stores/ChatStore.test.ts
    - tests/stores/agentTask.test.ts
    - tests/stores/TaskStore.test.ts
    - tests/services/persistence.test.ts
    - tests/components/dock/TaskCenterPanel.test.ts
    - tests/e2e/desktop.spec.ts
    - docs/architecture.md
    - docs/changelog.md
- **test-cmd:** `npm run ci && npm run test:e2e`

## Acceptance details

- An unavailable explicit requested model blocks the spawn/launch before any
  provider request; there is NO fall-through to origin or background default.
- A pinned route that becomes unavailable enters `waiting_for_route`; the run
  never proceeds on a substitute route.
- Each of round / token / runtime / run-spend / daily-spend limits stops a run
  with the correct typed `stop_reason`; overshoot bounded to one in-flight
  request; daily spend aggregates across agent tasks per local day.
- Child tool set = requested ∩ skill allowlist ∩ runtime ∩ parent; a denied tool
  returns `tool_not_allowed`; a mid-run settings change never broadens a running
  task.
- `created_by` and `skill_id` parse, validate, and freeze; retry produces a new
  linked attempt without overwriting prior cost/evidence.
- `3→4` migration is additive and non-destructive; ledger serialize/restore
  round-trips; a pre-AP-2 agent thread reconciles to a retryable `interrupted`
  legacy task; boot does not auto-replay a cloud call.
- Two-slot cap unchanged (2); excess work queues FIFO with `waiting_for_slot`.
- Task center renders route, grants, budget usage, consent, and pending reason;
  Web Lite degrades honestly (no pretend unattended runs).
- No parallel queue, no second timer, no silent provider switching, no
  dependency, Rust, Tauri, bridge, sibling-repo, secret, or deployment change.

## Dispatcher notes

- No Ethan gate remains; `APPROVED` is authoritative.
- This Item is **large**. It is specified as one coherent lane, but may be split
  into the three ordered sub-lanes in PLAN.md §"Implementation slices"
  (1: spec/ledger + persistence · 2: fail-closed route + budgets · 3: UI), each
  independently green, if smaller verified increments are preferred. Size the
  cap accordingly (complex multi-file → ~$25; if split, ~$10 each) and apply the
  mid-flight liveness check at ~50% for any cap ≥$25.
- Do NOT weaken ESLint layer boundaries or the security model; new React↔store
  wiring goes through `stores/context.tsx`. Version bump is not required (no
  user-facing app-version claim changes) unless the implementer ships a
  user-visible release.
- Playwright may need the orchestrator's outside-sandbox verifier because the
  sandbox cannot bind the Vite listener. Do not weaken the command.
- Reuse System B modules — they are already unit-tested. Prefer extending them
  over reauthoring; delete no passing test without a stated reason.
