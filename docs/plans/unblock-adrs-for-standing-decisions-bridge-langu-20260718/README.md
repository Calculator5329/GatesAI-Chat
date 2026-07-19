# Plan: ADRs for standing decisions (bridge language, Firestore parked, updater)

- Roadmap item (Docs & stories): "ADRs for standing decisions (bridge language,
  Firestore parked, updater)"
- Ethan's decision (verbatim): **APPROVED**
- Task id: `unblock-adrs-for-standing-decisions-bridge-langu-20260718`
- Owned path: `docs/plans/unblock-adrs-for-standing-decisions-bridge-langu-20260718/`

## What this item asks for

Three long-standing architectural choices have been assumed but never written
down as Architecture Decision Records. Capture them in the established ADR
format (`docs/adr/…`, see `docs/adr/2026-07-12-offline-library-plugin.md`) so
future sessions treat them as deliberate, cite-able decisions rather than
folklore, and so any reversal must supersede a real ADR.

## Deliverables (finished ADRs, drafted here)

These three files are complete and ready to be placed under `docs/adr/`. They
were authored in this lease folder because the lease covers only this directory;
the follow-up task (`DISPATCH.md`) moves them into `docs/adr/` and wires the
index links.

1. `adr-2026-07-18-go-bridge-language.md` — the companion **Go** bridge stays a
   separate-repo Tauri sidecar over the versioned WebSocket protocol; Rust vs
   Go authority boundary; cross-references the active
   `decide-deliberately-go-bridge-vs-folding` deliberation as a scheduled review
   that may supersede it.
2. `adr-2026-07-18-firestore-parked-cloud-sync.md` — persistence is
   **local-first**; **Firestore / hosted cloud sync is parked** behind the
   existing `PersistenceProvider<T>` boundary; unparking needs its own ADR and
   an opt-in, E2E-encrypted, user-owned model.
3. `adr-2026-07-18-desktop-auto-updater.md` — signed **auto-updater** via the
   public releases repo (`tauri-plugin-updater`, pubkey pinned in
   `tauri.conf.json`, `latest.json` manifest, user-gated `UpdatePill`), records
   the shipped W-5 decision; Windows signing/SmartScreen is explicitly a
   separate ADR.

## Grounding (facts each ADR is built from)

- Bridge: `docs/architecture.md` "Bridge and workspace" + "Rust layer";
  `docs/bridge-protocol.md` (protocol v2, `ws://127.0.0.1:7331/ws`, health on
  `:7331/health`, sidecar spawn in `src-tauri/src/lib.rs`); cross-repo rule in
  `CLAUDE.md`.
- Persistence: `docs/architecture.md` "Persistence" (localStorage `state.v1`
  schemaVersion 2, IndexedDB `gatesai-chat` archive, migrations, corruption
  quarantine, bridge workspace mirror); `PersistenceProvider<T>` boundary
  (shipped, roadmap "Later"); Cloud track (E2E-encrypted, user-owned storage).
- Updater: `docs/changelog.md` 2026-07-12 (W-5); `docs/release-checklist.md`
  "Auto-updater signing"; `src-tauri/tauri.conf.json` `plugins.updater.pubkey`.

## Scope notes / non-goals

- No source or app-behavior changes — this item is documentation only. The ADRs
  describe decisions already in force.
- The **repo-visibility** ADR and the **signed/trusted Windows release** ADR are
  tracked by their own roadmap items and are *not* part of this item; each ADR
  here points at those as separate decisions.
- This lease does not (and must not) edit `docs/roadmap.md`, `docs/architecture.md`,
  or `docs/adr/`; the harvesting session ticks the roadmap and the follow-up
  task performs the file move + index wiring.

## Verification

Docs-only; no test suite applies. The follow-up task's acceptance is a link/lint
check (`npm run docs:check` if present, else `npm run lint` staying green after
the doc move) and that the three ADRs render with resolvable relative links.
