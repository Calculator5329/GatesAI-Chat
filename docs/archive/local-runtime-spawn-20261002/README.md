# Ollama and ComfyUI process manager: 2026-10-02

The 2026-10-02 local-first rework changed how GatesAI treats local runtimes: it detects a running Ollama or ComfyUI server and never starts or stops one. `LocalRuntimeStore` probes addresses through `localFetch`, which on desktop runs the request in Rust (`local_http_request` in `src-tauri/src/local_http.rs`). That left the old process-manager path with no callers.

One piece was a live liability. The Rust command `spawn_runtime` ran a program path supplied by the webview (`installPath`), checked only that the file was named `ollama`/`ollama.exe` or that the folder held `python_embeded/` and `ComfyUI/main.py`, and stayed registered after its last frontend caller was gone. Any script running in the webview could still invoke it.

Commit base for history: `427e568` (v4.8.1). The copies here are the working-tree versions immediately before archiving; they already include the uncommitted local-first changes (for example `probeHttp` and `fetchOllamaTags` on `localFetch`, and the removed `probe_http`/`ollama_tags` Rust commands). `git show 427e568:<path>` gives the pre-rework versions.

## What moved here

Wholly unused, moved with their tests:

- `src/services/local/autoDetect.ts`: guessed Ollama and ComfyUI install paths.
- `src/services/local/platformCopy.ts`: install-path placeholders and the Ollama executable name for the path field.
- `tests/services/local/autoDetect.test.ts`, `tests/services/local/platformCopy.test.ts`.

Still live, trimmed in place, full original kept here:

- `src/services/local/localRuntimeService.ts`. Removed `startRuntime`, `stopRuntime`, `getRuntimeStatus`, `probeHttp`, `pathExists`, `pickDirectory`, `getCandidatePaths` and the `LocalRuntimeStatus`, `RuntimeStartOptions`, `RuntimeStatusSnapshot`, `RuntimeCandidatePaths` types. Kept `fetchOllamaTags` (LocalRuntimeStore) and `pickFile` (LibraryStore).
- `src-tauri/src/local_runtime.rs`. Removed the commands `spawn_runtime`, `stop_runtime`, `runtime_status`, `path_exists`, `pick_directory`, `runtime_candidate_paths`, plus `RuntimeKind`, `LocalRuntimeState`, `RuntimeProcess`, `kill_all`, the Ollama and ComfyUI launch specs, the log pipes and the Windows-only `comfy_spec` test. Kept `pick_file`, which LibraryStore still uses. `lib.rs` no longer registers the removed commands, manages `LocalRuntimeState`, or calls `kill_all` on shutdown.

None of the removed commands appeared in `src-tauri/capabilities/default.json`; there is no `src-tauri/permissions/` folder.

## Not carried over

These files are reference only. Nothing under `docs/` is collected by vitest (`tests/**/*.test.ts`), type-checked (`tsconfig*.json` include `src`, `tests`) or linted (ESLint `files` patterns are rooted at `src/` and `tests/`), so the archived imports are not expected to resolve.
