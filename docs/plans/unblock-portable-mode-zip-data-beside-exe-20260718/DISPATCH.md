# DISPATCH — Portable mode (ZIP, data beside EXE)

The approved design requires a small bridge prerequisite and one app/release
implementation. Dispatch in order. Both executors must read
`docs/plans/unblock-portable-mode-zip-data-beside-exe-20260718/DESIGN.md` and
`EXECUTION.md` from `ai/gatesai-chat` before editing. Do not reopen the decided
marker, port, data layout, secret, update, or packaging policies.

## Task 1 — bridge portable data-root option

- **title:** `Bridge: add explicit portable data root with movable relative workspace`
- **repo:** `ai/gatesai-bridge`
- **model tier:** smart
- **goal:** Add `gatesai-bridge --data-dir <absolute-directory>` without changing
  installed defaults or protocol v2. The option selects
  `<data-dir>/bridge.json`; first creation stores `workspace_root` as relative
  `workspace`; relative workspace values resolve against the config directory
  so a whole portable folder can move drives; absolute user overrides remain
  valid, while relative `..` escapes are rejected. Keep `LoadOrCreate()` as the
  home-directory compatibility wrapper.
  Do not fake `HOME`/`USERPROFILE`, change the path jail/allowlist/caps, broaden
  listen defaults, or change RPC schemas. Add deterministic config tests and
  document the flag.
- **depends on:** none
- **owns:**
  - `cmd/gatesai-bridge/main.go`
  - `internal/config/config.go`
  - `internal/config/config_test.go` (new)
  - `README.md`
  - `docs/roadmap.md`
  - `docs/changelog.md`
- **test-cmd:** `go test ./...`
- **acceptance:**
  - `go run ./cmd/gatesai-bridge --help` lists `--data-dir`.
  - No option preserves `~/.gatesai/bridge.json` and
    `~/GatesAI/workspace` behavior.
  - A fresh explicit root writes `<root>/bridge.json` with
    `"workspace_root": "workspace"` and health resolves it beneath that root.
  - Moving the complete fixture root and reloading resolves beneath the new
    root; the config contains no old absolute path.
  - Malformed config, invalid root, absolute workspace override, and rejected
    relative escape behavior have tests; existing server/operation tests
    remain green.
  - Changelog/tracking docs are true; no secrets or personal paths enter
    fixtures.

## Task 2 — app portable runtime and Windows ZIP release asset

- **title:** `Ship Windows portable ZIP with all non-secret data beside the EXE`
- **repo:** `ai/gatesai-chat`
- **model tier:** smart
- **goal:** Implement the approved portable-mode design exactly. A versioned
  `portable.flag` beside the EXE activates a custom WebView2 data directory at
  `data/webview`, Rust-managed app data at `data/app`, and bridge data/workspace
  at `data/bridge`; installed mode remains unchanged. Portable uses bridge port
  `7332`, passes the bridge Task-1 `--data-dir` option, validates the health
  workspace before any WebSocket/RPC, and disables updater imports/checks.
  Extend the Windows release job to publish
  `GatesAI-Chat-Portable-x64.zip` containing the EXE, renamed sidecar, marker,
  portable README, and source snapshot under one top-level folder, with no
  packaged `data/`. Credentials remain in Windows Credential Manager and are
  documented as non-portable. Do not change bridge security/protocol, Web Lite,
  Linux/macOS packages, installed storage, or `latest.json` Windows updater
  target.
- **depends on:** Task 1 merged to the bridge ref used by the build. Also
  reconcile the active opt-in-updater task before editing updater files.
- **owns:**
  - `src-tauri/src/portable.rs` (new)
  - `src-tauri/src/lib.rs`
  - `src-tauri/src/source_workspace.rs`
  - `src/core/runtime.ts`
  - `src/services/bridge/health.ts`
  - `src/services/updates/appUpdater.ts`
  - `src/stores/BridgeStore.ts`
  - `scripts/stage-windows-portable.mjs` (new)
  - `tests/core/runtime.test.ts` (new)
  - `tests/services/portableBundle.test.ts` (new)
  - `tests/services/updates/appUpdater.test.ts` (new)
  - `tests/stores/BridgeStore.test.ts`
  - `.github/workflows/release.yml`
  - `README.md`
  - `docs/architecture.md`
  - `docs/tech_spec.md`
  - `docs/release-checklist.md`
  - `docs/quick-setup.md`
  - `docs/changelog.md`
- **must not own/edit:** `docs/roadmap.md` (harvesting session owns the canonical
  transition), `src-tauri/tauri.conf.json` updater endpoints/keys, sibling bridge
  source, persistence schemas/migrations, or security allowlists.
- **test-cmd:**

  ```sh
  npm run ci && \
  TAURI_CONFIG='{"bundle":{"externalBin":[],"resources":[]}}' cargo test --manifest-path src-tauri/Cargo.toml && \
  npm run test:e2e
  ```

  The E2E command needs an outside-sandbox verifier because the sandbox cannot
  bind Vite ports. Additionally dispatch the Windows `Release desktop builds`
  workflow against Task 1’s bridge ref and require the portable artifact smoke;
  do not publish a release from the implementation lane.
- **acceptance:** every checkbox in `DESIGN.md` passes, including first launch,
  relaunch, move-folder, installed/portable coexistence, conflicting portable
  root fail-closed, updater no-op, credential exclusion, exact ZIP structure,
  and docs truth. Unit tests must assert zero WebSocket/workspace requests on a
  root mismatch and exact marker/staging behavior. The ZIP remains outside
  `latest.json`; the installed NSIS updater regression tests remain green.
