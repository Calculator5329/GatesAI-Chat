# Portable mode (ZIP, data beside EXE) — design

> **Decision status:** APPROVED by Ethan (authoritative task decision,
> 2026-07-18).
>
> **Planned at:** `gatesai-chat` commit `7fdbb6a`; bridge behavior inspected at
> `gatesai-bridge` commit `b3703fa`.
>
> **Scope:** Windows x64 only. The phrase “EXE” and the requested ZIP define a
> Windows portable distribution. The installed Windows build, Linux AppImage,
> macOS app, and Web Lite keep their current storage behavior.

## Outcome

The public release gains a stable
`GatesAI-Chat-Portable-x64.zip` asset. Extracting it produces one self-contained
folder. Running `GatesAI-Chat.exe` creates a `data/` directory beside the EXE;
moving or archiving the whole folder moves the app state, RAG/thread archives,
managed source workspace, bridge configuration, chats, attachments, artifacts,
skills, and logs together.

Provider credentials remain in Windows Credential Manager. They are deliberately
not written beside the EXE, copied into the ZIP, or included in JSON exports. A
portable folder moved to another Windows account or machine therefore requires
the user to enter provider keys again. This is the only app-data portability
exception and preserves the repository’s existing secret-storage safety rule.
Because the installed and portable builds use the same `gatesai-chat` keyring
service name, they intentionally see the same provider credentials when run by
the same Windows account; deleting or replacing a key in either build affects
the other.

## User-visible contract

1. Download `GatesAI-Chat-Portable-x64.zip` and extract the top-level
   `GatesAI-Chat-Portable/` folder somewhere writable.
2. Launch `GatesAI-Chat.exe`; no installer, account, or configuration file is
   required.
3. GatesAI creates and uses `data/` in that folder. It does not use the installed
   app’s WebView profile, bridge config, or default `~/GatesAI/workspace`.
4. The portable build can run while an installed GatesAI instance is running.
   Installed mode keeps bridge port `7331`; portable mode uses `7332`.
5. A second portable folder cannot silently attach to the first folder’s bridge.
   If port `7332` is already serving a different workspace, workspace tools show
   an explicit offline/conflict reason rather than reading or writing the wrong
   folder.
6. Auto-update checks and installation are disabled in portable mode. To update,
   fully quit GatesAI, extract the new ZIP to a new folder, copy the old `data/`
   directory into it, verify the new version, and archive the old folder. The
   NSIS installer/updater path remains unchanged.
7. Starting from an unwritable folder fails before the main window opens and
   shows a native error naming the folder and advising the user to move the
   extracted folder to a writable location.

No automatic installed-to-portable migration is attempted. Users can start
fresh, move their workspace files intentionally, or use the existing JSON
export/import flow. Silent copying would duplicate data and create ambiguous
ownership.

## Archive and data layout

```text
GatesAI-Chat-Portable/
├── GatesAI-Chat.exe
├── gatesai-bridge.exe
├── portable.flag                 # exact content: gatesai-portable-v1
├── PORTABLE-README.txt
├── source/                       # shipped self-improvement source snapshot
│   ├── manifest.json
│   └── current/...
└── data/                         # created on first launch; absent from release ZIP
    ├── webview/                  # WebView2 localStorage, IndexedDB, cache
    ├── app/
    │   └── source-workspace/     # editable managed source copy
    └── bridge/
        ├── bridge.json           # portable bridge configuration
        └── workspace/
            ├── .gatesai/         # app-owned chat snapshot, skills, etc.
            ├── chat-history/
            ├── attachments/
            ├── artifacts/
            └── logs/
```

The release ZIP never contains `data/`, so it cannot publish developer state or
overwrite user state when unpacked. `PORTABLE-README.txt` explains the layout,
credential exception, manual update flow, and requirement to quit the app before
copying `data/`.

External programs and models are references, not portable payloads. Saved Ollama,
ComfyUI, MCP, and source-tool paths travel in WebView storage, but their target
binaries/models must exist on the destination machine.

## Why the current application is not portable

- `src-tauri/tauri.conf.json:13-24` lets Tauri create the main WebView from static
  config. With no override, pinned Tauri `2.10.3` places Windows WebView data in
  its local-app-data directory.
- `src-tauri/src/source_workspace.rs:497-509` places the managed source workspace
  under `app_local_data_dir()`.
- `src-tauri/src/lib.rs:21-28,127-135` probes/spawns the bridge on fixed port
  `7331` with only a `--listen` override.
- `src/stores/BridgeStore.ts:23,68-70` and
  `src/services/bridge/health.ts:4,19-25` hard-code that bridge endpoint.
- The bridge currently loads `~/.gatesai/bridge.json` and defaults to
  `~/GatesAI/workspace` (`gatesai-bridge/internal/config/config.go:45-76`). Its
  CLI exposes only `--listen`
  (`gatesai-bridge/cmd/gatesai-bridge/main.go:24-34`).
- `.github/workflows/release.yml:167-223` builds and publishes only the NSIS
  installer even though the raw EXE, sidecar, and source snapshot are all
  available in that job.
- `src/services/updates/appUpdater.ts:23-50` treats every Tauri Windows runtime
  as installable and would otherwise offer the NSIS updater to a portable copy.

Merely zipping the raw EXE would therefore split state across the ZIP directory,
Windows LocalAppData, Windows Credential Manager, and the home-directory bridge
workspace. It would also let installed and portable instances share a bridge by
accident.

## Host architecture

### Marker-based mode selection

Add `src-tauri/src/portable.rs` with a small, pure path/mode model:

- Resolve `std::env::current_exe()` and its parent; never use the process working
  directory.
- Interpret the marker only in Windows desktop builds. Linux, macOS, and mobile
  builds remain installed mode even if a file with that name is present beside
  their executable.
- A missing sibling `portable.flag` means installed mode. A regular file whose
  trimmed contents equal `gatesai-portable-v1` means portable mode. If the path
  exists but is not a regular file or has any other content, fail startup with a
  native corruption/version error rather than silently falling back to installed
  storage.
- Derive `data_root`, `webview_data_root`, `app_data_root`,
  `bridge_data_root`, and `bridge_workspace_root` from the EXE directory.
- Installed mode retains `app.path().app_local_data_dir()` and the default WebView
  directory.
- Create/validate the portable directories in Tauri setup. On error, use the
  already-registered dialog plugin to show a native error, then exit from the
  dialog callback without spawning a bridge or opening the main window. Do not
  call `blocking_show` from Tauri's main setup thread.
- Expose the mode as managed Rust state so source-workspace and launcher code use
  one decision rather than probing the marker independently.

Unit tests operate on explicit temporary roots; they do not depend on the test
binary’s real location. Cover missing/wrong/correct marker, all derived paths,
file-vs-directory marker rejection, and unwritable/invalid-root errors where the
platform permits deterministic simulation.

### Custom WebView data directory

Tauri’s JSON `dataDirectory` accepts only a path relative to LocalAppData, so it
cannot implement this contract. Pinned Tauri `2.10.3` exposes the absolute-path
`WebviewWindowBuilder::data_directory(PathBuf)` API.

At startup, before handing the generated context to `Builder::run`:

1. Detect the marker exactly once and retain either installed mode, portable
   paths, or the startup error. Generate the normal Tauri context and clone its
   `main` `WindowConfig`.
2. For portable mode **or any marker/path-detection error**, set the generated
   context entry’s `create` field to `false`. Tauri creates configured windows
   before its setup hook, so this is required to prevent both a transient
   LocalAppData WebView and an installed-mode fallback on invalid input.
3. Installed mode passes the otherwise unchanged context to Tauri and keeps the
   config-created main window. For a detection error, setup shows the native
   error and exits without creating a window or starting the bridge.
4. In portable mode, setup validates/creates `data/`, then builds the cloned
   main window with
   `WebviewWindowBuilder::from_config(...).data_directory(data/webview)`.
5. Add a safely JSON-serialized initialization script that defines:

   ```ts
   window.__GATESAI_DESKTOP_RUNTIME__ = {
     portable: true,
     bridgePort: 7332,
     expectedBridgeWorkspaceRoot: '<absolute data/bridge/workspace path>'
   };
   ```

   Serialize the object with `serde_json`; never interpolate an unescaped path
   into JavaScript.
6. Installed mode continues using the unchanged config-created main window and
   frontend defaults (`portable: false`, port `7331`).

This redirects both localStorage and IndexedDB, covering the app snapshot and
the two current IDB databases (`src/services/persistence/idb.ts` thread archive
and `src/services/rag/vectorStore.ts` RAG vectors) without adding a second
persistence implementation.

### Rust-managed app data

Change `source_workspace::managed_paths` to obtain its base directory from the
shared portable-mode state:

- installed: existing `app_local_data_dir()`;
- portable: `<exe>/data/app`.

The existing `source-workspace/` layout, safety marker, copy behavior, and source
build behavior remain unchanged. The shipped read-only source resource remains
`<exe>/source`; only its editable copy moves into `data/app/source-workspace`.

### Runtime bridge endpoint

Extend `src/core/runtime.ts` (or a focused adjacent core module) with pure readers
for `window.__GATESAI_DESKTOP_RUNTIME__`:

- `isPortableDesktop()`;
- `bridgePort()` (validated integer, default `7331`);
- `bridgeHealthUrl()` and `bridgeWebSocketUrl()`;
- `expectedBridgeWorkspaceRoot()`.

`BridgeStore` and `probeBridgeHealth` consume these helpers rather than constants.
Before connecting the WebSocket, `BridgeStore.poll()` compares the health
payload’s workspace root with the expected portable root. Normalize separators,
trailing separators, and Windows case. A mismatch is an offline state with a
specific message; it must never become `online`, seed a guide, enable persistence,
or issue workspace requests.

Port `7332` deliberately separates installed and portable processes while
preserving the bridge’s loopback-only trust boundary. The existing CSP already
allows loopback wildcard ports. Same-folder relaunches may reuse a healthy
portable bridge only when the reported workspace matches.

### Bridge portable-data contract

The bridge gets one new CLI option:

```text
--data-dir <absolute-directory>
```

With no option, behavior remains byte-for-byte compatible: config at
`~/.gatesai/bridge.json`, default workspace at `~/GatesAI/workspace`.

With `--data-dir D`:

- configuration path is `D/bridge.json`;
- a newly created config stores `"workspace_root": "workspace"` (relative, not
  an absolute path tied to the current drive/folder);
- relative workspace paths in that config resolve against `D`, not the bridge
  process working directory;
- a relative workspace value that lexically escapes `D` through `..` is
  rejected; users who intentionally want an external workspace must make that
  choice explicit with an absolute path;
- absolute user-edited workspace paths remain supported;
- all existing config validation, file caps, allowlist behavior, path jail, and
  protocol version remain unchanged.

Implement this as an explicit-path loader in `internal/config`, with the existing
`LoadOrCreate()` as the installed-mode compatibility wrapper. Do not fake a home
directory through `HOME`/`USERPROFILE`; that would leak into bridge-spawned
terminal commands and change `~` semantics.

The Tauri launcher passes:

```text
--listen 127.0.0.1:7332 --data-dir <exe>/data/bridge
```

only in portable mode. Installed mode keeps its current `--listen
127.0.0.1:7331` invocation.

## Update policy

`checkForUpdate()` must return `null` before importing the updater plugin when
`isPortableDesktop()` is true. This guard must also be preserved if the concurrent
opt-in-updater work changes where checks are initiated. No background timer,
download, install, or relaunch path may activate in portable mode.

The portable ZIP is not added to `latest.json`; that manifest continues pointing
Windows clients to `GatesAI-Chat-Setup-x64.exe`. Portable users update manually
using `PORTABLE-README.txt` and the release checklist.

## Release construction

Add a dependency-free `scripts/stage-windows-portable.mjs` helper. It accepts
explicit EXE, target-triple sidecar, source-snapshot, and output paths; refuses a
non-empty destination; and stages the exact archive tree above. It writes the
versioned marker and portable README. It must not read developer home state.

In the existing Windows release job, after the NSIS build:

1. Stage the installer as today.
2. Stage the portable folder from:
   - `src-tauri/target/release/gatesai-chat.exe`;
   - `src-tauri/binaries/gatesai-bridge-x86_64-pc-windows-msvc.exe` renamed to
     `gatesai-bridge.exe`;
   - `src-tauri/resources/source/` copied to `source/`.
3. Compress the top-level folder with PowerShell `Compress-Archive` to the stable
   asset `GatesAI-Chat-Portable-x64.zip`.
4. Expand the ZIP into a fresh verification directory and assert the marker,
   EXE, sidecar, `source/manifest.json`, and absence of a packaged `data/`.
5. Upload/publish the ZIP beside the NSIS asset. Do not add it to updater
   signatures or `latest.json`.

The staging helper gets unit tests with fixture files, including missing input,
non-empty output refusal, stable internal names, exact marker content, source
snapshot preservation, and no `data/` inclusion.

## Security and failure boundaries

- The portable bridge remains loopback-only. Portable mode does not broaden CSP,
  network exposure, the bridge path jail, command allowlist, protected chat
  paths, or MCP validation.
- Credential commands continue using the `keyring` backend. No plaintext or
  locally invented encryption scheme is introduced.
- Paths passed to the sidecar are separate argv entries, so spaces and shell
  metacharacters are never re-parsed by a shell.
- A bridge workspace mismatch fails closed before any WebSocket request.
- The portable root is derived from `current_exe`, not user-controlled frontend
  input. Frontend-injected expected paths are advisory validation; the Rust
  launcher remains the authority that selects the bridge directory.
- `data/` is never part of a release artifact. CI assertions make accidental
  state publication a build failure.
- No process other than a bridge child owned by this Tauri instance is killed.
  A healthy matching bridge may be reused; a conflicting listener is reported.

## Acceptance criteria

All items are required:

- [ ] A tagged Windows release publishes non-empty
      `GatesAI-Chat-Portable-x64.zip` with the stable internal layout and no
      `data/` directory.
- [ ] First launch from a writable extracted folder creates WebView, app-managed,
      bridge-config, and workspace data only under sibling `data/` (credentials
      excepted to Windows Credential Manager).
- [ ] Relaunch preserves a conversation, preference, RAG/thread IDB data, bridge
      workspace file, and managed source workspace.
- [ ] Moving the fully-closed folder to a different path/drive preserves that
      state; `bridge.json` contains a relative default workspace and does not
      retain the old absolute folder path.
- [ ] Installed and portable instances use ports `7331` and `7332` respectively
      and do not share WebView or bridge workspace state.
- [ ] A second portable folder encountering another folder on `7332` stays
      offline with an actionable conflict message and performs no workspace RPC.
- [ ] Portable update checks do not import/call the updater plugin; installed
      updater behavior remains covered and unchanged.
- [ ] A missing marker uses installed mode; a correct marker uses portable mode;
      a malformed marker or unwritable portable root shows a native error and
      does not fall back to LocalAppData.
- [ ] API keys are absent from the extracted tree and must be re-entered after
      moving to a different Windows account/machine; installed and portable
      copies on one account share the existing OS-keyring entries as documented.
- [ ] `npm run ci`, `npm run test:e2e`, Rust tests, and bridge Go tests pass.
- [ ] README, architecture/tech spec, release checklist, and both changelogs
      describe the shipped behavior accurately.

## Explicitly out of scope

- Linux/macOS portable packages.
- Bundling WebView2, Ollama, ComfyUI, models, MCP binaries, or other external
  runtimes.
- Portable plaintext credentials or a new encryption/key-management design.
- Automatic migration from installed mode, automatic portable self-update, or
  adding the ZIP to `latest.json`.
- A bridge protocol-version bump: the new option is process configuration, not
  an RPC schema change.
- Changes to workspace path-jail/security behavior, the default installed data
  directories, or Web Lite.
