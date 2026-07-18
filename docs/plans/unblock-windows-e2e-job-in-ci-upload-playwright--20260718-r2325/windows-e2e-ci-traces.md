# Windows E2E CI and Playwright traces — implementation audit

**Task:** `unblock-windows-e2e-job-in-ci-upload-playwright--20260718-r2325`  
**Roadmap item:** Tooling & release → “Windows e2e job in CI; upload
Playwright traces on failure; coverage” (`docs/roadmap.md:699`)  
**Ethan's decision:** `RE-DISPATCH`  
**Audited commit:** `93d44c3e22cdc9a613d543e963a1e4d4cc2e4c66` and the current worktree tip  
**Status:** complete by prior implementation; the open item is a duplicate
queue record and needs harvesting reconciliation, not another source lane

## Outcome

The requested behavior is already implemented in the current tree. Commit
`93d44c3` (`ci: windows-latest e2e job + Playwright trace artifacts on
failure`, 2026-07-10) added the Windows job and per-OS trace artifacts. That
same commit checked off the detailed copy of this roadmap item at
`docs/roadmap.md:363-366`, including its acceptance criteria. The shorter open
entry at `docs/roadmap.md:699` was added earlier as a legacy backlog summary
and was never reconciled when the detailed item shipped.

No source change is needed, so this plan intentionally has no `DISPATCH.md`.
Dispatching `.github/workflows/ci.yml` or Playwright edits would duplicate
working behavior and create risk without closing a real gap.

## What “coverage” means here

The legacy summary ends in the bare word “coverage,” but it defines no code
coverage percentage, coverage reporter, output format, or acceptance target.
The detailed copy of the same item supplies the authoritative concrete
acceptance:

> Add a `windows-latest` e2e job to `.github/workflows/ci.yml` and upload
> traces on failure. CI must be green, and a forced failure must expose a
> downloadable trace artifact.

Accordingly, “coverage” is treated as platform and runtime-surface coverage:
the same full Playwright command runs on Linux and Windows, and that command
includes both configured app surfaces. It is not a request to introduce
Istanbul/V8 source-coverage collection into browser E2E tests.

## Current implementation evidence

### CI jobs

`.github/workflows/ci.yml` contains both E2E jobs:

| Job | Runner | Browser install | Test command | Failure artifact |
| --- | --- | --- | --- | --- |
| `e2e` | `ubuntu-latest` | `playwright install --with-deps chromium` | `npm run test:e2e` | `playwright-traces-linux` from `test-results/` |
| `e2e-windows` | `windows-latest` | `playwright install chromium` | `npm run test:e2e` | `playwright-traces-windows` from `test-results/` |

Both upload steps:

- use `actions/upload-artifact@v4`;
- run under `if: failure()`;
- retain artifacts for seven days; and
- have OS-specific names, so parallel job output cannot collide.

The jobs use Node 22 and `npm ci`, matching the repository's normal CI
dependency boundary. Windows does not use Linux's `--with-deps` flag, which is
correct because that flag installs Linux system packages.

### Trace production

`playwright.config.ts` sets:

- `trace: 'on-first-retry'`;
- `retries: 2` in CI; and
- `workers: 1` in CI.

Therefore a persistently failing Playwright test performs a traced retry and
leaves its `trace.zip` under `test-results/`, the exact directory uploaded by
the failed OS job. A flaky test that passes on retry makes the job green and is
correctly not published by an `if: failure()` step. A setup failure before
Playwright starts cannot produce a Playwright trace; the requirement applies
to Playwright test failures, not dependency-install failures.

### Runtime-surface and suite coverage

`npm run test:e2e` is exactly `playwright test`, so neither CI job filters out
a project or spec. The current config has two projects:

- `desktop-mocked`: the desktop-mode browser app with the bridge boundary
  mocked; and
- `web-lite`: the browser-only build with desktop capabilities absent.

On 2026-07-18, `npx playwright test --list` completed successfully with
Playwright 1.60.0 and enumerated **27 tests in 7 files**: 22
`desktop-mocked` cases and 5 `web-lite` cases. The list command does not start
the Vite listeners, so it is valid evidence inside this sandbox; running the
full E2E suite here is not, because the sandbox cannot bind the two required
ports.

## Acceptance mapping

| Requirement | Evidence | Verdict |
| --- | --- | --- |
| Windows E2E job exists | `e2e-windows` runs on `windows-latest` | Met |
| Windows runs the real repository E2E command | Both OS jobs invoke `npm run test:e2e` with no project/spec filter | Met |
| Desktop-mocked and Web Lite are covered | The command enumerates both projects; current list is 22 + 5 tests | Met |
| A failed Playwright test records a trace | CI has two retries and `trace: on-first-retry` | Met |
| Failed-job traces are downloadable | OS-specific `upload-artifact@v4` steps upload `test-results/` under `if: failure()` | Met in workflow; previously accepted at the checked roadmap copy |
| CI stays deterministic | CI uses one worker and a 30-minute job timeout on both OSes | Met |

The original acceptance asked for a forced-failure artifact check. This
docs-only lane cannot push a deliberately failing change or inspect private
GitHub Actions artifacts, and it should not manufacture a new failure path in
the product merely to repeat that check. The repository already records the
detailed item as done after the implementation landed. If the harvesting
session wants fresh operational evidence, it may temporarily force an
existing E2E assertion to fail on a throwaway PR, confirm the matching
`playwright-traces-<os>` artifact contains a `trace.zip`, and close the PR
without merging. That is verification of shipped behavior, not a source
follow-up or a blocker to reconciling the duplicate checkbox.

## Prior lane failure and how this re-dispatch avoids it

The prior campaign did not fail while analyzing or implementing this item; no
task work ran far enough to produce a deliverable:

1. Run
   `codex-unblock-windows-e2e-job-in-ci-upload-playwright--20260718-run-20260718094022-9e305be2`
   reached `adapter.start`, then stopped emitting output and remained recorded
   as `running`. It held the original plan-path lease.
2. Four subsequent attempts wedged at time zero because that stale run still
   owned `docs/plans/unblock-windows-e2e-job-in-ci-upload-playwright--20260718`.
3. A later Claude attempt obtained a worktree but exited immediately because
   its configured model, `gpt-5.6-terra`, was unavailable.

This re-dispatch uses a new task id and disjoint leased directory ending in
`-r2325`, so it does not contend with the stale original lease. It also uses
the requested Codex adapter rather than the unavailable Claude model. The
lesson from the prior lane is operational: expire/release a stale run before
retrying the same owned path, or re-dispatch to a fresh task/path as done here.

## Non-blocking documentation drift

`docs/architecture.md` still summarizes only the Linux E2E job and says it
uploads a “Playwright report.” The workflow actually runs Linux and Windows
and uploads `test-results/` traces. This is a small existing truth-pass item,
not missing product or CI behavior and not part of this lane's owned path. It
can be corrected the next time that architecture section is refreshed; it
does not justify redispatching the already-shipped CI feature.

## Harvesting instruction

Reconcile the open summary at `docs/roadmap.md:699` as a duplicate of the
checked detailed item at `docs/roadmap.md:363-366`. The completion note should
reference commit `93d44c3` and this audit. Do not dispatch another source
implementation task.

## Verification performed for this plan

- Read `CLAUDE.md`, `docs/roadmap.md`, the testing/CI sections of
  `docs/architecture.md`, and the relevant workflow/config/package files.
- Inspected commit `93d44c3` and blame/history for both roadmap copies.
- Read the prior `.orc` campaign report, run records, handoff, and logs.
- Ran `npx playwright --version` → `1.60.0`.
- Ran `npx playwright test --list` → 27 tests in 7 files across both projects.
- Did not run `npm run test:e2e`: its Vite servers require listener ports that
  this sandbox cannot bind.

