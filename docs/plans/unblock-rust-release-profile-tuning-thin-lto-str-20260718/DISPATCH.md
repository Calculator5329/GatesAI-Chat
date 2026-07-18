# DISPATCH — Rust release profile tuning

This source task is immediately dispatchable. Read `PLAN.md` in this folder
first; it is the approved design and scope boundary.

## Task spec

- **title:** Tune the Rust release profile with ThinLTO and symbol stripping
- **model tier:** fast
- **goal:** |
    Implement
    `docs/plans/unblock-rust-release-profile-tuning-thin-lto-str-20260718/PLAN.md`
    exactly.

    In `src-tauri/Cargo.toml`, add this release profile and no other profile
    tuning:

    ```toml
    [profile.release]
    lto = "thin"
    strip = "symbols"
    ```

    Before editing, capture the baseline commit/toolchain/target and the exact
    byte sizes of the native Tauri executable and a production bundle. Rebuild
    the same target from the same inputs after editing and report absolute and
    percentage deltas. Use separate Cargo target directories; if reconstructing
    the untuned baseline after the edit, use only
    `CARGO_PROFILE_RELEASE_LTO=false` and
    `CARGO_PROFILE_RELEASE_STRIP=none` for that baseline build.

    Preserve Cargo's other release defaults, the Linux `NO_STRIP=1`
    `linuxdeploy` workaround, Go sidecar build flags, source snapshot, updater
    signing, stable artifact names, and all runtime behavior. Append a dated
    changelog entry with the measured evidence. Do not bump a version, tag,
    publish, deploy, or edit the roadmap; the harvesting session owns the
    checkbox transition.
- **owns:**
    - `src-tauri/Cargo.toml`
    - `docs/changelog.md`
- **test-cmd:** `npm run ci && cargo test --manifest-path src-tauri/Cargo.toml && npm run test:e2e`

## Acceptance

- Manifest profile is exactly ThinLTO plus symbol stripping; no `opt-level`,
  `panic`, `codegen-units`, dependency-profile, UPX, or workflow flag change.
- Same-input measurements include exact before/after native-executable and
  final-bundle bytes. The tuned native executable is strictly smaller; the
  bundle delta is recorded without an invented threshold.
- A production Tauri bundle succeeds and smoke-launches on the verifier's host;
  the app window opens and its bundled bridge is healthy.
- The next cross-platform release workflow remains green for macOS app/DMG,
  Windows NSIS, Linux AppImage, and signed updater artifacts.
- `npm run ci`, Rust tests, and E2E are green. If E2E needs a listener, use the
  orchestrator's outside-sandbox verifier; do not weaken or skip the gate.
- Changelog is true. There are no runtime-code, dependency, bridge, asset-name,
  signing, version, release-publication, or roadmap changes.

## Dispatcher notes

- No Ethan decision remains; `APPROVED` is authoritative.
- A release-capable host with a prepared `gatesai-bridge` sidecar is required
  for the bundle-size comparison. Ordinary Cargo tests do not prove installer
  size.
- ThinLTO can lengthen the release link. Record the observed build time if it is
  readily available, but do not broaden this item into CI-cache or build-speed
  work.
