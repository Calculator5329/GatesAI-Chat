# Roadmap

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
- [x] Sidebar message previews (derived from messages) + body search, real
      persisted user-togglable model favorites, and a broad Playwright UI suite
      (faked-bridge desktop project + web-lite project, mocked OpenRouter stream)

## Near-term
- [x] **Multimodal + image-gen, phased** — see `docs/plans/2026-04-26-multimodal-and-imagegen.md`
      - [x] Phase 1: Vision input (cloud + local), content-parts at the wire boundary
      - [x] Phase 2: Historical fal.ai cloud image generation; later removed from the foundation
      - [x] Phase 3: Local image-gen backend (ComfyUI) behind same `image_generate` tool
- [x] Add a verified default OpenRouter catalog for the current leading
      OpenAI, Anthropic, Gemini, Grok, Meta, NVIDIA Nemotron, DeepSeek, and
      Kimi models, with per-thread thinking effort controls and opt-in live
      compatibility tests.
- [ ] Continue architecture cleanup: split large tools/components and keep
      slimming `ChatStore` where helpers can move out safely
- [ ] Manually test the foundation surface before rebuilding optional integrations
- [x] Add basic unit tests around `ChatStore` (send, stream, switch, stop) —
      covered by the Vitest suite (`tests/stores/ChatStore.test.ts`, 600+ tests)

## Later
- [ ] Multi-window / split-thread layouts
- [ ] Extend `inspect_file` to source-code structure (`py`, `js`, `ts`, `go`)
- [ ] Extend `inspect_file` to document formats (`pdf`, `docx`, `xlsx`)
