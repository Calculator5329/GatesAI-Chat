# Portable mode execution plan

> **Executor instruction:** Read `DESIGN.md` in this folder completely before
> changing source. The design decisions are final. Execute the bridge task first,
> then the chat-app task. Stop on any condition below; do not improvise around a
> storage, secret, or workspace-isolation mismatch.

## Status

| Step | Repo | Priority | Effort | Depends on | Status |
| --- | --- | --- | --- | --- | --- |
| 1. Bridge explicit portable data root | `ai/gatesai-bridge` | P1 | S | none | TODO |
| 2. Portable host/runtime and Windows ZIP | `ai/gatesai-chat` | P1 | L | step 1 merged or pinned | TODO |
| 3. Windows artifact smoke and docs truth | `ai/gatesai-chat` release workflow | P1 | M | step 2 | TODO |

## Drift checks

Before step 1:

```sh
git -C /home/ethan/projects/ai/gatesai-bridge diff --stat b3703fa..HEAD -- \
  cmd/gatesai-bridge/main.go internal/config README.md docs
```

Before step 2:

```sh
git diff --stat 7fdbb6a..HEAD -- \
  src-tauri/src/lib.rs src-tauri/src/source_workspace.rs src/core/runtime.ts \
  src/services/bridge/health.ts src/services/updates/appUpdater.ts \
  src/stores/BridgeStore.ts scripts .github/workflows/release.yml README.md docs
```

The opt-in-updater and Windows-CI items were active when this plan was written.
If either changed an in-scope file, reconcile the portable guard with the live
implementation while preserving the acceptance criteria; do not restore the old
excerpt mechanically.

## Commands

| Purpose | Repo | Command | Expected result |
| --- | --- | --- | --- |
| Bridge tests | `gatesai-bridge` | `go test ./...` | exit 0, all packages pass |
| App unit/type/lint | `gatesai-chat` | `npm run ci` | exit 0 |
| Rust host tests | `gatesai-chat` | `TAURI_CONFIG='{"bundle":{"externalBin":[],"resources":[]}}' cargo test --manifest-path src-tauri/Cargo.toml` | exit 0 |
| UI E2E | `gatesai-chat` | `npm run test:e2e` | all projects pass; requires an outside-sandbox verifier because Vite must bind a port |
| Windows artifact | GitHub/Windows verifier | Dispatch `Release desktop builds` with the bridge ref containing step 1 | Windows job produces installer + portable ZIP; portable smoke assertions pass |

Do not run `npm run test:models`; it is live and paid. Do not publish a release
from an implementation lane.

## Step 1 — give the bridge an explicit portable data root

1. Add `--data-dir` parsing in `cmd/gatesai-bridge/main.go`. Keep `--listen`
   behavior unchanged.
2. Refactor `internal/config/config.go` around an explicit config-path loader.
   Keep `LoadOrCreate()` as the installed compatibility wrapper.
3. When a data root is supplied, use `<root>/bridge.json`, seed
   `workspace_root` as relative `workspace`, and resolve relative workspace
   values against the config directory. Reject relative `..` escapes; continue
   accepting explicit absolute values.
4. Add `internal/config/config_test.go` covering installed defaults, portable
   first creation, relative resolution after moving an entire fixture tree,
   absolute overrides, malformed JSON, and invalid/unwritable roots.
5. Document the flag and relative-path rule in README; append bridge changelog
   evidence and record the completed tracked item according to that repo’s docs
   convention.

**Gate:** `go test ./...` passes and `go run ./cmd/gatesai-bridge --help` lists
`--data-dir`. An invocation without the option still reports the normal home
workspace.

## Step 2 — route portable app state and isolate the bridge

1. Add the pure Rust portable-mode/path model and tests in
   `src-tauri/src/portable.rs`.
2. Refactor `src-tauri/src/lib.rs` startup:
   - detect the exact versioned marker once;
   - suppress Tauri’s config-created main window only in portable mode;
   - create/validate portable roots;
   - create the main WebView with absolute `data/webview` and the safely
     serialized desktop-runtime initialization object;
   - spawn installed bridge on `7331` as today or portable bridge on `7332`
     with `--data-dir data/bridge`;
   - never kill or reuse a conflicting foreign bridge.
3. Route `source_workspace::managed_paths` through the shared app-data-root
   resolver and add a pure-root regression test.
4. Add validated desktop runtime helpers in core. Switch bridge HTTP/WS clients
   to those endpoints. Add the portable expected-workspace comparison before
   the WebSocket connects or state becomes online.
5. Guard the live updater entry point before its dynamic import. Preserve the
   concurrent opt-in updater’s installed-mode policy.

**Gate:** targeted Rust/core/BridgeStore/updater tests pass. Tests prove that a
malformed marker cannot fall back to installed storage and a workspace mismatch
causes zero WebSocket or workspace requests.

## Step 3 — stage, publish, and verify the ZIP

1. Add the dependency-free staging helper and fixture-based tests specified in
   `DESIGN.md`.
2. Extend only the Windows job in `.github/workflows/release.yml`; leave NSIS,
   Linux, macOS, updater signatures, and `latest.json` semantics intact.
3. Stage the raw release EXE, target-triple bridge renamed to
   `gatesai-bridge.exe`, source snapshot, marker, and portable README below one
   top-level folder. Compress to the stable asset name.
4. Expand and structurally verify the ZIP in CI before upload.
5. Run a Windows process smoke in a fresh extraction when the runner supports
   WebView startup: wait for bridge health on `7332`, assert the reported
   workspace is inside the extracted folder, assert all three data roots exist,
   then close only the processes started by the step. If GitHub’s non-interactive
   desktop cannot start WebView2 reliably, move this exact smoke to the Windows
   worker; do not weaken it to a structure-only assertion.
6. Update README download table and portable instructions, architecture, tech
   spec, release checklist, and changelog. Do not edit `docs/roadmap.md`; the
   harvesting session owns its canonical transition.

**Gate:** `npm run ci`, Rust tests, and outside-sandbox `npm run test:e2e` are
green. A Windows workflow artifact passes the first-launch, relaunch, move-folder,
installed-coexistence, and mismatch cases in `DESIGN.md` before this is called
shipped.

## Review focus

- Confirm there is one portable-mode decision shared by window creation,
  Rust-managed data, sidecar spawn, frontend endpoints, and updater gating.
- Search for remaining production `7331` constants; only installed defaults,
  docs, and explicit test fixtures should remain.
- Inspect the release ZIP contents and verify no `data/`, credential, developer
  absolute path, build cache, or source `.env*` file is present.
- Inspect `bridge.json` after moving the folder: the saved default must be
  relative and health must report the new absolute workspace.
- Confirm installed-mode snapshots and bridge defaults are unchanged.

## STOP conditions

Stop and report instead of improvising if:

- Tauri’s pinned API cannot set an absolute WebView data directory before the
  first main-window creation.
- Implementing portable mode appears to require plaintext credentials, weakening
  keyring use, or putting secrets into the portable tree.
- The bridge cannot accept an explicit data root without changing terminal
  `HOME`/`USERPROFILE` semantics or weakening its workspace jail.
- Portable and installed instances can observe the same WebView profile or
  bridge workspace in any smoke case.
- A workspace-root mismatch can still reach WebSocket negotiation or an RPC.
- The ZIP needs any file not enumerated in `DESIGN.md`, or staging would include
  a pre-existing `data/` directory.
- The source has drifted such that the updater no longer uses
  `appUpdater.ts`; locate the new single update boundary and stop for plan review
  if more than one independent guard would be required.
