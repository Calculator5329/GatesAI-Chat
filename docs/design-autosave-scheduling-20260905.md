# A53 — schedule deep autosave observation with the existing throttle

Adopted and implemented source candidate, 2026-09-05; focused checks and all required gates passed; parent source and commit review passed. Source-only synthetic work, no real conversations or provider calls. The unchanged baseline and source hashes live in `/home/ethan/.cache/tmp/astra-chat-hotpath`.

## Measured problem and design choice

The persistence coordinator currently throttles writes after its immediate MobX autorun traverses all retained messages and serializes nested tool arguments. Forty one-character mutations with 1,000 inactive synthetic tool messages performed 40,000 argument serializations (10.68 million characters) in 480.55 ms while scheduling only the initial save. This is one Node baseline measurement, not a browser frame claim.

Move the existing leading/trailing 250 ms scheduling boundary around the autorun execution using MobX's supported per-autorun scheduler. Keep the initial run immediate. On later invalidation, retain one runner and execute it at the next allowed time; that runner reads the latest snapshot and performs the unchanged deep field observation and ordinary schedule call. No per-message cache, version protocol, signature equality shortcut, new public interface, or persistence schema change.

The installed MobX implementation in `src/api/autorun.ts` coalesces invalidations until the supplied runner executes, then checks reaction disposal before tracking. Therefore synchronous teardown must drain a pending runner BEFORE disposing its reaction; pagehide/beforeunload likewise drain it and synchronously flush the persistence slot. Cancel timers, remove listeners, and make repeated disposal harmless. Paused/follower paths must not schedule or flush writes. Workspace queue serialization and failure recovery remain unchanged.

## Interrogation and stream check

- Failed future: tokens or a replaced thread array vanished on unload because a deferred reaction was disposed before reading the latest snapshot. Tests must cross the actual start/teardown interface, not inspect timer internals.
- Simpler alternative: retain the current write-only throttle. It cannot reduce the measured scans. Per-message caches add observer lifetimes and invalidation complexity that the existing scheduler avoids. Adopt the scheduler.
- Vocabulary/fit: existing coordinator, snapshot, reaction, and flush vocabulary and interfaces remain. No spend, publication, schema, or new architecture authority is needed.
- Incidence: this is the measured autosave-scan finding; the existing code documents earlier nested-observation data loss. No claim of a complete historical incident count.
- Symptom/spine: scheduling occurs after the expensive observation stage. Moving admission before that stage repairs the stream's scheduling placement, rather than adding a second cache.
- Context: execute the actual pending MobX runner against the latest snapshot; do not reconstruct a stale pending snapshot or drop field dependencies.
- Designed: the same leading/trailing policy spans observation and save, with explicit synchronous lifecycle drains. The guard is aligned with the existing stream.

## Acceptance and separate concern

Use the unchanged actual-MobX fixture with identical source data/token updates against baseline and candidate. Count serializations and read the final persisted content; timing is secondary. Verify immediate leading save, trailing coalescing, same-length replacements, nested tool-argument edits, latest structural snapshot, appends during a pending run, both unload events, disposal, repeated disposal, and paused/follower no-write behavior. Retain existing workspace queue/failure tests.

Inspect attachWorkspacePersistence while paused separately: the existing method bypasses schedule's pause check. If a synthetic test confirms that invariant failure, report it for separate scope adoption rather than silently changing queue policy here.

Required CI (unit/type/lint) and full E2E run only in a coordinated resource window. Parent independent source/lifecycle review precedes commit. Exact seven owned files are coordinator, its test, the named workspace-pause trigger, this design, architecture, roadmap, and changelog. No live workspace activation or publication.

## Implemented candidate and focused verification

The narrow scheduler change is implemented; 18 focused coordinator tests passed. The unchanged field walker observes the latest snapshot only on admitted reaction execution. Teardown drains while MobX can still run, then disposes and clears listeners. Tests use actual local persistence and canonical message selectors after reload (the loader migrates legacy fields and merges adjacent assistant records). Initial test assertions incorrectly read legacy fields/positions after normalization; that fixture failure is retained as `focused-initial-fixture.log`, and the assertions now verify canonical content and call identity without changing production behavior.

The exact same-input updated probe records baseline and candidate in `baseline-comparison.json` and `candidate-comparison.json`. For 1,000 historical tool messages and 40 streamed characters, baseline performed 40,000 argument serializations / 10.68 million characters in 347.20 ms; candidate performed none during token mutations (0.24 ms), then 1,000 / 267,000 characters during a forced reaction drain (16.11 ms). This is a single-run Node comparison with persistence writes stubbed; operation counts are the primary evidence, not a claim of measured browser frame speed. Actual persisted final text and deep argument edits are independently covered by focused tests. The probe's overridden schedule method counts invocations, not real writes.

Separate baseline issue confirmed: a paused coordinator still writes once when workspace persistence attaches (`paused-attach.json`: paused true, workspaceSaves 1). That path was initially left untouched by A53; the separately adopted A54 correction below now suppresses it. This is not evidence that paused ordinary schedule/unload writes bypass their existing checks; focused tests cover those paths.

Full CI/type/lint and the complete E2E suite passed in the coordinated windows. Parent source review precedes delivery. No live data or providers were accessed.

## A54 — separate adopted workspace pause suppression

The actual baseline also starts a queued workspace snapshot after pause when an earlier save settles (`paused-drain.json`: initial and queued-before-pause both saved while paused). This is distinct from A53's observation cost. The adopted narrow correction clears pending workspace state on pause and checks pause at both enqueue and drain. Attaching while paused establishes the adapter but cannot start a save. A write already in flight is not cancelled and is not claimed to be cancellable.

Resume only re-enables subsequent scheduling, preserving the existing interface. `ChatStore.ts:1274–1278` resumes before reloading the latest leader state; automatically saving on resume would race that refresh with stale follower memory. Therefore no saved attachment snapshot or pre-pause queue is replayed. The next ordinary current-state schedule after reload/import/user mutation supplies the data. `ChatStore` already cancels the global local deferred slot on pause; this change does not duplicate or move that policy.

Scope limit: `enableWorkspacePersistence` performs direct migration/hydration writes before coordinator attachment. Those caller-owned writes are outside this adopted coordinator suppression and are not newly claimed follower-safe. No distributed lock guarantee is introduced. Tests must establish paused attach refusal, dropped queued follow-up, no stale replay across pause/resume while an old save settles, and fresh post-resume scheduling with existing failure recovery.

### A54 gate-design lenses

Interaction: ChatStore leadership/conflict callbacks produce pause/resume; ordinary scheduling and attachment enqueue workspace snapshots; asynchronous save completion consumes the pending queue. Resume precedes leader refresh, so it cannot itself enqueue a snapshot. Direct hydration saves are a separate producer outside this coordinator's authority.

Adversarial: pausing after enqueue but before an in-flight save settles bypassed a schedule-only guard. Clearing pending state plus guarding both private enqueue and drain blocks that actual path. Already-started writes remain outside cancellation guarantees. Resuming early must not revive the dropped snapshot.

Running versus declared: the retained actual baseline deferred fixture saved queued-before-pause while paused; the named workspace-pause trigger and lifecycle diagnostics assert the bad follow-up is absent and a fresh approved post-resume snapshot reaches the real queue. Parent independent review/acceptance and pre-existing queue/failure tests supplement lane-authored diagnostics; the lane does not authorize its own release solely by passing new tests.

Root independently reviewed the complete production change and passed the existing 21-test candidate lifecycle suite before the named-trigger organization change (receipt `c7c7d6`, 35 ms test time / 0.55 seconds total). The queued-pause incident case lives only in the named trigger file; its duplicate was removed from the coordinator suite, preserving earlier logs. This avoids counting the same assertion twice solely for a test-path convention.

Combined A53/A54 focused suite passed 21 tests after moving the single queued-pause incident case into its named trigger. Full CI passed 1,370 tests across 178 files (8.86 seconds test phase), application/test TypeScript checks, and lint. Initial CI exposed a missing assistant-role type narrowing in a new test assertion; that test-only fix passed the full rerun, and `ci-initial-types.log` is retained. No production change was needed. Final E2E subsequently passed as recorded below.


## Final combined gates — 2026-09-05

`npm run ci` passed: 1,370 tests, application/test typechecks, and lint. `npm run test:e2e -- --workers=4 --output=/home/ethan/.cache/tmp/astra-chat-hotpath/e2e-artifacts` passed all 146 tests in 1.7 minutes, using isolated ports 5633/5634. No scope narrowing or timeout change. `e2e.log` and artifacts are retained. Teardown completed; an outside-sandbox listener check confirmed both owned ports closed. No generated journey/source artifacts changed.

The measured performance benefit remains the synthetic operation-count comparison, not a full-application frame-time claim. A54 refuses new coordinator-owned workspace writes while paused and drops stale queued state; already-started operations and caller-owned direct hydration/migration writes remain explicitly outside that guarantee. Source/test hashes are retained in `candidate-source-hashes.json`. No real conversations, provider calls, installed workspace writes, deployments, or publication occurred.
