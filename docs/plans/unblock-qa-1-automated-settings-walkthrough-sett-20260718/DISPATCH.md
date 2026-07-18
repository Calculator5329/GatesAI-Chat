# Follow-up dispatch specification

## Title

QA-1 implementation: exhaustive Playwright settings walkthrough and de-bloat audit

## Goal

Implement the approved plan in
`docs/plans/unblock-qa-1-automated-settings-walkthrough-sett-20260718/PLAN.md`
completely. Add a deterministic Playwright spec to the default e2e suite that
inventories every control on Settings, Usage, Agent, Models, Local, Workspace,
and Gallery; changes every persistent setting; proves persistence after reload
and a real observable effect; smokes non-persistent actions; and verifies
honest desktop-mocked/Web Lite partitioning. Publish a dated per-control audit
with `works`, `dead`, `confusing`, or `runtime-limited` verdicts. File each
proposed removal, merge, or advanced-disclosure change as a separate unchecked
roadmap review item. Do not remove or consolidate production settings in this
task.

## Owns

```text
tests/e2e/settingsWalkthrough.spec.ts
tests/e2e/fixtures/settingsWalkthrough.ts
tests/e2e/fixtures/harness.ts
src/components/menu/sections
docs/audits/2026-07-18-settings-walkthrough.md
docs/roadmap.md
docs/changelog.md
```

`src/components/menu/sections` is owned only for minimal accessible-name or
label associations required for stable role/name Playwright locators. Do not
de-bloat or redesign those components in this task. Reuse
`scripts/screens-tour.mjs` and existing e2e fixtures as the route/runtime map;
do not duplicate live-service dependencies.

## Acceptance

- The spec is discovered by default `npm run test:e2e`; no opt-in environment
  flag is required.
- All seven menu surfaces and every conditional persistent control have a
  stable case ID and a per-runtime audit row.
- Every persistent control is changed through the UI, polled to its expected
  persistence state, reloaded, restored in the UI, and paired with an
  observable behavioral/request effect.
- Every action has a deterministic effect assertion or an explicit justified
  exclusion; destructive actions prove Cancel and Confirm against synthetic
  state.
- No real network service, credential, bridge, Ollama/ComfyUI runtime, or host
  app data is used.
- Desktop-mocked evidence is labeled accurately and never represented as real
  Tauri/OS verification.
- The audit contains per-control evidence and verdicts; every de-bloat
  candidate is a separate unchecked reviewed follow-up item. No setting is
  removed in this task.
- `npm run ci` and the full `npm run test:e2e` pass.

## Test command

```sh
npx playwright test tests/e2e/settingsWalkthrough.spec.ts && npm run ci && npm run test:e2e
```

The e2e commands need permission to bind the repository's local Vite ports. If
the lane sandbox prohibits listeners, report `needs outside-sandbox
verification`; do not weaken the tests or alter the port-owning setup.
