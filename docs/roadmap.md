# Roadmap

## Handoff plan — Now / Next / Later (2026-07-05)

Current focus: **open-source / product readiness**. The app itself is deep
(997 unit + 20 e2e tests, CI, releases at v4.5.0); what's missing is the
public-facing shell around it. Each task below is sized for one working
session by an agent with no prior context (read `docs/architecture.md` and
root `CLAUDE.md` first) and has explicit acceptance criteria. Do not modify
sibling repos (`../gatesai-bridge` etc.) from this repo's sessions.

### Now

- [ ] [ETHAN] **Decide and execute repo visibility.** The source repo
      (`Calculator5329/GatesAI-Chat`) is private; releases publish to the
      separate public `GatesAI-Chat-releases` repo (see comment in
      `.github/workflows/release.yml`). Either flip the source repo public or
      write an ADR in `docs/` saying why the split stays.
      *Acceptance:* before flipping, scan full git history for secrets
      (e.g. `gitleaks detect` or `git log -p` grep for `sk-`, `key=`, tokens)
      and record the result; after flipping, README release/download links and
      the Pages demo still resolve; if keeping split, ADR committed instead.
- [ ] **Demo GIF at the top of the README.** Record a 20–40s loop: ask a
      question → model streams → a tool runs (e.g. `fs` or `web_search`) →
      activity timeline shows it. `npm run screens:tour` and
      `scripts/screens-tour.mjs` show how to drive the app scripted; a screen
      recorder + gif conversion is fine too.
      *Acceptance:* `docs/user-guide-assets/demo.gif` (< 10 MB) embedded above
      the fold in `README.md`; renders on GitHub.
- [x] **README truth pass.** *(done 2026-07-10)* Fix the Memory bullet that still claims "no
      embeddings/RAG" (RAG shipped in Wave F: `src/services/rag/`, `recall`
      tool); re-verify every command, link, badge, and the tool list against
      the tree; confirm test counts with `npx vitest list ... | wc -l` and
      `npx playwright test --list`.
      *Acceptance:* no statement in README contradicts the code; counts match
      reality on the day of the pass.
- [x] **CONTRIBUTING.md.** *(done 2026-07-10)* Setup (Node, Rust, Go/bridge), the quality gates
      (`npm run ci`, `npm run test:e2e`, `cargo test`), the layer rules in one
      table (link `docs/architecture.md`), how to add a tool/store/component,
      PR expectations, and the AGPL-3.0 contribution terms.
      *Acceptance:* file exists at repo root, linked from README; a newcomer
      can go from clone to green `npm run ci` using only it.
- [ ] **Dependency audit.** Run `npm audit` and `cargo audit`
      (install `cargo-audit` if absent) — fix or explicitly waive findings.
      *Acceptance:* zero high/critical advisories, or each remaining one
      documented with justification in the PR/commit message; `npm run ci`
      still green.
- [x] **Repo hygiene sweep.** *(done 2026-07-10)* Remove or ignore root scratch files
      (`debug.log`, `vite-5182.*.log`, `.codex-vite-*.log`, `.codex-tasks/`
      leftovers), retire `.env.firebase` (only sets `VITE_GATESAI_WEB=1`; fold
      into the build script or rename to something honest), prune dead
      `.firebase/` and `.cursor/` if untracked/unused.
      *Acceptance:* fresh clone root contains only purposeful files;
      `.gitignore` covers the scratch patterns; nothing tracked was deleted
      without checking `git ls-files` first.

### Next

- [x] **Flaky-test sweep.** *(done 2026-07-10)* Run the unit suite 5× and the e2e suite 3× in a
      row (`npm test`, `npm run test:e2e`); record any test that fails
      non-deterministically, fix or quarantine it with a linked issue/note in
      this file. *Acceptance:* 3 consecutive fully-green runs of both suites;
      a short report of what was flaky and what changed.
      *Report: 5×995-unit + 3×20-e2e consecutive runs on Linux, all exit 0 —
      zero non-deterministic failures observed; nothing to fix or quarantine.*
- [x] **Windows e2e job in CI + Playwright traces.** *(done 2026-07-10)* Add a windows-latest e2e
      job to `.github/workflows/ci.yml` and upload traces on failure (backlog
      item). *Acceptance:* CI green with the new job; a forced failure shows a
      downloadable trace artifact.
- [ ] [ETHAN] **Signed / trusted release builds.** Investigate Windows code signing
      (paid cert vs Azure Trusted Signing vs documented-unsigned) and at
      minimum add a README note about the SmartScreen warning and checksums
      (`SHA256SUMS` published per release). *Acceptance:* release workflow
      emits checksums; decision on signing recorded in an ADR under `docs/`.
- [x] **Release checklist doc.** *(done 2026-07-10)* One page in `docs/`: version bumps
      (`package.json` + `src-tauri/tauri.conf.json`), changelog entry, tag
      push, asset verification, Web Lite check. *Acceptance:* the next release
      is cut following only the checklist.
- [ ] **Bridge protocol version handshake.** App sends/expects a protocol
      version on WebSocket connect; mismatch surfaces a clear BridgeStore
      error state instead of quiet failures. Coordinate the bridge half as a
      separate task in `../gatesai-bridge` (do not edit it from here).
      *Acceptance:* unit tests for the app-side handshake; graceful degraded
      message on mismatch.
- [ ] **macOS build.** Keyring is already apple-native-capable; needs a
      macos-latest job, sidecar naming for the darwin triple, and (later)
      signing/notarization. *Acceptance:* an unsigned .dmg/.app artifact
      builds in CI even if not yet published.

### Later

- [ ] Opt-in auto-updater (signed, OFF by default) — after signing lands.
- [ ] Portable mode (zip, data beside exe).
- [ ] Agent eval harness — see `docs/IDEAS.md` #1; promotes to Next once the
      open-source track is done.
- [ ] Cowork mode (designed, see Moonshots below) — its own wave when picked.
- [ ] Content-parts message model unification (pre-req for several ideas).
- [ ] LAN companion / phone access (bridge serves Web Lite with pairing code).

---

## Done
- [x] Clean up dead code, root HTML mockups, and unused assets
- [x] Convert codebase to TypeScript
- [x] Introduce MobX object model (ChatStore / UiStore / RootStore)
- [x] Split monolithic `chat-variant.jsx` and `gates-menu.jsx` into
      small, focused components
- [x] Document architecture, changelog, roadmap
- [x] **Phase 1**: extract `components/ui/` design-system primitives
- [x] **Phase 2**: `LlmProvider` interface + simplified foundation router
      (OpenRouter cloud chat, Ollama local chat, local-image direct ComfyUI)
- [x] **Phase 3**: tiny hash router (`#/thread/<id>`, `#/menu/<section>`)
- [x] **Phase 4**: Vitest suite under top-level `tests/` + lint + typecheck CI
- [x] **Phase 5**: Live OpenRouter catalog (`ModelRegistry` + `OpenRouterStore`,
      registry-backed model picker with pricing, API panel refresh button)
- [x] Add minimalist Ctrl/Cmd-click copy gesture to chat messages
- [x] Local-only `git` tool for status, diff, add, commit, and branch work
- [x] Add hybrid markdown/code Appearance tweaker with persisted presets
- [x] Add `inspect_file` tool for compact CSV, JSON, and text inspection
- [x] Smooth active assistant streaming with batched text updates and incremental markdown rendering
- [x] Add Windows double-click launcher for chat + bridge
- [x] Inject runtime time, timezone, and harness context into every turn
- [x] Make `inspect_file` encoding-tolerant and add artifact-first query workflows
- [x] Start architecture boundary cleanup: move icons out of `core/`, replace
      service-to-store type imports with facades, and add staged import rules
- [x] Extract shared tool-call rendering to `components/ui/`
- [x] File attachments in the composer via the bridge workspace
- [x] Move attachment upload behind a `BridgeStore` facade and promote UI
      service-import boundaries to lint errors
- [x] Extract ChatStore runtime context and tool
      failure logging helpers into focused services
- [x] Multimodal cleanup (structured tool artifacts, facade-only bridge
      service, shared `SecretKeyField`, unified image-backend types,
      `Api.tsx` split, composer upload action on `UiStore`, Routing card
      marked as Coming soon)
- [x] Local image-gen quality pass: SDXL Lightning hi-res workflow, sweep3
      model comparison script, picker manifest auto-detect, and LLM prompt
      enhancement controls
- [x] Local image-gen tuning pass: narrow FLUX.2/Z-Image winner sweep and
      Ultimate SD Upscale 2x benchmark mode
- [x] Prepare local image-gen finalization: SDXL quick draft lane, reusable
      final ComfyUI workflow templates, and winner selection script
- [x] Add FLUX.2 Klein FP8 wide recovery benchmark for final workflow selection
- [x] Ollama provider — local LLMs in the model picker via the Ollama runtime
      (native NDJSON `/api/chat`, catalog refresh, status pill, per-model
      `supportsTools` allowlist, global tool-calls toggle)
- [x] Add local image-generation size controls: named aspect ratios plus
      explicit pixel dimensions for ComfyUI
- [x] Add a dedicated Local menu for Ollama, ComfyUI, and local vision setup
      (auto-detect install paths, managed Start/Stop, live logs, ComfyUI CORS
      flags, local vision `describe_image` tool)
- [x] Add ComfyUI direct-image Draft / Normal / Upscale model choices plus
      FLUX.2 Klein hires-fix controls for offline local image generation
- [x] Add `image_generate` prompt-file batch mode for overnight queued local
      image runs
- [x] Trim unfinished integrations back to a manual-test foundation:
      OpenRouter, Ollama, ComfyUI, memory/notes/thread, and workspace tools
- [x] Add model-picker Favorites with relative cost labels and provider-grouped
      OpenRouter catalog organization
- [x] Remove unfinished HTML artifact and dead theme/header/send variant
      surfaces from the foundation
- [x] Retire the Appearance tab and keep the foundation presentation fixed at
      Aside tool calls, Compact markdown, Obsidian code, and animations on
- [x] Slim the settings menu to Agent, Models, Local, Workspace, Gallery, and
      Settings, with Profile folded into Agent and API renamed to Models
- [x] Add a `PersistenceProvider<T>` boundary around local storage slots so
      future IndexedDB / Firestore work can swap repositories without store
      rewrites
- [x] Add workspace-backed chat-history persistence with readable HTML/Markdown
      exports and a protected `chat_history` tool for model-side recall
- [x] Add Brave Search-backed `web_search`, a Models-menu key surface, and an
      HTML artifact helper for validated workspace deliverables
- [x] Centralize assistant activity display into a unified ambient timeline
      for thinking, tools, terminal tails, image jobs, and bridge transitions
- [x] Architecture-boundary hardening: make the ESLint import rules actually
      enforce UI→store→service direction (depth-agnostic globs, self-contained
      per-layer blocks), move runtime-mode detection into `core/runtime.ts`,
      add a `components/media/` home for shared image UI, add a
      `SourceWorkspaceStore` facade, and route remaining UI service imports
      through store facades
- [x] Project-showcase pass: recruiter-facing `README.md`, root decluttered
      (scratch notes relocated under `docs/notes/`), dead code removed
      (`core/modelMenu.ts`, unused persistence/context exports), and
      previously-silent store failures logged
- [x] Central logging + self-diagnosis: a `services/diagnostics/logger`
      (ring buffer + console + bridge-file sinks), a `logs` tool so the
      assistant can read its own logs, and a full `console.*` → logger migration
- [x] Maxed-out lint enforcement: `no-console`, `consistent-type-imports`,
      no `fetch` in stores, no `localStorage` in stores/UI, `import/no-cycle`,
      and `mobx/*-make-observable` correctness rules — with the surfaced
      violations refactored through services/facades
- [x] Sidebar body search across thread titles and message bodies, real
      persisted user-togglable model favorites, and a broad Playwright UI suite
      (faked-bridge desktop project + web-lite project, mocked OpenRouter stream)
- [x] Model picker redesign with runtime availability gating: a pure
      `core/modelPickerAvailability` decides which sources/models are usable
      (web-lite hides Local/Image; offline Ollama and not-ready ComfyUI are
      hidden, not shown-disabled), prominent live-verified catalog section,
      vision/tools/reasoning/fast/free capability chips, and a hardened
      direct-image path (ComfyUI-ready guard + forced local-comfy backend)
      with new picker/availability/guard tests
- [x] Web Lite persistence fix + UX pass: the `ChatStore` autosave reaction now
      deep-observes nested thread/message edits (in-place message appends and
      streamed tokens previously never triggered a save, losing fresh
      conversations on reload), plus a sidebar cleanup (single-line titles,
      wider nav, pin/trash icons, no preview line), an intuitive first-run
      onboarding panel, explicit Web Lite desktop-only states for Workspace and
      Gallery, and an API-key-forward Settings page

## Near-term
- [x] **Multimodal + image-gen, phased** — see `docs/plans/2026-04-26-multimodal-and-imagegen.md`
      - [x] Phase 1: Vision input (cloud + local), content-parts at the wire boundary
      - [x] Phase 2: Historical fal.ai cloud image generation; later removed from the foundation
      - [x] Phase 3: Local image-gen backend (ComfyUI) behind same `image_generate` tool
- [x] Add a verified default OpenRouter catalog for the current leading
      OpenAI, Anthropic, Gemini, Grok, Meta, NVIDIA Nemotron, DeepSeek, and
      Kimi models, with per-thread thinking effort controls and opt-in live
      compatibility tests.
- [x] **2026-07-02 delegated feature/refactor pipeline (waves A–C)**:
      - [x] CI hygiene: Rust tests in CI (windows-latest), single vitest config,
            portable `npm run ci`
      - [x] Ctrl/Cmd+K command palette (thread search + actions) and app
            keyboard shortcuts (Ctrl+N new thread, Ctrl+L composer, Ctrl+, menu)
      - [x] Versioned JSON export/import of all app data (merge/replace modes,
            secrets excluded and tested)
      - [x] API keys in the OS credential store on desktop (`keyring` crate,
            Windows Credential Manager) with Web Lite localStorage fallback and
            safe one-time migration
      - [x] `StreamingRoundExecutor` extracted from `ChatStore` with a unified
            abort envelope and transient-provider retry policy (backoff, never
            after user abort or first content)
      - [x] Message edit-and-resend, regenerate, and branch-from-message with
            inline destructive confirmations and a sidebar-clickability
            regression test
      - [x] Incremental streaming markdown chunking (append-only tail re-parse,
            stable chunk keys, seeded equivalence tests)
      - [x] Real usage/cost tracking: normalized per-message usage, per-thread /
            per-model / per-day selectors, and a live Usage menu section
      - [x] Persistence hardening: snapshot `schemaVersion` + migration
            registry, future-version backup keys, IndexedDB archive tier
            (20 hot threads, stubs + async hydration, write-order safety), and
            a proactive 3.5MB archive threshold
      - [x] MCP client support (streamable HTTP): server manager UI, dynamic
            `mcp_<server>_<tool>` registry tools with schema passthrough,
            32k result cap, header secrets via `secretStorage`
- [ ] Wave D refactor: `TurnRunner` extraction from ChatStore, shared LLM
      stream-parsing core (openaiCompat/ollama), `useEditorial()` store facade,
      message-list windowing, ModelPopover memo consolidation
- [ ] Manually test the foundation surface before rebuilding optional integrations
- [x] Add basic unit tests around `ChatStore` (send, stream, switch, stop) —
      covered by `tests/stores/ChatStore.test.ts` and the full Vitest suite
- [x] **Audit follow-ups** — see `docs/audits/2026-06-07-comprehensive-audit.md`
      - [x] Multi-tab localStorage warning banner + save pause on chat key conflict
      - [x] Chat-history protection across tool paths + mirror scope (Batch A)
      - [x] Image-job cancel serialization + stale turn finalization guards (C2/C4)
      - [x] Manual rename blocks auto-naming; summary scheduler respects background streams + deleted threads
      - [x] Per-thread composer draft and error banner scoping
      - [x] User-visible persistence quota / compaction notices
      - [x] Batch C–E: Models copy, context-aware banners, setup checklist, image UX polish, notes limits/quarantine, Web Lite clear reload
      - [x] Audit documentation: test coverage matrix + implementation guide (`docs/audits/2026-06-07-*.md`)

## Wave F — agentic capabilities (shipped 2026-07-03)
- [x] Local semantic memory (RAG): Ollama embeddings + IndexedDB vectors over
      chats/notes/memories, `recall` tool, optional auto-context injection
- [x] `fetch_page` tool: Rust-side reqwest fetch + readable-text extraction
      (https-only, private-IP blocked, size-capped) so the model can read pages
- [x] Skills packs: `workspace/skills/*.md` prompt packs with optional tool
      allowlists, composer picker, per-thread activation
- [x] Sub-agents v1: `spawn_task` tool running a scoped background TurnRunner
      loop (one concurrent, round-capped), status surface, results linked back

## Wave G — agentic depth (shipped 2026-07-05)
- [x] Sub-agents v2: multiple parallel tasks, model-customizable model/system
      prompt/delayed start per task
- [x] Screenshot tour harness: Playwright script capturing every screen/menu
      section (desktop-mocked + web-lite) into docs/screens/ for future audits
- [x] Self-improvement loop UI: diff review for source-workspace edits,
      build-output panel, install handoff, source-change context for the model
- [x] Scheduled tasks v1 (app-open scheduler + schedule_task tool)
- [x] MCP stdio transport (user-configured local server processes, Rust-managed)

## Wave I — daily-feel + loop depth (shipped 2026-07-06)
- [x] Light theme ("paper") with dark/light/system modes, contrast unit tests,
      and a committed light-theme screenshot set
- [x] Global summon shortcut (configurable, default Ctrl+Shift+Space), tray
      icon with toggle/new-conversation/quit, optional hide-to-tray
- [x] Self-improvement loop: test job (npm ci/test/typecheck/lint) in the
      source copy with streamed per-step status, edit→test→build agent
      guidance, soft stale-tests warning on Run build, test state in the
      model's runtime context

## Open-models-first audit (DONE 2026-07-05 — see docs/audits/2026-07-05-open-models-audit.md; Wave H shipped fixes)
- [x] *(verified already-done, 2026-07-10 truth pass — audit doc `docs/audits/2026-07-05-open-models-audit.md` exists; section header records Wave H shipped the fixes)* Walk EVERY screen with the lens "what do I do if I'm running open/local
      models only?" — the app currently reads API-first in many surfaces
      (model picker defaults, usage panel framing, onboarding order, error
      copy, thinking-effort controls that are OpenRouter-only, catalog
      language). Use the docs/screens/ corpus + user-story review per screen.

## Future ideas backlog (2026-07-03 analysis)

> Backlog / aspirational — not scheduled (truth pass 2026-07-10)

### UI/UX
- [x] Light theme + follow-system (`prefers-color-scheme`); "paper" palette *(verified already-done, 2026-07-10 truth pass — Wave I; dark/light/system `ThemeMode` in `src/components/menu/sections/Settings.tsx`)*
- [x] Sidebar date grouping (Today / Yesterday / Previous 7 days) *(done 2026-07-10, burndown w1 — `groupThreadsByDate` in `src/core/threadSelectors.ts`; sidebar history now splits under Today / Yesterday / Previous 7 days / Previous 30 days / by-month headers)*
- [ ] Inline thread rename (F2 / right-click) and drag-to-reorder pins
- [x] Global summon shortcut + tray icon (Tauri global shortcut) *(verified already-done, 2026-07-10 truth pass — Wave I; tray in `src-tauri/src/desktop.rs`)*
- [ ] Jump-to-bottom pill with new-tokens indicator; sticky date separators
- [ ] Composer: up-arrow recall, paste-image, window-wide drag-drop
- [x] Auto-collapse tool outputs over ~40 lines *(done 2026-07-10, burndown w2)*
- [ ] What's-new panel on version change
- [ ] Onboarding v2: bundled "tour" thread showing tools/artifacts/images

### Architecture
- [ ] Unify message model into content-parts (text/tool/image/artifact parts)
      — do before deep RAG indexing settles the schema
- [x] Split EditorialComposer (~840 lines) into Input/AttachmentTray/
      ModelControls/SendPipeline *(done 2026-07-10, burndown w11 — pure refactor;
      `EditorialComposer.tsx` is now a ~270-line orchestrator delegating to
      `components/editorial/composer/`: `ComposerInput`, `AttachmentTray`,
      `ComposerMeta` (model/skill pickers + context/thinking selects), `ContextMeter`,
      `ComposerBanners`, `SkillPopover`, the `useComposerDraft` send/draft pipeline,
      and shared `composerStyles`/`composerAttachments`. Public props unchanged;
      DOM/classes byte-identical so the existing unit+e2e suites stay green)*
- [ ] Bridge protocol doc + version handshake (fail loud on mismatch)
- [ ] Headless core entry (boot RootStore without React) → CLI mode, scripted
      smokes, scheduler runner
- [ ] Decide deliberately: Go bridge vs folding into a Rust sidecar

### Performance
- [ ] Cold-start budget (<1.5s to interactive): lazy menu sections, idle-time
      catalog hydration, audit source-snapshot resource cost in installer
- [ ] IDB background compaction; storage stats in Usage panel
- [ ] Rust release profile tuning (thin LTO, strip) for installer size
- [ ] Adaptive streaming reveal pacing (faster catch-up when far behind)

### State & data
- [ ] Web Locks API leader election for multi-tab (replace pause-on-conflict)
- [ ] Generalized undo (command pattern) for destructive ops
- [ ] Per-thread system-prompt presets (Coding / Writing / Research)

### Platforms & compatibility
- [ ] macOS build (keyring apple-native already enabled; needs signing)
- [ ] Opt-in Tauri auto-updater (signed, OFF by default)
- [ ] Portable mode (zip, data beside exe)
- [ ] LAN companion: bridge serves Web Lite on LAN with pairing code (phone
      access, data never leaves the network)

### Cloud (strictly opt-in; local-only remains the default)
- [ ] E2E-encrypted sync to user-owned storage (S3/Drive/WebDAV, user key)
- [ ] Share thread as single-file HTML

### Docs & stories
- [ ] Refresh handbook user stories for palette/onboarding/MCP/usage; retire
      delivered ones
- [ ] ADRs for standing decisions (bridge language, Firestore parked, updater)
- [ ] Refresh bundled in-app user guide
- [ ] Bridge protocol spec in docs/

### Tooling & release
- [ ] Changelog automation from commits; nightly channel from master
- [ ] Windows e2e job in CI; upload Playwright traces on failure; coverage
- [ ] Settings-only config profile export

### Moonshots / new directions
- [ ] **Cowork mode** (designed, not scheduled): the first *push* capability —
      opt-in per-folder file watching (Rust `notify`) that surfaces a
      dismissible SUGGESTION chip when a watched file changes ("new CSV — want a
      summary?"); one click spawns a background agent task with the file as
      context. Turns the app from "one you open" into "a coworker who's around,"
      composing with global summon + tray. Hard constraints: suggests, never
      auto-executes; watched-file CONTENTS are never treated as instructions
      (instruction-source boundary); rare + rate-limited + easy to mute; opt-in,
      off by default; fully local. Its own wave when picked.
- [ ] Duel mode: two models side-by-side or cross-reviewing
- [ ] Canvas/whiteboard artifact type for planning sessions
- [ ] In-app `ollama pull` with progress for missing local models
- [ ] Record the self-improvement demo (app edits itself, rebuilds, asks to
      update) once the loop closes

### Suggested release sequencing
- 4.2: semantic memory + fetch_page + sidebar QoL
- 4.3: sub-agents + scheduled tasks + light theme + global summon
- 5.0: self-improvement loop closed + macOS + opt-in updater + content-parts

## Later
- [ ] Multi-window / split-thread layouts
- [ ] Extend `inspect_file` to source-code structure (`py`, `js`, `ts`, `go`)
- [ ] Extend `inspect_file` to document formats (`pdf`, `docx`, `xlsx`)
