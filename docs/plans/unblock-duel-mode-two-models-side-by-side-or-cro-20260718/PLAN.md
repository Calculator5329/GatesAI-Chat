# Duel mode — two models side-by-side or cross-reviewing

**Status:** approved; design + implementation handoff (source lands in a
follow-up lane per `DISPATCH.md`)

**Decision:** `APPROVED` (Ethan, authoritative)

**Roadmap source:** `docs/roadmap.md`, Visions → *Moonshots / new
directions*: "Duel mode: two models side-by-side or cross-reviewing".

**Scope of this lane:** design and an exact, bounded v1 implementation
handoff. No source changes here — my lease covers only this folder.

## Outcome

A user can pose one prompt to **two models at once** and see their answers
**side-by-side**, then keep the one they prefer. The conversation stays a
single linear thread: only the chosen answer is committed; the loser is
discarded. **Cross-review** (model B critiques/refines model A's answer) is a
designed v2 that reuses the same primitives and is dispatched separately so v1
can ship small and safe.

The feature works in Desktop and Web Lite, adds **no persistence-schema
migration**, and never lets two candidate models both perform irreversible
side-effecting tool actions.

## Corrected baseline — what already exists

This is a greenfield feature (no `duel`/`compare`/`variant`/`candidate` code
exists anywhere in `src/`), but almost every primitive it needs is already in
the codebase. Do **not** rebuild these; compose them.

- **One model per thread, one assistant message per turn.** `Thread.modelId`
  (`src/core/types.ts:255`) pins the model; `TurnRunner.run(threadId, signal,
  options)` (`src/services/chat/turnRunner.ts:182`) creates exactly one
  `AssistantMessage` with `model: thread.modelId` (`turnRunner.ts:186-194`) and
  `buildTurnRequest` (`turnRunner.ts:497`) derives the whole request from
  `thread`. `AssistantMessage` (`types.ts:92`) carries a single `model?` field —
  there is **no** variant/candidate/alternatives array.
- **Concurrent turns on separate threads already work — this is the key
  enabler.** Background agent tasks run up to `MAX_CONCURRENT_AGENT_TASKS`
  `TurnRunner.run` calls concurrently, each on its own thread with its own
  `AbortController` (`ChatStore.ts:1257-1283`, `SchedulesStore.ts:195`,
  `controllersByThread` at `ChatStore.ts:129`). The **only** concurrency blocker
  is `ChatStore`'s per-thread single-slot streaming state —
  `streamingByThread` / `streamActivityByThread` / `controllersByThread`
  (`ChatStore.ts:113-129`) key streaming by *thread id*, so two live streams in
  the **same** thread would collide. Duel mode sidesteps this entirely by
  running each candidate on its **own** scratch thread — no change to the
  streaming-state keying is needed. The provider layer (`services/llm/*`) has no
  shared mutable state and is already safe for concurrent streams
  (`openaiCompat.ts:70`, `streamCore.ts:96-130`).
- **Branch/regenerate primitives.** `branchThreadFrom` (`threadOps.ts:144`)
  clones a thread's messages up to a chosen message (copying `modelId`,
  `contextMode`, `thinkingEffort`, `skillId`); `regenerateThreadFromAssistant`
  (`threadOps.ts:167`) truncates back to a user message. Duel candidates are
  built with the same clone-up-to-the-user-prompt logic.
- **Per-thread model + context + tool wiring.** `ChatStore.setThreadModel`
  (`ChatStore.ts:706`), `setThreadContextMode` (`:723`); tool availability is
  gated by `toolsForContextMode` (`contextModes.ts:88`) and per-tool
  read-only/side-effect metadata the batch executor already reads.
- **Model picker UI.** `ModelPopover.tsx` + `modelPopoverSections.ts` list
  selectable/ready models per runtime (and already hide local models in Web Lite,
  `ModelPopover.tsx:306`); reuse for the second model. `ModelRegistry.findById`
  (`ModelRegistry.ts:61`) resolves names/capabilities.
- **Message rendering.** `EditorialMessage.tsx` renders one assistant message;
  `EditorialChat.tsx` is the windowed list host (per-message frame at
  `EditorialChat.tsx:814-880`). The duel columns are a transient overlay, not
  new persisted message rows.
- **Runtime gating.** `core/runtime.ts` (`isWebLite`, `hasDesktopRuntime`) plus
  ready-provider checks already tell us which models can run where.
- **Persistence.** `CURRENT_CHAT_SCHEMA_VERSION = 3` (`migrations.ts:5`);
  `canonicalizeMessage` (`messageParts.ts:72`) spreads whole messages so a
  committed winner needs no new field and no migration.

## The core design decision: ephemeral candidates, commit the winner

Two shapes were considered:

1. **Persisted variants** — store N candidate answers per turn, either as a
   `candidates[]` array on `AssistantMessage` or as sibling messages linked by a
   new `turnId`. Requires a message-model change, a `streamingByThread` rework to
   key streaming by message id (`ChatStore.ts:113-129`), a schema bump + v3→4
   migration (`migrations.ts:5`), duel-aware rendering with windowing
   height-measurement reconciliation (`EditorialChat.tsx:814-884`), and
   export/import/archive handling for a fan-out history. The architecture
   explicitly flags "message model is not content-parts" as a known limitation
   (`docs/architecture.md`), so this is a large, risky change.
2. **Ephemeral candidates, commit one** *(chosen)* — run both answers on
   transient in-memory scratch threads (each its own thread id, so the existing
   per-thread streaming slot and `TurnRunner` work unchanged), render them
   side-by-side, and append only the chosen answer to the real thread as a normal
   `AssistantMessage` (its `model` field already records which model produced it).
   Thread history stays linear and portable. **No migration, no message-model
   change, no streaming-state rework, no export/import work, no `TurnRunner`
   model-override parameter** (each scratch thread already pins its own model).

Shape 2 is the v1. It reuses the proven agent-task concurrency shape, keeps the
blast radius small, ships the user-visible value (compare two models, keep the
best), and leaves a clean seam for v2 cross-review and a possible future "keep
both as branches" without redoing the plumbing.

## v1 — side-by-side compare ("Duel")

### Trigger & entry points

- A **Duel** affordance in the composer (a toggle/icon next to Send, added in
  `EditorialComposer.tsx` near the existing model-pick wiring at `:139-142`)
  turns the next send into a duel: the typed prompt is answered by both selected
  models.
- A **"Duel again"** action on the latest user message (mirroring the existing
  regenerate button at `EditorialMessage.tsx:224-234`) re-runs the most recent
  prompt against two models without retyping.

Duel is only offered when the runtime has **at least two ready models**.
Otherwise the affordance is hidden or disabled with truthful copy ("Add or
connect a second model to duel").

### Model selection

- **Model A** defaults to the thread's current `modelId`.
- **Model B** defaults to the next distinct ready model (deterministic pick:
  first ready model that is not A). Both are user-changeable through the existing
  `ModelPopover` selection; the two must be distinct.
- In Web Lite, the selectable set is whatever is ready in-browser (OpenRouter /
  OpenAI-compatible keys). Local Ollama models require the Desktop bridge and are
  simply absent from the Web Lite duel picker (the popover already applies this
  gate) — graceful degradation, never a half-working control.

### Execution

Introduce a small **`DuelStore`** (MobX) that owns a transient duel session:

- On start, build **two scratch `Thread` objects** from the active thread using
  the same message-clone logic as `branchThreadFrom` (messages up to and
  including the triggering user message; append the user message when starting
  from a fresh composer prompt). Each scratch thread is pinned to model A / model
  B and copies `contextMode`, `thinkingEffort`, and `skillId`.
- Scratch threads are **not** added to the persisted `threads` list / sidebar and
  are **never** written to storage. See "Open implementation choice" in DISPATCH
  for the two viable ways to run `TurnRunner` against a transient thread; the
  follow-up lane picks the least invasive.
- Run both candidates **concurrently**, each with its own `AbortController`,
  reusing `TurnRunner` unchanged so both candidates get real streaming, usage,
  finish reason, and activity — the same pipeline a normal turn uses. This is the
  exact shape agent tasks already use to run concurrent turns across threads.

### Safety: side-effecting tools are suppressed in candidates

This is the load-bearing safety rule. Two models answering the same prompt must
**not** both run irreversible actions (file writes, terminal, git, image jobs,
`spawn_task`, MCP side-effects). Candidates run in a **read-only tool posture**:

- Read-only tools (per the side-effect/read-only metadata the batch executor
  already consults — `web_search`, `recall`, `time`, read-only `inspect_file`,
  `chat_history`, etc.) remain available so answers are grounded.
- Every tool whose side-effect predicate is true is **suppressed** for duel
  candidates. Implement as an explicit filter on the duel run path (a
  `RunTurnOptions`/context flag consulted where `toolsForContextMode`
  (`contextModes.ts:88`) assembles the tool list), **not** by weakening any
  tool's own metadata.
- The **winner**, once committed, continues the conversation as a normal thread
  turn with the full tool set — so nothing is permanently lost; the user compares
  *answers* first, then the chosen model acts.

This rule is in the DISPATCH acceptance list and must have a direct test (a
side-effecting tool call requested inside a duel candidate is never executed).

### UI — the duel panel

- A two-column panel (overlay or right-dock region) titled with each model's
  name (via `ModelRegistry.findById(modelId)?.name`), each column streaming its
  candidate answer through the normal `EditorialMessage` body renderer, plus
  per-candidate usage (tokens/cost) and finish reason.
- Each column has a **"Keep this answer"** action. A shared **Dismiss** discards
  both and leaves the thread unchanged (no message appended).
- While a duel is live, the main composer is disabled for that thread (mirrors
  the existing "turn in flight" lock, `isThreadStreaming` at `ChatStore.ts:457`).
  Switching threads or closing aborts both candidate turns via their signals and
  tears down the session (same lifecycle as an aborted turn).
- Errors are per-column: one candidate failing does not kill the other; the
  failed column shows the normal turn-error formatting and its "Keep" action is
  disabled.

### Commit

On **Keep this answer**:

1. Append the chosen candidate's `AssistantMessage` (unchanged, including its
   `model` field, usage, finish reason, and any read-only tool parts) to the
   **real** thread via the existing append/persist path (`appendMessage`,
   `ChatStore.ts:1410`).
2. Set the real thread's `modelId` to the winning model (`setThreadModel`), so
   the conversation naturally continues with the model the user just preferred.
   (Design choice: switch to the winner — the least surprising default, visible
   in the model pill; the user can always switch back.)
3. Discard the losing candidate and tear down the scratch threads.
4. Persist through the existing snapshot path — a committed duel winner is
   indistinguishable from a normal assistant message (`canonicalizeMessage`
   spreads it as-is), so **no** migration, export/import, or archive change is
   needed.

### Persistence

None for candidates. The only persisted artefact is the committed winner, which
uses the existing `AssistantMessage.model` field and the current schema. Do
**not** bump `CURRENT_CHAT_SCHEMA_VERSION`. (Note: a sibling SP-1 lane may bump
3→4 for `systemPromptOverride`; duel v1 deliberately needs no schema change and
must not add one — if both land, the harvesting integration keeps SP-1's bump
and duel adds nothing.)

### Runtime parity

- **Desktop:** models A/B may include local Ollama models (bridge online).
- **Web Lite:** duel across cloud / OpenAI-compatible models only; Ollama models
  absent from the picker. The panel, keep/dismiss, and commit behave identically.
  No Desktop bridge call is on the duel control path itself.
- **Spend:** two concurrent streams double token spend for that turn. Surface it
  — the duel panel shows each candidate's usage, and the pre-send affordance
  should make it obvious two models will run.

## v2 (designed, dispatched separately) — cross-review

Cross-review answers the roadmap's "or cross-reviewing" half. It reuses the
scratch-thread + commit primitive:

1. Model A answers the prompt normally (or reuse an existing assistant message).
2. Model B is run on a **review turn**: a scratch thread seeded with the prompt
   and A's answer plus a built-in review instruction ("critique this answer for
   correctness/completeness; if you can improve it, provide a revised answer").
   B's output renders as a review card beneath A's answer.
3. The user can **keep A**, **keep B's revision**, or **dismiss** — the same
   commit primitive as v1.

v2 needs only: a review-prompt template (new built-in system text, analogous to
`MICRO_LOCAL_SYSTEM_PROMPT` / the agent-task prompt), a `mode:
'compare' | 'cross-review'` flag on the duel session, and a review-card
renderer. It intentionally does **not** ship in v1 to keep the first lane bounded
and the safety story simple. A separate dispatch follows once v1 is green.

## Non-goals for v1

- No persisted duel history / branch-of-both. (A future "keep both as branches"
  can build on `branchThreadFrom`.)
- No 3+ way duels. Exactly two columns.
- No side-effecting tools inside candidates.
- No schema migration, export/import, or message-model/content-parts change; no
  `streamingByThread` message-keyed rework.
- No `TurnRunner` model-override parameter (scratch threads pin their own model).
- No new dependency, no Rust/bridge/sibling-repo change.
- No prompt-preset or leaderboard/scoring system.

## Definition of done (for the follow-up implementation lane)

1. A user can start a duel from the composer and from the latest user message,
   pick two distinct ready models, and see both answers stream side-by-side.
2. "Keep this answer" commits exactly one answer as a normal assistant message,
   switches the thread to that model, and tears down candidates; "Dismiss"
   leaves the thread unchanged.
3. Side-effecting tool calls requested inside a duel candidate are never
   executed; read-only tools still work. Covered by a direct test.
4. One candidate erroring does not affect the other; abort/thread-switch tears
   down both cleanly.
5. Desktop and Web Lite both expose the feature; Web Lite omits bridge-only
   models with truthful copy; no schema migration is introduced.
6. Committed winners round-trip through the existing persistence/export path
   unchanged (regression test that a duel-committed message is a normal message).
7. `npm run ci` and `npm run test:e2e` green (no `src-tauri/` change expected, so
   no `cargo test`). Docs updated (`architecture.md` turn-pipeline / known-
   limitations, `README` if user-facing claims change, `changelog.md`); the
   roadmap checkbox is left for the harvesting session.

## Verification

```sh
npm run ci
npm run test:e2e
```

No Rust, bridge, network, secret, dependency, or deployment work is required for
v1.
