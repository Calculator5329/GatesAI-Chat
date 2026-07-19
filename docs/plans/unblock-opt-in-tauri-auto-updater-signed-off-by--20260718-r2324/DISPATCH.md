# DISPATCH — implement the default-off signed updater opt-in

This source task is immediately dispatchable. Read `PLAN.md` in this folder
first; it is the authoritative repository-backed design for the re-dispatched
roadmap item. W-5's signed updater foundation is already shipped. This task
adds the missing consent boundary without rebuilding or weakening signing.

## Task spec

- **title:** Make signed Tauri update checks opt-in and OFF by default
- **model tier:** smart
- **goal:** |
    Implement
    `docs/plans/unblock-opt-in-tauri-auto-updater-signed-off-by--20260718-r2324/PLAN.md`
    exactly.

    Add a strict version-1 persistence slot at `gatesai.updater.v1` with only
    `{ version: 1, enabled: boolean }`; missing, malformed, and future values
    must default false. Keep this consent per local app profile and out of the
    chat/UI data-export envelope. Access storage only through an injectable
    service-layer `PersistenceProvider`.

    Extend `UpdateStore` with runtime-aware `available`/`enabled` state,
    `initialize`, `setEnabled`, race-safe check invalidation, and `dispose`.
    A fresh Desktop profile, Web Lite, and headless runtime must make zero
    updater calls and allocate no update interval. Explicit Desktop enablement
    persists true, checks immediately, and schedules one six-hour interval;
    persisted valid consent resumes on a later boot. Disable stops checks,
    persists false, ignores late check results, and clears an available/error
    candidate. It must not cancel or hide an install/ready flow already
    initiated by the user. Install and restart remain separate pill clicks.

    Pass `RootStore.runtime` to `UpdateStore`, replace unconditional desktop
    background checks with consent-aware initialization, and dispose the
    updater lifecycle from `RootStore.dispose()`.

    At the end of Settings → Desktop, add an existing-primitive toggle labeled
    `Automatic update checks`, off by default, with this detail:
    “When on, GatesAI contacts the public releases repository at launch and
    about every six hours. Downloads and restarts still require your click;
    update packages are verified with the app's pinned signing key.”
    Do not render the control in Web Lite.

    Cover the complete PLAN.md matrix: storage fail-closed behavior, zero-call
    default, valid rehydration, idempotent single timer, disable/timer cleanup,
    late-result invalidation, installing/ready preservation, disposal, current
    updater behavior, Settings toggle/persistence, and Web Lite absence/no
    invocation. Use fake timers and injected check/persistence dependencies;
    tests must not contact GitHub or import the real updater plugin.

    Document the consent lifecycle in architecture, change the release smoke
    to enable the toggle before expecting the pill, correct default-on polling
    claims, and append the changelog. Do not edit `docs/roadmap.md`; harvesting
    owns the verified item transition.

    Preserve the existing updater packages, Rust plugin registration,
    capabilities, pinned public key, public `latest.json` endpoint,
    signature-required manifest job, stable release asset names,
    `appUpdater.ts`, and `UpdatePill` behavior. Do not rotate keys, add
    dependencies, change the release workflow, conflate Tauri signatures with
    Windows Authenticode, publish a release, or touch a sibling repository.
- **owns:**
    - `src/services/storage/updateSettingsStorage.ts`
    - `src/stores/UpdateStore.ts`
    - `src/stores/RootStore.ts`
    - `src/components/menu/sections/Settings.tsx`
    - `tests/services/storage/updateSettingsStorage.test.ts`
    - `tests/stores/UpdateStore.test.ts`
    - `tests/components/menu/SettingsSection.test.ts`
    - `tests/e2e/desktop.spec.ts`
    - `tests/e2e/web-lite.spec.ts`
    - `docs/architecture.md`
    - `docs/release-checklist.md`
    - `docs/changelog.md`
- **test-cmd:** `npx vitest run tests/services/storage/updateSettingsStorage.test.ts tests/stores/UpdateStore.test.ts tests/components/menu/SettingsSection.test.ts && npm run ci && npm run test:e2e`

## Acceptance criteria

- New/malformed/future updater state is disabled and causes no check/import or
  interval on Desktop boot.
- Only explicit Desktop enablement persists consent, checks immediately, and
  starts one six-hour timer; a later boot with that valid setting resumes.
- Disable is idempotent, clears future work and non-install candidates, and
  rejects stale async results without interrupting a user-started install or
  staged restart.
- The Desktop setting uses the exact label/copy above and defaults off; Web
  Lite shows no control and invokes no updater dependency.
- Downloads and restarts still require existing `UpdatePill` clicks, and the
  existing Tauri signature trust chain is unchanged.
- Focused tests, `npm run ci`, and `npm run test:e2e` pass. If any
  `src-tauri/` file changes unexpectedly, also pass
  `cargo test --manifest-path src-tauri/Cargo.toml` and justify the scope
  expansion.
- Architecture, release checklist, and changelog are truthful. The next signed
  release checklist tells the tester to enable update checks before expecting
  the previous AppImage to discover the release.

## Dispatcher notes

- The authoritative workflow decision is `RE-DISPATCH`; do not infer or alter
  proposed/accepted graph state from it.
- The previous Claude lane wedged before work because its selected model was
  unavailable. Dispatch only through an adapter/model that passes preflight.
- Old task records include an orphaned `running` Codex attempt and a stale
  lease conflict under the non-`r2324` path. Use this task's new ownership
  paths; do not hand-edit `.orc` state or reuse the stale lane.
- The real older-AppImage smoke needs a future signed release and owner action;
  the implementation lane records the exact release-checklist step but does
  not tag, publish, or deploy.
