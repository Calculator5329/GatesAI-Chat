# A55 — workspace hydration authority, 2026-09-05

Adopted and implemented in isolated lane astra-hydration-authority-20260905, base 51ade7e7. Required verification passed; root integration remains separate. No release or native runtime claim. Historical pre-source proposal, source copies and synthetic evidence are retained at /home/ethan/.cache/tmp/astra-audit-20260905/gates-hydration-audit/.

## Problem and authority

RootStore desktop boot invokes ChatStore workspace hydration. The old method awaited a load and then directly saved migration data, malformed backups or shared local storage even while the coordinator was paused. The old load also created a directory. Baseline actual-store fake-bridge diagnostics measured four bridge writes for missing state as a follower, after a controlled lost verdict, and after actual disposal; importing valid workspace data as a follower wrote shared local state once. A controlled leader→follower→leader sequence also resumed the old write. These were synthetic cache diagnostics, not live provider/workspace or browser revocation measurements.

A54 already protects queued coordinator writes and exposes isPaused. This slice reuses that authority; it does not change the coordinator or election implementation.

## Implemented interface and behavior

ChatStore owns one observable authority generation and a disposal flag. Every actual leadership transition, legacy conflict pause and disposal invalidates the old generation. The existing election suppresses notifications when next state equals current state, so an unchanged leader does not increment it. A private current-initialization identity also invalidates a replaced persistence wrapper. Initialization captures generation without incrementing it, avoiding a self-triggered RootStore loop.

RootStore watches workspace root, online state, leader/conflict state and authority generation, and samples client identity/connection epoch when those observed inputs change. BridgeClient.connectionEpoch is a plain getter, not an independent MobX subscription; arbitrary same-state socket replacement is not claimed to trigger hydration. Existing production connect callers are RootStore and the BridgeStore offline-to-online path. A changed desired context invalidates the old applicability closure immediately. If a load is in flight, its completion triggers at most the latest changed context; an unchanged transport failure does not busy-retry. Disposal invalidates pending callbacks. Observable generation preserves ABA transitions even when MobX batches the final leader label back to its old value.

Before applying loaded state to memory, ChatStore requires the current generation, initialization and RootStore context. Valid current followers may import into memory, but return false rather than claiming write-ready persistence; missing/malformed/older data retain local memory. A fresh eligible transition reconciles again. Stale root, disposed or superseded completions cannot apply memory or attach persistence.

The same live predicate also requires !coordinator.isPaused for local publication and is carried into workspaceChatPersistence's existing privileged request wrapper. Every mutating request checks it immediately before dispatch: mkdir, backup, temp write, move, direct-write fallback and readable mirror writes. Read/list remain available; load no longer creates a directory. Default factory callers retain the previous writable behavior unless an authority predicate is provided. No schema, source label, newer-local selection or temp/move policy changes.

An already dispatched RPC cannot be recalled. This protects subsequent request starts after observed revocation; it does not claim an atomic distributed transaction or rollback. Old wrappers remain invalid after authority returns; new initialization attaches a fresh wrapper.

## Design checks

Stream: this follows A54 on the persistence-authority flow. The defect was bootstrap bypassing the existing authority, so the shared publication seam carries permission rather than patching three branches independently. Reads and publication remain distinct.

Interaction lens: leader election, fallback conflict, coordinator pause, disposal, root/connection context, malformed backup, save fallback and mirror all consume this permission. Adversarial lens: revoke during an await, regain before completion, or fall through from failed move to direct write; none may reauthorize the old operation. Running lens: actual request and shared-local-write counters, existing store/service tests, and independent root review.

Interrogation: blocking all follower hydration was smaller but removed valid reads and still missed disposal. Reusing the existing coordinator accessor and privileged wrapper adds no manager, new lock or queue. Existing resume-before-reload ordering is preserved.

## Scope and verification

Ten owned paths: ChatStore.ts, RootStore.ts, workspaceChatPersistence.ts; their existing ChatStore/service tests and new RootStore.workspacePersistence.test.ts; this design, architecture, roadmap and changelog. No coordinator/election source changes.

First focused run: 118/118 passed across the existing ChatStore/workspace service tests plus RootStore coalescing and generation/request diagnostics (2.72s). Initial typecheck and scoped ESLint passed. Additional missing/malformed/older follower diagnostics were then added; final CI and required E2E results will be recorded when measured. Initial root review of all three production diffs and RootStore wiring found no blocker.

Full CI passed: 179 files / 1384 tests, TypeScript and ESLint (ci-first.log). Then the existing RootStore test gained an authority-only batched ABA parameter; both focused cases passed (root-aba-focused.log, 1.74s). That extra case is not retroactively included in the CI count. Independent source reviewer found no blocker, and identified the sampled-epoch limitation now stated above. Required full browser gate remains pending the parent window.

Final gates on this source: `npm run ci` passed 179 files / 1385 tests plus typecheck and ESLint (ci-final.log). `GATESAI_E2E_DESKTOP_PORT=5573 GATESAI_E2E_WEB_LITE_PORT=5574 npm run test:e2e` passed all 146 tests in 1.8m outside the sandbox (e2e-final.log), preserving configured timeouts, retries and workers. This is desktop-mocked, Web Lite and journey coverage, not native Tauri capture. No source changes followed these gates. Generated observations used ignored test output paths; all tracked changes remained within the ten owned paths. Both gate processes finished and the shared verification window was released. Logs remain in the cache evidence directory named above.
