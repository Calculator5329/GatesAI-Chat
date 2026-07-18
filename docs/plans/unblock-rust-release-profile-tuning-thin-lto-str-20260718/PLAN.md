# Rust release profile tuning for installer size

Status: **approved and implementation-ready**

Roadmap item: `Rust release profile tuning (thin LTO, strip) for installer size`

Decision authority: Ethan — `APPROVED` (2026-07-18)

## Outcome

Reduce the native Tauri executable, and therefore the Windows NSIS and Linux
AppImage downloads, with Cargo's conservative release-only size controls. The
change must not alter application behavior, the development/test profiles, the
bundled Go bridge, the source snapshot, updater signing, or stable release asset
names.

This is a build-configuration item, not a runtime performance rewrite. The
implementation is intentionally two settings in `src-tauri/Cargo.toml`:

```toml
[profile.release]
lto = "thin"
strip = "symbols"
```

Use the explicit string form of `strip` so the intended operation is
unambiguous: remove symbols from release binaries. Do not substitute `"z"`
optimization, `panic = "abort"`, `codegen-units = 1`, dependency-specific
profile overrides, UPX, or post-build binary rewriting. Those choices have
different runtime, diagnostic, compatibility, or build-time tradeoffs and are
not part of the approved item.

## Current-state findings

- `src-tauri/Cargo.toml` has no `[profile.release]`, so Cargo release defaults
  apply today.
- `.github/workflows/release.yml` invokes `npx tauri build` on macOS, Windows,
  and Linux. A manifest release profile therefore reaches every native build
  without workflow-specific flags.
- The public downloadable artifacts are the stable-name Windows NSIS installer
  and Linux AppImage. The workflow also builds a macOS app/DMG.
- The Go bridge is already compiled separately with Go's `-ldflags "-s -w"`.
  Cargo profile settings do not affect it.
- `scripts/tauri-build.mjs` sets `NO_STRIP=1` on Linux to bypass a known
  `linuxdeploy` post-processing failure on `.relr.dyn`. Cargo's
  `strip = "symbols"` happens while Rust links the executable; it does not
  remove or weaken that packaging workaround.
- Release bundles also contain the source snapshot and bridge sidecar, so the
  installer percentage reduction will be smaller than the native executable
  reduction. Evidence must report both rather than implying they are equal.
- No crash-symbol upload or symbol-server workflow exists in this repository.
  Release builds already default to no debug info; stripping the remaining
  symbol table does not discard a currently shipped diagnostics artifact.

## Why this profile

Thin LTO lets LLVM optimize across Rust code-generation units with a lower
release-build cost than fat LTO. Symbol stripping removes link-time names that
the shipped application does not need. Together they target size while keeping
Cargo's normal release optimization level and unwind behavior intact.

The cost is a potentially longer release link. That is acceptable because the
settings do not affect `dev`, `test`, or Web Lite builds. Release CI duration
should be recorded once, but there is no reason to add a build-time threshold
until a real regression is observed.

## Implementation plan

1. Capture the baseline commit, Rust toolchain, target triple, native executable
   byte size, and packaged artifact byte size before changing the manifest.
   Use the same host/toolchain, source snapshot, bridge binary, target, and
   bundle kind for the tuned comparison. Do not compare artifacts from
   different app versions as the primary proof.
2. Append the exact `[profile.release]` block above to
   `src-tauri/Cargo.toml`. Keep dependency declarations and every other Cargo
   profile setting unchanged.
3. Run the repository gates. No new unit test is warranted because this is
   declarative Cargo configuration; successful release compilation is the
   relevant executable check.
4. Build the same release target again without Cargo profile environment
   overrides. Record native executable and final installer bytes plus absolute
   and percentage deltas in the changelog entry or attached verifier evidence.
   If a baseline must be rebuilt after the manifest edit, override only the two
   settings (`CARGO_PROFILE_RELEASE_LTO=false` and
   `CARGO_PROFILE_RELEASE_STRIP=none`) and use a separate Cargo target directory
   so the comparison cannot reuse tuned objects.
5. Smoke-launch the resulting native bundle on the build platform and verify
   that the bundled bridge starts. The next cross-platform release workflow
   must confirm Windows, Linux, and macOS packaging and updater signatures.
6. Append a dated `docs/changelog.md` entry describing the settings and the
   observed size evidence. The harvesting session, not the source lane, updates
   `docs/roadmap.md`.

## Verification and acceptance

The source task is complete when all of the following are true:

- `src-tauri/Cargo.toml` contains exactly `lto = "thin"` and
  `strip = "symbols"` under `[profile.release]`; no unrelated profile knob was
  added.
- `cargo test --manifest-path src-tauri/Cargo.toml`, `npm run ci`, and
  `npm run test:e2e` pass. Playwright may require the orchestrator's
  outside-sandbox verifier because the Codex sandbox cannot bind its server.
- A production release build succeeds with no change to updater signing,
  sidecar inclusion, source-snapshot inclusion, or artifact names.
- Same-input evidence reports exact bytes for both the native executable and
  final bundle before and after tuning, with the tuned native executable
  strictly smaller. The final bundle delta is recorded honestly even if fixed
  bundle content makes the percentage modest.
- The built app launches, opens its window, and reaches a healthy bundled
  bridge on at least the locally built platform.
- `docs/changelog.md` records the change and evidence. No dependency, runtime
  code, bridge code, version bump, deployment, tag, or release publication is
  included.

## Rollback

If any supported target fails to link/package or the native executable is not
smaller under a controlled comparison, remove the entire `[profile.release]`
block and retain the measurements in the task evidence. Do not compensate by
changing signing, disabling updater artifacts, weakening tests, or modifying
the Linux packaging workaround.
