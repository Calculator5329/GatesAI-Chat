# Changelog

## 2026-07-19 — Depth-over-breadth de-scope pass

Aggressively narrowed the product to what it should do exceedingly well.
Routing now centers on three destinations only: **OpenRouter** (cloud LLM +
image), **Ollama** (local LLM), and **ComfyUI** (local image). Archived
subsystems are recoverable from git history.

- **Deleted** the unused `.gatesdb` database plugins layer (dead code floor).
- **Moved** the OpenRouter model-compatibility suite out of the app into
  `scripts/model-compat/` (to become an auto-runner over a curated model set;
  no longer shipped in the bundle).
- **Archived** the legacy recurring Schedules feature (store, tool,
  `core/schedules`, storage, wiring, tests).
- **Archived** the source workspace + source-build runner (TS stores/services/
  tools + `src-tauri` `source_workspace.rs` / `source_build.rs` and commands).
- **Archived** MCP (managed code providers): store, services, `mcp_stdio.rs`,
  tools, and E2E seed.
- **Archived** the Offline knowledge Library, including `offline_library.rs`,
  its dock panel, tool, and storage. The **Super+G** global shortcut now simply
  summons/toggles the window (a personal OS-level convenience) instead of
  opening a local knowledge chat.
- **Removed** the user-configurable custom OpenAI-compatible endpoint provider:
  its store, dynamic catalog probe, `'openai-compat'` provider id, secret slot,
  and token/usage/model-picker special cases. The shared `OpenAiCompatProvider`
  transport stays — OpenRouter still extends it for OpenAI wire format.
- **Persistence:** added a one-time boot purge of retired localStorage slots
  (`gatesai.mcp.v1`, `gatesai.offlineLibrary.v1`, `gatesai.schedules.v1/v2`);
  the provider-config parser already drops the legacy `openai-compat` config.
  Chat snapshot schema is unchanged, so `CURRENT_CHAT_SCHEMA_VERSION` stays 3.
- CI green (156 files / 1223 tests + typecheck + lint), `cargo test` green
  (25 passed); e2e 25/26 — the one failure is the pre-existing
  `artifactContract` palette→dock iframe test (verified failing identically on
  pre-session baseline `3659518`).

## 2026-07-19 — Settings trim: 7 tabs → 3

- Cut the GatesMenu to three tabs (Settings / Models / Agent) to restore the
  narrow-scope feel; retired Usage, Local, Workspace, and Gallery sections
  (legacy `#/menu/*` hashes redirect: local→models, usage/workspace/gallery→settings).
- Settings now holds only Theme, Conversations, Desktop (summon/tray),
  Export & import, and a 3-action danger zone (threads, memories, provider keys).
- Models = OpenRouter provider card + a minimal Ollama card (status, base URL,
  refresh). Removed compat test suite, Brave Search, and cloud-image cards from
  the menu (stores/services untouched — features still work, only config UI cut).
- Agent = Instructions + Memory. Removed semantic memory, schedules, MCP,
  skills, recent conversations, and capabilities blocks from the menu UI.
- Deleted orphaned `McpSettings.tsx` / `OllamaPullStatus.tsx`; moved pure
  `statusCopy` helpers from services/chat to core to fix the pre-existing
  UI→services lint violations.
- All persisted state (`gatesai.*` slots) is preserved; re-adding a trimmed
  section later is a registry + component restore from git history.
- CI green (183 files / 1384 tests + typecheck + lint); e2e 25/26 — the one
  failure is the artifactContract palette→dock iframe test already filed as
  pre-existing on master (verified failing identically on stashed HEAD).

## 2026-07-18 — Unblock plan lane handoffs

- Recorded four unblock-plan lanes in the roadmap and queued implementation
  dispatches: `w-1-right-dock-panel-framework`,
  `extend-inspect-file-to-source-code`,
  `extend-inspect-file-to-document-formats`, and
  `canvas-whiteboard-artifact` (all dated 2026-07-18). See:
  - `docs/plans/unblock-w-1-right-dock-panel-framework-dockstore-20260718/`
  - `docs/plans/unblock-extend-inspect-file-to-source-code-struc-20260718/`
  - `docs/plans/unblock-extend-inspect-file-to-document-formats--20260718/`
  - `docs/plans/unblock-canvas-whiteboard-artifact-type-for-plan-20260718/`

## 2026-07-18 — Wave-D harvest close-out (session:fable-visions-loop-20260718)

- Landed w1-gatesai-sidebar-dates (last unlanded Wave-D lane): 20-row sidebar
  history cap via `groupThreadsByDate(..., limit)`; merged-branch tests
  reconciled to master's Previous-7/30-day bucketing (LF-5 semantics kept).
  Other 9 Wave-D lanes verified semantically present on master (per-lane
  file:line proofs in .orc run codex-harvest-stack-wave-d-v2 final message).
- Merged release/v4.7.0 back into master (version bump + changelog).
- CI 184/184 files / 1388 tests + tsc green. Known pre-existing e2e failure
  (artifactContract palette→dock iframe, fails identically on pre-merge
  master) filed in roadmap.

## 2026-07-18 — v4.7.0

- Release rollup since v4.6.1: local-first first-boot (LF-4), plugins
  bounds/typecheck fix, Windows build-script spawn fix, artifact preview
  iframe titled by display label (e2e green again). First release verified
  by the Geordi Windows worker before tagging (full CI + native Tauri
  build).

## 2026-07-18 — Typecheck fix (plugins bounds literals)

- `tsc -b` was red on master: `as const` bounds made `str()`'s default `max`
  and policy's `candidates` array infer literal types (`128`/`50`), rejecting
  every explicit override. Annotated both as `number`. First verified green on
  both Linux and the new Geordi Windows worker (1388 tests pass there).

## 2026-07-16 — Local-first first-boot (LF-4)

- The first-boot hero now leads with the local path: detected Ollama models
  default the composer on untouched chats, the Local card precedes Cloud, and
  offline states link Local settings instead of nagging for cloud keys.
  Providers never switch silently; explicit choices stay put.

## 2026-07-16 — Linux compatibility pair (A13)

- NVIDIA + Wayland white-screen fixed in the app itself: Linux-only NVIDIA
  detection (no shelling out) sets `WEBKIT_DISABLE_DMABUF_RENDERER=1` before
  the first webview unless the user already set a value (including `0`).
  Six Rust unit tests; cargo suite 45/45.
- Web Lite `/#/menu/local` no longer throws: the Local panel is gated on a
  semantic desktop-capability check and renders a desktop-only explainer;
  screens-tour asserts the explainer and zero console errors.

## 2026-07-15 — W-1 basic dock file explorer

- Added a compact, read-only File Explorer panel to the existing dock registry.
  It navigates one jailed workspace directory at a time, sorts folders first,
  provides breadcrumbs/back/refresh, surfaces truncation and bridge errors,
  and opens selected files through the existing file/media viewer in the other
  dock cell.
- Added the desktop-only "Browse workspace in dock" palette entry and persisted
  panel-kind support. Existing Web Lite and mobile dock gates remain unchanged.
  No write, terminal, network, dependency, bridge protocol, or filesystem
  authority was added.

## 2026-07-14 — v4.6.1: bridge v2 sidecar release

- Release bundling the protocol-v2 bridge sidecar so the shipped app matches
  its own bundled bridge (v4.6.0 pinned protocol 2 but shipped the v1
  sidecar). No app-code changes beyond the version bump; bridge v2 was merged
  and verified on master 2026-07-13.
- Cross-platform release build validated green (linux/windows/macos) on
  workflow run 29303417151 before tagging.

## 2026-07-13 — LF-6: Settings leads with local/appearance, not the cloud key

- `SettingsSection` (`src/components/menu/sections/Settings.tsx`) now renders
  the local/appearance blocks (Theme, Conversation, Desktop, OfflineLibrary)
  ABOVE the OpenRouter API-key credential card — a local-first surface should
  lead with local settings, not cloud credentials. Order-only, no behavior
  change.
- Added a DOM-position regression test asserting the theme block precedes the
  API-key card (`compareDocumentPosition`). SettingsSection 5/5 green.

## 2026-07-13 — LF-5: no more "December 1969" sidebar date bucket

- `groupThreadsByDate` (`src/core/threadSelectors.ts`) now resolves a sane
  timestamp per thread: prefer `updatedAt`, fall back to `createdAt`, and park
  a thread with no sane timestamp at all in a shared "Older" bucket at the
  bottom of the list — never dropping it (EditorialSidebar renders every
  thread) and never minting a spurious pre-2000/epoch-0 month label.
- Regression tests cover `updatedAt` of 0, negative, NaN, and absent, asserting
  the thread stays present and no pre-app date label appears. threadSelectors
  (19) + EditorialSidebar (7) green.

## 2026-07-12 — Super+G Offline Knowledge

- Added a fixed desktop `Super+G` shortcut, independent from the configurable
  summon chord, with its own registration status in Settings.
- The chord opens a fresh `Offline knowledge` conversation on a connected,
  installed tool-capable Ollama model and injects a strict local-library,
  citation-first, public-schema-only context.
- Disabled/unhealthy library state routes to Settings; a missing/offline local
  runtime routes to Local. Neither path creates a thread or silently selects a
  remote provider.

## 2026-07-12 — Offline Library cross-repository acceptance (G6)

- Completed the pinned plugin 1.3.0 acceptance matrix across host contract
  tests, GatesAI CI/E2E/Rust gates, and the actual trusted desktop request path.
- Added durable ignored live tests for citation-scheme/path preservation and
  typed offline degradation. Both passed in the controlled smoke, and the
  loopback service was restored afterward.
- The live smoke exposed and drove a host fix for one legacy absolute-path
  citation; local-ai-lab `083fef6` now emits opaque `library://` identities.
  The verified record is in `docs/acceptance/offline-library-2026-07-12.md`.

## 2026-07-12 — Offline Library benchmark explorer (G5)

- Added a compact, bridge-independent right-dock panel for the sanitized
  Knowledge Arena summary, opened from the existing Offline Library Settings
  block rather than duplicating the full host dashboard.
- The panel filters model × retrieval-setup cells and shows restrained score
  bars, sample counts, 95% confidence intervals, source/term/citation
  components, and separate retrieval/generation latency.
- Lifecycle refresh now also caches public/offline source inventory and
  benchmark summaries. Optional detail failure is visible without disabling
  otherwise healthy search/tools; raw answers, evidence passages, private
  database metadata, and factual-hallucination claims remain excluded.

## 2026-07-12 — Offline Library task-aware profiles (G4)

- Loaded the host's versioned, local-only routing profiles alongside lifecycle
  discovery and kept its public-schema, document-quality, and balanced
  recommendations distinct rather than naming one universal winner.
- Added a compact Settings selector with persistent explicit override plus
  visible model, retrieval, trials, 95% confidence interval, citation-grounding
  proxy, generation latency, and limitation evidence.
- Users can explicitly apply an installed recommended Ollama model to the
  active chat; unavailable tags remain disabled. Cited document search follows
  the effective local retrieval profile, with no automatic remote fallback.

## 2026-07-12 — Offline Library read-only tools (G3)

- Added four bounded, read-only model tools for cited library search, source
  inventory, public database schemas, and Knowledge Arena benchmark/profile
  summaries. They are registered only while the explicitly enabled addon is
  compatible and healthy, and fail closed without remote fallback.
- Search projection keeps exact evidence citations but omits full content and
  local URLs; schema projection exposes no rows; benchmark projection omits raw
  answers and labels citation/support metrics as trust proxies rather than a
  factual hallucination rate.
- Preserved exact `kiwix://`, `library://`, `man:`, and `db://` links through
  tool results, rendered Markdown, exported/imported chats, and persisted
  snapshots while retaining the existing unsafe-URL sanitizer.

## 2026-07-12 — Offline Library lifecycle and settings (G2)

- Added a default-disabled, explicitly enabled Offline Library lifecycle with
  a minimal versioned local preference containing only the enable flag—no
  secret, configurable host, cloud dependency, or background remote fallback.
- Compatible manifest and health discovery now surface distinct checking,
  healthy, offline, incompatible, and error states plus the host-declared
  read permissions. Disabling invalidates in-flight discovery immediately.
- Added a compact Settings block for enablement, status, permissions, and a
  manual health check. Web Lite shows a desktop-only explanation, disables the
  switch, and never invokes the local transport.

## 2026-07-12 — Offline Library trusted client (G1)

- Added dedicated `offline_library_read` and `offline_library_search` Tauri
  commands. Rust owns the exact loopback base URL and fixed operation map;
  browser input cannot supply a URL, route, method, header, SQL, or path.
- Enforced public-alias and search bounds, no redirects, JSON-only responses,
  finite timeouts, a strict 1,000,000-byte response ceiling, and typed
  unavailable/timeout/HTTP/contract errors.
- Added the typed frontend client for status, sources, evaluations, profiles,
  Knowledge Arena summaries, public database catalog/schemas, and cited search.
  Web Lite returns a desktop-only state without attempting any transport, and
  citation strings are passed through unchanged.
- The required full Rust gate exposed and now closes an existing source-jail
  portability hole: Windows drive, backslash/UNC, and leading-slash absolute
  paths are rejected consistently even when GatesAI runs on Unix.

## 2026-07-12 — Offline Library consumer boundary (G0)

- Accepted a dedicated, fixed-authority Tauri proxy design for the optional
  Offline Library addon. It is loopback-only, read-only, redirect-free,
  response-bounded, unavailable in Web Lite, and cannot accept arbitrary URLs,
  paths, methods, SQL, or database mutations.
- Pinned sanitized `local.offline-library` 1.3 manifest, task-aware profile,
  and repeated Knowledge Arena fixtures with contract tests for transport,
  version, evidence, and publication-safety invariants.
- Runtime commands, settings, tools, and UI remain ordered follow-up work in
  G1–G6; this checkpoint intentionally adds no active connection.
- Repaired the existing scroll-follow E2E gate by using a real second wheel
  interaction instead of a synthetic `scrollTop` write that could be consumed
  by programmatic-pin bookkeeping; the user-behavior assertions are unchanged.

## 2026-07-12 — build: NO_STRIP wrapper for Linux AppImage packaging

- `npm run tauri:build` now goes through `scripts/tauri-build.mjs`, which sets
  `NO_STRIP=1` on Linux (only when unset): linuxdeploy's bundled strip cannot
  parse `.relr.dyn` sections from newer toolchains (CachyOS) and killed
  AppImage packaging. Other platforms and explicit `NO_STRIP` values are
  untouched.

## 2026-07-12 — Release v4.6.0

First self-updating release. Rollup of the entries below: signed auto-updater
(W-5) with sidebar update pill and `latest.json` on the public releases repo,
right dock panel framework slices 1+2 (W-1), F11 fullscreen toggle (W-4),
ComfyUI failure diagnosis + persistent error trail, scroll-follow and
code-block stability fixes, default model → Nemotron 3 Ultra free, e2e
foreign-server port guard. Versions bumped in `package.json` +
`tauri.conf.json`; what's-new panel entry added.

## 2026-07-12 — W-1 slice 1+2: right dock panel framework

- New right dock column (desktop only): `DockStore` (one column × 1–2 cells,
  split/width ratios, collapse rail, persisted to `gatesai.dock.v1` with
  corrupt-snapshot fallback), `components/dock/` shell + panel registry, and
  the first two read-only panels — `FileViewerPanel` (markdown via the
  existing markdown renderer, JSON per-key `<details>`, HTML in the same
  sandboxed iframe policy as `HtmlArtifactPreview`, plain text) and
  `MediaViewerPanel` (workspace images via the shared image machinery,
  video/audio via native elements). File reads go through a new
  `BridgeStore.readWorkspaceTextFile` facade.
- Entry points: command palette "Open file in dock…" (workspace-path prompt)
  and an "Open in dock" button on gallery tiles. Hidden on Web Lite and the
  mobile shell (`DockStore.available` + `ui.mobileShell`).
- Tests: DockStore unit suite, dockStorage round-trip/corrupt cases, panel
  registry lookups, FileViewerPanel content-type dispatch with a mocked
  bridge, and a desktop e2e (`tests/e2e/dock.spec.ts`) that opens a markdown
  file in the dock via the palette (open → render → collapse → reopen →
  close).
- Fixed pre-existing red e2e (all three `polish.spec.ts` failures from the
  UI/UX polish lane): (1) real bug — `EditorialChat`'s unmount cleanup
  cancelled the pending scroll rAF without resetting the guard ref, so
  StrictMode's dev double-mount permanently disabled scroll-follow;
  (2) real bug — unstable renderer identities (`bind(ui)` prop + inline
  `components` map in `MarkdownChunk`) remounted code blocks on message
  re-renders, wiping copy/preview state (now a bound store action + memoized
  components map); (3) test bugs — the copy assertion's `hasText: 'Copy'`
  locator stops matching once the label flips to "Copied", the wheel test
  aimed at the off-screen `.editorial-stream` box, and the paused-scroll
  assertion now checks distance-from-bottom instead of a scrollTop that
  windowing legitimately adjusts. Also stubbed `updates` into two
  component-test store builders that broke when W-5's `UpdatePill` landed in
  the sidebar.
- Slice 3 (CodeMirror editor, file explorer, terminal panel) intentionally
  not in this lane; W-1 stays open on the roadmap.

## 2026-07-12 — e2e: foreign-server guard on the dev-server ports

- `globalSetup` now verifies that whatever answers on the e2e ports is
  actually GatesAI Chat (`<title>` marker) before reusing it, and fails fast
  with a clear message otherwise — previously an unrelated dev server
  squatting the port (concurrent agent sessions) made 19 specs fail with
  cryptic element-not-found errors against the wrong app. Ports moved to a
  shared `tests/e2e/ports.ts`, overridable via `GATESAI_E2E_DESKTOP_PORT` /
  `GATESAI_E2E_WEB_LITE_PORT`.

## 2026-07-12 — Deterministic UI review screenshots

- Added `npm run screenshots`, a headless Playwright pipeline that captures
  seven fixed 1440×900 app states under `screenshots/<git-short-sha>/` with
  mocked providers, local persistence fixtures, reduced motion, and no live
  model calls. Each run emits a versioned `manifest.json` and asserts that
  every declared PNG was produced.

## 2026-07-12 — W-5: Auto-updater (signed, via the public releases repo)

- Desktop builds now self-update: `tauri-plugin-updater` + `tauri-plugin-process`
  registered (Rust + capabilities), updater artifacts signed in CI
  (`TAURI_SIGNING_PRIVATE_KEY` secret; pubkey pinned in `tauri.conf.json`),
  and a new `updater-manifest` release job assembles `latest.json` (tag-pinned
  URLs + signatures) and publishes it to `GatesAI-Chat-releases`. Installed
  apps poll `releases/latest/download/latest.json` on launch and every 6h.
- New `UpdateStore` (+ `services/updates/appUpdater.ts`, Web Lite no-op) and a
  sidebar `UpdatePill`: "vX available — update" → background download with
  progress → "restart to finish updating"; dismissible; failures land in the
  error trail and offer retry. 6 store tests; release checklist gains signing
  guardrails and an auto-update smoke test.

## 2026-07-12 — W-4: Fullscreen toggle (F11 + palette)

- New `services/window/fullscreen.ts`: F11 (no modifier, works from any
  focus) toggles true OS fullscreen on desktop via the Tauri window API
  (`core:window:allow-set/is-fullscreen` capabilities added); Web Lite
  falls back to the browser Fullscreen API. Never throws — failures log
  to the `window` scope.
- Command palette gains "Toggle fullscreen" (routed through a new
  `UiStore.toggleFullscreen()` facade to respect layer rules). Dispatcher
  + service tests added.

## 2026-07-12 — ComfyUI "Load failed" root-caused + persistent error trail

- Root cause: a ComfyUI started by `local-ai-lab`'s launcher (without
  `--enable-cors-header`) 403s the Tauri webview's cross-origin `/prompt`
  POST, which WebKit surfaces as an opaque "Load failed". Our own bundled
  launcher already passed the flag; the reused external server didn't.
  Fixed in `local-ai-lab` (launcher now defaults `--enable-cors-header *`,
  loopback-only listen unchanged) and the running server was restarted.
- `comfyClient` now wraps `/prompt` network failures with the base URL and
  the two likely causes (server down / CORS-less server) instead of the
  bare webview one-liner; aborts still report as `cancelled`. Tests added.
- Error data collection: `logger` warn/error entries are now additionally
  appended to a dedicated daily `/workspace/logs/errors-YYYY-MM-DD.jsonl`
  (alongside the existing app log), and image-job dispatch failures attach
  a structured payload (job id, backend, mode, dims, seed, thread, prompt
  preview) so recurring failures are diagnosable after the fact. New
  `tests/services/diagnostics/logger.test.ts`; `npm run ci` green.

## 2026-07-12 — Chat interaction and artifact polish

- Replaced the composer's square textarea focus outline with an accessible,
  rounded accent ring on the composer shell, and changed sidebar-brand hover
  feedback from a full-row wash to a quiet wordmark/dot response.
- Hardened streaming scroll-follow: upward wheel intent over the message
  column pauses following immediately, returning to the bottom or using the
  floating latest-response button re-arms it, and nested content can no longer
  leak horizontal overflow onto the page.
- Refined fenced code blocks with tolerant language labels, stable monospace
  rendering, contained horizontal scrolling, wrap/source controls, animated
  copy confirmation, and safe handling of incomplete streaming fences.
- Complete fenced HTML documents now offer a sandboxed inline preview with
  source/preview, open-in-new-tab, and download actions. The iframe never gets
  same-origin access and preview remains unavailable until the fence and HTML
  document are complete.
- Added unit and Playwright coverage for focus appearance, follow pause/re-arm,
  code copy feedback, and HTML preview toggling.

## 2026-07-12 — Default chat model → Nemotron 3 Ultra free (OpenRouter)

- `DEFAULT_MODEL_ID` is now `or-nemotron-3-ultra-free`
  (`nvidia/nemotron-3-ultra-550b-a55b:free`), so fresh installs and unresolved
  legacy thread models land on the free OpenRouter route instead of Gemini 3
  Flash. Keyless-with-Ollama still prefers the best local model; the composer
  banner still prompts for an OpenRouter key otherwise.
- Updated picker tags (`modelPicker.ts`), catalog descriptions, and the unit
  tests that pinned the old default. No provider or persistence changes —
  the key still lives in Menu → Models → OpenRouter (keychain on desktop,
  browser storage in Web Lite).

## 2026-07-10 — Flaky-test sweep: clean bill of health

- Ran the unit suite 5× (995 tests) and the Playwright e2e suite 3× (20
  tests) consecutively on Linux; every run exited green. No flaky tests
  found, nothing quarantined. Roadmap item closed with the report inline.

## 2026-07-10 — Repository hygiene and release checklist

- Retired the tracked Firebase-mode environment file after verifying its full
  history contained only the public Web Lite flag. Web Lite now uses an
  explicit Vite build mode; the legacy filename is ignored and documented by
  a safe example file.
- Made root scratch-log and agent-task ignore patterns explicit and confirmed
  no tracked or orphaned root scratch files needed removal.
- Added `docs/release-checklist.md` with the version, changelog, tag, workflow,
  Web Lite, and stable release-asset verification steps.

## 2026-07-10 — Roadmap/TODO truth pass

- Checked off **Wave D refactor** in `docs/roadmap.md` (TurnRunner, streamCore,
  `useEditorial`, message windowing, ModelPopover memo).
- Checked off verified `docs/todo.md` items: IndexedDB archive tier, Tauri
  bridge auto-launch, superseded Appearance controls, sidebar soft-delete.
- Left open: open-source readiness (Now), README RAG bullet + test-count drift
  (badge 995+20 vs `vitest list` 641 / Playwright 19), CONTRIBUTING, bridge
  version-mismatch UX, inline thread rename.

## 2026-06-10 — Pin default chat to Gemini 3 Flash (not latest alias)

- `or-gemini-3-flash` (and the Auto picker row) now route to the pinned
  OpenRouter slug `google/gemini-3-flash` instead of `~google/gemini-flash-latest`,
  so new threads stay on Gemini 3 Flash rather than whatever Google marks "latest".

## 2026-06-10 — Remove sidebar thread search

- Removed the "Search threads" input from `EditorialSidebar`; the "Begin a new
  conversation" button (and mobile new-chat control) remain. History still shows
  pinned threads plus the first 20 unpinned rows.
- Dropped search-specific CSS in `editorial.css` / `responsive.css`; updated
  sidebar unit test and removed the desktop e2e search spec.

## 2026-06-09 — Test hardening: BridgeClient unit tests, two-tab e2e, deterministic waits

- **`tests/services/bridge/client.test.ts` (new, 13 tests):** full coverage of
  the previously untested `BridgeClient` WebSocket protocol via an injected
  `FakeWebSocket` (vi.stubGlobal): connect resolve/error/3s-timeout +
  idempotency, offline throw, out-of-order id correlation, event routing to
  the right `onEvent` without settling, `BridgeError` message/op/code,
  30s `bridge_timeout` + pending-entry cleanup, close-mid-request rejecting
  all pending, the new `options.privileged` envelope flag (present only when
  requested), and malformed-frame tolerance.
- **`tests/e2e/multiTab.spec.ts` (new, 2 tests):** two pages in one browser
  context exercise the real cross-tab `storage` event — tab B's chat write
  raises the "Another browser tab updated chat history" banner in tab A;
  Reload adopts B's snapshot; Dismiss clears the banner and resumes autosave
  (verified by A's next write raising the banner in B).
- **Replaced timing-based waits with state-based ones (tests only):**
  the 260ms autosave-throttle sleeps in EditorialChat/EditorialSidebar/perf
  teardowns now call `chat.dispose()` (drains the throttle synchronously);
  ChatStore late-finalize tests gate the abandoned stream on a test-controlled
  promise instead of `setTimeout(20)` + `flush(30)`; ImageJobStore/ImageJobCard
  and the composer paste test poll with `vi.waitFor`; `desktop.spec.ts` drops
  three `waitForTimeout(150)` calls (auto-retrying assertions cover the search
  debounce; sidebar clicks blur-flush the draft). Intentional fixture delays
  are commented as such.
- Verified: typecheck green; e2e 21/21 (multiTab/desktop also 3x repeat-each);
  unit 715 passing — the only failures are 3-4 model-picker tests in
  `EditorialComposer.test.ts` that fail identically on the unmodified baseline
  (concurrent ModelPopover work in flight; fixed in the same session — the
  picker tests now await the lazy popover mount).

## 2026-06-09 — Repo-improvement plan: CI gate, strict TS, ChatStore decomposition, bridge security, picker/persistence extraction

Remaining items from the repo-wide improvement plan (the test-hardening,
CSS/mobile, and requireBridge/UI-bridge entries nearby were the same session's
parallel tracks).

- **CI workflow (new `.github/workflows/ci.yml`):** unit tests + typecheck +
  lint on push to `master` and on PRs, plus a Playwright e2e job with report
  artifact upload. Releases/deploys are no longer ungated.
- **Repo hygiene:** `.firebase/` and `.playwright-mcp/` gitignored; the
  tracked Firebase hosting cache untracked.
- **TypeScript strict mode enabled** in `tsconfig.app.json` and
  `tsconfig.node.json` (test config inherits). No suppressions needed.
- **Web Lite clear-data inventory completed:** `gatesai.menuHintSeen.v1` and
  `gatesai.search.v1` (credential) added to the slot inventory; dynamic
  `*.corrupt-<ts>` quarantine keys are now scanned and cleared too.
- **ChatStore decomposed (2,429 → ~1,660 lines):** pure selectors moved to
  `core/threadSelectors`; context-mode prompt/tool shaping to
  `services/chat/contextModes`; Ollama pseudo-tool rescue to
  `services/chat/pseudoToolRescue`; turn/error display text to
  `services/chat/turnFormatting` + `imageTurnFormatting`; activity projection
  to `services/chat/activityProjection`; the tool-call batch loop to
  `services/chat/toolBatchExecutor`; and the three persistence paths
  (throttled local autosave, unload flush, multi-tab pause, serialized
  workspace save queue) behind `stores/chatPersistenceCoordinator`.
- **Bridge-level protected-path enforcement (gatesai-bridge repo):** protocol
  envelopes carry `privileged`; unprivileged fs ops on `.gatesai/chat` /
  `chat-history` are denied and hidden from list/search; unprivileged exec
  refuses commands/cwd referencing those subtrees. App-side
  `workspaceChatPersistence` wraps its bridge client so all of its requests
  are privileged. Go tests cover denial + hiding.
- **Persistence/library split:** the ~1,000-line readable chat-history
  renderer moved out of `workspaceChatPersistence` into
  `services/chat/libraryExport` (persistence owns policy, export owns
  presentation; export remains best-effort).
- **ModelPopover slimmed + lazy:** all section/filter/badge/copy logic moved
  to `core/modelPicker` (pure, unit-testable); the popover is now
  `React.lazy`-loaded from the composer; Vite `manualChunks` (function form —
  rolldown-vite) splits the markdown/KaTeX/highlight stack (~597 kB) out of
  the eager main chunk.
- Verified: typecheck, lint, production build, unit suite green (composer
  picker tests updated to await the lazy popover mount).

## 2026-06-09 — CSS consolidation + mobile-shell breakpoint unification

- **Split `src/index.css` (~3,000 lines) into layered files** under
  `src/styles/`: `base.css` (keyframes, resets, utilities), `editorial.css`
  (chat/sidebar/composer), `markdown.css` (md body, code, KaTeX, artifacts),
  `menu.css` (menu/settings chrome), `responsive.css` (all `@media` blocks).
  `index.css` is now an `@import` manifest only; import order preserves the
  original cascade (responsive last).
- **Merged duplicate media blocks:** the two `@media (max-width: 480px)`
  blocks are one block; the two mobile-shell blocks
  (`max-width: 640px / 960px×480px`) are one block, with the earlier
  `.runtime-web-lite` variable rule (topbar 50px, drawer 82vw, reserve 162px,
  gutter 18px) deleted — the later `:is(.runtime-web-lite, .runtime-desktop)`
  values (48px / 84vw / 118px / 16px) already won the cascade, so behavior is
  unchanged.
- **Removed brittle `[style*=...]` selectors:** composer meta separator now
  carries `composer-meta__sep`, the Settings kicker carries
  `settings-page__kicker`; the four attribute selectors target those classes.
- **Unified the mobile-shell breakpoint:** new `src/core/breakpoints.ts`
  exports `MOBILE_SHELL_QUERY`; `UiStore.mobileShell` observes it via a single
  matchMedia subscription (guarded for jsdom); `EditorialSidebar` reads
  `ui.mobileShell` instead of its own matchMedia effect. Sync comments link
  the constant and the `responsive.css` block.
- Verified: typecheck, lint (only the pre-existing ModelPopover useMemo
  warning), 706/706 unit tests, production build.

## 2026-06-09 — requireBridge tool middleware + bridge calls out of UI

Refactor-plan tasks A/B. Full suite green (typecheck, lint, 706 unit).

- **`services/tools/requireBridge.ts` (new):** shared bridge guard middleware —
  `requireBridge(ctx, messages?)` (discriminated `{ ok: true, bridge } |
  { ok: false, error }`), `requireBridgeOutcome(ctx)` for `ToolOutcome`-shaped
  tools, and `bridgeErrorMessage` / `describeBridgeError` for catch blocks.
  Refactored fs, git, terminal, sqlite_query, python_inline, inspect_file,
  artifact, image_generate, and describe_image to use it; all guard/error
  strings preserved byte-for-byte (per-tool wording via the `messages` param).
- **Bridge orchestration moved out of UI components (facade rule):**
  - `BridgeStore.resetWorkspaceDirectory(path, children)` — Settings danger
    zone no longer issues raw `fs.delete`/`fs.mkdir` requests.
  - `BridgeStore.listWorkspaceDir(path, recursive)` — Workspace section file
    explorer goes through the store.
  - `services/bridge/artifactPreview.ts` (new) — the HTML artifact
    stat/read/asset-inlining preview pipeline (plus its LRU cache and inflight
    dedupe) extracted from `HtmlArtifactPreview.tsx`; exposed via
    `BridgeStore.loadHtmlArtifactPreview` / `peekHtmlArtifactPreview`.
    `isHtmlWorkspacePath` moved to `core/workspacePaths` (re-exported from the
    component for existing importers). Cache test hooks now live in
    `__artifactPreviewTestApi` on the service.

## 2026-06-07 — Polish pass: sub-agent double-check + correctness hardening

Ran three parallel audit sub-agents (dead-code, architecture, correctness) and
acted on the verified findings. Full suite green (typecheck, lint, 688 unit, e2e).

- **Auto-naming hardening (`ChatStore` / `threadNamer`):**
  - `maybeAutoName` now skips threads that are already naming (no parallel
    namers / title flicker) or soft-deleted, and the async callback re-checks
    `deletedAt` so a returning namer can't revive a deleted thread's title.
  - `generateThreadTitle` now has a per-attempt 15s timeout that aborts the
    stream, so a stalled provider can no longer leave a thread stuck in the
    "naming…" state forever.
- **`reloadFromStorage` aborts in-flight streams:** extracted `abortAllStreams`
  (shared with `clearAllThreads`) and call it before replacing the thread list
  on a cross-tab reload, so an abandoned `runTurn` can't keep mutating/re-saving
  the freshly-loaded state.
- **Path protection is now case-insensitive:** `isProtectedChatHistoryScope`
  lower-cases the comparison, matching the command-text scanner — `Chat-History`
  / `.GatesAI/chat` are blocked on case-insensitive (Windows/macOS) filesystems.
- **Dead code / consistency:** removed the unreachable `'offline'` model-picker
  badge branches and the now-unused `ollamaOnline`/`comfyReady` props (offline
  models are filtered by `isModelAvailable`); collapsed the redundant
  `isProtectedChatHistoryPath` alias and a `!X && !X` predicate; corrected
  inaccurate copy-pasted file headers across the editorial folder; removed a
  stray `playwright-out.txt` from the repo root.
- **Tests (+5):** case-insensitive + `..`-traversal path protection, namer
  timeout, `reloadFromStorage` stream abort, and the soft-delete naming guard.
- **Verified false positives (no change):** the `sqlite_query` `ATTACH` "bypass"
  is already blocked by the single-statement / leading-keyword `validateSql`
  guard; the model-picker `auto`-source branches flagged as dead are reachable
  when `recommended` is empty.

## 2026-06-07 — Audit hardening: critical/high fixes + production polish

Verified all comprehensive-audit findings with sub-agents, then fixed the
confirmed issues. Full suite green (typecheck, lint, 683 unit, e2e).

- **Persistence / chat (critical):**
  - Restored LLM auto-naming, which a premature `ownsStreamingTurn` guard in
    `maybeAutoName` had silently disabled (the streaming state was already cleared
    by the time it ran, so the check always failed). Naming ownership is now
    verified by callers *before* finalize; `maybeAutoName` re-checks only the
    `autoNamed` lock to avoid clobbering a manual/tool rename mid-flight (C4).
  - `persistence.ts` now surfaces a user notice when even emergency compaction
    fails, instead of losing the session silently (S1).
  - Added `cancelPendingDeferredSnapshot`, invoked from the multi-tab write
    handler, so a save queued just before the cross-tab pause can't clobber the
    other tab's write (C1).
  - `reloadFromStorage` now adopts an empty conversation (rather than re-saving
    stale threads) when another tab cleared storage, and drops per-thread errors.
- **Image jobs (critical):** confirmed the C2 runner-lock fix — `cancel()` no
  longer drives `runNext()`, and the runner's `finally` only clears the
  controller it owns, so the next job stays cancellable. Gallery supports
  single-image deletion (`removeImage`) and shows an explicit "image file
  missing" tile.
- **Image UX (I1):** assistant prose is always rendered alongside an image job
  card — direct image turns no longer collapse to a bare gray chip.
- **Security (C3):** chat-history protection now covers the readable
  `/workspace/chat-history` mirror (case-insensitive, relative-path aware),
  canonicalizes `..` segments to block traversal, filters protected entries from
  every `fs.list` (not just recursive), and is enforced across `terminal`,
  `python_inline`, `sqlite_query`, `git`, `describe_image`, and `image_generate`
  (`prompt_file`).
- **Provider UX (P1):** offline Ollama shows a "start Ollama" banner instead of
  "add an API key"; unusable models are filtered from the picker entirely.
- **Accessibility:** attachment-remove is a real `<button>` with an `aria-label`,
  the context meter has `role="img"`/`aria-label`, banner actions are
  `type="button"`, and the model picker is a proper `listbox`/`option` tree.
- **Deslop:** removed the now-dead `disabledReasonForModel` and its call sites
  (model availability is handled entirely by `isModelAvailable`).

## 2026-06-07 — Audit test gap fill (B–E coverage)

- **Tests (+13 Vitest):** closed all section-9 gaps except two documented
  partials — soft-delete streaming interrupt; first-run checklist; Ollama offline
  banner; model picker + menu a11y; persistence/conflict composer banners;
  `ActivityRow` image-job layout; cancelled partial + missing-file `ImageJobCard`
  renders; notes title/body truncation; Web Lite credential-preserving clear.
- **Docs:** refreshed `docs/audits/2026-06-07-test-coverage-matrix.md` (20
  covered / 2 partial / 0 gap). README test badge → 683 unit.
- **Comments:** `lastErrorByThread` JSDoc on `ChatStore`.

## 2026-06-07 — Audit documentation: coverage matrix + implementation guide

- Added `docs/audits/2026-06-07-test-coverage-matrix.md` (Batch A–E items →
  implementation files, test names, covered/partial/gap status).
- Added `docs/audits/2026-06-07-implementation-guide.md` (what/why per item,
  invariants, test locations, remaining bridge/multi-tab gaps).
- Linked both from comprehensive audit section 9; marked audit follow-ups
  complete in `docs/roadmap.md`.

## 2026-06-07 — Diagnostics pass: logging coverage, inline docs, architecture notes

- **Logging:** expanded ring-buffer coverage across batches A–E — multi-tab
  pause/reload/dismiss, compaction notice, protected chat-history denials
  (`security`), dropped threads on load, bridge connect/offline, catalog/runtime
  failures, attachments/search/tools/LLM stream errors, model-picker and Web Lite
  storage failures, workspace chat malformed snapshots.
- **Code comments:** JSDoc and module headers for `ownsStreamingTurn`, protected
  paths, multi-tab pause semantics, summary scheduler guards, image batch
  `notifyOnTerminal`, partial image cards, composer banner stack, notes quarantine.
- **Docs:** `architecture.md` scope table, multi-tab/compaction/per-thread state;
  `tech_spec.md` persistence durability matrix and logging scopes.

## 2026-06-07 — Audit batches C–E: clarity, image UX, storage durability

- **Batch C — User clarity:** context-aware composer banners (Models key, Ollama
  offline, Comfy offline); persistence conflict + compaction notices; first-run
  setup checklist in chat empty state; model picker as accessible button; Menu
  affordance; OpenRouter copy unified to “Models”.
- **Batch D — Image polish:** image job cards render outside collapsed activity
  rows; partial results on failed/cancelled cards; missing-file failed state;
  `prompt_file` batch returns `{ content, artifacts[] }` with terminal notify on
  last job.
- **Batch E — Storage:** notes quarantine + body/title size limits; Web Lite
  clear-data reloads after credential-preserving wipe.
- **Tests:** updated `ImageJobStore` cancel-chain and `imageGenerate` batch
  expectations; Playwright banner/menu e2e. Vitest + Playwright green.

## 2026-06-07 — Hardening continuation: background streams, reload, e2e

- **Bridge activity on background streams:** `recordActivityEvent` targets the
  streaming thread when the sidebar-active thread differs.
- **`reloadFromStorage()`:** multi-tab conflict banner reloads from disk without
  a full page refresh.
- **Image cancel runner lock test** updated for async `runNext` after abort settle.
- **Playwright:** per-thread draft e2e rewritten; per-thread error banner e2e added;
  menu/gallery specs hardened with explicit waits. **19** e2e / **670** Vitest.

## 2026-06-07 — Batch B hardening: per-thread state, multi-tab pause, notes quarantine

- **Per-thread composer draft + attachments:** `UiStore.bindDraftThread` (wired from
  `RootStore` on `activeThreadId` changes) isolates draft text and staged files per
  thread instead of leaking across sidebar switches.
- **Per-thread error banners:** `lastErrorByThread` + computed `lastError` so a
  provider error on thread A does not show while viewing thread B.
- **Multi-tab protection (C1 partial):** external `storage` writes to
  `gatesai.state.v1` set `persistenceConflict`, pause autosave, and show a composer
  banner with Reload (`reloadFromStorage`) or Dismiss.
- **Compaction notice:** emergency chat snapshot compaction surfaces
  `compactionNotice` in the composer.
- **Notes quarantine:** corrupt `gatesai.notes.v1` snapshots are quarantined with a
  recovery copy (matching chat persistence) instead of silently wiping to `[]`.
- **Bridge activity routing:** `recordActivityEvent` attaches to the streaming
  thread when the active sidebar thread differs (background streams).
- **Tests:** `UiStore.test.ts`, expanded `ChatStore` / `NotesStore` / `persistence`
  coverage; Playwright per-thread draft + per-thread error e2e. Vitest: **669+**;
  Playwright: **19** e2e tests.

## 2026-06-07 — Hardening pass: audit Batch A fixes + regression tests + Playwright

- **Image cancel race (C2):** `ImageJobStore.runNext` only clears `inflight` when
  the settling job still owns the active `AbortController`.
- **Stale finalize / auto-name (C4):** normal and side-effect-loop finalization
  paths guard with `ownsStreamingTurn`; manual `renameThread` sets `autoNamed`.
- **Chat-history protection (C3 partial):** `protectedWorkspacePaths` now covers
  the `/workspace/chat-history` mirror; `terminal`, `python_inline`, and
  `sqlite_query` reject protected paths before bridge execution.
- **Summary scheduler:** `SummaryStore.tick` backs off when **any** thread is
  streaming, not only the active thread.
- **Tests:** +15 Vitest cases (`protectedWorkspacePaths`, image cancel
  serialization, stale finalize, manual rename, background-stream summary skip,
  multi-tab last-write-wins doc, `NotesStore` corrupt boot, tool denials).
  Suite: **659** tests / **78** files.
- **Playwright:** +7 e2e scenarios (draft on thread switch, new conversation,
  Models API UI, streaming Stop, no-key banner; web-lite parity). `delayMs` on
  `mockOpenRouter`. **18** e2e tests; search spec waits for debounce.
- **Docs:** README, architecture, tech_spec storage tables, roadmap audit
  checkoffs reconciled with current counts and layout.

## 2026-06-07 — Logging hardening + audit cross-links + stale-turn guard

- **Smarter diagnostics coverage:** `createJsonPersistenceProvider` now logs
  load/save/clear failures (notes, profile, image jobs, UI prefs, provider keys).
  Chat snapshot quarantine, compaction, and recovery-copy failures log to the
  ring buffer. Workspace chat atomic-save fallback, multi-tab `storage` events,
  `runTurn` failures, model resolve errors, provider stream exceptions, image
  job cancel/recovery, and summarization stream failures all emit scoped
  `logger.*` entries the `logs` tool can read.
- **Stale-turn robustness (audit C4):** error finalization after a provider
  failure now re-checks `ownsStreamingTurn` so an abandoned interrupt-and-resend
  turn cannot stamp `finishReason: 'error'` on an already-interrupted message.
- **Multi-tab awareness (audit C1, logging-only):** `installMultiTabStorageListener`
  warns when another tab mutates `gatesai.*` localStorage keys (last-write-wins
  risk; full coordination still planned).
- **Tests:** compaction test updated for dual warn logs; added multi-tab listener
  and stale-turn error-finalization regression tests. Full suite green: 661 unit,
  18 e2e, typecheck, lint.

## 2026-06-07 — Comprehensive read-only audit

- Added `docs/audits/2026-06-07-comprehensive-audit.md`: six parallel code
  walkthroughs, user-story reference, 4 Critical / ~11 High findings.
- No code changes from the audit itself; findings feed near-term roadmap work.

## 2026-06-07 — Web Lite persistence fix + UX/onboarding pass

- **Critical autosave fix (data loss on reload):** a freshly created conversation
  could be lost on refresh — most visibly in the deployed Web Lite demo, where a
  brand-new thread's messages never reached `localStorage` even though the API key
  did. Root cause: the `ChatStore` autosave `autorun` read only `snapshot`
  (`{ threads, activeThreadId }`), which subscribes to the `threads` array
  identity and `activeThreadId` — but `appendMessage` and token streaming mutate
  `thread.messages` / `message.content` **in place**. Those nested mutations never
  invalidated the reaction, so only thread-list operations (create/select/delete/
  rename) incidentally flushed deep state. Fix: the reaction now calls a
  `trackSnapshotDeep(threads)` helper that reads each thread's title/updatedAt/
  pinned/deletedAt/summary/threadContext and every message's content length, so
  any in-place edit re-runs the existing 250ms-throttled save. Regression test
  added in `tests/stores/ChatStore.test.ts` (send a message + stream a reply with
  no thread-list change, assert both persist to `localStorage`).
- **Sidebar polish:** removed the derived preview/subtitle line (retired
  `threadSidebarPreview`; body search via `threadMatchesSearch` stays), forced
  thread titles to a single line with ellipsis, widened the nav (240→270), and
  replaced the pin/delete controls with smaller, cleaner pin + trash icons.
- **First-run onboarding:** the cryptic "A blank page. Say something." empty state
  is now an intuitive panel — what GatesAI is, a clear "Add your OpenRouter API
  key to start" CTA when no provider is usable, and a Web Lite "saved locally in
  this browser" note.
- **Web Lite disabled-capability clarity:** Workspace and Gallery now early-return
  explicit desktop-only capability overviews (mirroring the Local section's
  pattern) instead of rendering dead offline bridge cards.
- **Settings is clearer:** API-key management is front-and-center (a primary
  "OpenRouter API key" card with a Manage key button at the top), section grouping
  is tightened, and the Web Lite browser-data panel reads as "Your data is saved
  in this browser."
- **Fixed a pre-existing typecheck break:** `core/modelPickerAvailability.ts`
  imported `ProviderId` from `./types` (which only re-imports it locally from
  `./llm`); it now imports `ProviderId` from `./llm` directly.
- **Decisions recorded (kept as-is, by design):** API-key "rotate" is remove +
  reconnect; `inspect_file` stays scoped to csv/json/txt as a deliberate
  foundation; OpenRouter catalog refresh is manual (no TTL); web-search uses the
  desktop bridge (web-lite degrades by design).
- **Tests:** `tests/stores/threadPreview.test.ts` trimmed to the search helper;
  the desktop e2e preview assertion replaced with a body-search assertion; the
  web-lite e2e settings assertion updated to the new wording. Full suite green
  (`npm run typecheck`, `npm run lint`, `npm run test`, `npm run test:e2e`). Note:
  `npx playwright install chromium` is required before the e2e suite can run.

## 2026-06-07 — Model picker redesign + runtime availability gating + image verification

- **Runtime availability is now a first-class, pure concept:** new
  `src/core/modelPickerAvailability.ts` exposes `availableSources()`,
  `isProviderAvailable()` / `isModelAvailable()`, and `isVerifiedModelId()`. It
  reuses `DEFAULT_OPENROUTER_CATALOG_MODEL_IDS` (the live-tested matrix) as the
  canonical "verified" set, and `ModelPickerSource` moves here so storage + UI
  share one definition.
- **The model picker only shows what you can actually use:** the source tabs are
  now derived from `availableSources()`. In web-lite there are no Local/Image
  tabs at all; on desktop the Local tab appears only when Ollama is online and
  the Image tab only when ComfyUI is ready (`comfyReady`). Unusable models are
  hidden entirely instead of shown disabled, and a persisted source that is no
  longer available falls back to `auto`.
- **Verified models are featured prominently:** the curated, live-tested catalog
  renders as an unlimited, accent-marked `Verified` section (with a per-row
  verified check), since that set is what gets picked the overwhelming majority
  of the time.
- **Capability filter chips:** vision / tools / reasoning / fast / free toggles
  under the search box narrow the list across every section. Rows also gained a
  context-window badge.
- **Image generation is provably gated and guarded:** direct-image models only
  appear when ComfyUI is ready, and `ChatStore.runDirectImageTurn` now refuses
  (with a clear assistant message) to enqueue when `comfyReady` is false instead
  of silently queuing against a dead backend. Direct-image turns force the
  `local-comfy` backend and always derive the ComfyUI mode, so a picked
  Draft/Normal/Upscale model can no longer be re-routed to OpenRouter image by a
  global preference.
- **Tests:** new `tests/services/modelPickerAvailability.test.ts` and
  `tests/components/editorial/ModelPopover.test.ts` (web-lite tab hiding, offline
  Ollama hiding, ComfyUI-gated image rows + pick, verified prominence, capability
  filters, cross-source search); a new `ChatStore` guard test; and updated
  `EditorialComposer` expectations (offline Ollama rows are now hidden rather
  than shown with an offline badge).

## 2026-06-07 — Sidebar previews + body search, model favorites, Playwright e2e

- **Sidebar message previews + search:** the sidebar thread row now derives its
  preview line from the latest message with text (attachment footers stripped on
  user messages) via a pure `threadSidebarPreview(thread)`, instead of the unused
  `Thread.subtitle`. Sidebar search now scans message bodies as well as the
  title/subtitle through `threadMatchesSearch(thread, query)`. `Thread.subtitle`
  is kept for back-compat but no longer drives the UI; nothing is copied onto the
  thread (preview is derived on read).
- **Real model favorites:** added persisted, user-togglable favorites. New
  `gatesai.modelPicker.favorites.v1` storage (`loadFavoriteModelIds` /
  `toggleFavoriteModelId`) exposed through `ModelRegistry` facade methods and a
  per-row star toggle in the model picker, with a `Favorites` section above
  `Recommended`. The hardcoded decorative star (`META.starred`) was removed.
  Favorites resolve through `registry.findById` so a curated id that a dynamic
  catalog entry supersedes still renders (fixes a silent empty-section case).
- **Broad Playwright UI suite:** added `@playwright/test` + a two-project config
  (`desktop-mocked` on the default build with a faked online bridge, `web-lite`
  on the `firebase` build). Specs cover load/nav, the streamed chat flow,
  previews + body search, favorites, attachment upload, gallery thumbnails, the
  settings danger zone, and web-lite degraded states. The bridge is faked via
  `routeWebSocket` (fs/exec ops) + a `/health` route, and the OpenRouter stream
  is mocked as SSE. Run with `npm run test:e2e`.
- **Unit tests:** added round-trip coverage for the favorites storage and for
  `threadSidebarPreview` / `threadMatchesSearch`.
- **Partial features kept as-is by design** (audited, no change needed): API-key
  "rotate" (remove + reconnect already works), `inspect_file` csv/json/txt scope
  (deliberate artifact-first foundation), OpenRouter manual catalog refresh (no
  TTL by design), and web-search CORS (desktop works; web-lite degraded by
  design).
- Verified green: full Vitest suite (627 tests), typecheck, lint, and the
  Playwright suite (11 e2e tests across both projects).

## 2026-06-07 — OpenRouter default catalog + thinking controls

- Rebuilt the curated OpenRouter catalog around the current leading model
  families: GPT-5.5 / GPT Mini, Claude Opus/Sonnet/Haiku latest, Gemini
  Pro/Flash latest plus Flash Lite, Grok 4.3/4.20, Llama 4, NVIDIA Nemotron 3,
  DeepSeek V4, and Kimi K2.
- Added Nemotron 3 Ultra/Super paid and free OpenRouter routes plus the free
  Nano 30B route to the default live-tested catalog; Nemotron 3.5 Content
  Safety is cataloged as a non-default guardrail model with tool calls disabled.
- Added a `Default catalog` section to the model picker so the curated set is
  visible ahead of the broader live OpenRouter browse list.
- Added per-thread thinking effort (`none`, `low`, `medium`, `high`, `extra
  high`) and mapped non-`none` values centrally to OpenRouter's `reasoning`
  request payload; `none` omits the override so reasoning-mandatory models
  keep their provider default.
- Extended OpenRouter compatibility coverage: catalog unit tests, reasoning
  request-body tests, Anthropic latest-alias tool-result normalization, and an
  opt-in live suite that preflights `/api/v1/models` and probes text, strict
  tools, tool-result continuation, and all thinking efforts, with throttling
  for OpenRouter `:free` route rate limits.
- Verified green: typecheck, lint, full offline Vitest suite, and the full
  live OpenRouter compatibility suite (197 tests) using
  `OPENROUTER_API_KEY`.

## 2026-06-07 — Central logging + maxed-out lint enforcement

- Added a central logger (`services/diagnostics/logger.ts`): leveled
  `debug/info/warn/error`, a 500-entry in-memory ring buffer, a level-filtered
  console (the single sanctioned `console` boundary), and a desktop JSONL file
  sink at `/workspace/logs/app-<date>.log` wired from `RootStore`.
- Added a `logs` tool (category `diagnostics`, always-on) so the assistant can
  read its own recent logs and self-diagnose failures.
- Migrated every `console.*` call in `src/` to the logger (~24 sites across 14
  files); only the logger itself touches the console now.
- Pushed the ESLint config to enforce more project patterns: `no-console`
  (logger-exempt), `consistent-type-imports`, no `fetch()` in stores, no
  `localStorage`/`sessionStorage` in stores or components, `import/no-cycle`
  (with the TS resolver), and the `mobx/*-make-observable` correctness rules.
- Resolved the violations the new rules surfaced without weakening them:
  extracted the bridge `/health` probe into `services/bridge/health.ts`, and
  routed the model picker's source-filter/recent-models persistence through a
  new `services/storage/modelPickerStorage.ts` behind a `ModelRegistry` facade.
- Added the three-sentence project pitch to the top of `README.md`.
- Verified green: typecheck, lint (all new rules), and the 608-test suite.

## 2026-06-07 — Architecture audit, boundary enforcement, and showcase pass

- Rewrote `README.md` as a recruiter-facing project showcase (highlights,
  layered-architecture overview, tech stack, dev/build/quality-gate commands,
  repository layout).
- Made the ESLint architecture rules actually enforce the UI→store→service
  direction. The flat-config blocks were silently replacing each other and the
  path globs were too shallow to catch nested violations; each layer now has a
  self-contained, depth-agnostic `no-restricted-imports` block.
- Resolved the real boundary violations the stricter rules surfaced:
  - Moved runtime-mode detection from `services/system/runtime.ts` to
    `core/runtime.ts` so every layer may read the platform mode without crossing
    a boundary.
  - Added `src/components/media/` and moved the shared `Lightbox` and
    `useImageDataUrl` there so both `editorial` and `menu` can use them without
    a cross-feature import.
  - Added `RouterStore.hrefForThread`, `UiStore` Web-Lite local-data facade
    methods, image-job type re-exports on `ImageJobStore`, and a new
    `SourceWorkspaceStore` facade so UI no longer imports services directly.
- Removed dead code: `core/modelMenu.ts` (+ its test), the unused
  `useExecStreamStore` context hook, and the unused
  `saveSnapshotToLocalStorage` / `parseChatSnapshotRaw` persistence exports.
- Surfaced previously-silent failures: auto-naming and background
  summarization now log on failure, and the Local menu shows the Ollama
  catalog-refresh error.
- Decluttered the repo root: relocated scratch audit notes under `docs/notes/`,
  moved `NAMING.md`/`DIRECTIONS.md`/`TODO.md`/`CODEBASE_OVERVIEW.html` into
  `docs/`, and dropped their now-stale entries from the source-snapshot script.
- Verified green: `npm run typecheck`, `npm run lint`, and the 608-test Vitest
  suite all pass.

## 2026-05-17 - Version 4.0.0 release build

- Updated release metadata and Arch Linux AppImage examples for the `4.0.0`
  artifact name.

## 2026-05-17 - Version 3.7.0 release build

- Bumped GatesAI Chat package, Tauri, and Rust crate metadata to `3.7.0`.
- Updated Arch Linux AppImage install examples for the `3.7.0` artifact name.

## 2026-05-17 - Linux AppImage sidecar preparation

- Added `scripts/prepare-linux-sidecar.sh` to build or copy the required
  `gatesai-bridge-x86_64-unknown-linux-gnu` sidecar before AppImage bundling.
- Updated the Linux AppImage workflow to build with a real bridge checkout when
  configured, while keeping the old stub path as an explicit manual smoke-test
  option.
- Documented local Linux AppImage build steps and tightened sidecar ignore
  rules so generated bridge binaries stay out of git.
- Added an HTML Arch Linux AppImage install guide covering runtime packages,
  launcher setup, bridge verification, and troubleshooting.

## 2026-05-15 — Unified assistant activity timeline

- Added a typed `ActivityItem` model and a single ambient `ActivityStream`
  renderer for thinking notes, tool calls/results, terminal tails, image jobs,
  and bridge status transitions.
- Promoted tool result summaries to first-class data and gave every registered
  tool pure UI metadata (`verb`, `target`, `summary`) so the chat surface no
  longer parses result strings to explain what happened.
- Replaced the old `EditorialMessage` tool/status branches with the unified
  stream, then removed `ToolCallRender`, `LiveExecTail`, thinking/working
  indicator forks, and the obsolete `toolCallStyle` preference.

## 2026-05-14 — Workspace chat history and web search

- Added workspace-backed chat persistence at `/workspace/.gatesai/chat` plus a
  readable `/workspace/chat-history` HTML/Markdown library for conversations.
- Added the `chat_history`, `web_search`, and `artifact` tools, with Brave
  Search configuration in Models and a Tauri-side Brave proxy for desktop use.
- Hardened direct workspace file access so app-managed chat history stays behind
  the `chat_history` tool instead of being read, listed, searched, or modified
  through raw `fs` operations.

## 2026-05-10 - GatesAI core hardening sprint

- Added ChatStore workflows for pin/unpin, trimmed rename fallback, branching
  from a message, regenerate-in-place, historical regenerate via branch, and
  edit-and-resend via branch without mutating the original thread.
- Added sidebar thread search plus inline thread actions for rename, pin/unpin,
  and soft-delete with undo.
- Added compact message actions for copy, regenerate, edit-and-resend, and
  branch while preserving the existing Ctrl/Cmd-click copy gesture.
- Kept the performance pass intact with memoized model rows, lazy markdown
  rendering dependencies, sticky-scroll behavior, draft debounce, and
  content-visibility for off-screen messages.
- Expanded ChatStore and editorial component coverage around thread mutation,
  branching, regeneration, composer debounce, markdown chunking, and message
  action behavior.

## 2026-05-10 — Mobile sidebar cleanup

- Removed redundant in-drawer "Back to chat" / "Menu and settings" buttons; the
  fixed top bar already handles those navigations.
- Replaced the `Close` text affordance on the brand row with a real close icon
  button on mobile.
- Reworked thread rows on mobile from centered pills into full-width list rows
  with the existing accent rail for the active thread, and tightened spacing
  for the New conversation button and search input.

## 2026-05-10 — Firebase Hosting default project

- Added `.firebaserc` with default project `ethan-488900` so Firebase CLI picks
  a project automatically and `npm run deploy:firebase` does not stop with “No
  currently active project”.

## 2026-05-09 - 0.3.0 release prep

- Bumped GatesAI Chat to `0.3.0` across npm, Tauri, and Cargo metadata.
- Includes the recent tool reliability, structured validation feedback, redacted
  diagnostics, HTML artifact preview, default workspace guide, user guide, and
  image generation flow improvements.

## 2026-05-09 — Settings menu UX trim

- Consolidated Profile into Agent, so instructions, durable memory facts,
  recent summaries, and capability status now live in one assistant-focused
  menu.
- Renamed API to Models for OpenRouter key and catalog management, removed
  Profile/API/Usage from the top-level menu, and redirected legacy menu hashes
  to their current homes.
- Added an explicit Workspace open action and clarified Gallery empty/populated
  states while keeping Settings as the shortcuts and danger-zone home.
- Removed the `(OpenRouter)` suffix from curated cloud model names; the model
  picker uses short capability subtitles instead of repeating the gateway name.
- Hid the `image_generate` agent tool unless ComfyUI is enabled and healthy, so
  image prompts do not route to a tool that cannot run.
- Built the Firebase web bundle and deployed web mode to
  `https://ethan-488900.web.app`.

## 2026-05-09 — Foundation trim follow-up

- Removed the unfinished HTML artifact tool/store/storage path and its README
  prompt injection, keeping workspace artifacts as file outputs for images and
  query scripts.
- Collapsed dead theme/header/send variants to the current fixed foundation
  choices and removed misleading Appearance copy about a non-existent Tweaks
  panel.
- Retired the Appearance menu tab; menu fallbacks now land on Settings, and
  saved UI preferences normalize to Aside tool calls, Compact markdown,
  Obsidian code blocks, compact density, and animations on.
- Filtered embedding-only Ollama tags out of the chat model catalog.
- Default unresolved persisted thread model ids back to Gemini 3 Flash and gate
  chat sending on the active model's provider readiness, so configured
  OpenRouter keys are honored and stale model ids do not leave the composer in
  a "Select model" state.
- Also fall back to Gemini 3 Flash in the live composer path and repair an
  unresolved active model before sending, covering already-mounted sessions
  whose thread model has gone stale.

## 2026-05-09 — Model menu favorites

- Added a top Favorites model-picker section for Gemini 3 Flash, DeepSeek V4
  Flash, GPT-5.5, Claude Opus 4.7, Gemini 3.1 Pro, and Normal FLUX.2 Klein
  local image generation.
- Added relative cost labels (`$`, `$$`, `$$$`, `LOCAL`) to favorite rows and
  grouped the remaining OpenRouter catalog by underlying provider.

## 2026-05-08 — Foundation polish

- Set normal chat to Gemini 3 Flash via OpenRouter and summary/title helpers
  to Gemini 3.1 Flash Lite via OpenRouter.
- Removed dead routing/default-provider and direct-provider fallback code.
- Preserved dynamic OpenRouter/Ollama model ids during snapshot migration and
  gated Ollama routeability on a live refresh rather than a cached catalog.
- Trimmed stale UI metadata and removed retired OpenAI image helper code.
- Marked older image-generation plans as superseded by the foundation trim.

## 2026-05-08 — Foundation trim

- Reduced the shippable foundation to OpenRouter cloud chat, Ollama local chat,
  ComfyUI local image generation, memory/notes/thread context, and the existing
  bridge workspace tools.
- Removed unfinished cloud image-generation paths (OpenRouter/OpenAI/Gemini
  image clients), A1111, prompt-enhancement controls, direct cloud-provider
  API cards, routing/spend placeholders, and non-persisted Agent settings.
- Added migration hygiene so old provider keys, retired image backends, and
  saved direct-provider model ids normalize to the supported foundation.

## 2026-04-27 — Harden Linux AppImage tool downloads

- **`.github/workflows/build-linux.yml`:** Prefetches Tauri AppImage helper tools into **`~/.cache/tauri`** with retry/backoff before bundling. This avoids failing a successful Rust/Tauri build when GitHub returns a transient **502** for **`AppRun-x86_64`**.
- **`.github/workflows/build-linux.yml`:** Caches **`~/.cache/tauri`** along with Cargo artifacts so later Linux builds can reuse the AppImage helper binaries.
- **`src-tauri/src/local_runtime.rs`:** Removed the unused **`RuntimeKind::id`** method so release builds no longer emit that warning.

## 2026-04-27 — Linux AppImage CI readiness

- **`tauri.conf.json`:** **`bundle.targets`** lists **`nsis`** and **`appimage`** so Linux releases declare AppImage alongside Windows NSIS (each OS still builds only compatible formats).
- **`.github/workflows/build-linux.yml`:** **`build-essential`** for toolchain parity; **`mkdir -p src-tauri/binaries`** before compiling the stub bridge; removed empty **`TAURI_SIGNING_PRIVATE_KEY`** env line.
- **`ArtifactStorage` / `ArtifactStore`:** Replaced constructor parameter properties with explicit fields so **`erasableSyntaxOnly`** passes (**required for `npm run build`** inside Tauri **`beforeBuildCommand`**).
- **Artifact tests:** Typed **`BridgeFacade`** / **`ToolContext`** stand-ins instead of **`any`** for ESLint compliance.

## 2026-04-27 — Fix Linux CI: Comfy Windows bootstrap isolation

- **`src-tauri/src/local_runtime.rs`:** Moved the embedded Python bootstrap string and Windows-only Comfy args into **`#[cfg(windows)] fn comfy_windows_python_args`** (and **`#[cfg(not(windows))] fn comfy_unix_python_args`**). Non-Windows builds no longer resolve the Windows bootstrap symbol, fixing **`cargo`/Tauri builds on Linux** (e.g. AppImage CI).

## 2026-04-27 — Merge `feature/html-artifacts` to `master`

- Fast-forward merged **`feature/html-artifacts`** into **`master`** and pushed to **`origin`**. **`.github/workflows/build-linux.yml`** is now on the default branch so GitHub Actions shows **Build Linux AppImage** (manual `workflow_dispatch` or push tags matching `v*`).

## 2026-04-27 — Unsupported settings states

- Unsupported settings tabs (Profile, Agent, Usage) are now visibly dimmed and non-interactive, with a "Coming soon" badge.
- Placeholder controls inside live sections (Routing card in API, Model defaults and Voice & tone in Agent) use the same muted treatment.
- Live sections — Local, API provider keys, Appearance, Workspace, Gallery, Settings — remain fully interactive.

## 2026-04-27 — Local image mode picker

- Direct local image generation now appears as three model-picker choices:
  **Draft** (SDXL Lightning), **Normal** (FLUX.2 Klein with no upscale), and
  **Upscale** (FLUX.2 Klein with a 2× hires-fix pass). Normal is the default
  local ComfyUI path, and old saved Quick/Draft defaults migrate to Normal.
- Image jobs can carry a ComfyUI mode override, so direct-image models are
  independent from the Local menu's saved workflow defaults.
- Root **`DIRECTIONS.md`** now embeds the ComfyUI model download checklist and
  resumable `curl` commands directly instead of only linking to deeper docs.

## 2026-04-27 — v0.2.0 — Ship-ready setup guide

- Rewrote root **`DIRECTIONS.md`** as a self-contained one-page setup guide
  meant to ship next to the NSIS installer. Covers install, ComfyUI portable
  + model placement, Ollama (optional), API keys (optional), and a single
  troubleshooting table. Mirrors what the bundled app actually does.

## 2026-04-27 — Desktop release hygiene + setup guide

- Finished the ComfyUI `full` workflow path: `ImageGenStore` now persists and
  passes the hires-fix upscale factor, `ComfyClient` feeds it into the FLUX.2
  Klein workflow builder, and `{{SEED_PLUS_1}}` is substituted for the
  refinement pass.
- Added the offline **ComfyUI (direct, no chat)** model path: the catalog
  includes the synthetic `local-image` model, `ChatStore.runTurn` enqueues an
  image job without streaming an LLM provider, and the composer enables send
  without requiring an API key when that model is selected.
- Tightened direct-image mode so the context meter and ComfyUI enqueue path use
  only the user-authored prompt body. Prior chat context, system prompt text,
  tool schemas, reserved reply budget, and attachment footers are ignored.
- Extended `image_generate` with `prompt_file` batch mode. The model can write a
  `/workspace` JSON file of prompts, call the tool once, and fan out up to 500
  prompt entries into existing queued image jobs.
- Fixed Gallery image loading for ComfyUI outputs by fetching hosted `/view`
  results and persisting them into `/workspace/artifacts/`; older hosted
  history entries are converted to data URLs in Gallery/Lightbox before
  rendering. The image viewer now shows the full prompt in a selectable field
  with a one-click copy button.
- Fixed TypeScript drift (`ModelRegistry.byProvider` includes `local-image`; removed unused Comfy import; tests use `quick` / `full` presets).
- **`ChatStore.setThreadModel`** now replaces the thread object so MobX observes model changes — **ComfyUI (direct, no chat)** correctly clears the API-key banner and enables send.
- Added root **`DIRECTIONS.md`**: end-user steps for bridge, Ollama vs API “Local”, ComfyUI **Quick** / **Full** image flow, direct-image mode, and build artifact paths.
- Verified **`npm run ci`** and **`npm run tauri:build`** produce `GatesAI Chat_0.1.0_x64-setup.exe`.

## 2026-04-26 — Feature: Image-gen UX overhaul

`image_generate` is now a background job. The tool returns immediately with a
job id; the chat message renders a live progress card that fills in with the
final image when the render completes. Switching threads, sending more turns,
or kicking off a second image-gen call works fine — jobs run serially in the
background.

- New `ImageJobStore` owns the queue, the active job, and a persisted
  completed-job history under `gatesai.imagejobs.v1`.
- `image_generate` accepts a new `count` arg (1–10). Multi-image jobs land as
  a uniform-tile grid in the chat message; click any tile to open in the
  Lightbox with arrow navigation.
- ComfyUI progress streams over its WebSocket (`/ws`); A1111 progress polls
  `/sdapi/v1/progress` every 500ms. Both expose a Cancel button on the card.
- New **Gallery** menu section shows every completed image across threads
  with click-to-Lightbox.
- Markdown links to `/workspace/...` paths now open in the OS viewer (the
  `<a>` interceptor mirrors the existing inline-code workspace-path link).
- The system prompt now tells models not to repeat tool results in their
  prose when `image_generate` is in scope.
- Removed the unused fal.ai cloud backend; cloud image-gen will route through
  OpenRouter when that lands. `image_generate` is local-only for now
  (ComfyUI / AUTOMATIC1111).

## 2026-04-26 — Refactor: Local runtime single source of truth

`LocalRuntimeStore` is now the only owner of the Ollama and ComfyUI base URLs.
`OllamaStore.baseUrl`, `ImageGenConfig.comfyBaseUrl`, the legacy-migration
helper, and the two `RootStore` autorun mirrors are gone; `ProviderStore`
exposes an `effectiveConfigs` getter that overlays the live URL when the LLM
router asks for it. The Settings → Local URL inputs write directly to
`local.setBaseUrl(...)` and the legacy keys' URL fields are ignored on load.

Hygiene pass alongside the SoT change: dead `OllamaStore` status-poll plumbing
deleted, `LocalRuntimeStore.refreshStatus` coalesces in-flight calls,
`isLocalBackend` consolidates to a single export, image-tool args validate via
`IMAGE_ASPECT_RATIOS` / `IMAGE_VARIANTS` guards, and the ComfyUI workflow
templates moved into `src/services/image/workflows/`. On the Rust side,
`local_runtime.rs` introduces a `RuntimeKind` enum (no `""` fallback), shares
`http_health::probe_health` with the bridge sidecar check, and recovers from
mutex poisoning via `into_inner()` with a logged warning.

## 2026-04-26 — Feature: Local runtime setup

GatesAI now has a dedicated **Local** menu for setup and day-to-day control of
Ollama, ComfyUI, and local vision. The app can auto-detect common install paths,
store them under `gatesai.local.v1`, start/stop managed child processes, show
live status and captured logs, and pass the correct ComfyUI CORS flags
automatically.

The API menu is now cloud-only: cloud LLM keys and fal.ai live there, while
local LLM catalog refresh, ComfyUI workflow settings, and local vision-model
selection live under Local. `RootStore` wires `LocalRuntimeStore` into the
existing `OllamaStore` and `ImageGenStore` so the model picker and
`image_generate` keep using the same ports and backend contracts.

Added `describe_image`, a local vision helper tool that reads a workspace image
through the bridge and sends it to the selected Ollama vision model. This lets a
non-vision chat model ask a local vision model to inspect screenshots or image
artifacts without changing the active chat model.

## 2026-04-26 — Feature: Ollama provider

Local LLMs via Ollama are now first-class in the model picker. The **Local**
menu owns Ollama setup: install path, managed Start/Stop, base URL (default
`http://127.0.0.1:11434`), optional bearer key, catalog refresh, and the global
tool-calls toggle. Refresh hits `/api/tags` and populates the picker with
whatever models you've pulled.

The `OllamaProvider` speaks Ollama's native NDJSON `/api/chat`, so
streaming text, tool calls, and image inputs all work for capable
models. The catalog flags known-bad tool families (`gemma*`, `phi*`,
`codellama`) with `supportsTools: false`; ChatStore drops `tools` from
the request for those models. The existing **Local endpoint** provider
(LM Studio / vLLM / llama.cpp) is untouched.

Runtime status now lives in Local alongside managed process logs. The model
catalog and optional auth persist under `gatesai.ollama.v1`, separate from the
LLM-provider config; local runtime paths and management flags persist under
`gatesai.local.v1`.

## 2026-04-26 — Image-gen quality overhaul

Local ComfyUI now ships two opinionated lanes — a fast SDXL Lightning **Draft**
preset for prototypes (built into `comfyClient.ts`) and a tuned FLUX.2 Klein
FP8 **Final** workflow at `scripts/comfy-workflows/current-final-workflow.json`.
`image_generate` accepts explicit `width`/`height` for local backends and an
opt-in LLM-driven prompt enhancement step (configured under the Local menu and
off by default for prompt adherence).

### Added
- Built-in ComfyUI **Draft** workflow uses SDXL Lightning with fp16-fix VAE,
  4-step Lightning settings, a 1.5× latent hi-res fix, and a second
  low-denoise sampler pass.
- **Final** ComfyUI workflow: 4-step FLUX.2 Klein FP8 with a single 2× Ultimate
  SD Upscale pass at denoise `0.20` and wide linear tiles. Lives in
  `scripts/comfy-workflows/current-final-workflow.json`.
- Optional LLM prompt enhancement for `image_generate` with a per-style preset,
  exposed in the Local menu and disabled unless the user opts in.
- Local-only explicit pixel dimensions on `image_generate` (ComfyUI and
  AUTOMATIC1111). Cloud backends keep using named aspect-ratio buckets.
- New doc: `docs/gatesai-local-image-prereqs.md` (download sheet for the
  FLUX.2 Klein FP8 final workflow plus SDXL draft mode).

### Changed
- ComfyUI setup docs updated for the new checkpoints, VAE, upscaler, and
  opt-in prompt-enhancement setting.
- Settings copy frames ComfyUI as two lanes: Draft for SDXL prototypes and
  Final for the selected workflow template.

## 2026-04-26 — Refactor: Multimodal feature cleanup

Architectural cleanup of the seams introduced by multimodal + image-gen.
No user-visible behavior change except that the unwired Routing card is
now clearly disabled with a Coming-soon pill.

- **Structured tool artifacts.** `ToolResult` gained an optional
  `artifacts: ToolResultArtifact[]` field; `Tool.execute` may return
  `string | { content, artifacts }`. The chat UI renders the
  `image_generate` thumbnail from `result.artifacts` instead of regex-ing
  the tool result string. Forward-compat with batch image generation.
- **Service / store boundary.** `services/bridge/readAttachmentBytes.ts`
  no longer imports `BridgeStore`; takes a narrow `AttachmentBytesReadDeps`
  shape. The store-side facade still passes `this`.
- **defaultVariant honored.** `ImageGenStore.config.defaultVariant` is now
  surfaced through `ImageBackendSnapshot` and consulted by `image_generate`
  (precedence: tool args → snapshot default → `flux-2-pro`).
- **Unified image-backend types.** `ImageBackendId`, `ComfyQualityPreset`,
  and `ImageBackendSnapshot` live in `services/image/types.ts` only;
  `services/imageGenStorage.ts` and `services/tools/types.ts` re-export.
  `ImageBackendConfig` extends the snapshot.
- **`SecretKeyField` primitive.** New `components/ui/SecretKeyField`
  consolidates inline mask / reveal / connect / clear blocks in provider and
  Local settings.
- **`Api.tsx` split.** `components/menu/sections/api/{ApiSection,ProviderCard,
  ImageGenCard,OpenRouterCatalogRow,RoutingCard,ProviderAvatar}.tsx`. The
  outer `sections/Api.tsx` is a one-line re-export.
- **Composer upload moved into store.** `UiStore.uploadFiles(files, bridge)`
  owns `uploading` / `uploadError` and the upload loop;
  `EditorialComposer` is now a thin presentational wrapper.
- **Routing settings disabled.** Inputs are bound (not `defaultValue`) and
  rendered with `disabled` + a Coming-soon pill so users don't think their
  selection is being honored.
- **`isImageMime` helper.** `core/attachments.ts#isImageMime` replaces
  open-coded `/^image\//i.test(...)` scattered across the composer,
  ChatStore, the resolver, and the legacy attachment renderer.

## 2026-04-26 — Feature: SDXL Lightning draft image preset

Added a ComfyUI quality preset for fast prototype images. `Draft` is now the
default ComfyUI preset and uses a built-in SDXL Lightning 4-step workflow
targeting `sdxl_lightning_4step.safetensors` in ComfyUI's checkpoints folder.
`Final` keeps using the custom FLUX workflow path. The public `image_generate`
tool contract stays unchanged.

## 2026-04-26 — Bugfix: ComfyUI workflow metadata and background prompts

ComfyUI crashed with `'str' object has no attribute 'get'` when the custom
workflow JSON contained a top-level `_comment` string. The Comfy client now
strips top-level underscore metadata before POSTing to `/prompt`, and tool
selection treats "background" / "wallpaper" as image-generation requests.

## 2026-04-26 — Bugfix: image `fetch` Illegal invocation (Tauri WebView)

The FLUX / ComfyUI / A1111 clients kept `this.fetchImpl = fetch` and later
called it as a method, so the native `fetch` received the wrong `this` and
threw `Failed to execute 'fetch' on 'Window': Illegal invocation`. Storing
a wrapper from `wrapGlobalFetch()` in `src/services/image/types.ts` fixes it.

## 2026-04-26 — Phase 3: Local image generation (ComfyUI + A1111)

Closes the multimodal + image-gen plan. The same `image_generate`
tool can now route to three backends behind one contract, with a
cloud fallback so local GPU failures don't silently break things.

Architecture:

- **`ImageBackend` interface** (`src/services/image/types.ts`) —
  shared `{prompt, aspectRatio, seed, variant}` request and
  `{base64, mime, width, height, seed, endpoint, backend}` response
  shape. Extracted shared helpers (`dimsForAspect`, `bytesToBase64`,
  `mimeFromUrl`, `safeText`) out of `fluxClient.ts` so every backend
  speaks the same vocabulary.
- **`A1111Client`** (`src/services/image/a1111Client.ts`) — wraps
  AUTOMATIC1111's `POST /sdapi/v1/txt2img`. Returns base64 images
  synchronously, parses the resolved seed from the `info` JSON
  blob, supports optional `--api-auth` Bearer tokens.
- **`ComfyClient`** (`src/services/image/comfyClient.ts`) — full
  `/prompt → /history/<id> → /view` flow. Ships a built-in SDXL
  txt2img workflow with `{{PROMPT}}`, `{{WIDTH}}`, `{{HEIGHT}}`,
  `{{SEED}}` token substitution; users with non-SDXL checkpoints
  can point the `comfyWorkflowPath` setting at their own workflow
  JSON (e.g. a FLUX.1-schnell graph) and the tool will load and
  substitute it. Polling is injectable (`sleep`, `fetch`,
  `maxPollAttempts`, `pollIntervalMs`) for deterministic tests.
- **`dispatchImageGenerate`** (`src/services/image/imageBackend.ts`)
  — single entry point the tool calls. Resolves the `primary`
  backend, runs it, and on local failure (or un-instantiable local
  backend) automatically retries against the configured cloud
  `fallback` with usable credentials. Cloud primaries never
  auto-fall-back — a 402 / 429 there is signal, not noise. The
  fallback emits a short note the tool prepends to its return
  string so the model can mention the degraded state.
- **Settings UI** — single "Image generation" card now hosts a
  backend dropdown (fal.ai / ComfyUI / A1111, with BFL reserved).
  Selecting a backend swaps in only the fields it needs: API key
  for fal, base URL + optional workflow path for ComfyUI, base URL
  + optional API key for A1111. A "Cloud fallback" row shows only
  for local backends.
- **Store surface** — `ImageGenStore.toBackendConfig()` returns a
  plain snapshot the dispatcher accepts. The facade
  (`ImageGenFacade` in `services/tools/types.ts`) exposes only the
  snapshot + workflow-path getter so the tool stays decoupled from
  the store.

Bundling note (for the distributed `.exe`): the **client code**
bundles fine — it's just TypeScript. The **backend** (Python +
PyTorch + CUDA runtime + 7-24GB model weights) cannot reasonably
be bundled. The current Phase-3 implementation assumes the user
brings their own ComfyUI / A1111 install. A future polish could
ship a first-run helper that downloads ComfyUI into
`~/GatesAI/comfyui/` and boots it as a sidecar — same pattern as
the existing bridge.

Tests (18 new, 229 total):

- `tests/services/image/a1111Client.test.ts` — 4 cases: request
  shape + aspect-ratio dims, error-body surfacing, Bearer auth,
  missing-images guard.
- `tests/services/image/comfyClient.test.ts` — 7 cases:
  `substituteWorkflow` type-preservation + substring semantics,
  full submit-poll-fetch flow, workflow token wiring, timeout
  path, /prompt rejection path.
- `tests/services/image/imageBackend.test.ts` — 7 cases:
  primary-ok, unconfigured-primary, local→cloud fallback on
  failure, cloud-never-auto-falls-back, local→cloud on
  missing-base-URL, double-failure reporting, identical
  primary/fallback treated as no fallback.

Typecheck + lint clean.

## 2026-04-26 — Phase 2: Image generation via fal.ai (FLUX 2.x)

Second phase of the multimodal + image-gen plan. The model can now
produce images with a single tool call: `image_generate` takes a
prompt, renders it through fal.ai FLUX 2.x, and saves the bytes to
`/workspace/artifacts/` where the clickable-workspace-path link from
the last session lets the user open the full-resolution result.

Architecture:

- `ImageGenStore` (`src/stores/ImageGenStore.ts`) — new MobX store
  backed by `services/imageGenStorage.ts`, persisted under
  `gatesai.imagegen.v1` separately from `gatesai.providers.v1`.
  Holds `{backend, falApiKey, bflApiKey, defaultVariant}`; backend
  switcher is ready for Phase 3 (local ComfyUI / A1111) without
  churning the schema.
- `FluxClient` (`src/services/image/fluxClient.ts`) — stateless
  service wrapper around fal.ai's synchronous POST endpoints
  (`https://fal.run/fal-ai/flux-pro/v2`, `/flux/v2/flex`,
  `/flux/v2/dev`). Maps aspect-ratio strings to concrete
  `image_size` dims, fetches the returned image bytes, and returns
  `{base64, mime, width, height, seed, endpoint}`. Injectable `fetch`
  for tests; surfaces fal error bodies in the thrown `Error`.
- `image_generate` tool (`src/services/tools/imageGenerate.ts`) —
  registered in the tool registry, gated into the per-turn toolset
  by intent keywords (`draw`, `render`, `generate image`, `flux`,
  `dall-e`, etc.). Writes base64 bytes through `fs.write`, so
  artifacts flow through the same bridge jail as everything else.
  Returns a concise `Saved: /workspace/artifacts/<file>.png
  (WxH, seed=N, variant=...)` so the model never ingests raw base64.
- Settings UI — the cloud image-generation section in API exposes the fal.ai
  key + default-variant selector. The field
  re-uses the same masked/revealed key pattern as LLM providers.
- Inline preview — when a message has an `image_generate` tool
  result, `EditorialMessage` renders a `WorkspaceImage` thumbnail
  right below the tool-result box so the generated artwork lands
  visibly in the chat flow, not just as a path string.
- `ToolContext.imageGen` facade — `ImageGenFacade` exposes only the
  minimum surface (`backend`, `getCredential`, `toBackendConfig`),
  keeping the tool decoupled from the full store.

Tests:

- `tests/services/image/fluxClient.test.ts` — 4 cases covering auth
  header, image_size per aspect ratio, endpoint selection per
  variant, error-body surfacing, `endpointOverride`.
- `tests/services/tools/imageGenerate.test.ts` — 6 cases covering
  prompt validation, missing-key / offline-bridge error paths,
  filename defaulting, filename sanitization against path
  traversal, and the fs.write payload shape.

All 211 tests pass; typecheck clean.

## 2026-04-26 — Phase 1: Vision input (multimodal wire format)

First phase of the multimodal + image-gen plan
(`docs/plans/2026-04-26-multimodal-and-imagegen.md`). Users can now drop
images into the composer, attach them to a user turn, and have every
vision-capable model (Anthropic Claude, OpenAI GPT-4o / GPT-5+, Gemini,
same families routed via OpenRouter) actually see the pixels instead of
just the file footer.

Architecture:

- `UserMessage.attachments: MessageAttachmentRef[]` — structured refs
  (path + mime + size) live alongside the legacy markdown footer in
  `content`, so older persisted messages still parse via
  `splitAttachmentFooter` while new turns use the authoritative field.
- `BridgeStore.readAttachmentBase64()` — facade method (pure service
  helper in `services/bridge/readAttachmentBytes.ts`) that fetches a
  workspace file's bytes as base64, returning `null` when offline or on
  failure so callers can degrade instead of throwing.
- `modelSupportsVision(model)` — pattern-matches provider + model id
  (with an explicit `Model.supportsVision` override), centralizing the
  capability check so the composer, provider adapters, and future
  tools all agree.
- `LlmMessage.images?: LlmImagePart[]` — inline base64 on the wire. A
  new `resolveWireImages()` resolver runs just before `provider.stream`
  (gated on `hasAnyImageAttachment`, so the zero-image fast path stays
  synchronous and time-sensitive streaming tests still pass).
- Provider adapters extended to emit native multimodal shapes:
  OpenAI-compat emits `image_url` content parts with `data:` URLs,
  Anthropic emits `image` blocks with base64 sources, Gemini emits
  `inlineData` parts.
- UI: `WorkspaceImage` component renders attached images as thumbnails
  (in both the composer preview and sent user messages), clicking opens
  the file in the OS default handler. The composer shows a small
  "text-only model" hint when the active model can't consume images.

## 2026-04-25 — Clickable workspace paths in chat

Inline code in assistant messages that looks like a `/workspace/...` path now
renders as a clickable link. Click resolves the model-facing path against the
bridge's reported `workspaceRoot` (platform-aware path joining via
`core/workspacePaths.ts`) and opens the file with the OS default handler — so
a `/workspace/artifacts/pi.html` artifact opens in the browser, a `.py` in
the user's editor, etc. Implementation: a new `open_path` Tauri command
(backed by the `open` crate), an `openExternal` service wrapper that no-ops
gracefully outside Tauri, a `BridgeStore.openWorkspacePath()` facade that
keeps UI code free of path manipulation, and a `<code>` override in
`EditorialMessage` that detects workspace paths without re-parsing the
markdown stream. Block code (anything with a syntax-highlight class) is left
alone.

## 2026-04-25 — Quieter `fs.read` and tougher CSV header parsing

`fs.read` no longer dumps base64 blobs into model context when the bridge
returns binary-coded content. Responses are now decoded through a shared
text decoder (`services/tools/textDecode.ts`) that recognizes utf-8/utf-16/
windows-1252 and detects truly-binary content; binary files come back as a
short stub (`path`, `mime`, `size`, `kind: binary`) instead of pages of
`LCwsLCws…`. Callers that genuinely want raw bytes can still pass
`encoding: "base64"` explicitly. `inspect_file` now reuses the same
decoder and auto-names empty CSV header columns as `column_N` instead of
hard-erroring on Excel-exported sparse headers, so attached `.csv` files
stop falling through to the gross `fs.read` path.

## 2026-04-25 — Fresh-install UX

Removed the demo-mode feel from a fresh install. New installs land in one
empty untitled thread instead of eleven seeded fakes. Sending a message
without a configured provider no longer falls back to canned responses —
the composer's send button is disabled and a banner above it links to the
API settings panel until a real provider is configured. `FakeProvider` and
`src/core/seed.ts` are gone; the router throws `NoProviderConfiguredError`
when no real provider can serve a request. The installer now ships with
the brand icon instead of the Tauri placeholder.

## 2026-04-25 — Desktop app

GatesAI Chat now ships as a native Windows installer that bundles the Go
bridge automatically. The previous `Start GatesAI Chat.cmd` launcher has been
removed.

## 2026-04-25 — Architecture cleanup sprint

Moved shared tool-call/result rendering into `components/ui/` so editorial and
menu surfaces no longer import from each other. Removed React type dependencies
from `core/` style modules and tightened ESLint boundary rules for core,
stores, and cross-feature component imports.

Resynced architecture docs with the current store graph, menu routes, and
storage keys, including profile, notes, UI preferences, bridge, exec stream,
and workspace menu state. Roadmap and TODO entries now distinguish completed
attachment/tooling work from the remaining cleanup.

Centralized attachment footer formatting/parsing in `core/attachments.ts`, then
moved file uploads behind `BridgeStore.uploadAttachment()` so UI components no
longer import bridge services directly. Extracted ChatStore helper logic for
runtime context, artifact README loading, and tool failure logging into focused
service modules with regression tests.

## 2026-04-25 — Streaming markdown rendering and scroll UX fix

`EditorialChat` no longer forces the scroll container to the bottom on every
streaming token. The `useEffect` dependency on `chat.streamingMessageId` was
removed so the viewport only scrolls when a new message row appears or the
active thread switches — users can now freely scroll while the assistant streams.

`EditorialMessage` now routes active assistant stream content through the same
`ReactMarkdown` / remark-gfm / rehype pipeline used for finalized messages.
The old `StreamingPlainText` component is gone; a shared `MarkdownBody` helper
deduplicates the plugin configuration. The `WorkingIndicator` remains visible
outside the markdown tree during streaming. Tests updated to reflect markdown
rendering during active streams.

## 2026-04-25 — Architecture boundary cleanup, P0

Moved the shared SVG icon set from `core/` into `components/ui/` so the core
layer no longer owns React components. Removed unused icon exports and the
unused `fieldStyle` barrel export.

Replaced service-layer imports of store classes with narrow facades: tools now
type against service-owned context interfaces, `LlmRouter` accepts a
`ModelCatalog` interface, `threadNamer` accepts a router facade, and attachment
upload accepts a bridge-shaped facade. Added staged `no-restricted-imports`
rules so service-layer violations fail while the remaining UI-to-service
attachment import is tracked as a warning until the attachment store lands.

Made `FakeProvider` response rotation instance-local and moved duplicated
provider JSON parsing into a shared `services/llm/json.ts` helper.

## 2026-04-25 — Inspect workflow and query-script guidance

`inspect_file` now handles common uploaded data encodings instead of rejecting
binary/base64 bridge reads. It decodes UTF-8/BOM, UTF-16LE/BE, and
Windows-1252/Latin-1 style CSV/text inputs, reports detected encoding, and adds
richer CSV profiling with delimiter, row/column counts, likely date columns,
numeric min/max/sample, and empty/ragged row counts.

Added `inspect_file({ action: "workspace_profile" })` for artifact-first
workspace discovery using bridge `fs.list` and optional `fs.search`, plus a
`query_script` template tool for reusable scripts under
`/workspace/notes/query_scripts/` and final JSON outputs under
`/workspace/artifacts/`.

## 2026-04-25 — Scoped Python and SQLite wrappers

Added scoped `python_inline` and `sqlite_query` tools so the model can run
short Python snippets and read-only SQLite queries without broad shell access.
Both wrappers route through bridge `exec.run` with `cmd: "python"` and explicit
argv, avoiding PowerShell, cmd.exe, shell pipes, redirects, and the raw
`sqlite3` shell.

The SQLite wrapper accepts workspace-relative `.sqlite`, `.sqlite3`, and `.db`
paths, rejects dot-commands and multiple statements, and returns compact
JSON-shaped row output. Docs now mark broad shells as power-user escape hatches,
not default-safe workflow tools.

## 2026-04-25 — Emergency persistence for oversized tool results

Root cause for lost recent chat state: `ChatStore` saved snapshots to
`localStorage`, but `saveSnapshot` silently ignored quota failures. Large
tool/file results could push `gatesai.state.v1` past the browser limit, so a
crash or reload restored the older last-successful snapshot.

`saveSnapshot` now retries with an emergency-compacted snapshot that preserves
threads, user messages, assistant prose, tool calls, and tool result metadata
while replacing oversized tool result bodies and large tool-call payload
arguments with head/tail snippets and explicit compaction markers. Added
quota-style regression tests.

## 2026-04-25 — Runtime context in system prompt

Every provider request now includes a fresh `Runtime context` system section
with local time, timezone, ISO timestamp, bridge state, workspace path layout,
and terminal cwd semantics. This gives the model stable information about
where it is and how the harness works without needing a tool call.

The `time` tool remains registered for compatibility, but ordinary turns no
longer advertise it because the current time is already present in the system
prompt.

## 2026-04-25 — Artifact README system context

Artifact README files now act as global instructions. Before each provider
round, `ChatStore` reads `/workspace/artifacts/**/README.md` files through the
bridge, sorts them deterministically, caps their content, and appends them to
the composed system prompt under `Artifact instructions`.

This keeps generated artifact guidance available across all threads without
duplicating file contents into persisted chat state.

## 2026-04-25 — Tool harness guidance and failure logging

Updated the always-on bridge harness prompt to steer models toward
command-style tool use: choose a narrow action, pass explicit arguments, read
status/error output, and retry with corrected arguments when appropriate. The
prompt now also tells models to use `inspect_file` before `fs.read` for CSV,
JSON, and text files.

Updated attachment footers to reinforce the same rule so CSV/JSON/text
attachments point the model at `inspect_file`, reserving `fs` for byte-level
reads/writes.

Added structured console warnings for failed tool calls at the central
`ChatStore` execution boundary. Failure logs include tool/call/thread ids,
reason, result previews, redacted argument previews, bridge-online state,
read-only classification, duration, and timestamp for harness improvement.
Non-zero `terminal` and `git` exits are logged as failures too.

## 2026-04-25 — Chat-side guard for stale bridge empty results

Confirmed a live bridge process was still returning `entries: null` for an
empty `fs.list` response, even though the bridge source now returns empty
arrays. Updated the chat-side `fs` tool formatter to treat legacy `null`
`entries`/`hits` values as empty arrays so stale bridge processes no longer
surface `Cannot read properties of null (reading 'length')` to the model.

## 2026-04-25 — Semantic file inspection tool

Added a read-only `inspect_file` tool for compact CSV, JSON, and text
inspection. The assistant can now profile, preview, search, extract, and
aggregate supported files through the bridge without dumping full file contents
into model context.

Added focused regression coverage for CSV profiling/extraction, JSON shape
profiling, text line extraction, and tool registry selection.

## 2026-04-25 — Idempotent Windows launcher

Updated `Start GatesAI Chat.cmd` to probe the bridge health endpoint before
starting `gatesai-bridge`. If a bridge is already listening on
`127.0.0.1:7331`, the launcher reuses it and only opens the chat dev server,
avoiding the duplicate-socket `bind: Only one usage of each socket address`
error.

## 2026-04-25 — Working indicator during streamed text

Active assistant messages now keep a subtle `working` indicator under streamed
plain text after the first token arrives, matching the existing pre-token
`thinking` / `responding` / `compacting` status treatment. Streaming assistant
rows also hide their bottom divider until the response is complete, so the UI
doesn't imply the answer has finished early.

## 2026-04-25 — Context accounting and auto-compaction

Made the context meter use the same provider payload shape as `runTurn`,
including the composed system prompt, expanded tool results, tool schemas, and
reserved reply budget. `ChatStore` now preflights each request before calling
the provider so oversized threads fail locally with a friendly message instead
of surfacing raw OpenRouter context-limit JSON.

Added automatic compaction for large tool results. When a thread approaches the
model context window, the store prefers a cheap configured small model to
summarize old bulky tool output, falls back to deterministic path/size
summaries when needed, then retries the original model request. Empty assistant
rows can now show `compacting` during that pre-token step.

## 2026-04-25 — Windows chat + bridge launcher

Added `Start GatesAI Chat.cmd`, a double-click Windows launcher that starts
the sibling `gatesai-bridge` process and the Vite chat dev server in separate
PowerShell windows. The script validates the expected project layout and
required commands before launching, prefers a built bridge binary when present,
and falls back to `go run ./cmd/gatesai-bridge`.

The launcher also supports `Start GatesAI Chat.cmd /check` for a non-launching
sanity check.

## 2026-04-25 — Smoother assistant text streaming

Reduced choppy assistant text loading by batching streamed text deltas before
writing them into MobX state. The batcher flushes on a short frame-sized timer
or sooner when enough text accumulates, which cuts down render churn without
leaving long responses visually stalled.

Active assistant streams now render as lightweight pre-wrapped text and switch
back to full markdown once finalized. This avoids reparsing the entire markdown
tree on every small token update while preserving final markdown formatting.

## 2026-04-25 — Bridge empty-list response fix

Fixed a bridge protocol edge case where empty `fs.list` and no-match
`fs.search` responses marshaled Go nil slices as JSON `null`. The chat-side
tool formatters expect arrays and could surface
`Error: Cannot read properties of null (reading 'length')` during tool-heavy
turns that probed empty workspace folders before reading an attachment.

The bridge now initializes those response slices so empty results are sent as
`entries: []` and `hits: []`. Added Go regression coverage for both cases.

## 2026-04-25 — Harness accuracy and performance

Added a model-facing `workspace` tool so the assistant can query bridge runtime
facts instead of relying only on prompt prose. The tool reports bridge state,
platform, workspace root, allowlist, known caps, and the cwd-based script recipe.

The tool registry now stores capability metadata, selects a smaller conservative
tool schema set per round, budgets large `fs`, `terminal`, and `git` results,
and lets `ChatStore` run independent read-only tool calls concurrently while
preserving result order. Context estimates now include flattened wire messages,
serialized tool calls/results, and selected tool schemas.

Hardened `gatesai-bridge` by rejecting oversized `fs.read` files before loading
them and throttling streamed `exec.run` events once the output budget is spent.
Added TS/Go regression tests for workspace info, schema selection, result
compaction, token accounting, wire-format ordering, and bridge read/stream caps.

## 2026-04-25 — Responding indicator after interrupt

Added a context-aware pre-token label for interrupted-and-replaced replies.
Fresh empty assistant streams still show `thinking`, while a replacement turn
created by sending during an active stream now shows `responding` until the
first token arrives.

Added regressions for the `responding` indicator and for continued streaming
after an interrupted turn starts its replacement response.

## 2026-04-25 — Remove orphan streaming caret

Removed the post-markdown streaming caret from assistant messages. React
Markdown renders paragraphs as block elements, so the inline caret could fall
onto its own line and appear as an isolated green rectangle while a response
was still streaming. Pre-token responses still use the `thinking` indicator.

Added a renderer regression test so streamed markdown content does not render
the orphan caret.

## 2026-04-25 — Extended visible tool-loop cap

Raised `ChatStore`'s per-turn tool round cap from 6 to 16 so larger file and
artifact workflows can complete without premature interruption. If a model
still hits the cap, the assistant message now gets a visible explanation
instead of ending with blank content and only setting `lastError`.

Added a regression test covering extended tool work and the visible cap message.

## 2026-04-25 — User attachment chip rendering

Changed user messages with uploaded files to render only the model-facing
attachment footer as a compact green chip. The visible message now shows a
minimal `CSV · 10.7KB` style label, while the stored raw text still keeps the
`/workspace/attachments/...` path and fs reminder the model needs for reads.

Added a renderer regression test so attachment footers stay separate from the
user's prose and do not leak workspace paths or tool reminders into the
visible message body.

## 2026-04-25 — Markdown and code Appearance tweaker

Added a hybrid Appearance tweaker for assistant output: markdown preset cards
(`Editorial`, `Technical`, `Compact`), code-block preset cards (`Obsidian`,
`Terminal`, `Paper`), and compact advanced controls for markdown density and
code size.

The choices persist through `gatesai.uiprefs.v1` and apply live via root
classes plus `.md-body` CSS variables, keeping rendering in the UI layer and
leaving chat data unchanged.

## 2026-04-25 — Currency-safe markdown math

Fixed assistant message rendering where ordinary currency prose like
`$120,000 gross/$85,700 take-home` could be parsed as inline KaTeX math.
That caused spaces to collapse inside phrases such as "going into investments"
and made normal financial summaries look garbled. Markdown math now requires
double-dollar delimiters, preserving single-dollar currency formatting.

Added a renderer regression test covering financial-plan prose with multiple
dollar amounts and bold currency text.

## 2026-04-25 — Local-only Git tool

Added a dedicated `git` tool that wraps safe local Git porcelain through the
bridge instead of asking the model to use raw terminal commands. The first
version supports status, diff, log, show, branch listing, add, commit, and
local branch create/switch. Restore actions require the explicit confirmation
string `restore local changes`.

The tool intentionally exposes no push, pull, fetch, remote, reset, rebase,
merge, or force operations. Regression tests cover bridge-offline handling,
command argv construction, required commit messages, guarded restore behavior,
and rejection of unsupported remote/destructive actions.

## 2026-04-25 — Minimalist message copy gesture

Added a low-chrome copy affordance to chat messages: Ctrl/Cmd-click a rendered
user or assistant message to copy its raw text. A one-time hover hint teaches
the gesture, normal text selection is left alone, and the existing kicker line
briefly reports `copied` or `copy failed`.

The interaction lives entirely in the editorial UI layer. A small helper keeps
the gesture rules testable without involving stores or services.

## 2026-04-25 — Bridge harness prompt

Added an always-on bridge harness section to the composed system prompt so
models get the local workspace contract every turn before user-editable
instructions. The prompt now distinguishes model-facing `/workspace/...`
paths from subprocess working directories, tells scripts to use cwd/relative
paths, warns against shell-only syntax in direct argv terminal calls, and
sets expectations for dependent action ordering, bulk-data validation, and
long-running command results.

Tightened the `fs` and `terminal` tool descriptions with the same guidance,
covering bridge path semantics, script execution from the workspace root,
sequential write-then-run flows, artifact placement under `/workspace/artifacts`,
and timeout/final-result handling for async terminal work.

## 2026-04-25 — Tool-call error handling for OpenRouter Claude

Fixed a two-part tool loop failure seen with OpenRouter-routed Claude models:
malformed `fs` tool calls with empty arguments now return a clear
`` `action` is required for fs `` result instead of the confusing
`unknown action ""`, and OpenRouter Anthropic model requests now serialize
tool results as user continuations so Claude does not reject the follow-up as
assistant prefill.

Added regression coverage for empty `fs` actions, `fs` calls flowing through
`ChatStore`'s tool loop, and scoped OpenRouter formatting so non-Anthropic
OpenRouter models keep the standard OpenAI-compatible `tool` message shape.

## 2026-04-25 — Bridge large-request read limit

Fixed a `gatesai-bridge` WebSocket disconnect where requests larger than the
`coder/websocket` default 32 KiB read limit logged
`read limited at 32769 bytes` and closed the socket before the operation could
run. The bridge now sets its inbound WebSocket message limit from
`max_file_bytes` with room for base64 expansion and JSON overhead, keeping the
existing `fs.write` size cap as the source of truth.

Added a Go regression test that sends a >32 KiB `fs.write` request through the
real WebSocket route and verifies it receives a normal `result` response.

## 2026-04-25 — GPT-5.5 catalog refresh

Verified the new OpenAI and OpenRouter model slugs from provider pages, then
added the supported GPT-5.5 entries to the curated catalog:

- Direct OpenAI: `gpt-5.5`, `gpt-5.5-pro`
- OpenRouter mirrors: `openai/gpt-5.5`, `openai/gpt-5.5-pro`

No GPT-5.5 mini or nano entries were added because the provider docs point
cost-sensitive usage at the existing `gpt-5.4-mini` and `gpt-5.4-nano`
models instead. The model picker metadata and Agent default-model dropdown now
include GPT-5.5 and GPT-5.5 Pro, with a regression test guarding the catalog
slugs.

## 2026-04-23 — Workspace + terminal via the `gatesai-bridge` companion

Introduced a second product alongside the chat app: a small Go companion
process (`../gatesai-bridge/`) that owns a workspace folder and exposes
filesystem + shell ops over a single WebSocket. Pairing the chat app with
a local process unlocks two long-pending capabilities — real file
read/write and real terminal commands — without compromising the
"chat-app stays a static SPA" property.

### Bridge (Go)

- **Module**: `github.com/etgates/gatesai-bridge`. One dep, `coder/websocket`.
- **Workspace root**: `~/GatesAI/workspace/` with auto-created
  `attachments/`, `notes/`, `artifacts/` subfolders.
- **Path jail**: every fs op resolves through `workspace.Resolve()`,
  which calls `filepath.EvalSymlinks` and rejects anything that exits
  the root. Unit-tested for `..`, absolute paths, and symlink escapes.
- **Protocol**: WebSocket + JSON envelopes (`request | event | result |
  error`) with id correlation. One connection multiplexes everything;
  `exec.run` streams `event` envelopes for live stdout/stderr lines and
  closes with a `result` carrying the full captured output.
- **Allowlist**: `~/.gatesai/bridge.json` ships with a safe default set
  (`ls, tree, cat, head, tail, grep, find, wc, stat, mkdir, mv, cp, rm,
  touch, echo, pwd, date, whoami`). Edit + restart to add more. Rejects
  before fork.
- **Listen**: `127.0.0.1:7331` only. No auth — loopback is the entire
  trust boundary for v1.
- **Endpoints**: `GET /health` (poll target) + `WS /ws` (everything else).

### Chat (TS)

- **`core/workspace.ts`** — typed shapes mirroring the bridge's response
  structs (`FsReadResp`, `ExecRunResp`, etc.). Single source of truth
  for the wire types.
- **`services/bridge/client.ts`** — `BridgeClient` keeps one WebSocket,
  routes `result | event | error` envelopes back to per-call promises by
  id. `BridgeOfflineError` is the one error tools translate into a
  friendly string for the model.
- **`stores/BridgeStore.ts`** — owns the connection lifecycle. Polls
  `/health` every 5s; on offline → online it opens the socket; on
  online → offline it tears it down (in-flight requests reject cleanly).
- **`stores/ExecStreamStore.ts`** — keeps a "last 10 lines" tail of each
  in-flight `terminal` job purely for the UI. The model never sees the
  live stream; it gets the full captured output as the tool result.
- **Two new tools, both registered always-on**:
  - `fs` — `read | write | append | list | delete | move | copy |
    mkdir | stat | search` over the workspace.
  - `terminal` — runs allowlisted shell commands; emits live updates
    into `ExecStreamStore`.
- **Composer**: paperclip + drag-drop. Files upload to
  `/workspace/attachments/<safe-name>` via `fs.write` and become chips
  on the draft; on send, the user message gains a footer like:
  ```
  📎 Attached files (read with the `fs` tool):
    - /workspace/attachments/foo.csv · 12.3KB · text/csv
  ```
  The model reads them on demand instead of inflating every prompt.
- **Bridge status pill** at the bottom of the sidebar — green/red dot +
  click-to-repoll. Hover for the workspace root, version, allowlist
  size, and last error.
- **Live exec tail** beneath any `terminal` tool call that's still
  running — accent left-rule + last 10 stdout/stderr lines + caret.
  Replaced by the real `ToolResultView` once the bridge sends `result`.
- **Workspace settings page** under `#/menu/workspace` showing the
  status, root path, allowlist (as chips), and a recursive `fs.list` of
  the workspace contents with refresh.

### Auto-named threads + animation

After the first successful turn finishes, `ChatStore` fire-and-forgets a
`generateThreadTitle()` cascade:

```
gemini-2.5-flash-lite  →  gpt-5.4-nano  →  gemini-3-flash
                       →  gpt-5.4-mini  →  thread's own model
```

Each candidate is checked for `provider.ready()` before we waste a
request. `Thread.autoNamed` flips true once a title lands so we don't
re-run; `Thread.naming` is a transient flag (stripped on save) that
drives a `<ThreadTitle>` component in the sidebar — quiet `…` while
naming, then a one-shot 22ms/char typewriter animation when the new
title arrives.

### Tests

- `tests/services/tools.test.ts` gained 7 new tests covering `fs` and
  `terminal` against a fake bridge (offline error, validation errors,
  list formatting, run output formatting, op routing).
- Total: 78 → 85 tests, all green.
- `gatesai-bridge` has its own Go unit tests covering the path jail
  (allowed reads, escape rejections, symlink boundary confusion,
  subfolder auto-create).

### Notes

- The chat app degrades gracefully when the bridge is offline. Tools
  return `Error: bridge offline. Start gatesai-bridge.`; the composer's
  paperclip dims and tooltips explain why; the status pill goes red.
  No crashes, no spinners hanging forever.
- `Thread.naming` is intentionally non-persisted. If a tab closes
  mid-name, the title falls back to "first 40 chars of opener" until
  the next turn (which won't re-run the namer because the auto-named
  flag isn't set — small UX bug, logged in TODO).

## 2026-04-23 — Three new tools: `time`, `notes`, `thread`

Expanded the tool catalog from one (`memory`) to four. The picks were
chosen to play to the architecture's strengths — every tool runs in the
browser with no backend, and each one works with every model the user
plugs in (Claude, GPT, Gemini, OpenRouter, local).

- **`time`** — single-action tool. Returns ISO + human-readable + tz +
  unix_ms. Five-line implementation; closes the "what day is it" gap
  every model has.
- **`notes`** — six-verb tool (`create | read | update | delete |
  search | list`) backed by a new `NotesStore` and `gatesai.notes.v1`
  localStorage key. The companion to `memory`: short atomic facts go in
  `memory` (and the system prompt every turn); long-form documents go in
  `notes` (and are read on demand). Notes never leak into the system
  prompt automatically, keeping cost predictable as the corpus grows.
- **`thread`** — six-verb meta-tool (`rename | set_context |
  get_context | summarize_now | switch_to | list`). Finally gives
  `Thread.threadContext` a way to be set end-to-end (it's been in the
  data model with no UI for weeks). The model can also force-summarize
  a thread on demand and switch the active thread.

Wiring touched:

- `ToolContext` gained `notes: NotesStore` and `summary: SummaryStore`.
  These are injected lazily via `ChatStore.setToolStoresProvider(...)`
  so existing tests that don't use those tools didn't need updating.
- `SummaryStore.summarizeNow(threadId)` added — public force-summarize
  for the `thread` tool, ignoring the lazy scheduler's filters.
- `ChatStore.renameThread(id, title)` added — the `thread` tool's
  `rename` verb routes through it.
- `Agent` settings page lists the four live tools and adjusted
  "planned" set: `web_search`, `web_fetch`, `code_run`.

Tests: 12 new tool tests (`tests/services/tools.test.ts`) covering each
verb's success and error paths. Total now 70 passing.

## 2026-04-23 — One assistant message per turn (collapsed multi-round tool work)

The previous refactor put tool results on the assistant message that
called them, but each model→tool round trip was still its own assistant
message. That meant a single user turn ("forget jazz") could produce two
stacked assistant rows — the tool round and the prose round — each with
its own kicker, requiring `hideKicker` / `isOpener` / `isContinuation`
gymnastics in the renderer to make them look like one reply. The fix
was to collapse them at the storage layer, not the rendering layer.

- **One stored `AssistantMessage` per user turn**, no matter how many
  internal tool round trips happen. `toolCalls` and `toolResults`
  accumulate across rounds; `content` holds the model's final closing
  prose. The renderer sees one speaker boundary per turn.
- **`flattenForWire` does the round-splitting** when sending to
  providers — one stored message expands to `[assistant(toolCalls),
  tool, tool, ..., assistant(text)]` if needed. All wire-format
  knowledge stays in this one helper.
- **Renderer dropped 60% of its conditional logic.** No more `hideKicker`
  prop, no `isContinuation` peek-back from the parent, no `isOpener`
  border tricks, no calls-only bare-frame branch. One frame, one kicker,
  always. Tools render above the prose because chronologically that's
  what happened: the model used tools first, then composed its reply.
- **`EditorialChat` simplified** — no longer compares `messages[i-1]` to
  detect runs; it just maps each message to a renderer.
- **Persistence migration extended** to also fold consecutive assistant
  messages from the same turn (legacy snapshots may have one row per
  round). The merged row keeps the first round's id/createdAt so
  references survive, accumulates calls/results, and uses the last
  non-empty `content` as the final prose. Idempotent.

## 2026-04-23 — Tool results live on the assistant message that called them

Restructured the chat domain so a tool result is no longer its own
"message" — it's metadata on the assistant message that triggered the
call. One assistant message per round trip, with `toolCalls` and a
parallel `toolResults` array on the same object. The renderer became
trivial (no pairing, no calls-only suppression hack), persistence got
cleaner (one row per round), and the data model now matches the mental
model — nobody "said" the tool result; it's the function's return value
the model reads on its next round.

- **`Message` discriminated union shrinks to `UserMessage |
  AssistantMessage`.** `ToolMessage` is gone. `AssistantMessage` gains
  `toolResults?: ToolResult[]` paired to `toolCalls` by `toolCallId`.
  (`src/core/types.ts`)
- **`flattenForWire(messages)` is now the single boundary between
  storage and the wire format.** The wire-level `LlmMessage` shape that
  providers expect is unchanged (`user | assistant | system | tool`);
  every provider call routes through this helper, which expands one
  stored assistant-with-results into the `[assistant, tool, tool, …]`
  sequence the APIs want. Missing results (interrupted runs) get a
  synthetic placeholder so we never emit a dangling tool-call id.
  (`src/services/llm/wireFormat.ts`)
- **Forward migration in `loadSnapshot`.** Old snapshots stored tool
  results as `role: 'tool'` rows. On load we walk each thread, fold
  every tool message into the preceding assistant's `toolResults`, and
  drop the row. Idempotent — clean snapshots round-trip unchanged.
  Test: `tests/services/persistence.test.ts`.
- **`ChatStore.runTurn` rewritten.** Each round appends exactly one
  assistant message and mutates it in place: text streams into
  `content`, calls into `toolCalls`, results into `toolResults` as each
  tool finishes (so a slow tool reveals progressively in the UI).
  (`src/stores/ChatStore.ts`)
- **`EditorialMessage` simplified.** Dropped the `role === 'tool'`
  branch and the calls-only suppression hack that hid the redundant
  kicker. Now renders one assistant frame per round: kicker → markdown
  body → tool calls + their results inline, paired by id. The
  "Memory · Saved …" line appears below the model's prose, under its
  own kicker, where it belongs. (`src/components/editorial/EditorialMessage.tsx`)
- **`ToolCallRender` now takes `ToolResult` directly** instead of a
  `ToolMessage`. Variants are unchanged in look — `whisper`, `dot`,
  `aside`, `mark`, `hidden` — just bound to a cleaner data type.
- **`SummaryStore` transcript renderer updated.** Indents `[tool name
  → result]` under the assistant line that produced it, so the
  summarizer correctly attributes tool activity rather than treating
  it as a separate speaker.

## 2026-04-23 — Memory v2: unified `memory` tool + cross-thread summaries + Profile UI

Memory caught up to what the leading labs do. Three structural changes:
the `add_memory` tool became the broader `memory` tool with `add | remove |
update | list` actions; a new `SummaryStore` writes one-line digests of
idle threads in the background (using the cheapest fast model that's
configured); and the Profile section now actually lets you see and edit
what the assistant remembers.

- **Unified `memory` tool replaces `add_memory`.** One tool, four verbs
  (`action: 'add' | 'remove' | 'update' | 'list'`), mirroring OpenAI's `bio`
  pattern. Concentrating verbs into one tool keeps the catalog small as we
  add more domains and gives the model a single mental address for "the
  memory thing." `remove` and `update` accept either an `index` (from
  `list`) or a substring `fact` to match. (`src/services/tools/memory.ts`)
- **`UserProfileStore.facts` getter + full CRUD.** Bio is still stored as a
  newline-separated string (one fact per line, optional `· ` prefix) but is
  now exposed as a parsed array via `facts`. New actions: `addFact`,
  `removeFactAt`, `removeFactMatching`, `updateFactAt`, `updateFactMatching`,
  `clearFacts`. `addFact` is case-insensitive-deduped so the model's
  occasional re-fires don't grow the bio.
- **`SummaryStore` — lazy cross-thread digests.** A `setInterval`-driven
  scheduler that scans threads every 15s and picks the most-recently-touched
  one that meets the criteria (≥ 4 messages, not the active thread,
  either no summary or ≥ 4 new messages since the last one) — but only
  fires when the user has been idle for ≥ 60s. Mirrors what ChatGPT
  appears to do: lazy, debounced, off the hot path. (`src/stores/SummaryStore.ts`)
- **Cheap-fast summarizer routing.** Tries `gemini-3-flash` →
  `gpt-5.4-nano` → `gpt-5.4-mini` → `groq-llama-3.1-8b` →
  `claude-haiku-4.5` → `or-gpt-5.4-mini`, falls back to the thread's own
  model if none of those are configured. 120-token cap, single-sentence
  instruction. Tool messages in the transcript are flattened to
  `[tool name → result]` lines so summaries can reference saved memories.
- **Cross-thread awareness in every system prompt.** `composeSystemPrompt`
  now accepts `{ threadContext, recentSummaries }`. Recent summaries land
  under `## Recent conversations:` between the bio and the per-thread
  context. Capped at 15 entries, sorted by `summaryUpdatedAt` desc,
  excludes the active thread (since it's already in full context).
  ChatStore wires the source via a late-bound provider so tests stay
  isolated.
- **Implicit-save nudge.** When any memory context exists (bio non-empty
  or recent summaries available), the system prompt is suffixed with a
  short instruction reminding the model to use the `memory` tool
  proactively for durable facts. Mirrors how ChatGPT's hidden prompt
  nudges its `bio` tool.
- **Thread fields for summary tracking.** `Thread.summary?: string`,
  `summaryUpdatedAt?: number`, `summaryMessageCount?: number`. All
  optional so existing snapshots round-trip. The message-count field is
  the staleness lever — re-summarize only when the thread has grown by
  ≥ 4 messages since the last write.
- **Profile section is now the home for memory.** Account info, an
  editable list of bio facts (add/edit/delete inline + clear-all), and
  a read-only list of recent thread summaries with timestamps. The Agent
  section's old bio textarea is gone (one source of truth) and its tool
  list now reflects what's actually wired (`memory · live`, others
  `planned`, no toggles since "all tools always on" is the design).
- **Tests.** Test suite up to **56 passing.** New coverage:
  `tests/stores/toolLoop.test.ts` exercises every memory action through
  the scripted-provider tool loop; `tests/stores/SummaryStore.test.ts`
  covers the trigger gate (too-few-messages skip, basic generation, no
  re-summarize until threshold), and `recentSummariesExcluding`
  behavior. The existing toolLoop tests were updated for the new
  `memory` tool name and `composeSystemPrompt({ ... })` shape.

## 2026-04-23 — Tool calling (add_memory) + per-thread context

The model can now persist things you tell it. First tool: `add_memory`. Works
across every direct provider — OpenAI, Anthropic, Gemini — and through
OpenRouter for everything else. Architecture is set up to add more tools by
dropping a file in `src/services/tools/` and registering it.

- **Discriminated `Message` union by `role`.** Added `'tool'` as a third
  message kind alongside `'user'` and `'assistant'`. Existing stored messages
  already have valid `role` values so no migration is needed — they just
  become two of three union members. Assistant messages can now carry an
  optional `toolCalls: ToolCall[]`. (`src/core/types.ts`)
- **`Thread.threadContext?: string`.** Per-thread context that's appended to
  the system prompt under `## About this conversation:`. No editor UI yet —
  written by the model (eventually) and exposed via `chat.setThreadContext()`
  for programmatic use. Persists with the thread snapshot.
- **`composeSystemPrompt` reorganized.** Now follows the same structure
  every leading product uses (ChatGPT Custom Instructions / Claude Project
  Instructions / Gemini Gems): behavior first → about-the-user (bio) →
  about-this-conversation (threadContext). Each section omitted when empty.
- **Tool registry.** `services/tools/registry.ts` is a singleton that holds
  every registered tool. `add_memory` registers itself. `LlmRequest.tools`
  carries the def list to providers; tool definitions use a small JSON-Schema
  subset.
- **`add_memory` tool.** Mutates `UserProfileStore.bio` via a new
  `appendBioFact()` action that prepends `· <fact>` so the newest memories
  are most prominent. Description steers the model toward durable facts and
  away from passing context. 500-char per-fact cap. Returns a confirmation
  the model sees on its next round so it can acknowledge the save in its
  reply. (`src/services/tools/addMemory.ts`)
- **Tool execution loop in `ChatStore`.** A user turn is no longer one
  round trip — `runTurn` cycles through model→tools→model rounds until the
  model produces a round with no tool calls. Each round writes into a fresh
  assistant message, so multi-turn tool use renders inline as
  `assistant(text + tool_call) → tool(result) → assistant(final reply)`. Hard
  cap of 6 rounds prevents runaway loops if a model misbehaves.
- **Provider adapters carry tools.** All four shapes implemented per their
  native conventions:
    - OpenAI/compat (OpenRouter, Groq, local): `tools: [{ type: 'function', function: {...} }]`,
      streamed `delta.tool_calls[]` accumulated by index, `tool_call_id` echoed
      on `role: 'tool'` results.
    - Anthropic: `tools: [{ name, description, input_schema }]`,
      `content_block_start (tool_use)` + `input_json_delta` accumulated until
      `content_block_stop`, results sent as `tool_result` blocks under a `user`
      role per Anthropic's convention (adjacent results merged into one user
      message).
    - Gemini: `tools: [{ functionDeclarations: [...] }]`, `parts[].functionCall`
      arrives pre-parsed (Google does the JSON assembly server-side), results
      go back as `parts[].functionResponse: { name, response: { result } }`.
- **`LlmChunk` union grows by one variant.** New `{ type: 'tool_call', call }`
  for fully-buffered tool calls (we don't surface argument-deltas to the
  store/UI — keeps the contract small and matches how tool JSON arrives in
  practice). `finishReason` gains `'tool_use'`.
- **Inline tool UI.** Tool-call badges render below the assistant message
  that called them (compact mono row: `↳ add_memory(fact: "…")`). Tool
  results render as a near-invisible mono row between assistant messages
  (`· add_memory → "Saved to memory: …"`). No menu sections, no toggles,
  just visual transparency in the conversation flow.
- **No tool toggles.** Per the user's call: tools are always-on. Adding more
  tools later means dropping a file in `services/tools/` and one
  `toolRegistry.register()` line — no UI plumbing.
- **Tests.** Seven new tests covering the tool loop happy path, multi-round
  message-history shape, threadContext composition, the round cap, and the
  `composeSystemPrompt` ordering / `appendBioFact` formatting. 49 tests pass.

## 2026-04-23 — Per-thread streaming, interrupt-and-send, better thinking state

Made the chat actually behave like a chat. Previously, switching threads or
tabs aborted the in-flight reply and partial messages just sat there mute.
And — embarrassingly — text was *technically* streaming on the wire but
appearing to land all at once because the leaf message component had been
un-`observer`'d in a recent refactor.

- **Streaming actually streams again.** Re-wrapped
  `EditorialMessage` in `observer`. Without this, `message.content`
  mutations during streaming weren't being tracked at the leaf, so the
  parent only re-rendered on length/id changes — making the assistant's
  reply appear to land in one chunk on `done`. One-line regression, immediate
  fix. (`src/components/editorial/EditorialMessage.tsx`)
- **Per-thread streams.** `ChatStore` now tracks
  `streamingByThread: Record<threadId, messageId>` and
  `controllersByThread: Map<threadId, AbortController>`. The old
  single `streamingMessageId` field is now a derived getter that reads
  the active thread's slot — preserves the existing UI contract.
  Switching threads no longer aborts the reply on the previous one, so
  you can fire off a long prompt, jump to another conversation, and
  come back to a finished message.
- **Sidebar streaming dot.** Each sidebar thread row shows a small
  pulsing accent dot while a reply is in flight on that thread, so you
  always know which conversations are still cooking.
- **Send-while-streaming = interrupt + send.** If the active thread is
  streaming and the user types + hits enter (or clicks send), the
  in-flight reply is aborted, the partial assistant message is annotated
  `*[interrupted]*` (or replaced with `*[no response]*` if the model hadn't
  yielded a single token yet), and the new turn starts immediately. The
  composer's right-side hint flips to `↵ to interrupt` while text is in the
  draft and a stream is running.
- **Stop control.** When streaming with an empty composer, the send
  button morphs into a compact stop square. As soon as the user starts
  typing, it swaps back to the regular send button (which is now the
  interrupt-and-send affordance).
- **Better thinking indicator.** Pre-token state used to be three small
  dim dots with no label. Now: an uppercase mono `THINKING` kicker (in
  the accent color) followed by larger, brighter pulsing dots with a
  faint accent glow. Reads as part of the typographic system, matches
  the role kicker style above it, and is much more visible.
- **Tests.** Replaced the now-incorrect "selectThread aborts the stream"
  test with three new ones: switching threads keeps the stream going,
  interrupt-and-send produces a 4-message sequence with the partial
  annotated, and a zero-token interrupt yields the `*[no response]*`
  placeholder. 42/42 passing.

Architecture stayed honest. `streamingByThread` is a plain `Record`
(not an `observable.map`) so `makeAutoObservable` can deep-convert it
cleanly — initial attempts using `observable.map` silently broke
persistence because MobX double-wrapped the field. Lesson: when in doubt
with `makeAutoObservable`, use plain JS containers and let MobX wrap them.

## 2026-04-23 — Memory wiring + context meter + equal voices

Three small, compounding wins.

- **Equal message font sizes.** User and assistant both render at 16px Source
  Serif 4 — same family, same size. Role distinction now lives in the kicker
  (color-coded `YOU` vs `CLAUDE SONNET 4.6`) instead of size + family swap.
  One file: `src/components/editorial/EditorialMessage.tsx`.
- **Live context-window meter.** Replaced the static
  `↵ send · ⇧↵ newline` hint under the composer with a real-time bar showing
  `tokensUsed / contextWindow` for the active thread, including the unsent
  draft. Color shifts amber at 75%, red at 90%. New `core/tokens.ts` (heuristic
  4-chars-per-token estimator + per-provider window defaults), new
  `ChatStore.tokenUsage(draft)` getter, new `ContextMeter` co-located in
  `EditorialComposer`.
- **System prompt + user bio (memory wiring).** The `LlmRequest.systemPrompt`
  contract that's been declared since Phase 2 is now actually populated.
  - **`UserProfileStore`** (`src/stores/UserProfileStore.ts`): owns
    `bio` and `defaultSystemPrompt`. Persisted to `gatesai.profile.v1`,
    independent of chat history so wiping conversations doesn't wipe memory.
    Exposes `composeSystemPrompt(threadOverride?)` which merges the two into
    the final string sent to the provider.
  - **`ChatStore.sendMessage`** now calls `profile.composeSystemPrompt()` and
    sets `request.systemPrompt` when non-empty.
  - **Agent menu section** rewritten as the single home for AI behavior:
    Instructions textarea (system prompt) and Memory textarea (bio) at the
    top, both wired live to the store. The old hard-coded "47 facts" theatrical
    UI is gone. The Tools section is dimmed and labeled "coming soon" until
    the tool runtime lands. `add_memory` is in the tools list as a teaser for
    the eventual model-driven memory writes.
  - **Profile section** demoted to account-only (name, plan, sessions). A
    note at the top points users to **Agent** for instructions/memory so the
    settings tree stays self-explanatory.

`tsc -b`, `vitest run` (40 tests), and `eslint .` all green. The 8 remaining
lint warnings are pre-existing fast-refresh advisories on co-located helper
components in `ModelPopover.tsx`, `Api.tsx`, and `core/icons.tsx`.

## 2026-04-23 — Live OpenRouter model catalog

Wired the model picker to OpenRouter's live `/api/v1/models` so users see the
real, current set of routable models (~350 on launch day) instead of just the
17 we hand-picked.

- **`Model` type**: gained optional `description`, `contextLength`,
  `pricing: { prompt, completion }` (USD per 1M tokens), and a `dynamic: true`
  marker that distinguishes runtime-fetched entries from the curated list.
- **New `ModelRegistry` store** (`src/stores/ModelRegistry.ts`): single source
  of truth that merges curated + dynamic entries, dedupes by
  `(providerId, providerModelId)` (dynamic wins on overlap), and exposes
  `findById`, `byProvider`, `byVendor`. Replaces the now-deleted helpers in
  `core/models.ts`. The router and every UI surface read from the registry,
  so a refreshed catalog flows everywhere through MobX without manual fan-out.
- **`OpenRouterStore`** (`src/stores/OpenRouterStore.ts`): owns
  `models`, `fetchedAt`, `fetching`, `fetchError`, plus `refresh()` and
  `clearCache()`. Hydrates from `gatesai.openrouter.catalog.v1` on boot, never
  auto-refreshes (explicit user action only).
- **Catalog fetcher** (`src/services/llm/openrouterCatalog.ts`): pulls the
  `/api/v1/models` endpoint, filters out non-text outputs (audio, image,
  embeddings) so the picker stays usable, namespaces ids as `or-live-<slug>`
  to avoid collisions, infers vendors from the slug prefix, and converts
  pricing from per-token strings to USD-per-1M-tokens.
- **API panel**: the OpenRouter card now shows
  *"N models · last refreshed Apr 23, 11:42"* with a `Refresh` /
  `Load models` button, error inline, and a `Clear` button that wipes the
  cache and registry slice in one shot.
- **Model popover**: now reads from the registry. Dynamic entries are grouped
  under a separate "OPENROUTER CATALOG · LIVE" heading at the bottom; their
  tag line shows context length and prompt/completion pricing instead of the
  hand-written one-liners we keep for curated models. Curated `or-*` entries
  are auto-hidden when a dynamic duplicate is present.
- **Tests**: added `openrouterCatalog`, `openrouterCache`, and `OpenRouterStore`
  suites; updated `LlmRouter` and `ChatStore` tests to inject a registry.
  39/39 green, 0 lint errors.

## 2026-04-23 — Gemini 3 catalog refresh + model picker restyle

- **Gemini**: replaced the stale 2.5 Pro / 2.5 Flash entries with the current
  Gemini 3 series. Direct Gemini API now exposes `gemini-3.1-pro`
  (`gemini-3.1-pro-preview` — note the original `gemini-3-pro-preview` was
  shut down 2026-03-09 and now resolves to 3.1), `gemini-3-flash`
  (`gemini-3-flash-preview`), `gemini-3.1-flash-image`
  (`gemini-3.1-flash-image-preview`, aka Nano Banana 2), and the still-
  production `gemini-2.5-flash-lite`. The OpenRouter Gemini entry was
  re-pointed to `google/gemini-3-pro-preview`.
- Refreshed `ModelPopover` `META` with new tags / capabilities / star flags
  for the Gemini 3 line, plus filled-in entries for the rest of the catalog
  (Anthropic 4.5–4.7, GPT-5.4 family, Groq GPT-OSS, OR Gemini 3 Pro).
- Updated demo references in `Agent.tsx`, `Usage.tsx`, and `seed.ts` to use
  the new Gemini ids.
- **Restyled the model popover to match the editorial theme.** Dropped the
  glassmorphic `--palette-*` tokens, big shadows, and 12px radius — the
  popover now uses solid `var(--panel)` with a 1px `var(--border)` outline,
  2px corners, and an accent left-bar for the selected row (mirroring the
  sidebar). Section labels are uppercase Geist Mono with 0.12em tracking,
  and the per-model tag line is rendered in italic Source Serif 4 to echo
  the sidebar previews. No more visual mismatch with the rest of the app.

## 2026-04-22 — Model catalog audit

Verified every `providerModelId` against live provider docs and OpenRouter's
`/api/v1/models` response (348 models on 2026-04-22). Findings + fixes:

- **Anthropic**: API uses dashes, not dots. Replaced stale `claude-sonnet-4-5`,
  `claude-opus-4`, `claude-haiku-4` with the current generation:
  `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-opus-4-6`,
  `claude-haiku-4-5`, plus stable `claude-sonnet-4-5`.
- **OpenAI**: added the current GPT-5.4 line (`gpt-5.4`, `gpt-5.4-pro`,
  `gpt-5.4-mini`, `gpt-5.4-nano`); kept `gpt-5` for back-compat. Removed
  `o3` (superseded by GPT-5.4 with `reasoning.effort`).
- **Groq**: removed `mixtral-8x7b-32768` (deprecated 2025-03-20). Added
  the current production menu: `llama-3.1-8b-instant`,
  `openai/gpt-oss-120b`, `openai/gpt-oss-20b`. Kept `llama-3.3-70b-versatile`.
- **Gemini**: kept `gemini-2.5-pro` / `gemini-2.5-flash`, added
  `gemini-2.5-flash-lite`. (Gemini 3.x is still preview-only.)
- **OpenRouter**: dropped the bogus `qwen/qwen-3-235b` slug. Expanded from
  3 → 17 curated entries covering frontier (Claude 4.7, GPT-5.4, Gemini 2.5
  Pro), xAI (Grok 4.20, Grok 4 Fast, Grok Code Fast), open weights (Llama 4
  Maverick/Scout, DeepSeek V3.2 + R1, Qwen3 Max + VL 235B, Kimi K2.6, Mistral
  Large 3 + Medium 3.1), and search (Perplexity Sonar Pro + Reasoning Pro).
- `DEFAULT_MODEL_ID` updated to `claude-sonnet-4.6`.
- `ModelPopover` META, `Usage`, `Agent`, and seed threads all refreshed to
  reference the new ids.
- Pre-existing `react-hooks/set-state-in-effect` lint error in
  `ModelPopover` fixed as a bonus — `setActiveIdx(0)` now happens in the
  search input's `onChange` handler instead of a `useEffect`.

## 2026-04-22 — Model picker overhaul

- Rebuilt `components/editorial/ModelPopover.tsx` as a richer, search-first
  command-palette-style picker while preserving all theme tokens
- New affordances: live filter, keyboard navigation (↑/↓/↵/esc), vendor
  grouping with brand glyphs, model descriptions, capability badges
  (vision / reasoning / fast / tools), price-tier `$` indicators, and a
  recommended `★` flag
- Local-only `META` map in `ModelPopover.tsx` powers descriptions/capabilities;
  no changes to `core/models.ts` so thread-persisted `modelId`s stay stable
- Selected model now shows an accent rail on the left edge instead of a tinted
  background — reads better on every accent palette

## 2026-04-22 — Phase 4: tests + CI gates

- Added Vitest in a top-level `tests/` folder, fully separate from `src/`
- 26 tests across 5 files: `ChatStore`, `ProviderStore`, `persistence`,
  `services/router`, `services/llm/router`
- `tests/helpers/mockProvider.ts` implements the `LlmProvider` contract for
  deterministic store tests
- New scripts: `npm run typecheck`, `npm run test`, `npm run test:watch`,
  `npm run ci` (typecheck → lint → test)
- ESLint config split into `src/` and `tests/` blocks; tests get node globals
- New `tsconfig.test.json` with `vitest/globals + node + vite/client` types

## 2026-04-22 — Phase 3: hash router

- Added `services/router.ts` — pure `parseHash` / `formatHash` + side-effecting
  `read/write/subscribeRoute`
- Added `stores/RouterStore.ts` — observable two-way binding to
  `window.location.hash`
- `RootStore` now wires the router to `ChatStore.activeThreadId` so deep
  links and back/forward buttons work
- `App` reads `router.isMenu` instead of `ui.menuOpen`
- `EditorialSidebar` clicks now navigate via `router.goThread` / `router.goMenu`
- Removed `menuOpen`, `menuSection`, and the `open/close/toggleMenu` API from
  `UiStore` — surface routing is fully owned by `RouterStore`
- Routes: `#/`, `#/thread/<id>`, `#/menu/<section>`

## 2026-04-22 — Phase 2: LLM provider abstraction

- Added `core/llm.ts` — provider-agnostic contract (`LlmProvider`,
  `LlmRequest`, `LlmChunk`, `ProviderId`, `ProviderConfig`)
- Added `core/providers.ts` — `PROVIDERS` info table for the API menu
- Expanded `core/models.ts` — every `Model` now declares its `providerId`
  and `providerModelId`; added v1 catalog entries for Anthropic, OpenAI,
  Google, Groq, OpenRouter, and Local
- Added `services/llm/`:
  - `sse.ts` — minimal SSE parser shared by all HTTP providers
  - `openaiCompat.ts` — base class for OpenAI-shaped `/chat/completions`
  - `openai.ts`, `groq.ts`, `openrouter.ts`, `local.ts` — thin wrappers
  - `anthropic.ts`, `gemini.ts` — bespoke request/response shapes
  - `fake.ts` — offline canned responder (always ready)
  - `router.ts` — `LlmRouter.resolve(modelId)` with fake fallback
  - `index.ts` barrel
- Added `services/providerStorage.ts` — `gatesai.providers.v1` localStorage
- Added `stores/ProviderStore.ts` — owns API keys + the long-lived `LlmRouter`
- `ChatStore.sendMessage` rewritten to use `for await ... of stream` with
  `AbortController`. New `lastError` field surfaces provider failures.
- `ApiSection` is fully wired: paste a key, see the provider connect; reveal,
  rotate, remove. Includes external "Get a key" links per provider.
- Removed the old callback-based `services/fakeLlm.ts` (replaced by
  `services/llm/fake.ts` which implements the same `LlmProvider` interface)

## 2026-04-22 — Phase 1: UI primitives

Extracted recurring inline-style patterns into a dedicated design-system layer.

### Added
- `src/components/ui/` — `Toggle`, `Pill`, `Card`, `Button`, `Input`, `Select`,
  `Textarea`, `SettingsRow`, `SegmentedControl`, plus an `index.ts` barrel
- `src/core/styleTokens.ts` — typography & layout tokens that don't have a
  natural component shape (`h1`, `kicker`, `section`, `sectionTitle`, `mono`,
  `number`, `numberLabel`)

### Changed
- All six menu sections (`Profile`, `Agent`, `Settings`, `Usage`, `Api`,
  `Appearance`) migrated from `menuStyles` + `MenuRow` + `MenuToggle` to the
  new primitives. UI is pixel-identical.
- `Button` got a `variant` API (`default | accent | danger`)
- `Pill` got a `tone` API (`accent | muted`)
- `SegmentedControl` is now a proper generic component (was inline JSX in
  three places)

### Removed
- `src/components/menu/shared.tsx` — fully replaced

### Architecture
- New layer rule: `components/ui/` may only import from `core/` — no stores,
  no features. Feature folders (`editorial/`, `menu/`) compose primitives.

---

## 2026-04-22 — Cleanup & restructure

Full refactor to TypeScript, MobX object models, and a clean three-layer
architecture. UI is pixel-identical to the previous build.

### Removed (dead code)
- Root: `browser-window.jsx`, `design-canvas.jsx`, `GatesAI.html`,
  `Personal AI.html`, `Personal AI Editorial.html`, `uploads/`
- `src/`: `app.jsx`, `composer.jsx`, `sidebar.jsx`, `palette.jsx`,
  `tools.jsx`, `tweaks.jsx`, `message.jsx`, `data.jsx` (split + trimmed),
  `chat-variant.jsx` (split, terminal/workbench variants dropped),
  `gates-menu.jsx` (split, three unused layouts dropped),
  `store.js`, `fake-llm.js`, `icons.jsx`, `variants.jsx`
- `src/assets/` (unused Vite template assets)

### Added
- `src/core/` — `types.ts`, `models.ts`, `theme.ts`, `seed.ts`, `icons.tsx`
- `src/services/` — `persistence.ts`, `fakeLlm.ts`
- `src/stores/` — `ChatStore.ts`, `UiStore.ts`, `RootStore.ts`, `context.tsx`
- `src/components/editorial/` — sidebar, chat panel, message, composer, etc.
- `src/components/menu/` — menu shell + six sections
- `src/app/App.tsx` — composition root
- `docs/` — this folder

### Dependencies
- Added `mobx`, `mobx-react-lite`
- Replaced hand-rolled `useSyncExternalStore` store with MobX object models

### Behavior changes
- Only the Editorial variant ships (Terminal/Workbench were never wired in)
- GatesMenu uses only the `topTabs` layout (the active one)
- `localStorage` key is unchanged (`gatesai.state.v1`), so existing user
  state survives the refactor
