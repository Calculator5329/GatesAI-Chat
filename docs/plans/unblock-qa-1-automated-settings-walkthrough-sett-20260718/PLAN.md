# QA-1 automated settings walkthrough and de-bloat plan

Status: ready for dispatch

Decision: APPROVED

Roadmap source: `QA-1: Automated settings walkthrough + settings de-bloat (Playwright, codex lane)`

## Outcome

Add a deterministic Playwright walkthrough that proves every persistent menu
setting can be changed, survives a reload, and changes the behavior it claims
to control. Exercise non-persistent menu actions as smoke flows, publish a
per-control audit, and file separately reviewable removal/consolidation items.
This lane must not remove settings.

QA-1 is complete only when:

1. the new spec is part of the default `npm run test:e2e` run and is green in
   both `desktop-mocked` and `web-lite` wherever the control is supported;
2. every visible persistent control on all seven menu surfaces has an explicit
   verdict and automated evidence;
3. every visible non-persistent action has either a deterministic smoke check
   or a documented exclusion with a reason;
4. a dated audit records `works`, `dead`, `confusing`, or `runtime-limited` for
   each control; and
5. removal/merge candidates are filed as unchecked review items. No candidate
   is implemented by this lane.

## Current baseline

- `scripts/screens-tour.mjs` already opens Settings, Usage, Agent, Models,
  Local, Workspace, and Gallery in desktop-mocked and Web Lite modes. It checks
  routing, runtime degradation, internal links, console/page errors, and
  horizontal clipping at 1280 and 820 pixels. It does not mutate each control,
  reload persisted state, or prove behavioral effects.
- `tests/components/menu/SettingsWalkthrough.test.ts` provides a useful
  composition guard for the same seven routed sections, but it only verifies
  routing and desktop/Web Lite branches.
- `tests/e2e/screensTour.spec.ts` and `tests/e2e/fixtures/harness.ts` already
  provide app boot, localStorage seeding, OpenRouter/Ollama/bridge mocks, and
  stable browser-hosted desktop/Web Lite coverage.
- The 2026-07-11 local-first screen audit is the historical map, not a source
  of current verdicts. For example, its LF-6 claim that the cloud key leads
  Settings is no longer true: Theme, Conversations, Desktop, and Offline
  Library now render first. The new audit must report observed current
  behavior rather than copy old findings.
- The e2e "desktop" project is browser-hosted, not real Tauri. Desktop shell
  effects therefore need a deterministic `__TAURI_INTERNALS__` invoke spy, and
  the audit must label them `desktop-mocked`; it must not claim real-shell
  coverage.

## Scope and inventory

Treat a **persistent setting** as any toggle, segmented choice, select, text or
number field, credential configuration, or created configuration record whose
value is intended to survive navigation/reload. Treat buttons such as Refresh,
Test, Export, Import, Run now, Open, Copy, Clear, and reset confirmations as
**actions**. Both are in scope, but only persistent settings require the
change/reload/effect triple.

The control inventory must cover these domains and all conditional branches:

| Surface | Persistent settings/configuration | Actions and conditional states |
|---|---|---|
| Settings | theme; automatic titles; global summon enable/chord; close-to-tray; Offline Library enable/profile | Models/Local links; connection check; export; merge/replace import; Web Lite data clearing; every danger-zone confirmation/cancel/effect |
| Agent | system instructions; memory facts; semantic-memory auto-inject/model; schedule create/edit/model/cadence/catch-up/enabled; HTTP and stdio MCP server fields/headers/env/enabled | rebuild; schedule run/edit/delete; memory edit/delete/clear; MCP test/remove; skill refresh; Ollama embedding pull/cancel where mockable |
| Models | OpenRouter credential; Brave credential; selected image backend | catalog load/refresh/clear; Local navigation; compatibility run/cancel; credential clear |
| Local | managed runtime/path/base URLs; custom endpoint URL/key/label; Ollama key/tool calls; ComfyUI preset/steps/CFG/upscale/workflow/backend; vision model | auto-detect/browse/start/stop/logs/test; model catalog/pull/cancel/delete; setup/copy actions |
| Workspace | no preference currently identified | bridge re-poll/open; source refresh/prepare/test/build/open paths; runtime-limited states |
| Gallery | selected tab is session state, not a persisted preference | refresh; image lightbox; artifact open; per-item removal; clear history |
| Usage | no preference currently identified | rendering/empty-state inspection only; record that the surface has no settings |

The implementation must derive the final row-by-row inventory from the live
DOM and the section source, including conditional states seeded as healthy,
connected, populated, and empty. The table above is a floor, not permission to
omit a newly discovered control.

## Test design

Create `tests/e2e/settingsWalkthrough.spec.ts`. Keep the cases data-driven so
the audit and test names use the same stable control IDs. Split the spec into
small scenarios by surface rather than one long serial tour, allowing a
failure to identify the exact control without losing evidence for later ones.

### 1. Deterministic setup

- Reuse the navigation and runtime model established by
  `scripts/screens-tour.mjs` and the mocks in
  `tests/e2e/fixtures/harness.ts`.
- Add a test-only fixture module for the walkthrough's seeded localStorage,
  bridge/WebSocket responses, Ollama/OpenAI-compatible endpoints, Offline
  Library health/profile responses, file chooser payloads, download capture,
  clipboard, confirm/alert, and Tauri invoke spy.
- Use only obvious dummy credentials such as `test-openrouter-key`; never read
  the developer's environment or include a real credential in traces/reports.
- Use fresh Playwright contexts for destructive/import cases so app data on
  the host can never be touched.
- Do not call live OpenRouter, Brave, Ollama, ComfyUI, Offline Library, or a
  real bridge.

### 2. Coverage guard

- Visit each menu route in each supported runtime and enumerate interactive
  form controls and action buttons inside `.gates-menu__body`.
- Activate conditional branches (connected/disconnected, online/offline,
  populated/empty, quick/full image mode, HTTP/stdio MCP, merge/replace
  import, enabled/disabled Offline Library).
- Match each persistent control to a stable case ID using accessible
  role/name locators. If a control lacks a unique accessible name, add the
  smallest truthful `aria-label`/label association in the owning section; do
  not paper over it with brittle CSS or nth-child selectors.
- Fail when a visible persistent control is neither in the registry nor in a
  narrow allowlist of transient form drafts. Every allowlist entry must have a
  reason in the spec.
- Navigation tabs are covered by the existing screen tour and are excluded
  from the settings-control count.

### 3. Persistence proof

For each persistent case:

1. record the initial control value and relevant persistence slot;
2. choose a non-default value through the UI;
3. poll for the expected serialized change rather than sleeping through store
   debounce windows;
4. reload the page and revisit the route;
5. assert the UI restores the changed value; and
6. restore only when the scenario needs to continue in the same context.

At minimum cover the existing slots for UI preferences, profile/memory,
schedules, RAG, MCP, providers/search/Ollama, local runtime, image generation,
and Offline Library settings. Desktop secret assertions must check the mocked
credential operation and redacted local persistence, not a plaintext key.

### 4. Real-effect proof

A localStorage assertion alone is insufficient. Pair every setting with an
observable effect:

- theme changes the effective root theme/CSS variables;
- automatic naming changes first-response title behavior under the mocked LLM;
- summon/chord/close-to-tray changes the captured desktop registration/invoke
  payload;
- Offline Library enable/profile changes status/routing behavior without cloud
  fallback;
- instructions, memory, semantic-memory, and schedule settings change the
  rendered or mocked request/task behavior;
- MCP/provider/local-runtime fields change the next mocked connection request
  or visible readiness state;
- image mode/sampling/backend settings change the generated backend payload;
- vision selection changes the model used by the mocked image-description
  path.

If a claimed effect cannot be observed after deterministic mocking, classify
the control as `dead` or `runtime-limited`; do not weaken the assertion to
"storage changed."

### 5. Action smoke flows

Exercise each non-persistent action against synthetic state and assert a
visible transition, captured request/download/clipboard payload, or scoped
data mutation. For destructive actions, prove both Cancel (no change) and
Confirm (only the named synthetic data changes). Never accept "button was
clickable" as the effect assertion.

### 6. Runtime and failure hygiene

- Run common cases in both Playwright projects. Desktop-only controls must be
  absent in Web Lite with the documented fallback; Web Lite-only browser-data
  controls must be absent in desktop-mocked.
- Keep network routing exhaustive enough that an unmocked external request
  fails the test with its URL.
- Assert no unexpected `pageerror` or console error per route, matching the
  screen-tour discipline.
- Prefer role/name locators and `expect.poll`; do not use arbitrary waits,
  screenshots as functional assertions, or execution-order coupling.

## Audit and de-bloat deliverables

Create `docs/audits/2026-07-18-settings-walkthrough.md` with one row per stable
control ID:

| ID | Runtime | Surface/control | Persistence evidence | Effect evidence | Verdict | Recommendation |
|---|---|---|---|---|---|---|

Allowed verdicts:

- `works`: persistence and claimed effect both pass;
- `dead`: UI accepts a change but the claimed effect is absent or unreachable;
- `confusing`: behavior works but its placement, wording, duplication, or
  mode distinction is misleading;
- `runtime-limited`: honest platform/integration limitation with deterministic
  fallback evidence.

Use the following de-bloat rubric:

- **Remove candidate:** dead, permanently unreachable, or duplicates a safer
  single supported path.
- **Merge candidate:** same task/domain and users must currently update more
  than one nearby control to get one outcome.
- **Hide behind advanced disclosure:** valid but rarely changed tuning whose
  defaults are sufficient for the primary journey.
- **Keep:** distinct user intent, observable effect, and a credible recurring
  reason to change it.

For each remove/merge/hide candidate, add a separate unchecked roadmap review
item linking the audit ID and stating migration/default behavior plus tests.
Do not modify production behavior in QA-1. This preserves the roadmap's
requirement that removal happens only in a separate reviewed change.

## Implementation sequence

1. Build the stable inventory from all seven routes and conditional branches.
2. Add the deterministic walkthrough fixture and external-call deny guard.
3. Add common Settings/Agent persistence and effect cases.
4. Add Models/Local persistence and mocked request-payload cases.
5. Add Workspace/Gallery/Usage action and no-setting evidence.
6. Add the coverage guard and verify both runtime partitions.
7. Run the focused spec, then the full e2e suite and CI gate.
8. Write the audit from observed results, file separate review checkboxes for
   every de-bloat candidate, update changelog/roadmap only after all gates pass.

## Verification

Run in this order:

```sh
npx playwright test tests/e2e/settingsWalkthrough.spec.ts
npm run ci
npm run test:e2e
```

The repository's e2e setup binds local Vite ports. If the execution sandbox
forbids listeners, record `needs outside-sandbox verification` and let the
orchestrator's unrestricted verification run the same command; do not retry,
weaken, or skip the e2e gate.

## Non-goals

- Removing, consolidating, or visually redesigning a setting in this lane.
- Calling real services or validating real credentials.
- Claiming real Tauri, OS shortcut, tray, or file-dialog coverage from the
  browser-hosted desktop-mocked project.
- Replacing the screen-tour visual/layout corpus.
- Adding a dependency.
