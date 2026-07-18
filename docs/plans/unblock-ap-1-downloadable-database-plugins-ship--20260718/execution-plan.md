# AP-1 — Downloadable database plugins — execution plan

**Roadmap item:** "AP-1 — Downloadable database plugins. Ship versioned,
data-only knowledge/database bundles that users can inspect, explicitly install
and enable; agents can initiate the approval-gated install flow and query
enabled bundles through bounded read-only operations with stable citations."
(`docs/roadmap.md` -> Agentic platform -> AP-1)

**Ethan's decision:** APPROVED (authoritative, verbatim).

**Canonical design:** [Story AP-1](../07-16-agentic-platform-design.md#story-ap-1--downloadable-database-plugins)
in `docs/plans/07-16-agentic-platform-design.md`. That document is the accepted
product contract; this plan does **not** re-open it. This plan turns AP-1 into
an ordered set of one-session, disjoint, dispatchable Items with exact `owns`
boundaries, acceptance mapping, and verify commands, and ships the first
executable Item as `DISPATCH.md`.

**Scope of this lane:** design/plan only. This lane owns exactly
`docs/plans/unblock-ap-1-downloadable-database-plugins-ship--20260718/` and
writes no source. Each Item below is a separate downstream lane that the
harvesting session dispatches; each carries its own worktree, `owns` fence,
tests, and verification. Nothing here modifies `docs/roadmap.md` or any path
outside this folder.

---

## 1. Why AP-1 is a program, not one lane

AP-1 as written spans a Rust Tauri package engine, a TypeScript service+store,
core parser contracts, root-store/tool-registry/persistence wiring, and a
user-facing lifecycle UI. The accepted design already decomposes this into
**Items C1, D1, D2, X1, D3** across Phases 0-2 of the platform plan. Those
Items are the correct unit of dispatch — each is sized for one session and has
a literal `owns` set. This plan's job is to (a) confirm those boundaries against
the current tree, (b) sequence them with real dependencies, (c) map them to the
AP-1 slice of the V1 acceptance envelope, and (d) hand off the first Item.

A single lane cannot implement AP-1: the `owns` sets of C1/D1/D2/X1/D3 are
disjoint by construction so they can run as separate verified lanes without
stepping on each other, and the integration Item (X1, then platform-wide X2)
is deliberately reserved so no lane edits shared wiring opportunistically.

## 2. Current-tree grounding (verified 2026-07-18)

What already exists in this worktree, confirmed by inspection:

- **Offline Library** is fully shipped and is the pattern to carry forward, not
  to repackage: `src/core/offlineLibrary.ts` (typed `OfflineLibraryResult<T>`,
  error-kind union, versioned manifest), `src/services/offlineLibrary/`,
  `src/stores/OfflineLibraryStore.ts`, `src/services/tools/offlineLibrary.ts`,
  Rust `src-tauri/src/offline_library.rs` (fixed-authority commands
  `offline_library_read` / `offline_library_search`, registered in
  `src-tauri/src/lib.rs` `generate_handler!`), ADR
  `docs/adr/2026-07-12-offline-library-plugin.md`, fixtures under
  `tests/fixtures/offline-library/`. AP-1's UI/registry must show the Offline
  Library beside packaged plugins as a built-in `loopback_service` adapter
  **without changing its transport** (design "Package and runtime architecture",
  final paragraph).
- **Sibling AP core contracts already landed** from concurrent lanes:
  `src/core/agentTaskPolicy.ts`, `src/core/agentOutcomes.ts` (+
  `tests/core/agentOutcomes.test.ts`), `src/core/agentSchedules.ts`,
  `src/core/subAgentPolicy.ts`. **`src/core/databasePlugins.ts` does NOT yet
  exist** — that is Item C1, the first AP-1 Item and the content of `DISPATCH.md`.
- **No `.gatesdb` engine exists**: no `src-tauri/src/database_plugins.rs`, no
  `src/services/databasePlugins/`, no `src/stores/DatabasePluginStore.ts`, no
  `tests/fixtures/database-plugins/`.
- Persistence uses `CURRENT_CHAT_SCHEMA_VERSION = 3` in
  `src/services/persistence/migrations.ts`; any new persisted enablement shape
  goes through that migration path (X1's job) and bumps the version with a
  migration + tests (repo hard rule).
- Verify gates (root `CLAUDE.md`): `npm run ci` (= vitest + typecheck + lint),
  `npm run test:e2e`, and `cargo test --manifest-path src-tauri/Cargo.toml` when
  `src-tauri/` changed.

Consequence: dependency order is preserved from the design, and C1 is genuinely
unblocked and self-contained (pure TypeScript, no Tauri/UI wiring).

## 3. AP-1 Item breakdown, dependencies, and owns

The AP-1 slice of the platform plan is Items **C1 -> {D1 || D2} -> X1 -> D3**.
Phase-1 Item B1 (TaskStore policy) is an AP-2 concern and is *not* part of AP-1
delivery, though X1 must not break its wiring. Dependencies below are the real
blocking edges.

| Item | Title | Depends on | `owns` (literal) | Verify |
| --- | --- | --- | --- | --- |
| **C1** | Package schema + ADR (pure parser) | — (unblocked now) | `docs/adr/2026-07-18-database-plugin-packages.md`, `src/core/databasePlugins.ts`, `tests/core/databasePlugins.test.ts` | `npm run test -- databasePlugins && npm run typecheck && npm run lint` |
| **D1** | Tauri `.gatesdb` package engine | C1 | `src-tauri/src/database_plugins.rs`, `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/tests/database_plugins.rs`, `tests/fixtures/database-plugins/` | `cargo test --manifest-path src-tauri/Cargo.toml` |
| **D2** | DB plugin service + store | C1 (parallel D1) | `src/services/databasePlugins/`, `src/stores/DatabasePluginStore.ts`, `tests/services/databasePlugins/`, `tests/stores/DatabasePluginStore.test.ts` | `npm run test -- databasePlugins DatabasePluginStore && npm run typecheck && npm run lint` |
| **X1** | Phase-1 platform wiring (AP-1 slice) | D1, D2 | `src/stores/RootStore.ts`, `src/stores/context.tsx`, `src/services/tools/registry.ts`, `src/services/chat/contextModes.ts`, `src/services/persistence/migrations.ts`, their corresponding tests | `npm run ci` |
| **D3** | Plugin lifecycle + query surfaces (UI + model tools) | X1 | `src/services/tools/databasePlugins.ts`, `src/components/menu/sections/DatabasePlugins.tsx`, `src/components/dock/DatabasePluginPanel.tsx`, focused tests | `npm run ci && npm run test:e2e` |

Notes on boundaries:
- X1 in the platform plan also owns Phase-1 wiring for B1/D2 together. For AP-1
  standalone delivery, X1's AP-1 responsibilities are: register
  `DatabasePluginStore` on `RootStore` + expose via `context.tsx` hooks; add the
  narrow model-facing tool facade to `registry.ts`; add the persisted-enablement
  migration + bump schema version; and enforce the **local-data/cloud-route
  block before prompt assembly** in `contextModes.ts`. If B1 (AP-2) has not
  landed when X1 runs, X1 wires only the DB-plugin half and leaves TaskStore
  policy wiring to AP-2's own integration — the `owns` files overlap, so X1 and
  AP-2's B1-wiring must be sequenced, not parallel (flagged as a cross-Story
  coordination point for the harvesting session).
- D3 registers the five model-facing tools as **one file + registry lines +
  honest read-only metadata** per the repo's "new tools" rule.

## 4. The five model-facing tools (facade contract)

Downstream Items implement, but the contract is fixed by the design so C1's
types must anticipate it:

- `database_plugins.list` — installed/enabled metadata + available datasets.
- `database_plugins.search` — bounded text query, dataset enum, `limit`.
- `database_plugins.lookup` — named lookup + typed scalar parameters only.
- `database_plugins.schema` — published field descriptions; never raw SQLite
  internals or rows beyond a bounded projection.
- `database_plugins.propose_install` — creates a user-visible install proposal;
  never downloads or enables by itself.

Every evidence row carries an opaque citation
`gatesdb://<plugin-id>@<version>/<dataset>/<record-id>` that must survive task
result -> origin-thread event -> chat persistence -> export -> rendering (mirrors
the Offline Library `kiwix://`/`db://` citation guarantee, already tested).

## 5. Non-negotiable rails inherited by every AP-1 Item

From design "Privacy and safety rails" and the shared invariants — each Item's
tests must encode the ones it touches:

1. **Data-only, no code.** V1 bundles contain no scripts, native libs, HTML,
   migrations, triggers, runtime SQL templates, secrets, or network endpoints.
2. **Explicit lifecycle.** Install/update/enable/archive are user actions;
   agent-found URLs or plugin content can only produce a **proposal**.
3. **Fixed authority.** The WebView cannot choose host, path, method, redirect,
   SQL, or destination; catalog hosts are user-added/shipped config; redirects
   rejected. Installer is a dedicated Tauri module (app-managed files, not the
   user-workspace jail); the generic `sqlite_query` tool is **not** reused.
4. **Bounds.** Defaults: 256 MiB compressed, 1 GiB expanded, 100 files, 50
   results, 32,000 transcript chars/query; stricter per-dataset manifest limits
   win. Reject absolute paths, `..`, symlinks, duplicate paths, executable
   payloads, digest mismatches, decompression-bomb ratios.
5. **local_only vs cloud_allowed.** Manifest `data_policy` is a *ceiling*;
   default is local-only; user may tighten, never loosen past the author's
   declaration. `local_only` data + cloud route **blocks before context
   assembly** — no provider request, no fallback, no model switch.
6. **Integrity != identity.** `checksums.json` proves payload integrity; an
   optional signature is *displayed* with its key fingerprint and only called
   "trusted" after the user trusts that key/catalog. Mandatory trust roots and
   revocation are explicitly later scope.
7. **Version pinning.** A version used by a running task stays pinned until the
   task ends; updates install side-by-side and require approval to activate;
   never mutate a run in flight.
8. **Evidence, not instructions.** Database text is wrapped as untrusted
   evidence; it cannot request tools, installs, provider changes, schedules,
   memory writes, or prompt edits.
9. **Web Lite honesty.** Install and loopback access are desktop-only; Web Lite
   inspects exported metadata where safe and makes **zero** transport/Tauri
   calls (mirror the Offline Library no-invoke facade).

## 6. Acceptance mapping (AP-1 slice of the V1 envelope)

From design "V1 acceptance envelope", the AP-1-owned cases and where they are
proven:

- **Case 1** (install+enable a sanitized schema-1 bundle, query from a local
  background agent, preserve `gatesdb://` citation through result / origin event
  / persistence / export): spans D1 (install+query engine) + D2 (lifecycle
  state) + X1 (tool facade + persistence) + D3 (UI + tool result); end-to-end
  proof lands in the platform-wide **X2** e2e (`agentic-platform.spec.ts`), with
  each Item unit-testing its slice.
- **Case 2** (`local_only` bundle + cloud route blocks with no provider request
  or fallback): owned by **X1** (`contextModes.ts` block before assembly) with a
  core-level policy test seeded in C1's types and a store test in D2.
- **Case 7** (hostile archive + manifest tests): C1 (hostile manifest fixtures /
  parser) + D1 (hostile archive fixtures: traversal, symlink, bomb, digest,
  duplicate paths, executable payload) + Web Lite degradation in D2/D3.

Cases 3-6 belong to AP-2/AP-3/AP-4 and are out of AP-1 scope; the final
composition Item **X2** runs all seven together and is dispatched only after all
four Stories land.

## 7. Risks and coordination flags for the harvesting session

- **X1 file overlap with AP-2.** `RootStore.ts`, `context.tsx`, `registry.ts`,
  `migrations.ts` are shared integration surfaces. AP-1's X1 and AP-2's B1
  wiring both want them. Sequence them (one merges, the next rebases) — do not
  dispatch as parallel lanes. Flag in the integration Item.
- **Schema-version bump race.** Any concurrent lane that adds a migration bumps
  `CURRENT_CHAT_SCHEMA_VERSION`. Whichever of X1 / AP-2 / AP-3 lands first takes
  the next integer; the rest rebase their migration onto it. Not parallel-safe.
- **`Cargo.lock` churn.** D1 adds a Rust dep for archive/SQLite handling (e.g.
  bounded zip + `rusqlite` immutable open). Adding a dependency is a deliberate
  decision (repo rule) — D1's ADR/PR must justify it and keep the list short;
  prefer crates already in the tree if they suffice.
- **Offline Library must not regress.** The adapter-registry change (design's
  built-in `loopback_service`) is a *display/registry* change only; D2/D3 tests
  must assert the Offline Library transport and its ADR-governed commands are
  untouched.
- **Signature scope creep.** V1 is *display only* for signatures. Any lane
  tempted to enforce trust roots/revocation must stop and route a new ADR — it
  is explicitly later scope.

## 8. Dispatch sequence

1. **Now:** `DISPATCH.md` (Item C1) — pure core parser + ADR, unblocked,
   self-contained, no Tauri/UI. Green on `npm run test -- databasePlugins`,
   `typecheck`, `lint`.
2. **After C1 merges:** dispatch D1 and D2 in parallel (disjoint `owns`).
3. **After D1 + D2 merge:** dispatch X1 (coordinate schema-version + shared-file
   ordering with any concurrent AP-2/AP-3 wiring lane).
4. **After X1 merges:** dispatch D3 (UI + model tools + e2e).
5. **After all four Stories' Items land:** platform-wide X2 runs the seven
   acceptance cases and corrects truth docs. Out of AP-1's lane scope.

`DISPATCH.md` in this folder is the ready-to-run spec for step 1.
