# Render Perf Notes

## Conventions

- Keep high-frequency UI state as low in the tree as possible. Example: thread-row hover/focus state lives in the row, not the sidebar list.
- For memoized rows, stabilize callbacks only after verifying their dependency arrays are stable. A stable child callback does not help if the parent passes a fresh callback or object every render.
- MobX observers should be narrow. Prefer small components that read the store values they need directly over a broad parent that observes store data and passes it down.
- Provider values should stay stable. The root store context currently passes the stable `rootStore`, not a reconstructed object.

## Audit Decisions

- Workspace explorer virtualization is deferred pending production scale data. If 95th-percentile workspaces are usually below roughly 50 entries, keep this in the backlog.
- Gallery virtualization is deferred pending production scale data. If typical galleries are below roughly 40 images, keep the current lazy image loading and avoid the extra complexity.
- `src/services/persistence.ts` TypeScript errors and the `GatesMenu.test.ts` OpenRouter expectation failure are tracked as unrelated validation blockers. Do not fix them inside render-performance commits.

## Scope Notes

- The `1ccbae0 Add bundle analyzer baseline tooling` commit also included React callback-stability changes. Treat that as a scope-mixing example to avoid: bundle tooling and render-performance fixes should be separate commits.
- Cleanup work now follows the stricter operating rule: if a finding was not in the current task scope, log it here and do not absorb it into the active diff. If the finding blocks validation, fix it as a separate prior commit and call it out explicitly.
- Reports must enumerate concrete observed values and validation evidence. For component splits, list exact observed store fields and prop contracts. For performance claims, include methodology and before/after numbers rather than a single summary metric.

## Composer Split Notes

- The composer shell must not own observed store lookups. It should be layout and drag/drop wiring only; children should observe the exact store slices they need.
- Before splitting `EditorialComposer`, capture a React Profiler baseline for a 10-second normal-speed typing session, then repeat after the full split and compare commit count plus total render time across the composer subtree.
- Status after Performance Sweep 2: the Composer split was not implemented. Do not close the render-performance pass until the split is either completed with explicit prop contracts or explicitly deferred in the final report.

## Performance Sweep 2 Residue

- Bundle evidence gap: the main chunk moved only from roughly 179.65 KB gzip to roughly 178.90 KB gzip. This is too small to support broad lazy-loading claims without chunk-by-chunk baseline comparison. Future bundle work must use a visualizer or equivalent table with raw and gzip size for every chunk, baseline vs. current.
- Static import graph finding from the sweep: menu sections, image backend clients, `openRouterCompatibility.ts`, `services/sourceWorkspace.ts`, and `services/sourceBuild.ts` were no longer statically reachable from `src/main.tsx`; however `services/tools/sourceWorkspace.ts`, `services/tools/sourceBuild.ts`, and `services/image/imageBackend.ts` remained statically reachable through stores/registry. Treat the source tool work as partial executor-service lazy loading, not a full lightweight tool catalog split.
- Profiler evidence gap: pagination and autorun-based streaming scroll were tested but not profiled. Required scenarios are typing during streaming on a 50-turn thread, scrolling backward through a 500-turn thread, and cold-opening a 1000+ message thread. Capture commit count and total render time before claiming render-performance closure.
- Scope drift to avoid repeating: long-thread pagination, sidebar search debounce/result cap, broad menu/image/compat lazy loading, and spend caching were implemented during the same sweep. Some were in the immediate user plan, but they bypassed the earlier audit gate. Future reports must list each decision with the justification that would have been given upfront.
- Test residue: full Vitest passes, but the frozen 2026 test clock emits `TimeoutOverflowWarning` because some timer code receives a timestamp outside the 32-bit timeout range. Track for a future cleanup turn; do not bury it in performance-result summaries.
- Validation blocker residue: `src/services/persistence.ts` TypeScript errors were fixed with explicit parse/narrowing helpers, not ignored. Because persistence is high-blast-radius and was not render-perf scope, any further persistence work should be isolated in its own commit and validation pass.
