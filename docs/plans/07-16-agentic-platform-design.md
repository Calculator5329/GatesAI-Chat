# GatesAI agentic platform design

*Product direction mandated by Ethan on 2026-07-16. This document proposes
the implementation contracts; it does not imply that any roadmap Item is
accepted or complete. Design only—no runtime changes are part of this lane.*

## Vision and vocabulary

**Vision:** GatesAI is a quiet, user-controlled agent platform: an agent can
ground itself in installable local data, delegate bounded work, arrange a
future wake, and learn from the result without hiding activity, provider
changes, spend, or prompt mutations from the user.

The four mandated capabilities below are **Stories** within that Vision.
Implementation lanes are **Items**; their bullets are bounded **Sub-items**.
Projects remain execution homes, while run/evidence records attach proof to an
Item. Proposed/accepted is separate from workflow state: ready, running,
review, or done never means Ethan accepted a product decision.

## Existing foundation and decisions carried forward

This is an extension of shipped primitives, not a second agent framework.

| Foundation | Current truth | Design consequence |
| --- | --- | --- |
| Offline Library | Accepted fixed-authority, read-only desktop boundary in [`../adr/2026-07-12-offline-library-plugin.md`](../adr/2026-07-12-offline-library-plugin.md); explicit enablement, versioned manifest, typed unavailable states, bounded results, opaque citations, no remote fallback | Generalize its lifecycle and threat-model patterns. Do not force its loopback-service transport into the packaged-database format. |
| W-3 TaskStore | `TaskStore` projects image and agent work into one ledger with pending/running/history, cancel, retry, progress, result, and cost | Background agents remain `kind: "agent"` tasks and use the existing task center. `ChatStore` may remain the runner until a separately tested fold. |
| Agent tasks | Separate linked threads, boot interruption recovery, round caps, no nested spawning | Preserve the origin/result link and non-interactive prefix. The source constant is **two** concurrent agent tasks; `docs/architecture.md` currently says three and must be corrected by the integration-doc lane. |
| Schedules | `SchedulesStore` persists recurring definitions and starts work through `ChatStore.spawnTask()`; delayed agent starts also exist | Add a durable, consented wake contract around this store. Do not add a second timer or queue. V1 remains app-open/tray-resident and says so. |
| Memory and skills | User facts, local semantic recall, and workspace skill prompt packs already exist | Learning produces scoped, reviewable memory or skill/prompt proposals. It does not train a model or silently rewrite the system prompt. |
| Source workspace | A controlled source copy supports assistant edits, diffs, tests, builds, and user-approved install handoff | Keep app self-editing as a distinct transparent workshop. Outcome learning may recommend a source change, but may not apply or install one automatically. |
| Bridge protocol v2 | Strict hello equality, typed request envelopes, correlation IDs, jailed workspace access, command allowlist, and cancellation operations | Database bundles live behind a dedicated Tauri app-data boundary. Agent work uses existing tools. No protocol downgrade, generic local-network proxy, or widened privileged flag. Any future bridge operation is a separate bridge-repo Story. |

### Platform shape

```text
User / agent proposal
        |
        v
Consent + policy gate ---- provider/model pin + spend/wake/tool budgets
        |
        +---- DatabasePluginStore ---- typed Tauri package boundary
        |             |                         |
        |             +---- bounded evidence queries + citations
        |
        +---- SchedulesStore ---- due wake ----+
        |                                      v
        +------------------------------- TaskStore ledger
                                               |
                                      ChatStore agent runner
                                               |
                                  outcome + feedback journal
                                               |
                                  reviewable lesson proposal
```

Layering remains UI → stores → services → core. Components never invoke Tauri,
the bridge, persistence, or providers directly. Stores do not use raw fetch or
localStorage. New persisted shapes use the normal provider/migration path.

### Shared invariants

1. **One visible ledger.** Every background or scheduled run becomes an agent
   `TaskView`; it cannot work only in a hidden timer callback.
2. **One exact route.** At creation/activation, resolve an effective model ID
   and provider and persist both. If either is unavailable at launch or wake,
   enter `waiting_for_route`/failed with a user action. Never substitute the
   origin model, background default, OpenRouter, or a local model silently.
3. **One policy snapshot per run.** Tool grants, database plugin/version,
   source-data policy, round/token/time/spend limits, and originating consent
   are captured on the task. A later setting change cannot broaden a running
   task.
4. **Local data is data, not instructions.** Plugin records, web pages, files,
   task results, and feedback are untrusted evidence. They are delimited from
   system/skill instructions and cannot grant tools, create schedules, install
   packages, or change prompts.
5. **Fail closed and tell the user.** Disabled, incompatible, missing,
   corrupt, budget-exhausted, wake-capped, route-unavailable, and app-closed
   are distinct states. None means “try a different provider.”
6. **Desktop and Web Lite are honest.** Package install and durable agent
   automation are desktop-only in V1. Web Lite can inspect exported metadata
   where safe, but does not pretend to install, wake, or access loopback hosts.

## Story AP-1 — downloadable database plugins

### User stories

- As a user, I can inspect a data bundle's publisher, version, size, datasets,
  data policy, permissions, and integrity before downloading it.
- As a user, I can explicitly install, enable/disable, update, and archive a
  database plugin without giving it code-execution, network, filesystem, or
  arbitrary-SQL authority.
- As an agent, I can initiate an install proposal from a trusted catalog and,
  after user approval completes the install, query the enabled plugin through
  bounded typed operations with stable citations.
- As a local-only user, I can ensure bundle content never enters a cloud-model
  request; an incompatible cloud route blocks instead of switching models.
- As an author, I can publish a static bundle against a versioned schema and
  validate it before users see it.

### Package and runtime architecture

Use a data-only archive (working name `.gatesdb`) with this logical shape:

```text
plugin.json                  required, canonical manifest
data/<dataset>.sqlite        immutable SQLite database(s)
indexes/...                  optional declared search index files
LICENSES/...                 required provenance/license material
checksums.json               digest for every payload file
```

`plugin.json` schema 1 declares an immutable `id`, semantic `version`, minimum
host/schema versions, publisher/provenance, compressed and expanded size,
datasets, citation namespace, content license, update URL/catalog identity,
and `data_policy: "local_only" | "cloud_allowed"`. Capabilities are an enum:
`catalog.read`, `schema.read`, `lookup.read`, and `search.read`. A dataset
declares named lookup/search projections and bounded scalar parameters; it
does not declare SQL text supplied at runtime.

The installer is a dedicated Tauri module because these are app-managed files,
not jailed user-workspace files. It stages a user-approved HTTPS catalog
download or local file import, verifies archive and manifest bounds, rejects
absolute paths, `..`, symlinks, duplicate paths, executable payloads, digest
mismatches, and decompression-limit violations, then atomically promotes the
version under the app-data plugin directory. The WebView cannot choose an
arbitrary host, path, method, redirect, SQL statement, or destination. Catalog
hosts are user-added or shipped configuration, and redirects are rejected.
Checksums prove payload integrity, not publisher identity. An optional
signature is verified and labeled with its key fingerprint, but is called
“trusted” only after that key or catalog is explicitly trusted by the user;
mandatory trust roots and revocation remain later scope.

`DatabasePluginStore` owns installed/enabled/health/update state. A service
wraps typed Tauri operations such as `plugin_list`, `plugin_inspect`,
`plugin_install`, `plugin_set_enabled`, `plugin_search`, and `plugin_lookup`.
Model-facing tools receive a narrower facade:

- `database_plugins.list` — metadata and available datasets;
- `database_plugins.search` — bounded text query, dataset enum, limit;
- `database_plugins.lookup` — named lookup plus typed scalar parameters;
- `database_plugins.schema` — published field descriptions, never private
  SQLite internals or rows beyond a bounded projection;
- `database_plugins.propose_install` — creates a user-visible install proposal;
  it does not download or enable by itself.

Results are size- and row-capped before entering a transcript. Each evidence
row carries an opaque URI such as
`gatesdb://<plugin-id>@<version>/<dataset>/<record-id>`; exact IDs survive task
results, chat persistence, export, and rendering. Installed versions used by a
running task remain pinned until that task ends. An update installs side by
side, requires user approval to activate, and never changes a run in flight.

The shipped Offline Library becomes a built-in `loopback_service` adapter in
the lifecycle UI/registry, still governed by its accepted ADR and dedicated
fixed-host Tauri module. It is not repackaged, auto-discovered, or weakened to
fit `.gatesdb`.

### Privacy and safety rails

- Install, update, enable, and archive are explicit user actions. Agent-found
  URLs or plugin content can only produce a proposal.
- V1 bundles contain no scripts, native libraries, HTML, migrations, triggers,
  arbitrary query templates, secrets, or network endpoints.
- Default maximums: 256 MiB compressed, 1 GiB expanded, 100 files, 50 results,
  and 32,000 transcript characters per query. The validator uses stricter
  per-dataset limits from the manifest when present.
- SQLite opens immutable/read-only with defensive settings. Only host-defined
  query builders over manifest-declared datasets run; the existing generic
  `sqlite_query` workspace tool is not reused.
- `local_only` data can be used only with a local model. `cloud_allowed` data
  may enter the exact pinned cloud route only after the install/activation
  surface states that policy. The manifest is only a ceiling: the default is
  local-only and the user can tighten it, never loosen it beyond the author's
  declaration. A route/data-policy mismatch blocks visibly.
- Database text is wrapped as untrusted evidence and cannot request tools,
  installs, provider changes, schedules, memory writes, or prompt edits.
- Package telemetry, hosted accounts, background cloud sync, and silent
  updates are absent.

### V1 and later

**V1:** schema-1 data-only bundles; catalog download plus local import;
integrity hashes and optional publisher signature display; one active version;
read-only list/schema/search/lookup; citations; explicit lifecycle; Offline
Library shown beside packaged plugins without changing its transport; desktop
only.

**Later:** mandatory signed catalogs with trust roots and revocation; delta
updates; richer local indexes; dependency graphs between data bundles; author
SDK/publishing service; encrypted private bundles; Web Lite import of small
in-memory public bundles. Executable plugins, arbitrary SQL, mutations, and
remote plugin processes require their own ADR and are not implied by “later.”

## Story AP-2 — background sub-agents on TaskStore

### User stories

- As a user, I can delegate a scoped task and continue chatting while it runs
  in a linked thread.
- As a user, I can see queue/running/history state, exact model/provider,
  round progress, elapsed time, cost, tool/data grants, and result in the task
  center; I can cancel or retry from the same surface.
- As a user, I can set task-level round, time, token, and cloud-spend limits
  before a run and see why a limit stopped it.
- As an agent, I can use enabled database plugins and allowed skills/tools in
  a child run without gaining broader authority than the parent.
- As a recovering user, I see an app-interrupted run as retryable—not silently
  resumed with stale context or billed twice.

### Architecture

Keep `TaskStore` as the shared ledger and `ChatStore`/`TurnRunner` as the agent
runner for V1. Add a persisted `AgentTaskSpec`/policy snapshot rather than a
second queue:

```text
id, originThreadId, resultThreadId, title, instructions
modelId, providerId, skillId?, databasePins[]
allowedTools[], maxRounds, maxTokens?, maxRuntimeMs, maxCostUsd
createdBy, consentRef, createdAt, startedAt?, completedAt?
```

The lifecycle is `pending → running → done | failed | cancelled`, with
`waiting_for_slot`, `waiting_for_route`, and `waiting_for_consent` represented
as visible pending reasons rather than new terminal states. The existing two
concurrent-agent cap is the only agent concurrency authority. Excess work
queues FIFO; retries create a new run attempt linked to the prior attempt so
cost and evidence are not overwritten.

Launch resolution is strict:

1. Resolve the user-selected/background-default/origin model once.
2. Display and persist the exact model and provider on the task.
3. Validate provider connection, tool capability, data policy, and budget.
4. If validation later fails, wait/fail with recovery choices; never run on a
   substitute route.

This intentionally replaces the current `resolveAgentTaskModelId()` behavior
that can fall through from an unavailable requested model to the origin or
background default. Migration tests must prove that an unavailable explicit
route blocks before any provider request.

The child receives the intersection of the requested tool set, selected skill
allowlist, runtime availability, and user policy. Agent tasks still cannot
spawn nested tasks in V1. Completion posts a compact result/activity event to
the origin thread and preserves the full linked agent thread. All runs append
a local outcome record used by AP-4.

### Privacy, safety, and spend rails

- A direct user delegation is launch consent. An agent may suggest additional
  work, but unsolicited follow-on tasks require a visible proposal.
- Default cloud limits are `$1.00` per one-off task and `$5.00` across all
  agent tasks per local day; local models record `$0`. Users may lower or
  explicitly raise these soft limits, but no run may exceed the workspace
  Ring-0 ceiling of `$100`. Before every paid request, reserve a conservative
  worst-case cost from known route pricing, current prompt tokens, and the
  request's maximum output tokens. Clamp the output bound or refuse the call
  when that reservation cannot fit the remaining hard budget. Reconcile the
  reservation to reported usage afterward. A soft per-task or daily limit may
  exceed its display threshold only by one disclosed, already-reserved request;
  the `$100` hard ceiling may never overshoot.
- Before each model round, check remaining round/token/time/spend allowance.
  Unknown-price paid routes cannot run as background or scheduled work in V1,
  because no conservative hard-budget reservation can be proved. Local routes
  with declared zero provider cost remain eligible.
- Cancellation aborts the active turn and prevents unstarted tool calls. Boot
  recovery marks orphaned work interrupted; it never auto-replays a cloud
  call.
- Side-effecting tools retain their own validation, path jail, allowlist, and
  protected-path rules. Background execution is not a privileged bridge mode.
- Task inputs, outputs, costs, and feedback stay local except content sent to
  the exact selected cloud model or an explicitly configured MCP server.

### V1 and later

**V1:** durable agent TaskSpecs; two slots; FIFO queue; linked threads;
cancel/retry/interruption; visible route, grants, progress, result, and cost;
round/time/token/spend caps; database-plugin queries; one level of delegation;
app-open/tray-resident execution.

**Later:** task dependencies/DAGs, parent-managed subtask trees, remote workers,
priority/fair scheduling, provider-specific reservation estimates, and safe
checkpoint/resume. None may bypass the two-slot/user cap until separately
designed and accepted.

## Story AP-3 — self-scheduling with visible wakes

### User stories

- As a user, I can ask an agent to remind itself or do bounded work at a local
  time, after a delay, or on a cadence, then approve the exact schedule.
- As a user, I can see creator, next wake, timezone, model/provider, tool/data
  grants, per-wake spend, wake cap, last result, and why a wake was skipped.
- As a user, I can pause, edit, run now, or archive a schedule immediately;
  changes that broaden authority require renewed consent.
- As a user returning after the app was closed, I can choose one bounded
  catch-up run or skip missed work; the app never fans out every missed wake.
- As an agent, I can create a schedule proposal but cannot silently activate,
  broaden, or hide it.

### Architecture

Evolve `SchedulesStore`; do not introduce another scheduler. A schema-v2
`Schedule` owns:

```text
id, title, instructions, createdBy, consentRef
trigger: once-at | delay | interval | daily
timezone, enabled, catchUp: skip | once
modelId, providerId, skillId?, databasePins[], allowedTools[]
maxRounds, maxRuntimeMs, maxCostUsdPerWake
maxWakesPer24h, lastWakeAt?, nextWakeAt, lastResultTaskId?
```

The model-facing tool separates **proposal** from **activation**. `propose`
returns a schedule card with normalized local/UTC times, exact route, grants,
caps, and app-open limitation. A user confirmation activates it. User-authored
settings forms can create an active schedule because the save action itself is
explicit consent. Any change to instructions, provider/model, data plugins,
tools, cadence frequency, catch-up, or caps returns to pending consent; pause,
lowering limits, and archive do not.

One scheduler tick computes due definitions and enqueues an ordinary agent
TaskSpec. TaskStore owns the run from that point. Slot exhaustion keeps one
pending wake and does not increment retry/wake counters. Overlap is forbidden
per schedule. Completion links the task and outcome back to the schedule.

Existing schema-v1 schedules lack exact route, grant, and budget consent. They
migrate intact but paused as `needs_review`; the user sees the normalized
definition and activates it only after confirming those fields. Migration must
not resolve a missing model by silently choosing the current default.

V1 truth remains: wakes run while the desktop process is open, including when
minimized to tray. Closing the process stops timers. On next launch, `catchUp:
once` may enqueue at most one missed run after revalidating consent, route,
budgets, data pins, and wake caps. There is no claim that Tauri wakes a powered
off or logged-out machine.

### Privacy, safety, consent, and wake rails

- Agent-created schedules are inactive proposals until the user confirms. The
  approval surface names future side effects; vague “allow automation” consent
  is insufficient.
- Default schedule policy is read-only tools plus explicitly selected local
  database plugins. Workspace writes or other mutations must be declared in
  the approval card. Public posting, deploy, purchase, permanent deletion,
  secret access, or OS-critical actions are not schedulable in V1.
- Default cap is 4 wakes per schedule per rolling 24 hours and 24 wakes global
  per rolling 24 hours. A user can explicitly raise a schedule up to the hard
  global limit—for example to approve an hourly schedule. Missed and slot-
  retry ticks do not multiply wakes.
- Default cloud cap is `$0.50` per wake, also subject to the `$5.00` daily
  agent cap and `$100` hard per-run ceiling. Every paid wake inherits AP-2's
  conservative pre-call reservation; a request that cannot fit the remaining
  hard budget is not started, and unknown-price paid routes cannot be
  scheduled in V1. A soft-cap exhaustion disables future wakes until the user
  lowers cost, changes the exact route explicitly, or renews the budget. There
  is no provider switch.
- Notifications show fired, skipped, waiting, completed, failed, budget-
  stopped, and consent-expired states. A global “Pause all schedules” control
  is always available.
- Timezone/DST behavior is stored and displayed. Daily schedules follow wall
  clock; ambiguous fall-back times fire once, and nonexistent spring-forward
  times advance to the next valid local time with an audit reason.

### V1 and later

**V1:** one-shot, delayed, interval, and daily app-open wakes; proposal/approve;
pause/edit/run-now/archive; exact route; one catch-up; overlap prevention;
wake/spend/tool caps; TaskStore run linkage; local notifications.

**Later:** OS login autostart opt-in, native wake timers where each platform can
honestly support them, calendar/event/webhook triggers, richer quiet hours,
trusted recurring mutation grants, and encrypted schedule sync to user-owned
storage. A background service or OS wake is a separate threat model and must
not be implied by V1 copy.

## Story AP-4 — self-improvement through outcomes and feedback

### User stories

- As a user, I can mark an agent result useful, wrong, incomplete, or unsafe
  and optionally explain why.
- As a user, I can inspect what GatesAI proposes to remember or change, the
  evidence behind it, its scope, and how to undo it.
- As an agent, I can retrieve accepted lessons relevant to this task type,
  skill, model, or data plugin without treating old output as instructions.
- As a privacy-conscious user, I can keep evaluation local, exclude selected
  threads/tasks, export the journal, and clear active lessons without sending
  telemetry.
- As a skill author, I can accept a versioned prompt/skill patch after seeing a
  diff and validation result; rejection is recorded so it is not proposed
  repeatedly.

### Architecture: honest client-side loop

V1 is retrieval and controlled prompt refinement, not model training:

1. **Observe:** append a local `OutcomeRecord` when an agent task ends. Store
   task/policy identifiers, exact model/provider, skill and database versions,
   duration, token/cost totals, tool success/failure summaries, terminal state,
   result pointer, and explicit user feedback. Do not duplicate secrets or raw
   private plugin rows into the journal.
2. **Assess:** deterministic signals (completion, retry, cancel, tool errors,
   budget stop) are available immediately. An optional evaluator can propose a
   concise lesson; local model is the default. Sending evaluation material to
   a cloud model requires an explicit evaluator route and obeys source-data
   policy.
3. **Propose:** produce a scoped lesson (`task_type`, `skill_id`, `model_id`, or
   `plugin_id`) with evidence links, confidence, expiry/review date, and a
   suggested action: retrieval memory, prompt patch, or skill patch.
4. **Approve:** retrieval lessons may be accepted individually or under an
   explicit low-risk auto-accept policy. Prompt/skill patches always show a
   diff and require user approval. Source-code changes remain in the existing
   source-workspace review/test/build/install flow.
5. **Apply and measure:** future task assembly retrieves a small number of
   accepted scoped lessons as a clearly labeled context block. Compare later
   outcomes, and suggest rollback when results regress. Every applied version
   is inspectable and reversible.

Suggested local contracts:

```text
OutcomeRecord { id, taskId, attemptId, policyHash, route, versions,
  timing, usage, toolSummary, terminalState, feedback?, createdAt }
LessonProposal { id, scope, evidenceOutcomeIds[], text, kind,
  confidence, status, candidatePatch?, createdAt, reviewedAt? }
AppliedLesson { proposalId, scope, version, enabled, appliedAt, supersedes? }
```

Outcome metadata belongs in IndexedDB with a small hot index, not the user bio
or chat transcript. Accepted retrieval lessons join semantic recall through a
separate source type so the UI can identify and disable them. Prompt and skill
versions are immutable; activation is a small pointer change with rollback.

### Privacy and safety rails

- Local-only, no telemetry, no cross-user learning, no hidden fine-tuning, and
  no claim that the base model's weights improve.
- User-profile facts remain user facts. The outcome loop cannot infer and save
  sensitive identity, health, finance, or credential data as “lessons.”
- Raw task output is evidence, never prompt authority. Lesson text is bounded,
  provenance-linked, escaped/delimited, and cannot expand tools or budgets.
- A negative/safety outcome automatically disables the implicated lesson or
  prompt candidate and asks for review; positive feedback never promotes trust
  or permissions by itself.
- Prompt/skill changes cannot add unknown tools, broaden an allowlist, install
  a plugin, change a provider, activate a schedule, or modify source without
  the feature's own consent gate.
- Retention is visible and configurable. Export excludes secrets. “Forget”
  removes a lesson from active retrieval immediately and archives its record;
  V1 never permanently deletes outcome or lesson evidence. Archive/disable
  actions require a visible owner confirmation card, remain reversible, and
  preserve receipts. No implementation lane in this platform may permanently
  delete records or inherit deletion authority from a feedback loop.
- Evaluation itself has round/token/time/spend limits and cannot recursively
  generate another evaluation task.

### V1 and later

**V1:** local outcome journal; deterministic metrics; thumbs up/down plus
reason; optional bounded lesson proposal; user-approved scoped retrieval
lessons; prompt/skill diff proposals with manual activation and rollback;
local evaluation default; no weight training.

**Later:** local A/B prompt evaluation over consented fixtures, bandit-like
selection with minimum evidence, richer skill synthesis, portable encrypted
learning profiles, and source-workspace change proposals. Fine-tuning,
federated learning, autonomous source installation, and automatic permission
promotion are explicitly outside this design.

## Cross-feature policy and failure behavior

| Condition | Required behavior |
| --- | --- |
| Exact provider/model unavailable | Wait or fail visibly; offer user choices; do not switch. |
| Plugin disabled/incompatible/version missing | Block the dependent task/wake and link to plugin recovery. |
| `local_only` data with cloud route | Block before assembling model context. |
| Two agent slots occupied | Queue visibly; cancellation removes only that pending run. |
| Per-run or daily spend exhausted | Stop before the next model call; preserve partial result and usage. |
| Wake cap or overlapping run | Skip/coalesce with an audit reason; never create catch-up fan-out. |
| App closes mid-run | Persist interruption; no automatic paid replay. |
| App closed at due time | V1 does nothing then; on launch, skip or one validated catch-up. |
| Plugin query contains prompt injection | Treat as quoted evidence; no tool/policy effect. |
| Feedback suggests a prompt change | Create a diff proposal; current prompt remains active. |
| Web Lite requests desktop capability | Stable desktop-only state with no loopback/Tauri attempt. |

## V1 acceptance envelope

The four Stories compose only when these end-to-end cases pass:

1. Install and enable a sanitized schema-1 database bundle, query it from a
   local background agent, and preserve its `gatesdb://` citation through the
   task result, origin-thread event, persistence, and export.
2. Attempt the same with a `local_only` bundle and a cloud route; verify the run
   blocks without any provider request or fallback.
3. Run two agent tasks, queue a third, cancel one, retry an interrupted one,
   and verify task-center progress/cost/route/result truth throughout.
4. Let an agent propose a schedule, verify no wake before approval, approve it,
   fire one TaskStore run, hit a wake/spend cap, and pause it globally.
5. Close/reopen around a due wake and prove `skip` versus single `catchUp`
   behavior without replaying every missed interval.
6. Give feedback on a completed task, generate a scoped lesson proposal,
   approve it, observe provenance-labeled retrieval on a relevant later task,
   then disable/roll it back.
7. Run hostile archive, manifest, database-text, provider-unavailable,
   interrupted-run, DST, persistence-migration, and Web Lite degradation tests.

Each implementation Story requires focused core/service/store/component tests,
`npm run ci`, desktop/Web Lite E2E where representable, and Rust tests for new
Tauri code. Package installation and app-open scheduling need a real desktop
smoke; tests that bind a listener are verified outside the Codex sandbox.

## Phased implementation lanes

Every Item below is sized for one Codex session. `owns` are enforceable paths
or directory globs to claim literally before dispatch; concurrent Items in the
same phase are disjoint. Shared frontend
registry/root-store wiring, architecture/changelog/roadmap, and end-to-end
composition are deliberately reserved for integration Items instead of being
touched opportunistically. A lane's run/evidence proves its Item; it does not
add a planning level or imply product acceptance.

### Phase 0 — contracts

1. **Item C1 — package schema and ADR**
   - `owns`: `docs/adr/2026-07-xx-database-plugin-packages.md`,
     `src/core/databasePlugins.ts`, `tests/core/databasePlugins.test.ts`.
   - Sub-items: pin manifest/schema-1 types and bounds; write transport/data-
     policy threat model; add hostile manifest fixtures; decide signature
     display versus enforcement honestly.
   - Verify: pure parser tests plus fixture corpus; no Tauri or UI wiring.
2. **Item C2 — task policy/budget core**
   - `owns`: `src/core/agentTaskPolicy.ts`,
     `tests/core/agentTaskPolicy.test.ts`, `src/services/tasks/policy.ts`,
     `tests/services/tasks/policy.test.ts`.
   - Sub-items: exact-route, tool/data intersection, round/time/token/spend
     math, daily accounting, and fail-closed reason codes.
3. **Item C3 — outcome contracts**
   - `owns`: `src/core/agentOutcomes.ts`,
     `tests/core/agentOutcomes.test.ts`.
   - Sub-items: versioned record/proposal/applied-lesson schemas, redaction and
     scope rules, deterministic outcome metrics.
4. **Item C4 — UX/taste contract and owner selection**
   - `owns`: `docs/plans/07-16-agentic-platform-ux.md`,
     `docs/assets/agentic-platform-ux/**`.
   - Sub-items: generate 5–10 genuinely divergent mockups spanning plugin
     lifecycle, task detail, schedule consent, and lesson review; present them
     to Ethan for selection and annotation; record the selected interaction
     grammar, progressive-disclosure rules, motion, and information hierarchy.
   - Acceptance: quiet power at the Jarvis standard, no settings-page sprawl,
     primary actions visible without enterprise-dashboard density, and an
     explicit owner selection. No component lane starts before C4 is accepted.

### Phase 1 — downloadable data and durable task policy

5. **Item D1 — Tauri database package engine** *(depends C1)*
   - `owns`: `src-tauri/src/database_plugins.rs`, `src-tauri/src/lib.rs`,
     `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
     `src-tauri/tests/database_plugins.rs`, `tests/fixtures/database-plugins/`.
   - Sub-items: bounded staging/import/download primitives, traversal/symlink/
     bomb/digest defenses, immutable SQLite query builders, atomic versions,
     and Tauri command registration.
   - Verify: Rust unit/integration tests with hostile archives; no bridge edits.
6. **Item D2 — database plugin service/store** *(depends C1; parallel D1)*
   - `owns`: `src/services/databasePlugins/`,
     `src/stores/DatabasePluginStore.ts`,
     `tests/services/databasePlugins/`,
     `tests/stores/DatabasePluginStore.test.ts`.
   - Sub-items: typed states, lifecycle, version pins, citation projection,
     Web Lite no-invoke facade, persisted enablement.
7. **Item B1 — TaskStore policy and attempt ledger** *(depends C2; parallel D1/D2)*
   - `owns`: `src/services/tasks/agentTaskSpec.ts`,
     `src/services/tasks/budgets.ts`, `src/stores/TaskStore.ts`,
     `tests/services/tasks/agentTaskSpec.test.ts`,
     `tests/stores/TaskStore.test.ts`.
   - Sub-items: pending reasons, immutable policy snapshots, FIFO/attempt
     linkage, budget/cost projection, two-slot tests.

8. **Item X1 — Phase-1 platform wiring** *(depends D1, D2, B1)*
   - `owns`: `src/stores/RootStore.ts`, `src/stores/context.tsx`,
     `src/services/tools/registry.ts`,
     `src/services/chat/contextModes.ts`, `src/services/persistence/migrations.ts`,
     `tests/stores/RootStore.agenticPlatform.test.ts`,
     `tests/services/tools/registry.agenticPlatform.test.ts`,
     `tests/services/chat/contextModes.agenticPlatform.test.ts`,
     `tests/services/persistence/migrations.agenticPlatform.test.ts`.
   - Sub-items: register stores and the narrow tool facade; migrate persisted
     shapes; enforce the local-data/cloud-route block before prompt assembly.

### Phase 2 — user-facing plugins and background agents

9. **Item D3 — plugin lifecycle and query surfaces** *(depends X1, C4)*
   - `owns`: `src/services/tools/databasePlugins.ts`,
     `src/components/menu/sections/DatabasePlugins.tsx`,
     `src/components/dock/DatabasePluginPanel.tsx`,
     `tests/services/tools/databasePlugins.test.ts`,
     `tests/components/menu/DatabasePlugins.test.tsx`,
     `tests/components/dock/DatabasePluginPanel.test.tsx`.
   - Sub-items: inspect/propose/install confirmation, enable/update/archive,
     permissions/data-policy display, bounded tool result and citations.
10. **Item B2 — strict-route agent runner** *(depends B1/X1; parallel D3)*
   - `owns`: `src/services/chat/agentTasks.ts`,
     `src/services/tools/spawnTask.ts`, `src/stores/ChatStore.ts`,
     `tests/services/chat/agentTasks.test.ts`,
     `tests/services/tools/spawnTask.test.ts`,
     `tests/stores/ChatStore.agentTasks.test.ts`.
   - Sub-items: exact route pin, pre-round budget enforcement, DB/tool policy
     injection, no nested tasks, interruption and attempt-aware retry.
11. **Item B3 — task-center agent controls** *(depends B1, C4; parallel D3/B2)*
    - `owns`: `src/components/dock/TaskCenterPanel.tsx`,
      `src/components/dock/task-center/AgentTaskDetails.tsx`,
      `tests/components/dock/TaskCenterPanel.agentTasks.test.tsx`,
      `tests/components/dock/AgentTaskDetails.test.tsx`.
    - Sub-items: route/grants/budgets/pending reasons, cancel/retry, partial
      result and spend-cap states; preserve image-task rendering.

### Phase 3 — self-scheduling

12. **Item S1 — schedule-v2 domain and persistence** *(depends C2/B1)*
    - `owns`: `src/core/schedules.ts`, `src/services/schedulesStorage.ts`,
      `src/stores/SchedulesStore.ts`, `tests/core/schedules.v2.test.ts`,
      `tests/services/schedulesStorage.v2.test.ts`,
      `tests/stores/SchedulesStore.v2.test.ts`.
    - Sub-items: triggers/timezones/DST, proposal/consent state, wake caps,
      one catch-up, overlap/coalescing, TaskSpec enqueue facade, v1 migration.
13. **Item S2 — schedule proposal and controls** *(depends S1/B2/C4)*
    - `owns`: `src/services/tools/schedules.ts`,
      `src/components/menu/sections/AgentSchedules.tsx`,
      `src/services/notifications/scheduleNotifications.ts`,
      `tests/services/tools/schedules.v2.test.ts`,
      `tests/components/menu/AgentSchedules.test.tsx`,
      `tests/services/notifications/scheduleNotifications.test.ts`.
    - Sub-items: approval card, exact route/grant/cap summary, pause/edit/run-
      now/archive, renewed-consent rules, honest app-open copy.

### Phase 4 — outcome learning

14. **Item I1 — local outcome journal** *(depends C3/B2)*
    - `owns`: `src/services/outcomes/`, `src/stores/OutcomeStore.ts`,
      `tests/services/outcomes/`, `tests/stores/OutcomeStore.test.ts`.
    - Sub-items: IndexedDB journal/hot index, redaction, task completion
      ingestion, feedback mutation, export/retention, deterministic metrics.
15. **Item I2 — lesson proposal and retrieval** *(depends I1; parallel UI below)*
    - `owns`: `src/services/learning/`, `src/stores/LearningStore.ts`,
      `tests/services/learning/`, `tests/stores/LearningStore.test.ts`.
    - Sub-items: bounded local evaluator, scoped evidence-linked proposal,
      accepted-lesson semantic source, injection delimiter, regression disable.
16. **Item I3 — feedback/review UI** *(depends C3/C4; parallel I2)*
    - `owns`: `src/components/editorial/TaskFeedback.tsx`,
      `src/components/menu/sections/Learning.tsx`,
      `src/components/dock/LearningPanel.tsx`,
      `src/services/learning/lessonDiff.ts`,
      `tests/components/editorial/TaskFeedback.test.tsx`,
      `tests/components/menu/Learning.test.tsx`,
      `tests/components/dock/LearningPanel.test.tsx`,
      `tests/services/learning/lessonDiff.test.ts`.
    - Sub-items: feedback capture, evidence view, accept/reject, prompt/skill
      diff, version activation, disable/rollback, privacy controls.

### Phase 5 — composition and evidence

17. **Item X2 — integration, truth docs, and acceptance** *(depends all prior Items)*
    - `owns`: `src/services/chat/contextModes.ts`,
      `src/services/chat/turnRunner.ts`, `src/stores/RootStore.ts`,
      `src/stores/context.tsx`, `src/services/tools/registry.ts`,
      `tests/services/chat/contextModes.agenticPlatform.test.ts`,
      `tests/services/chat/turnRunner.agenticPlatform.test.ts`,
      `tests/stores/RootStore.agenticPlatform.test.ts`,
      `tests/services/tools/registry.agenticPlatform.test.ts`,
      `tests/e2e/agentic-platform.spec.ts`, `docs/architecture.md`,
      `docs/handbook/capabilities.md`, `docs/changelog.md`, `docs/roadmap.md`,
      and `docs/acceptance/agentic-platform-v1.md`.
    - Sub-items: connect outcomes to TaskStore and accepted lessons to task
      context; run the seven acceptance cases; correct the stale three-agent
      architecture claim to two; document desktop/Web Lite truth and exact
      evidence revisions.

No Item edits the sibling `gatesai-bridge` repository. If later command-task
cancellation or remote workers need bridge evolution, create a separate Story
there with its own protocol pin, compatibility matrix, owns, and acceptance
evidence.
