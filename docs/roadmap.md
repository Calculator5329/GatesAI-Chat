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
- [x] **Dependency audit.** *(done 2026-07-11 — npm: 10→0 via audit fix, ci green; cargo: quinn-proto RUSTSEC cleared, quick-xml pair pinned upstream by tauri — details + re-check plan in docs/audits/2026-07-11-dependency-audit.md)* Run `npm audit` and `cargo audit`
      (install `cargo-audit` if absent) — fix or explicitly waive findings.
      *Acceptance:* zero high/critical advisories, or each remaining one
      documented with justification in the PR/commit message; `npm run ci`
      still green. *(progress 2026-07-11: npm side DONE — audit fix cleared all 10 vulns, ci 1040 green; cargo side documented in docs/audits/2026-07-11-dependency-audit.md — 3 transitive RUSTSECs need targeted cargo update, ~20 unmaintained gtk3 warnings inherent to tauri v2 linux)*

- [x] **Repo hygiene sweep.** *(done 2026-07-10)* Remove or ignore root scratch files
      (`debug.log`, `vite-5182.*.log`, `.codex-vite-*.log`, `.codex-tasks/`
      leftovers), retire `.env.firebase` (only sets `VITE_GATESAI_WEB=1`; fold
      into the build script or rename to something honest), prune dead
      `.firebase/` and `.cursor/` if untracked/unused.
      *Acceptance:* fresh clone root contains only purposeful files;
      `.gitignore` covers the scratch patterns; nothing tracked was deleted
      without checking `git ls-files` first.

### Next

- [x] **Offline Library plugin consumer.** *(completed 2026-07-12;
      coordinated with `../local-ai-lab`)* Integrate the host-ready,
      loopback-only Offline Library as a swappable read-only addon. The work is
      ordered so UI/tool code never outruns the versioned safety contract:
  - [x] **G0 — ADR and shared contract fixture.** *(done 2026-07-12 —
        dedicated fixed-authority Tauri boundary accepted in
        `docs/adr/2026-07-12-offline-library-plugin.md`; sanitized host 1.3
        manifest/profile/benchmark fixtures pinned with contract tests)* Record the desktop proxy
        choice (dedicated Tauri command or bridge operation), loopback threat
        model, Web Lite degradation, plugin lifecycle, and citation contract.
        Import a sanitized API fixture only after local-ai-lab declares the
        benchmark/profile endpoints in its manifest and OpenAPI document.
  - [x] **G1 — typed service client and trusted proxy.** *(done 2026-07-12 —
        dedicated Rust commands own the exact `127.0.0.1:8892/api/v1`
        authority and fixed route/method set; typed TypeScript result states
        degrade without invoking transport in Web Lite; hostile aliases,
        bounds, redirects, content types, sizes, errors, and citation identity
        are covered in Rust/frontend tests)* Add a service-layer
        client for status, sources, search, public schemas, profiles, and
        benchmark summaries. Browser code must not fetch `127.0.0.1` directly;
        the desktop backend must allow only the fixed host/port/path set, bound
        response sizes, reject redirects, and preserve offline/error states.
  - [x] **G2 — plugin lifecycle and settings.** *(done 2026-07-12 — explicit
        default-off enablement persists locally; compatible manifest + health
        discovery exposes healthy/offline/incompatible/error states and
        declared read permissions; Web Lite stays disabled and makes zero
        transport calls)* Discover and validate the
        manifest, expose explicit enable/disable and health state, show declared
        read permissions, and remain disabled/unavailable in Web Lite with a
        clear desktop-only explanation. Do not add secrets or background cloud
        dependencies.
  - [x] **G3 — read-only model tools.** *(done 2026-07-12 — four knowledge
        tools are exposed only while the explicitly enabled addon is healthy;
        inputs and projected outputs are bounded, public-schema results exclude
        rows, benchmark summaries retain evidence and trust-proxy labels, and
        exact offline citation URIs are covered through tool execution,
        rendering, export/import, and persisted snapshots)* Register bounded tools for library
        search, source inventory, public database schemas, and benchmark/profile
        summaries with honest read-only metadata. Preserve `kiwix://`,
        `library://`, `man:`, and `db://` citations through tool results,
        messages, persistence, export, and rendering.
  - [x] **G4 — task-aware local profiles.** *(done 2026-07-12 — the host's
        evidence-linked schema/document recommendations load with lifecycle
        state; Settings shows model, retrieval, trials, confidence interval,
        citation-grounding proxy, latency, and limitation; users can persist
        an explicit override and apply an installed Ollama model to the active
        chat, while document search follows the visible local retrieval route;
        unavailable local models stay disabled and never fall back remotely)* Offer visible, overridable routing:
        Qwen + public schema for public-schema questions; Phi-4 + hybrid/native
        for document quality; Qwen + hybrid/native for balanced latency. Show
        evidence/sample sizes, never claim one universal winner, and never
        silently fall back to a remote provider.
  - [x] **G5 — user-facing addon surface.** *(done 2026-07-12 — Settings now
        combines health, declared permissions, source count, task-aware profile
        evidence/override, and a right-dock entry point; the bridge-independent
        dock explorer filters model × retrieval-setup cells and shows aggregate
        score bars, trials, 95% confidence intervals, component metrics,
        retrieval/generation latency, and trust labeling without raw answers,
        evidence passages, or private metadata)* Add compact health/source/profile
        controls and benchmark model × setup inspection using the existing
        editorial system or right-dock framework. Avoid duplicating the Offline
        Library dashboard or exposing private database metadata.
  - [x] **G6 — full acceptance.** *(done 2026-07-12 — pinned host `083fef6` /
        plugin 1.3.0; host 42 tests + compile gate, GatesAI 1,146 frontend
        tests + type/lint, 25/25 E2E, 39 normal Rust tests, live trusted-backend
        citation test, and controlled typed-offline test all passed; service
        restored; evidence in `docs/acceptance/offline-library-2026-07-12.md`)* Unit-test validation, SSRF/redirect/size
        limits, unavailable host, citation preservation, tool bounds, profile
        overrides, Web Lite degradation, and persistence. Pass `npm run ci`,
        `npm run test:e2e`, and Rust tests for Tauri changes, plus a live local
        desktop smoke against the matching host API version.
  - [ ] **G7 — separately gated follow-ups.** Management mutations, private
        alias confirmation, row queries, and semantic hallucination judging are
        excluded until separately approved and threat-modeled.

- [x] **Super+G Offline Knowledge entry point.** *(done 2026-07-12 — fixed
      desktop chord registration has independent availability state; pressing
      it shows/focuses GatesAI, requires a healthy explicitly enabled addon and
      connected Ollama runtime, prefers the installed evidence-backed Qwen
      profile, creates a fresh policy-scoped knowledge thread, and routes
      visibly to Settings or Local rather than falling back remotely)*
      Register a fixed desktop chord that opens a fresh knowledge chat using an
      installed tool-capable Ollama model and the healthy read-only Offline
      Library. Disabled/unhealthy addons route visibly to Settings; missing
      local models route visibly to Local; neither path may use a remote
      fallback. Show shortcut availability in Settings and cover Rust + ambient
      event routing in tests.

**Workbench program (Ethan, 2026-07-12)** — design frame in
`docs/plans/2026-07-12-workbench-vision-design.md`; each item gets its own
dated plan doc before implementation. Order matters (5→4→1→2→3 in the doc):

- [x] **W-5: Auto-updater via releases repo.** *(shipped 2026-07-12 —
      plugins + signed workflow + latest.json manifest job + sidebar
      UpdatePill; signing key in GH secrets, pubkey pinned in
      tauri.conf.json; see docs/release-checklist.md. Final acceptance —
      an older AppImage updating in-app — verifies on the first tagged
      release, tracked in "Verify published assets".)*
- [x] **W-4: Fullscreen toggle + discoverability (Linux first).** *(shipped
      2026-07-12 — F11 via shortcuts dispatcher → services/window/fullscreen
      (Tauri setFullscreen on desktop, browser Fullscreen API on Web Lite);
      "Toggle fullscreen" palette entry via UiStore facade.)*
- [ ] **W-1: Right dock panel framework.** DockStore (1 col × 1–2 cells,
      movable/collapsible/persisted) + panel registry; first panels: file
      viewer (md/html/json/txt), simple code editor (CodeMirror ADR), basic
      file explorer, media viewer. Web Lite feature-gated.
      *(Slices 1+2 shipped 2026-07-12: DockStore + persisted shell + panel
      registry, FileViewerPanel + MediaViewerPanel, palette/gallery entry
      points, Web Lite + mobile gating — see the changelog entry. The basic
      read-only file explorer shipped 2026-07-15 through the existing jailed
      `fs.list`/file-viewer path, with no bridge expansion. Remaining for slice
      3: CodeMirror editor panel (dependency ADR first) and terminal panel
      (blocked on a bridge pty op). Plan:
      `docs/plans/2026-07-12-dock-framework.md`.)*
- [x] **W-2: HTML artifact contract.** *(done 2026-07-16, codex lane: versioned prompt contract + CSP/sandbox/size limits, /workspace/artifacts/html/ registry with migration+revisions, pre-write static+sandboxed smoke validation into the error trail, dock panel + auto-open; 1,199 tests green.)* Versioned system-prompt block
      generated from code, artifact id registry under
      `/workspace/artifacts/html/`, smoke-render validation at creation,
      failures into the error trail; artifacts open in the dock panel.
- [x] **W-3: Unified background-task framework.** *(done 2026-07-16, codex lane per docs/plans/07-12-unified-tasks.md — generic TaskStore with image/agent/command kinds, task-center dock panel with progress/cancel/retry/cost, ImageJobStore strangler migration kept green.)* Promote the ImageJob
      lifecycle to a generic TaskStore (`image` | `agent` | `command`
      kinds), task-center dock panel with progress/cancel/retry/cost;
      strangler migration keeping ImageJobStore's 22 tests green.

- [x] **BUG: white screen on NVIDIA + Wayland — bake the WebKit DMABUF
      workaround into the app.** *(done 2026-07-16, codex lane
      a13-nvidia-wayland-dmabuf-20260716: Linux-only /proc + /sys NVIDIA
      detection without shelling out, respects user-set values incl. 0,
      runs before the first webview; 6 unit tests, cargo suite 45/45.
      README/troubleshooting doc line still pending — folded into the
      docs sweep.)* Confirmed 2026-07-12 on the RTX 5070 Ti
      (CachyOS/Hyprland): the AppImage renders an all-white webview because
      WebKitGTK's DMABUF renderer fails on NVIDIA + Wayland. Workaround
      verified working: `WEBKIT_DISABLE_DMABUF_RENDERER=1` (currently set
      only in Ethan's `~/.local/bin/gatesai-launch`; any other Linux/NVIDIA
      user still gets a white window). Fix in `src-tauri/src/main.rs` (or
      `lib.rs` `run()` before the builder): on Linux, if an NVIDIA GPU is
      present (e.g. `/proc/driver/nvidia/version` exists or `nvidia` in
      `/sys/class/drm/card*/device/driver` — do NOT shell out to
      `nvidia-smi`) and the var isn't already set, `std::env::set_var(
      "WEBKIT_DISABLE_DMABUF_RENDERER", "1")`. Must run before the first
      webview is created. Respect an existing user-set value (incl. `0` to
      opt out).
      *Acceptance:* unit-testable detection helper in Rust with tests
      (`cargo test`); env var set on NVIDIA-detected Linux only; a line in
      `docs/arch-linux-appimage-install.html`/README troubleshooting noting
      the auto-workaround; `npm run ci` untouched; changelog entry.
- [x] **BUG: 5 e2e tests failing on master (found 2026-07-11).** *(done 2026-07-11)* Pre-existing
      before the harness handshake fix (proven by stash-baseline):
      desktop.spec:171 first-run onboarding, web-lite.spec:43 onboarding,
      multiTab.spec:23 + :63 conflict handling, bridge.spec:35 gallery
      thumbnails. Likely from overnight lanes (welcome tour w18 / Web Locks
      w25 / gallery seeds) integrating on `npm run ci` without the e2e gate.
      Fix all five; then e2e returns as a hard integration gate.
- [x] **LF-3: model picker needs a LOCAL tab.** *(done 2026-07-11)* Added a
      LOCAL tab fed by the Ollama registry, with an offline-graceful empty
      state that links the user back to Local settings. (Evidence:
      screen-picker-model.png; audit 2026-07-11.)
- [x] **LF-4: first-boot hero leads cloud despite local-first banner.** *(done 2026-07-16, codex lane a14-lf4-local-first-boot-20260716: Local card leads, detected Ollama models default for untouched empty chats, explicit selections respected, offline state routes to Local settings without key-nagging, no-fallback stated; component tests cover both detection states.)*
      Primary CTA is the cloud card; tagline "chat with frontier models";
      composer defaults to keyless cloud Gemini. Give the local path equal
      or leading prominence; default composer to a detected Ollama model
      when present. (screen-chat-onboarding.png)
- [x] **LF-5: sidebar renders "DECEMBER 1969" date group** — epoch-0
      timestamp leak in date bucketing. (screen-chat-empty.png) *(done
      2026-07-13 — `groupThreadsByDate` prefers `updatedAt`, falls back to
      `createdAt`, and parks a thread with no sane timestamp in a shared
      "Older" bucket rather than dropping it or minting a pre-2000 month;
      threadSelectors 19 + EditorialSidebar 7 green on master @730b416)
- [x] **LF-6: Settings leads with the OpenRouter key card** *(done 2026-07-13)*
      — reordered so local/appearance settings (Theme, Conversation, Desktop,
      OfflineLibrary) render ABOVE the OpenRouter credential card; order-only,
      no behavior change; DOM-position regression test added (SettingsSection
      5/5 green on master @92cb7ce). (screen-menu-settings.png)
- [x] **LF-7: Local runtimes panel hardcodes Windows placeholders** *(done 2026-07-11)*
      (C:\Users paths, ollama.exe copy) + cramped error column — platform-
      aware copy + layout fix. (screen-menu-local.png)
- [x] **LF-8: gallery thumbnails/lightbox render black** *(fixed 2026-07-16, codex lane: image-source resolution corrected for desktop+Web Lite, regression tests added; merged after gate pass, full suite 1220/1220)* while captions
      render — image blobs not displayed. May share a root with the
      bridge.spec gallery fix (2026-07-11) — re-capture first. (screen-menu-gallery.png)
- [ ] **LF-9: tool-activity screen never actually captured** (byte-identical
      to chat-active) — fix the tour step to expand the activity panel and
      re-audit that surface.
- [x] **LF-1: Local menu section breaks in Web Lite.** *(done 2026-07-16, codex lane a13-weblite-local-menu-20260716: Local panel gated on a semantic desktop-capability check in core/runtime.ts, friendly desktop-only explainer in Web Lite, screens-tour asserts explainer + zero console errors; vitest green.)* Found by the screen
      audit 2026-07-11: `/#/menu/local` throws unhandled
      "Cannot read local runtime status outside the GatesAI desktop app"
      (localRuntimeService.ensureTauri) instead of degrading gracefully —
      violates the Web-Lite rule in CLAUDE.md. Gate the panel on
      `core/runtime.ts`, show a friendly desktop-only explainer, no thrown
      rejections. *Accept:* /#/menu/local renders an explainer in Web Lite
      with zero console errors; screens-tour asserts it again.
- [x] **Local-first screen audit.** *(done 2026-07-11 — 22/22 screens captured + assessed: 13 GOOD / 8 GAP / 1 BLOCKED; findings LF-1..LF-9 filed as items; corpus in docs/audits/screens-2026-07/)* Extend `scripts/screens-tour.mjs` to
      screenshot EVERY screen/panel/modal in the app, then audit each from a
      local-first user's perspective (Ollama-only, offline, no cloud keys —
      a major user segment): what breaks, what nags for keys, what degrades
      silently. File each gap as a concrete roadmap item with its screenshot.
      *Acceptance:* full screenshot set under docs/audits/screens-2026-07/,
      audit doc with per-screen verdicts, gaps filed as checkboxes. (Added
      2026-07-11, Ethan directive.)

**Local-model UX + composer polish (Ethan, 2026-07-12)** — batch filed from a
live session on the RTX box running `phi4:latest`. Group focus: make the
local-first path feel first-class (its own copy, its own knobs) and make the
composer quieter.

- [ ] **CB-1: Composer focus highlight should be a soft background glow, not
      a ring.** Today `.composer-row:has(.composer-textarea:focus-visible)`
      draws a crisp 2px `--focus-ring` outline + 5px glow
      (`src/styles/editorial.css` ~1519–1530); Ethan finds the ring too loud.
      Replace it with a subtle *background* glow — e.g. shift the composer
      fill toward `--accent` a few percent and/or a wide, low-alpha inset/blur
      halo — so focus reads as a gentle warming of the field rather than a
      hard border. Keep a real `:focus-visible` affordance for keyboard users
      (WCAG) — soften, don't delete. *Acceptance:* focused composer has no
      hard accent ring in the default theme; keyboard focus still visibly
      distinct from blur in both light and dark; screenshot before/after in
      the PR; `npm run ci` green.

- [ ] **CB-2: Local models deserve their own status copy, not "Waiting on
      provider…".** The stall/idle indicators (`ImageJobCard.tsx:125`
      "Waiting on provider…"; text-turn stall copy via
      `streamingRoundExecutor.ts`, `PROVIDER_STREAM_INITIAL_STALL_MS = 180s`)
      are provider-framed and read wrong for an Ollama model loading locally.
      Add local-aware messaging keyed off `providerId === 'ollama'` (and other
      local runtimes): e.g. "Loading <model> into memory…", "Running locally —
      first token can take a moment on a cold model", "Warming up the local
      runtime…", cycling/curated rather than the single remote-provider line.
      Distinguish cold-start (model not resident) from mid-stream idle if the
      signal is available. *Acceptance:* a local turn never shows
      "provider"-framed copy; unit tests cover the local vs remote branch;
      copy lives in one place, not scattered string literals.

- [ ] **SP-1: User-configurable system prompt.** Today the system prompt is
      derived entirely from context mode
      (`systemPromptForContextMode`, wired in `services/chat/turnRunner.ts`
      and `ChatStore.ts:486`) with no user surface. Add a settings-level
      custom system prompt (global default + optional per-thread override),
      persisted via the normal persistence slots (migration + schemaVersion
      bump per CLAUDE.md), composed *with* — not silently replacing — the
      safety/tool-contract portions of the built-in prompt. Web Lite parity.
      *Acceptance:* setting round-trips through persistence with a migration +
      tests; the custom text reaches the wire prompt for both Ollama and
      OpenAI-compat paths (`ollama.ts:131`, `openaiCompat.ts:273`); built-in
      tool/safety instructions are preserved; documented in the user guide.

- [ ] **SP-2: Auto-slim the system prompt for small-context local models.**
      Large built-in prompts + tool schemas eat the whole window on
      small-context local models (some Ollama models default to a 2–8k
      `num_ctx`), pushing out the actual conversation and causing garbage or
      truncated output. Introduce a "slim" prompt profile selected when the
      model's effective context is below a threshold (context length is
      already tracked — `core/localModelMeta.ts`, `modelFormatProfiles.ts`):
      drop non-essential prose, prune/curtail tool schemas to the enabled set,
      keep only load-bearing instructions. Should compose with SP-1.
      *Acceptance:* for a model tagged small-context, the assembled prompt is
      measurably shorter (token count asserted in a test) while still valid;
      no regression for large-context models; a note in architecture.md on the
      slimming rule and threshold.

- [ ] **QW-1: Investigate the Qwen local-model failures.** Recent local
      sessions with Qwen models (`qwen2.5:7b` / `qwen2.5-coder:14b`, offered
      in `components/menu/sections/Local.tsx`) failed — reproduce and root-
      cause before fixing. Candidate causes to rule out: system-prompt/tool-
      schema overflow on Qwen's default `num_ctx` (ties to SP-2), Qwen chat-
      template / stop-token handling in `services/llm/ollama.ts`
      (`buildMessages`) and `modelFormatProfiles.ts`, tool-call format
      mismatch, or thinking-tag leakage. Capture a concrete repro (prompt,
      model tag, `num_ctx`, raw request/response) and file specific fix items.
      *Acceptance:* a short findings note under `docs/audits/` with a
      reproducible failing case and the identified cause(s); follow-up fix
      checkboxes filed; if it turns out to be SP-2, link and close here.

- [ ] **QA-1: Automated settings walkthrough + settings de-bloat (Playwright,
      codex lane).** Dispatch a codex session (per the workspace orchestrator
      flow) to drive a Playwright pass over **every** settings/menu control —
      toggle each, change each select, save/reload, assert it persists and has
      real effect — reusing the `scripts/screens-tour.mjs` harness and the
      2026-07-11 screen audit as the map. Output: (a) a coverage report of
      which settings work / are dead / are confusing, and (b) a proposal to
      **slim settings we don't need** — remove or consolidate dead, redundant,
      or never-changed options so the surface is smaller and clearer. Removal
      of any setting is a separate reviewed PR, not done blind by the lane.
      *Acceptance:* Playwright spec exercising all settings added under the
      e2e suite (green in `npm run test:e2e`); a report doc under `docs/audits/`
      listing per-setting verdicts; a checklist of proposed removals/merges
      filed as follow-up items for review.


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
- [x] **Bridge protocol version handshake.** *(done 2026-07-10)* App sends/expects a protocol
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

- [x] Opt-in auto-updater — promoted to Next as W-5 (2026-07-12); tracked there.
- [ ] Portable mode (zip, data beside exe).
- [ ] Agent eval harness — see `docs/IDEAS.md` #1; promotes to Next once the
      open-source track is done.
- [ ] Cowork mode (designed, see Moonshots below) — its own wave when picked.
- [x] Content-parts message model unification (pre-req for several ideas). *(done 2026-07-11 — schema v3 stores ordered text/tool/image/artifact parts; legacy snapshots migrate on read; selectors preserve old read semantics across wire formatting, RAG, exports, and tests; streaming writes parts incrementally)*
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
- [x] Wave D refactor: `TurnRunner` extraction from ChatStore, shared LLM
      stream-parsing core (openaiCompat/ollama), `useEditorial()` store facade,
      message-list windowing, ModelPopover memo consolidation
      *(done 2026-07-10 — TurnRunner, shared stream core, useEditorial facade, list windowing, ModelPopover memo)*
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
- [x] Inline thread rename (F2 / right-click) and drag-to-reorder pins *(done 2026-07-11 — keyboard/context-menu rename with commit/cancel semantics; persisted user-defined pinned ordering)*
- [x] Global summon shortcut + tray icon (Tauri global shortcut) *(verified already-done, 2026-07-10 truth pass — Wave I; tray in `src-tauri/src/desktop.rs`)*
- [x] Jump-to-bottom pill with new-tokens indicator; sticky date separators *(done 2026-07-11 — history-aware follow-stream pill with live-response pulse; local-day message groups with sticky viewport headers)*
- [x] Composer: up-arrow recall, paste-image, window-wide drag-drop *(done 2026-07-11)*
- [x] Auto-collapse tool outputs over ~40 lines *(done 2026-07-10, burndown w2)*
- [x] What's-new panel on version change *(done 2026-07-11)*
- [x] Onboarding v2: bundled "tour" thread showing tools/artifacts/images *(done 2026-07-11)*

### Architecture
- [x] Unify message model into content-parts (text/tool/image/artifact parts)
      *(done 2026-07-11 — ordered part model, versioned legacy migration,
      centralized compatibility selectors/render dispatch, incremental streaming,
      and ordering/migration/round-trip coverage)*
- [x] Split EditorialComposer (~840 lines) into Input/AttachmentTray/
      ModelControls/SendPipeline *(done 2026-07-10, burndown w11 — pure refactor;
      `EditorialComposer.tsx` is now a ~270-line orchestrator delegating to
      `components/editorial/composer/`: `ComposerInput`, `AttachmentTray`,
      `ComposerMeta` (model/skill pickers + context/thinking selects), `ContextMeter`,
      `ComposerBanners`, `SkillPopover`, the `useComposerDraft` send/draft pipeline,
      and shared `composerStyles`/`composerAttachments`. Public props unchanged;
      DOM/classes byte-identical so the existing unit+e2e suites stay green)*
- [ ] Bridge protocol doc + version handshake (fail loud on mismatch)
- [x] Headless core entry (boot RootStore without React) → CLI mode, scripted
      smokes, scheduler runner *(done 2026-07-11)*
- [ ] Decide deliberately: Go bridge vs folding into a Rust sidecar

### Performance
- [ ] Cold-start budget (<1.5s to interactive): lazy menu sections, idle-time
      catalog hydration, audit source-snapshot resource cost in installer
- [ ] IDB background compaction; storage stats in Usage panel
      — storage stats completed 2026-07-16: Usage now reports localStorage and
      archived-thread entry/byte totals read-only. Compaction remains open and
      owner-policy-gated because it permanently deletes orphaned IDB records.
- [ ] Rust release profile tuning (thin LTO, strip) for installer size
- [x] Adaptive streaming reveal pacing (faster catch-up when far behind) *(done 2026-07-11)*

### State & data
- [x] Web Locks API leader election for multi-tab (replace pause-on-conflict) *(done 2026-07-11)*
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
- [x] Bridge protocol spec in docs/ *(done 2026-07-16, codex lane: docs/bridge-protocol.md audited/completed against code incl. protocolVersion 2 handshake, envelope types, Privileged flag, compat matrix)*

### Tooling & release
- [x] Changelog automation from commits *(local script half done 2026-07-16: scripts/generate-changelog.mjs drafts grouped entries from conventional commits, --write inserts a marked DRAFT section; nightly channel deferred until GitHub Actions billing is fixed)*
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
- [x] In-app `ollama pull` with progress for missing local models *(done 2026-07-16, codex lane: streamed /api/pull progress UI with cancel/failure/already-installed handling, explicit user action only, Web Lite explainer degradation; service + component tests)*
- [ ] Record the self-improvement demo (app edits itself, rebuilds, asks to
      update). The safety boundary is closed through manual installer handoff;
      recording and owner review remain pending. See
      [`docs/self-update.md`](self-update.md).

### Suggested release sequencing
- 4.2: semantic memory + fetch_page + sidebar QoL
- 4.3: sub-agents + scheduled tasks + light theme + global summon
- 5.0: self-improvement loop closed + macOS + opt-in updater + content-parts

## Later
- [ ] Multi-window / split-thread layouts
- [x] Extend `inspect_file` to source-code structure (`py`, `js`, `ts`, `go`)
      — completed 2026-07-16 with bounded, read-only declaration/import
      summaries plus preview/search/extract reuse; no parser dependency or
      execution authority added.
- [ ] Extend `inspect_file` to document formats (`pdf`, `docx`, `xlsx`)
- [ ] Release pipeline: publish the macOS .dmg (+sig) as a stable public asset alongside win/linux — v4.6.1 shipped win+linux only (2026-07-14)
- [ ] Adopt headless `@shadcn/react/message-scroller` (MIT, unstyled) to replace hand-rolled chat scroll logic — owns streamed-reply anchoring, thread restore, jump-to-message (we already patched one scroll-follow bug, LF-4). Keep GatesAI's own styles; also mirror shadcn's Marker slot pattern for tool-activity/streaming rows. Ref: https://ui.shadcn.com/docs/changelog/2026-06-chat-components (Ethan design-input packet, 2026-07-14)
