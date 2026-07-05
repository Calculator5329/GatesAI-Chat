# Engineering patterns

The conventions that keep this codebase coherent as it grows. When adding code — human or
AI — match these; when one stops serving, change it deliberately and update this page.

## Layering (enforced by ESLint, not convention)
`UI → stores → services → core`, one-way. Components never import services directly; stores
never touch `fetch`/`localStorage` directly. The import rules in `eslint.config.js` are load-
bearing — violations are build failures, which is why five different AI agents have extended
this codebase without dissolving its structure.

## Host interfaces over god objects
Big orchestration lives in services that talk BACK to stores through narrow, explicit
interfaces: `TurnRunner` gets a ~15-method `TurnHost`; the auto-namer, RAG injection, skills,
and summaries reach ChatStore only through `set*Provider(...)` hooks wired in RootStore.
Rule of thumb: if a service needs a store, define the smallest interface it truly needs and
inject it — never import the store.

## One-way provider hooks in RootStore
RootStore is the ONLY place stores learn about each other, always as lazy getters/callbacks
(`setRecentSummariesProvider`, `setSemanticContextProvider`, `setToolStoresProvider`, ...).
This keeps the dependency graph acyclic and makes every cross-store edge visible in one file.

## Availability gating, one mechanism
A tool/model/feature that can't work right now is HIDDEN, not disabled: Web Lite hides bridge
tools, offline Ollama hides local models, a disconnected MCP server withdraws its tools,
skills' allowlists filter advertised tools. All of it flows through the registry's gating and
`core/modelPickerAvailability` — never add a second filtering path.

## Pure core, testable everything
Decision logic lives in `core/` as pure functions (`threadOps`, `defaultModel`,
`modelPopoverSections`, `schedules` due-time math, `usage` cost math, `lineDiff`). Stores call
them inside actions. This is why 900+ unit tests run in seconds with no mocking heroics.

## Storage slots + migrations
Each feature persists through its own small storage service (a `PersistenceProvider` slot).
The chat snapshot carries `schemaVersion` with an ordered migration registry
(`services/persistence/migrations.ts`); ad-hoc value coercion is the legacy pattern — new
shape changes get a numbered migration. Unknown FUTURE versions are backed up, never cleared.
Secrets never live in these slots — they go through `secretStorage` (OS keychain on desktop).

## Guard-rail testing
The two suites `tests/stores/ChatStore.test.ts` and `tests/stores/toolLoop.test.ts` are the
behavioral contract for the chat pipeline. Refactors must pass them UNMODIFIED; that rule
caught a real chunk-delivery regression during the streaming-executor extraction. The same
idea repeats: overlay features carry a sidebar-clickability regression test (a real historical
bug), destructive ops carry write-order tests.

## Streaming discipline
One abort envelope (`StreamingRoundExecutor`) — no scattered signal checks. Retries only
before first content, never after user abort, abort-aware backoff. Wire-format quirks stay in
each provider; shared semantics (tool-call assembly, finish reasons) live in `streamCore`.

## The delegation pipeline
Feature waves are implemented by Codex CLI agents from written task prompts (kept out of the
repo), each on its own branch, then independently reviewed, `npm run ci`-verified (plus
`cargo test` / e2e / browser checks as relevant), and merged `--no-ff`. The prompts encode the
guard rails above; the merge gate enforces them. Definition of done for ANY change:
`npm test` + `npm run typecheck` + `npm run lint` green, new logic tested, Web Lite degrades
gracefully, honest commit messages.

## UI conventions
Inline style objects with CSS variables from `styles/editorial.css` + `core/styleTokens.ts`;
one 140ms motion standard with `prefers-reduced-motion` respected; overlays fully unmount when
closed (never `display:none` full-screen layers); action UI stays inside its owner's layout
box; every interactive element has hover/focus-visible/disabled states; empty states are one
quiet serif sentence.
