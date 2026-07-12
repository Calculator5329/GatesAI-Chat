# Browser-QA harness bake-off

## Decision to make

Choose how coding agents should author browser QA for `gatesai-chat`. This is a
bake-off of **authoring harnesses**, not browser engines: every lane must write
ordinary Playwright TypeScript tests against the same running desktop-mocked
Vite app. Ethan judges the resulting tests and evidence, not an agent's prose
claim that a flow worked.

The bake-off should answer one practical question: which harness gives an
agent enough perception and structure to write readable, deterministic tests
without turning routine UI changes into expensive test maintenance?

## Controlled experiment

### Fixed environment

- Use the existing `@playwright/test` dependency and
  `playwright.config.ts`; add no dependency and change no production code.
- Target only the existing `desktop-mocked` project. The existing Playwright
  global setup owns the app servers and verifies that each port serves this
  app.
- Reuse `tests/e2e/fixtures/harness.ts` for `seedReadyProvider`,
  `seedThreads`, `makeThread`, `mockOpenRouter`, and `mockBridgeOnline`.
- Run Chromium at the existing `Desktop Chrome` viewport, with animations
  disabled through the user's UI preference if a lane needs stable captures.
- Use synthetic content, the mocked bridge, and mocked OpenRouter only. No
  key, live model, Tauri shell, real updater, or external network request is
  allowed.
- Each lane gets one fresh context per test and must be runnable alone with a
  single `playwright test <spec> --project=desktop-mocked` command.
- Each lane implements exactly three tests, in the order and with the
  assertions below. Extra product coverage does not earn points.
- Do not weaken assertions, add fixed sleeps, raise global timeouts, add
  retries, or modify the shared fixture/config to make one variant pass.

### The three common flow contracts

The literal test titles below make packet comparison and result merging easy.

1. **`sends a chat and follows the streamed reply`**
   - Seed one thread with 36 alternating, long user/assistant messages so the
     transcript overflows.
   - Mock a distinctive delayed reply, navigate to `/`, fill the composer,
     and activate Send.
   - Assert that the sent user text and final assistant text appear.
   - Assert the scroll container is overflowed and, after the reply settles,
     its bottom distance
     `scrollHeight - scrollTop - clientHeight` is at most 2 px. This is the
     behavior contract; merely calling `scrollIntoViewIfNeeded` or asserting
     that the reply is visible does not prove follow-scroll.
2. **`opens a workspace file in the dock`**
   - Mock `/workspace/notes/bakeoff.md` with a unique Markdown heading and
     body.
   - Navigate to `/`, open the command palette with `Control+k`, select
     **Open file in dock**, and accept the path prompt.
   - Assert the dock is visible, its title is `bakeoff.md`, and the rendered
     heading and body are visible. The flow ends there; collapse/resize/close
     is outside this experiment.
3. **`shows and dismisses the update pill`**
   - Navigate to `/`, then use the development-only
     `window.__gatesai.store.updates` hook to set an available phase and a
     distinctive synthetic version such as `99.0.0`. This is state injection,
     not a production updater test.
   - Assert the status contains `v99.0.0 available`, activate the accessible
     **Dismiss update notice** button, then assert the pill/status is absent.
   - Put any TypeScript cast for `window.__gatesai` inside the lane's own spec;
     do not change application types just for the bake-off.

All lanes may inspect existing e2e specs for product context. They must author
their own three tests rather than copy `desktop.spec.ts`, `dock.spec.ts`, or
`polish.spec.ts` wholesale. Small reuse of established fixture calls and
selectors is desirable and should remain visible in the source.

### Evidence every lane must capture

Playwright assertions are the verdict. Visual artifacts make Ethan's review
fast and traces explain failures:

- one named PNG after the asserted end state of each flow: `01-chat.png`,
  `02-dock.png`, and `03-update-before-dismiss.png`;
- one additional `03-update-after-dismiss.png` showing the sidebar after the
  pill is gone;
- a Playwright trace for each test, captured on the scored run rather than
  only on retry;
- the line/list reporter output, wall-clock duration, and pass/fail status for
  three consecutive clean runs;
- the final spec source and any lane-local helper source;
- a short authoring log containing commands used, agent wall time, and any
  selector or timing issue encountered. It is evidence, not scoring prose.

Screenshots are review artifacts, not pixel baselines: do not add
`toHaveScreenshot` baselines or score anti-aliasing differences. Each lane
stores its raw evidence under its disjoint
`artifacts/browser-qa-bakeoff/raw/<variant>/` ownership; the packet assembly
step copies the judge-facing selection to its separate packet path.

## Option A — plain Playwright, codegen-assisted

### How tests are authored

The lane uses Playwright codegen or Inspector against the running app to record
the three happy paths. It then replaces generated coordinate/CSS noise with
Playwright locators, adds the common fixture setup, and writes the explicit
state assertions above. Direct source inspection is allowed after recording,
but the interaction recording is the primary discovery loop.

This is the lowest-ceremony baseline: one spec, no page object, and no custom
DSL. Codegen output is never accepted unchanged; the lane must remove nth-row
selectors and incidental DOM structure where a role, label, visible name, or
existing stable test id exists.

### Evidence, cost, and risk

- **Evidence:** the four required screenshots, three scored-run traces, the
  cleaned spec, and optionally the raw generated snippet in the authoring log
  so Ethan can see how much cleanup was needed.
- **Expected authoring cost:** 30–45 agent minutes; lowest startup cost.
- **Expected scored runtime:** about 8–15 seconds per three-test run on a warm
  local server; traces add modest disk I/O but no app dependency.
- **Flakiness risk:** medium. Recording discovers paths quickly, but generated
  selectors tend to couple to DOM order, styling classes, prompt timing, and
  transient text. Cleanup quality is the main variable.
- **Maintenance profile:** good for one-off smoke coverage, weaker if future
  agents repeatedly regenerate rather than understand the behavior contract.

## Option B — accessibility-tree-driven agent authoring

### How tests are authored

The lane navigates with a browser agent that observes the accessibility tree
and uses roles, accessible names, labels, and live state as its primary UI
model. It may take screenshots for orientation, but interactions should be
derived from accessible semantics. It then writes normal Playwright tests,
favoring `getByRole`, `getByLabel`, and `getByText`; CSS or `data-testid`
locators are reserved for behavior with no useful accessible surface, such as
the scroll container and dock shell.

Before coding each flow, the lane records a compact accessibility outline of
the relevant controls in its authoring log. If an essential control cannot be
addressed accessibly, the lane documents the gap rather than changing product
code during the experiment.

### Evidence, cost, and risk

- **Evidence:** the common artifact set plus the three compact accessibility
  outlines used to author the tests. Traces should show semantic locator steps.
- **Expected authoring cost:** 45–70 agent minutes; tree inspection adds a
  discovery pass but often reduces selector debugging.
- **Expected scored runtime:** about 8–15 seconds per run; runtime should be
  effectively equal to Option A once authored.
- **Flakiness risk:** low to medium. Roles and names usually survive layout and
  CSS refactors, but exact accessible copy changes can break locators, and the
  transcript's follow invariant still needs a DOM measurement.
- **Maintenance profile:** strongest when the UI's accessibility contract is
  intentional. Failures can reveal real accessibility regressions rather than
  merely test-selector drift.

## Option C — contract-first Playwright flow fixture

### How tests are authored

The lane begins from the three behavior contracts, inspects existing e2e
fixtures and app source, and creates a **lane-local thin fixture/helper** that
names product actions and state invariants—for example `openBakeoffApp`,
`sendPrompt`, `bottomDistance`, `openWorkspaceFile`, and
`exposeAvailableUpdate`. The spec remains Playwright TypeScript and should read
as a short user story; the helper contains mocking and low-level DOM mechanics.

This is deliberately not a general framework. The helper may wrap only logic
used by at least two of the three tests or logic whose raw form obscures an
important assertion. It may not hide assertions behind a single opaque
`completeFlow()` call, and it may not add a dependency or edit the shared
harness.

### Evidence, cost, and risk

- **Evidence:** the common artifact set, the spec and helper side by side, and
  a small mapping in the authoring log from each contract bullet to the source
  line that proves it.
- **Expected authoring cost:** 60–90 agent minutes; highest initial design and
  review cost.
- **Expected scored runtime:** about 8–15 seconds per run. The abstraction
  should not add browser calls or polling beyond the common contracts.
- **Flakiness risk:** low if the helper centralizes only stable seams; medium if
  it becomes an abstraction layer that hides auto-waiting, broadens locators,
  or shares mutable state.
- **Maintenance profile:** potentially best for a growing suite because setup
  and behavioral measurements have named homes. For only three smoke tests it
  may be ceremony without enough reuse.

## Comparison and recommendation

| Option | Agent startup | Selector resilience | Source readability | Abstraction risk | Best fit |
| --- | --- | --- | --- | --- | --- |
| A. Codegen-assisted | Fastest | Medium after cleanup | Medium | Low | Rapid one-off smoke paths |
| B. Accessibility-tree-driven | Medium | High | High | Low | Default agent-authored user flows |
| C. Contract-first fixture | Slowest | High if disciplined | High | Medium | A suite whose shared vocabulary is already emerging |

**Recommendation: run all three capped lanes, then adopt Option B as the
provisional default unless the packet shows a material determinism or
maintenance advantage for C.** Accessibility-tree-driven authoring aligns
test selectors with the interface users and assistive technology perceive,
keeps the resulting files recognizably Playwright, and avoids introducing a
mini-framework before three flows demonstrate one is needed. Keep Option A as
the fast reconnaissance technique. Promote Option C only if its spec is
meaningfully easier to audit and all three clean runs remain deterministic.

If resources allow only two lanes, run B versus C: the repo already contains
enough plain Playwright to serve as an informal baseline. If resources allow
only one, use B and include a second review pass that rejects inaccessible or
structural selectors without justification.

## Ethan's judge-panel packet

The packet should be a single Markdown index with linked files and a compact
HTML contact sheet (or equivalent image grid) that can be judged without
opening traces first. Preserve raw traces as linked `.zip` files.

### Packet layout

```text
browser-qa-bakeoff/
  README.md                       # verdict sheet and run metadata
  source/
    option-a.spec.ts
    option-b.spec.ts
    option-c.spec.ts
    option-c.fixture.ts           # only when the lane produced it
  screenshots/
    chat--a.png  chat--b.png  chat--c.png
    dock--a.png  dock--b.png  dock--c.png
    update-before--a.png ...
    update-after--a.png ...
  traces/
    a/{chat,dock,update}.zip
    b/{chat,dock,update}.zip
    c/{chat,dock,update}.zip
  runs/
    option-a.md  option-b.md  option-c.md
```

`README.md` starts with the exact commit SHA, OS, Node version, Playwright
version, project name, viewport, run command, and whether the server was warm.
Then show three columns, A/B/C, with:

1. each full test source (and C's helper immediately beside it, not hidden);
2. the matching end-state screenshots at equal display dimensions;
3. run 1/2/3 status and duration, median total duration, and trace links;
4. the lane's authoring time and documented rough edges;
5. a blank score table and one line for Ethan's verdict: **adopt / retain for
   reconnaissance / reject**.

Do not normalize or rewrite lane source during packet assembly. Formatting is
part of what is being judged. Redact machine-specific absolute paths from
logs, but do not omit a failure or rerun.

### Scoring rubric

Score each category from 1 to 5, then apply the weight. A variant that fails
any common flow in any of the three clean runs is ineligible to win regardless
of total score.

| Category | Weight | 1 | 3 | 5 |
| --- | ---: | --- | --- | --- |
| Readability | 25% | Generated/opaque; intent is hard to recover | Mostly clear with some incidental mechanics | The three user stories and their assertions are obvious on one read |
| Determinism | 35% | Sleeps, broad locators, retries, or inconsistent runs | Three passes but some timing/selector fragility | Three clean passes; web-first waits and behavior invariants; no hidden recovery |
| Coverage | 20% | Checks navigation or visibility only | Covers most required outcomes | Proves every common contract, including true bottom distance and post-dismiss absence |
| Maintenance | 20% | Duplicated brittle mechanics or framework overhead | Localized change cost with minor coupling | Stable semantic seams, useful failure messages, minimal justified abstraction |

Weighted score is `readability*5 + determinism*7 + coverage*4 +
maintenance*4`, yielding 20–100 points. Record authoring time and runtime next
to the score but do not fold speed into the rubric: a fast harness that writes
fragile tests should not win by arithmetic.

Suggested decision rule:

- adopt the highest eligible score when it leads by at least 5 points;
- within 4 points, prefer the simpler source and lower ongoing maintenance;
- if Ethan cannot tell what a failure proves from the source plus trace, do
  not adopt that option even if its numeric score is highest.

## Dispatch-ready execution plan

Run these as three isolated, capped lanes. The proposed paths are disjoint so
they can run concurrently; each lane owns its spec, its optional local helper,
and its raw artifact directory only.

**Port preflight:** the Codex sandbox on this machine cannot bind listeners.
Before dispatch, an outside-sandbox operator must start both verified Vite
surfaces on the chosen `GATESAI_E2E_DESKTOP_PORT` and
`GATESAI_E2E_WEB_LITE_PORT`; `globalSetup.ts` will reuse them when `CI` is
unset. The commands below are then safe read/client runs. If those servers are
not supplied, lanes may finish source authoring but must report **needs
outside-sandbox verification** instead of retrying, changing global setup, or
weakening acceptance. The three scored runs and packet assembly remain
outside-sandbox verification requirements.

### Lane A — codegen-assisted baseline

```text
Title: Browser QA bake-off A — codegen-assisted Playwright
Owns: tests/e2e/bakeoff/option-a.spec.ts
       artifacts/browser-qa-bakeoff/raw/option-a/
Goal: Implement exactly the three common flow contracts in
      docs/design-browser-qa-bakeoff.md using Playwright codegen/Inspector as
      the primary discovery method. Capture the required evidence; do not edit
      shared fixtures, config, production code, or other variants.
Adapter: codex
Attempt cap: 1
Runtime cap: 50 minutes
Token cap: 30000
Setup: npm ci
Test: npx playwright test tests/e2e/bakeoff/option-a.spec.ts
      --project=desktop-mocked --trace=on
Acceptance: the isolated command passes three consecutive times; the spec has
            exactly three tests, no fixed sleeps, no nth/coordinate locators,
            and all required screenshots/traces/run metadata exist.
```

### Lane B — accessibility-tree-driven authoring

```text
Title: Browser QA bake-off B — accessibility-tree-driven Playwright
Owns: tests/e2e/bakeoff/option-b.spec.ts
       artifacts/browser-qa-bakeoff/raw/option-b/
Goal: Implement exactly the three common flow contracts in
      docs/design-browser-qa-bakeoff.md. Discover controls from accessibility
      snapshots/roles/names, record the three compact outlines, and write
      normal Playwright tests. Capture the required evidence; do not edit
      shared fixtures, config, production code, or other variants.
Adapter: codex
Attempt cap: 1
Runtime cap: 75 minutes
Token cap: 35000
Setup: npm ci
Test: npx playwright test tests/e2e/bakeoff/option-b.spec.ts
      --project=desktop-mocked --trace=on
Acceptance: the isolated command passes three consecutive times; the spec has
            exactly three tests, uses semantic locators except for documented
            non-semantic surfaces, has no fixed sleeps, and all required
            screenshots/traces/outlines/run metadata exist.
```

### Lane C — contract-first thin fixture

```text
Title: Browser QA bake-off C — contract-first Playwright fixture
Owns: tests/e2e/bakeoff/option-c.spec.ts
       tests/e2e/bakeoff/option-c.fixture.ts
       artifacts/browser-qa-bakeoff/raw/option-c/
Goal: Implement exactly the three common flow contracts in
      docs/design-browser-qa-bakeoff.md with a lane-local thin flow fixture.
      Keep assertions visible, map contract bullets to source lines, and
      capture the required evidence. Do not edit shared fixtures, config,
      production code, or other variants.
Adapter: codex
Attempt cap: 1
Runtime cap: 95 minutes
Token cap: 40000
Setup: npm ci
Test: npx playwright test tests/e2e/bakeoff/option-c.spec.ts
      --project=desktop-mocked --trace=on
Acceptance: the isolated command passes three consecutive times; the spec has
            exactly three tests, helpers are thin and assertion intent remains
            visible, there are no fixed sleeps, and all required screenshots,
            traces, contract mapping, and run metadata exist.
```

If only two execution slots are available, dispatch B and C and use the
existing e2e suite as context for A; do not serialize three lanes unless Ethan
wants the full controlled baseline.

### Packet assembly — serialized after all lanes

```text
Title: Assemble browser QA bake-off judge packet
Depends on: lanes A, B, and C (or the explicitly selected two-lane subset)
Owns: artifacts/browser-qa-bakeoff/packet/
Goal: Run each completed variant three consecutive times from the same commit
      and warm server, preserving failures. Copy sources without rewriting
      them, curate the required screenshots/traces/logs, build the side-by-side
      README and contact sheet, calculate medians, and leave Ethan's scores and
      verdict blank. Apply the rubric mechanically only after Ethan supplies
      the four category scores.
Adapter: codex
Attempt cap: 1
Runtime cap: 50 minutes
Token cap: 25000
Setup: npm ci
Test: for each selected option, run its isolated desktop-mocked command three
      times with --trace=on; then verify every path in the packet index exists.
Acceptance: packet metadata identifies one commit/environment; every selected
            variant has unmodified source, four screenshots, three per-test
            traces, three run results, authoring notes, and a blank rubric;
            failures are visible and no secrets or absolute home paths remain.
```

The packet step is the only judge-facing integration step. It must not merge
the three test variants into a common abstraction before Ethan decides; doing
so would destroy the evidence the bake-off is meant to compare.
