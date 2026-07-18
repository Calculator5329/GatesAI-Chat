# DISPATCH — implement Duel mode v1 (side-by-side compare)

This task is immediately dispatchable. Read `PLAN.md` in this folder first; it
is the authoritative design and records the approved decision (`APPROVED`,
Ethan). This spec implements **v1 only**: side-by-side compare of two models
with pick-a-winner. Cross-review is a **separate** later dispatch — do not fold
it in.

## Task spec

- **title:** Duel mode v1 — side-by-side compare with pick-a-winner
- **model tier:** smart
- **goal:** |
    Implement
    `docs/plans/unblock-duel-mode-two-models-side-by-side-or-cro-20260718/PLAN.md`
    v1 exactly.

    Let a user answer one prompt with two models at once and keep the one they
    prefer. Candidates run on transient in-memory scratch threads (each pinned to
    its own model, built with the existing `branchThreadFrom` clone logic),
    driven by the unchanged `TurnRunner` — the same concurrent-turns-across-
    threads shape background agent tasks already use. Only the chosen answer is
    committed to the real thread, as a normal `AssistantMessage` (its existing
    `model` field records the winner). Do NOT add candidate/variant fields to the
    message model, do NOT rework `streamingByThread` to key by message id, do NOT
    bump `CURRENT_CHAT_SCHEMA_VERSION`, and do NOT add a model-override parameter
    to `TurnRunner`.

    Add a `DuelStore` that owns one transient duel session (two scratch threads,
    two `AbortController`s, per-candidate streaming/usage/error state, and the
    keep/dismiss actions). Expose it through the store context hooks in
    `stores/context.tsx`.

    Duel candidates run in a read-only tool posture: every tool whose side-effect
    predicate is true is suppressed for candidate turns via an explicit
    `RunTurnOptions`/context flag consulted where `toolsForContextMode` assembles
    the tool list; read-only tools stay available. Never weaken a tool's own
    metadata to achieve this. The committed winner then continues the
    conversation with the full tool set.

    Add a composer Duel affordance (turns the next send into a duel) and a "Duel
    again" action on the latest user message. Offer duel only when at least two
    models are ready; otherwise hide/disable with truthful copy. Model A defaults
    to the thread's current model, model B to the next distinct ready model; both
    are selectable via the existing `ModelPopover`, and must differ.

    Render a two-column duel panel: each column shows a model name, its streaming
    answer via the normal `EditorialMessage` body, its usage and finish reason,
    and a "Keep this answer" button; a shared Dismiss discards both. One
    candidate erroring must not affect the other. While a duel is live the
    composer for that thread is locked; switching threads or closing aborts both
    candidates and tears the session down.

    On Keep: append the chosen candidate's assistant message to the real thread
    via the existing append/persist path, set the thread's model to the winner,
    discard the loser, tear down scratch threads, and persist through the normal
    snapshot path. On Dismiss: leave the thread unchanged.

    Both runtimes: Desktop may include local Ollama models; Web Lite offers only
    in-browser-ready models (Ollama absent) and behaves otherwise identically. No
    bridge call on the duel control path.

    Add the PLAN.md test matrix. Update `docs/architecture.md` (turn-pipeline +
    known-limitations), `README.md` if a user-facing claim changes,
    `docs/user-guide.html` if it documents composer actions, and append
    `docs/changelog.md`. Do NOT edit `docs/roadmap.md`; the harvesting session
    performs the verified checkbox transition.
- **owns:**
    - src/core/types.ts
    - src/core/threadOps.ts
    - src/stores/DuelStore.ts
    - src/stores/RootStore.ts
    - src/stores/context.tsx
    - src/stores/ChatStore.ts
    - src/services/chat/turnRunner.ts
    - src/services/chat/contextModes.ts
    - src/components/editorial/DuelPanel.tsx
    - src/components/editorial/EditorialComposer.tsx
    - src/components/editorial/EditorialMessage.tsx
    - src/components/editorial/EditorialChat.tsx
    - src/components/editorial/ModelPopover.tsx
    - tests/stores/DuelStore.test.ts
    - tests/services/chat/duelTools.test.ts
    - tests/core/threadOps.test.ts
    - tests/components/editorial/DuelPanel.test.tsx
    - tests/components/editorial/EditorialComposer.test.tsx
    - tests/e2e/desktop.spec.ts
    - tests/e2e/web-lite.spec.ts
    - docs/architecture.md
    - docs/changelog.md
    - README.md
    - docs/user-guide.html
- **test-cmd:** `npm run ci && npm run test:e2e`

## Open implementation choice (pick the least invasive; document it)

`TurnRunner.run` takes a `threadId` and looks the thread up through its host.
Two viable ways to run candidates on transient threads — the implementer picks
one and records the choice in the changelog/architecture note:

1. **Transient-thread tier in `ChatStore`.** Register the two scratch threads in
   an in-memory-only map the runner's `TurnHost` can resolve, but which the
   sidebar list, autosave snapshot, and export all filter out (same "not a real
   thread" treatment the code already applies to `naming`/soft-deleted rows).
   `DuelStore` drives `ChatStore.runTurn`-equivalent entrypoints against those
   ids. Reuses the most existing machinery; the filtering must be airtight (a
   scratch thread must never reach storage).
2. **Standalone runner host in `DuelStore`.** `DuelStore` constructs its own
   `TurnHost` over its own scratch-thread objects and calls `TurnRunner.run`
   directly, keeping all duel state out of `ChatStore`. Cleaner isolation; more
   wiring (host facade, model registry/router access) to reproduce.

Either way: candidate turns must reuse the real `TurnRunner`, `LlmRouter`, and
provider adapters unchanged, get real streaming/usage/finish-reason/errors, and
observe their own abort signals. The read-only tool posture is a run-path flag,
not a fork of the runner.

## Required test matrix

1. `DuelStore.start` builds two scratch threads that clone the active thread's
   messages up to the triggering user message, pin models A and B, and copy
   `contextMode`/`thinkingEffort`/`skillId`. New composer-prompt duels append the
   user message; "duel again" reuses the last user message.
2. Scratch threads never appear in the persisted `threads` list, the saved
   snapshot, or an export.
3. Both candidates stream concurrently; each has an independent abort signal.
   Aborting one, thread-switch, or session teardown cancels both without leaking.
4. One candidate erroring leaves the other running; the failed column disables
   its Keep action and shows the normal turn-error formatting.
5. **Read-only tool posture:** a candidate turn requesting a side-effecting tool
   (e.g. `fs` write / `terminal` / `git`) never executes it; a read-only tool
   (e.g. `web_search`/`time`) still runs. Assert at the tool-list/executor seam.
6. Keep commits exactly the chosen candidate's `AssistantMessage` (model, usage,
   finish reason, read-only tool parts intact) to the real thread, sets the
   thread `modelId` to the winner, and discards the loser + scratch threads.
7. Dismiss leaves the real thread unchanged (no message appended, model
   unchanged).
8. A committed duel winner round-trips through the existing snapshot/export path
   and reloads as an ordinary assistant message — no new field, no migration.
   `CURRENT_CHAT_SCHEMA_VERSION` is unchanged.
9. Duel affordance is offered only with ≥2 ready models; with <2 it is
   hidden/disabled with truthful copy. Model B defaults to a distinct ready
   model; A and B cannot be equal.
10. Component/E2E: composer Duel toggle + latest-user-message "Duel again" start
    a duel; the two-column panel renders both streams with model names, usage,
    finish reason; Keep and Dismiss behave per spec. Covered in both the
    desktop-mocked and web-lite Playwright projects.
11. Web Lite exposes the same panel/actions with only in-browser-ready models
    (no Ollama entries) and no bridge call on the duel path.

## Acceptance details

- No `candidates`/`variants`/`turnId` field is added to `AssistantMessage`; the
  message model and `streamingByThread` keying are unchanged.
- `CURRENT_CHAT_SCHEMA_VERSION` stays 3 (unless an unrelated already-merged lane
  moved it — do not add a duel-specific bump either way) and no duel migration is
  registered.
- `TurnRunner` gains no model-override parameter; candidate model selection is
  entirely via each scratch thread's `modelId`.
- Side-effecting tools are provably suppressed in candidates via a run-path flag,
  not by editing tool metadata or `eslint.config.js` layer rules.
- No new dependency, no `src-tauri/`/Rust, no bridge, no sibling-repo, no secret,
  and no deployment change is present.

## Dispatcher notes

- No Ethan gate remains; `APPROVED` is authoritative.
- v1 is compare-only. Cross-review ("or cross-reviewing") is a **separate** later
  dispatch that reuses `DuelStore` with a `mode: 'compare' | 'cross-review'` flag
  and a review-prompt template — see PLAN.md §v2. Do not implement it here.
- Respect the layer boundaries (UI → stores → services → core) and the existing
  hard rules in `CLAUDE.md`: no raw `console.*`/`fetch`/`localStorage` in
  stores/components; React↔store wiring goes through `stores/context.tsx`.
- Playwright may need the orchestrator's outside-sandbox verifier because a
  sandbox cannot bind the Vite listener. Do not weaken or skip the suite.
- Watch token spend: a duel runs two models, so the panel must surface both
  candidates' usage and the pre-send affordance must make the double-run obvious.
