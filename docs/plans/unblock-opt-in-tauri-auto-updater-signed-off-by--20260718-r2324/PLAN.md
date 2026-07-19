# Opt-in Tauri auto-updater — signed and OFF by default

**Status:** implementation-ready follow-up required

**Workflow decision:** `RE-DISPATCH` (authoritative, 2026-07-18)

**Canonical source:** `docs/roadmap.md`, Platforms & compatibility item
“Opt-in Tauri auto-updater (signed, OFF by default)”

**Scope of this lane:** repository-backed design and exact dispatch handoff
only. The lane owns no source paths, so the source implementation belongs in
the follow-up task in `DISPATCH.md`. This workflow decision does not by itself
assert proposed/accepted graph state, and no graph ID or revision was supplied
to change.

## Outcome

A new desktop profile performs **no update network check by default**. Settings
contains one desktop-only switch, **Automatic update checks**, initially off.
When a user turns it on, GatesAI immediately checks the existing public release
manifest and checks again about every six hours while the app is open. Finding
an update preserves the existing sidebar flow: the user must click to download
and stage it, then click again to restart. Every downloaded updater payload is
still verified by Tauri against the public key pinned in the application.

The preference survives restarts for that local app profile. Web Lite exposes
no updater control, imports no updater plugin, starts no timer, and makes no
updater request.

## Baseline and roadmap reconciliation

The roadmap has three updater statements that describe different points in
time:

- W-5 says the signed updater shipped on 2026-07-12.
- The Later list says the older “Opt-in auto-updater” item was promoted to W-5.
- The canonical Platforms item remains open and explicitly requires “signed,
  OFF by default.”

The code confirms that this open item is not a request to rebuild W-5. Signing,
release publication, update download, staging, restart, and the sidebar prompt
already exist. The missing behavior is the explicit opt-in:

- `src/stores/RootStore.ts` unconditionally calls
  `updates.startBackgroundChecks()` for every desktop boot.
- `UpdateStore.startBackgroundChecks()` immediately invokes the Tauri updater
  and creates a six-hour interval.
- There is no persisted updater-enabled preference or Settings control.
- `RootStore.dispose()` does not stop the updater interval, even though
  `UpdateStore.stopBackgroundChecks()` exists.
- `docs/release-checklist.md` currently expects the update pill to appear just
  by launching the previous AppImage; the opt-in flow will make that step
  stale.

The earlier Workbench design said to “respect an opt-out setting.” The selected
canonical item is more specific and newer for this execution: opt **in**, with
the default **off**. The follow-up must implement the canonical behavior and
correct the older documentation rather than preserve default-on checks.

## Existing signed foundation to preserve

No signing key rotation, plugin replacement, dependency change, asset rename,
or release-workflow rewrite is needed:

| Concern | Existing implementation |
| --- | --- |
| Update client | `@tauri-apps/plugin-updater` in `appUpdater.ts`; dynamic import keeps it out of Web Lite execution |
| Install/restart | `tauri-plugin-updater` download/install plus `tauri-plugin-process` relaunch |
| Trust root | `plugins.updater.pubkey` pinned in `src-tauri/tauri.conf.json` |
| Manifest | Public `GatesAI-Chat-releases/releases/latest/download/latest.json` endpoint |
| Signed artifacts | Release jobs receive `TAURI_SIGNING_PRIVATE_KEY` and stage stable `.sig` files |
| Fail-closed manifest | `updater-manifest` job exits when either Windows or AppImage signature is absent |
| User approval | `UpdatePill` requires a click to install and a later click to relaunch |

“Signed” here refers to Tauri updater artifact signatures, not Windows
Authenticode. The separate `[ETHAN] Signed / trusted release builds` roadmap
item still owns SmartScreen/code-signing/checksum decisions and must not be
folded into this task.

## Product contract

### Exact consent semantics

1. Missing, malformed, or future-version updater settings load as
   `enabled: false`.
2. A desktop boot with `enabled: false` does not call `checkForUpdate`, does
   not dynamically import the updater plugin, and does not allocate a timer.
3. Turning the switch on persists consent first, immediately performs one
   check, and schedules checks every six hours while the app remains open.
4. A later desktop boot with a valid persisted `enabled: true` resumes that
   same lifecycle. This is persistence of the user's explicit choice, not a
   new default.
5. Turning the switch off persists `false`, stops the interval immediately,
   and invalidates an in-flight check so a late response cannot resurrect an
   update prompt.
6. Disabling while an update is merely `available` or in a retryable `error`
   clears that transient candidate and hides the pill. Re-enabling performs a
   fresh signed check.
7. Disabling does not cancel a download already started by the user and does
   not hide an already staged `ready` restart. The Tauri updater API has no
   safe cancellation contract here; preserving the completion/restart
   affordance is safer and more truthful. It only prevents future checks.
8. Install and restart remain separate explicit user actions. Enabling checks
   must never imply automatic download, automatic restart, or background
   installation without the current pill clicks.

### Per-install persistence

Use a dedicated, versioned service-layer persistence slot rather than adding
the setting to `UiStore`:

```ts
interface UpdateSettingsSnapshot {
  version: 1;
  enabled: boolean;
}
```

- Key: `gatesai.updater.v1`.
- Default: `{ version: 1, enabled: false }`.
- Parser: accept only version `1` plus a boolean `enabled`; otherwise return a
  fresh default-off snapshot.
- Store access: injectable `PersistenceProvider<UpdateSettingsSnapshot>` in
  `UpdateStore`, matching the existing Offline Library opt-in pattern. No
  component or MobX store may access `localStorage` directly.
- Export/import: do **not** add this consent to the current chat/UI data-export
  envelope. The opt-in stays local to the app profile where the user enabled
  it; importing conversations or UI presentation on another installation
  must not silently start a release-network request. A future dedicated
  settings-profile export can make any consent-transfer policy explicit.

### Desktop and Web Lite behavior

Pass `RootStore.runtime` into `UpdateStore`. The store exposes updater
availability only for `desktop`, forces effective enablement false for
`web-lite` and `headless`, and ignores attempts to enable outside Desktop.
Keep the service's `isTauri()` no-op guard as defense in depth.

The control belongs at the end of the existing Settings → Desktop block. It is
not rendered in Web Lite because the entire block is already desktop-gated.
Use existing `SettingsRow` and `Toggle` primitives; add no route, modal,
dependency, or first-run nag.

Exact user-facing contract:

- Label: **Automatic update checks**
- Default switch state: off
- Detail: “When on, GatesAI contacts the public releases repository at launch
  and about every six hours. Downloads and restarts still require your click;
  update packages are verified with the app's pinned signing key.”

This copy names the network destination class, cadence, signature boundary,
and retained approval steps without pretending the Windows installer itself is
Authenticode-signed.

## Store lifecycle design

Extend `UpdateStore` rather than putting updater effects in `UiStore` or a
component:

- Constructor options gain `runtime` and `persistence` alongside the existing
  injectable `check` and `relaunch` dependencies.
- Observable `enabled` is initialized from the validated snapshot only when
  runtime is `desktop`; expose `available` as a derived desktop capability.
- `initialize()` starts background checks only for a rehydrated desktop
  opt-in.
- `setEnabled(boolean)` owns persistence and the start/stop transition.
- `startBackgroundChecks()` is idempotent and returns without doing anything
  unless desktop + enabled.
- `checkNow()` also enforces desktop + enabled so direct/internal calls cannot
  bypass the consent boundary.
- Use a monotonically increasing request generation (or equivalent identity
  check) around awaited checks. Disabling increments it; a result applies only
  if its generation is current and enablement is still true.
- `stopBackgroundChecks()` remains idempotent.
- `dispose()` invalidates pending results and stops the interval.

In `RootStore`, construct the store with the runtime, replace the unconditional
desktop start with `updates.initialize()`, and call `updates.dispose()` during
root disposal. Do not introduce a MobX reaction for timer ownership: the
updater store action already owns the complete preference/lifecycle boundary.

The existing `AvailableUpdate`, signature verification, download progress,
install failure, dismiss, and restart behavior should otherwise remain intact.
Do not edit `appUpdater.ts`, `UpdatePill.tsx`, Tauri configuration, capabilities,
Rust plugins, package manifests, or the release workflow unless a failing
acceptance test proves a concrete defect in that existing foundation.

## Implementation slices

### 1. Persisted default-off setting

- Add `src/services/storage/updateSettingsStorage.ts` with the versioned slot,
  strict parser, and fresh default objects.
- Add focused storage tests for missing, valid enabled/disabled, malformed,
  and future-version values.

### 2. Consent-aware updater lifecycle

- Add runtime/persistence injection, `enabled`, `available`, `initialize()`,
  `setEnabled()`, request invalidation, and `dispose()` to `UpdateStore`.
- Gate every automatic check/timer path on the effective opt-in.
- Preserve a user-started installing/ready flow when future checks are turned
  off; clear only non-terminal candidate/error state.
- Wire runtime/init/dispose through `RootStore`.

### 3. Desktop setting

- Add the named toggle and exact explanatory copy to the Desktop block in
  `Settings.tsx`; move the `last` marker from the tray row to this new row.
- Extend the Settings component harness with an observable updater stub.
- Assert default-off rendering and that the toggle delegates to
  `UpdateStore.setEnabled`, without making the component own persistence or
  updater imports.

### 4. Truth docs and release acceptance

- Add an updater lifecycle paragraph/section to `docs/architecture.md`:
  signed existing boundary, dedicated consent slot, default-off/no-request
  invariant, Desktop-only behavior, immediate + six-hour checks after opt-in,
  and explicit install/restart clicks.
- Update the auto-update smoke in `docs/release-checklist.md` to first enable
  **Automatic update checks** on the previous release, then verify the pill,
  signed download/staging, restart, and new version.
- Correct any nearby claim that installed apps poll automatically on every
  launch without consent.
- Append a dated `docs/changelog.md` entry. Do not edit `docs/roadmap.md`; the
  harvesting session owns the verified workflow transition.

## Required test matrix

1. Missing storage defaults exactly to disabled; malformed and future versions
   fail closed to disabled; valid true/false values round-trip.
2. Fresh desktop `initialize()` calls neither the check dependency nor timer
   scheduling.
3. Enabling persists true, checks immediately once, and schedules exactly one
   interval; repeated initialize/start calls do not duplicate the timer.
4. A persisted true desktop store starts checks on initialize; a persisted
   false store does not.
5. A persisted true snapshot in Web Lite/headless has effective enablement
   false, cannot be enabled, and invokes no updater dependency.
6. Disabling persists false, stops future fake-timer checks, and clears an
   available/error pill candidate.
7. A check promise resolved after disabling is ignored and cannot make the
   pill visible.
8. Disabling during installing/ready does not cancel or hide the user-started
   flow; restart still works, while no new check is scheduled.
9. `dispose()` clears the interval and ignores late results.
10. Existing progress, retry, dismiss, staged-update protection, and restart
    tests remain green after opt-in setup is added to their harness.
11. Desktop Settings renders **Automatic update checks** off by default, shows
    the consent/signature copy, calls the store action, persists across reload,
    and does not auto-download.
12. Web Lite Settings has no updater switch and the updater check dependency is
    never invoked.
13. Static review confirms the pinned updater public key, public manifest
    endpoint, signature-required manifest job, stable asset names, and current
    install/restart pill were not weakened.

## Verification

```sh
npx vitest run tests/services/storage/updateSettingsStorage.test.ts \
  tests/stores/UpdateStore.test.ts \
  tests/components/menu/SettingsSection.test.ts
npm run ci
npm run test:e2e
```

No Rust file changes are designed, so the Rust gate is not required for this
follow-up. If implementation unexpectedly changes `src-tauri/`, it must also
run `cargo test --manifest-path src-tauri/Cargo.toml`. The Playwright command
may require the orchestrator's outside-sandbox verifier because the Codex
sandbox cannot bind its Vite listener; do not weaken or skip the suite.

The next normal signed tag remains the real-shell release smoke: run the prior
AppImage, enable checks, observe the pill, install, restart, and verify the new
version. That release operation is Ethan-only and is recorded by the release
checklist rather than attempted in the implementation lane.

## Definition of done

- A fresh Desktop profile provably performs zero updater checks and owns no
  updater interval until the user opts in.
- The valid opt-in persists locally and drives immediate + six-hour checks.
- Disabling is race-safe and does not strand an install already initiated by
  the user.
- Download/install/restart remain explicit, and the existing signed Tauri
  trust chain is unchanged.
- Web Lite remains updater-free and truthful.
- Focused tests, `npm run ci`, and `npm run test:e2e` pass; docs describe the
  new consent flow; harvesting can close the canonical item without another
  product decision.

## Prior-lane failure record

The immediately previous lane,
`claude-unblock-opt-in-tauri-auto-updater-signed-off-by--20260718-run-20260718110645-a32e2bf5`,
did not reach repository work. Its `.orc` handoff records an unavailable model
selection (`gpt-5.6-terra`), adapter exit code 1 after roughly two seconds,
zero tokens, zero changed files, failed verification, and verdict `wedged`.
An earlier Codex attempt on the same old task ID remained recorded as
`running`, which then caused a lease-conflict failure for another retry.

This re-dispatch avoids both failure modes: it uses the available Codex
adapter, writes to the new `-r2324` owned folder, does not wait on or edit stale
`.orc` state, and leaves an implementation-ready source task rather than an
unlanded partial change.
