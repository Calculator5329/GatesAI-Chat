# Roadmap

## Narrowed scope — depth over breadth (2026-07-19)

**Principle:** a fast, beautiful, local-first chat workspace that does a small
set of things exceedingly well — bring-your-own-model chat (OpenRouter + local
Ollama), real workspace tools through the bridge, image gen via ComfyUI, and
well-managed memory — rather than a feature checklist.

**Routing floor:** three destinations only — OpenRouter (cloud LLM + image),
Ollama (local LLM), ComfyUI (local image). No custom OpenAI-compatible endpoint.

De-scope pass complete this session (archived to git history; recover a feature
by restoring its files + one registry line):

- [x] <!-- workspace:id=work:54c76ecf-f2f7-55e5-ad37-e5574dfd29a2 --> Delete `.gatesdb` database plugins layer *(2026-07-19)*
- [x] <!-- workspace:id=work:217c3a1b-3249-56a8-97db-8a41290baac8 --> Move OpenRouter model-compat suite to `scripts/model-compat/` *(2026-07-19)*
- [x] <!-- workspace:id=work:46019db4-5b2f-5463-8e53-243b50fd9b49 --> Archive Schedules, Source workspace + build runner *(2026-07-19)*
- [x] <!-- workspace:id=work:001e0073-59d9-504e-8e81-e44e12200b39 --> Archive MCP and the Offline knowledge Library *(2026-07-19)*
- [x] <!-- workspace:id=work:d0b9e311-45e8-5f56-afd3-ec46922ed154 --> Remove custom OpenAI-compatible endpoint provider *(2026-07-19)*
- [x] <!-- workspace:id=work:07f0bd53-267c-572e-b39c-13a2dc96540f --> Repurpose the global summon shortcut (configurable, e.g. `Super+G`) *(2026-07-19)*
- [x] <!-- workspace:id=work:83f80572-d71a-5733-9a8e-5915c4802566 --> Purge retired localStorage slots on boot *(2026-07-19)*

Foundation sweep (same day, follow-up pass before new roadmap work):

- [x] <!-- workspace:id=work:19e302fd-05b8-5abe-a98a-ce8a2b880385 --> Stop bundling the 31 MB source snapshot in installers; delete the
      snapshot script and its release-workflow steps *(2026-07-19)*
- [x] <!-- workspace:id=work:f0b0039d-f1e8-5e61-9676-3741e31084f4 --> Remove the dormant AP-2/AP-3/AP-4 scaffolding cluster (~3.4k lines:
      `core/agentSchedules|agentOutcomes|subAgentPolicy|agentTaskPolicy`,
      `services/tasks/{subAgents,scheduleLedger,outcomeLedger,agentTaskSpec,budgets}`)
      — it was imported only by its own tests; the design docs remain the
      source of truth for a future clean implementation *(2026-07-19)*
- [x] <!-- workspace:id=work:17e2d588-2bb6-5e78-98c1-ce7befbc7555 --> Centralize `isRecord` into `core/guards.ts` (was 13 copies) *(2026-07-19)*
- [x] <!-- workspace:id=work:8df0d5aa-dbc9-55c2-bf93-ebc61590f8e1 --> Drop the dead `mcp` tool category, unused `WebLiteNotice`, unused
      provider options; retire the old `openai-compat.api-key` keychain secret
      on boot *(2026-07-19)*
- [x] <!-- workspace:id=work:23ea26f2-0cde-5158-ab66-f0854e15bf20 --> Repair the screens tours for the 3-tab menu and regenerate all
      screenshot galleries; sweep stale docs *(2026-07-19)*
- [x] <!-- workspace:id=work:5d9ed76e-123a-598a-acd2-0b84067b7f9b --> Extract `ChatTurnEngine` + `AgentTaskLifecycle` from `ChatStore`; finish
      remaining docs leftovers in IDEAS/handbook/architecture *(2026-07-19)*

### Next up (priority order)

- [x] <!-- workspace:id=work:d76261d4-e89e-53e7-8d76-4d9474394fe9 --> **Switchable UI packs, with an AI-native pack ("Aurora").** *(done
      2026-08-11 — `core/uiPacks.ts` is the registry, `UiStore.uiPack` the
      persisted choice, and `Settings` + the command palette both switch it.
      Aurora reimplements eleven AI-native primitives on real turn data:
      pixel loader with live elapsed, typed activity trace with chip header,
      quoted follow-up chips, approval/recommendation cards backed by a
      blocking `ask_user` tool, diff cards on file edits, task step ladders,
      grouped palette search, a streaming-aware code block, and an image
      fine-tune card. Adding the next pack is one registry entry plus its
      renderers.)*
- [ ] <!-- workspace:id=work:c5e53088-e5e8-5a9c-8bcb-f9bdc2fafb6c --> **Add an AI SDK Elements pack.** Third entry in `UI_PACKS`, renderers
      under `components/editorial/elements/`, no changes to Classic or Aurora.
- [x] <!-- workspace:id=work:ef142638-602f-540a-b16a-658154a9df23 --> **Assistant activity, ChatGPT-style.** *(done 2026-07-31 — the transcript
      keeps a condensed digest of plain-English step headlines; the full
      reasoning, tool cards, and terminal tails read in a new Activity dock
      panel that auto-reveals on a live turn and can be aimed at one step from
      any digest line. Mobile keeps the inline expandable stream. Visual corpus:
      `npm run screens:activity` → docs/screens/activity/)*

      **Note 2026-08-13: this item is checked off and its code is not in the
      tree.** Owner ruling S4 `q-batch-notes` = `notes_and_fix`
      (`doc-truth-packet-20260812`, finding 12). Measured 2026-08-13 against the
      working tree and against `git log`: every file this item and LF-9 further
      down describe is absent, and no commit ever touched them.
      `src/core/activityDigest.ts`, `src/components/dock/ActivityPanel.tsx`,
      `src/components/editorial/activity/ActivityDigest.tsx`,
      `scripts/screens-activity.spec.mjs` and the whole `docs/screens/activity/`
      corpus do not exist, and `package.json` has no `screens:activity` script,
      so the command both entries cite cannot run.

      **Where the code is:** it survives, in full, in this repository's git
      stash. `git stash list` shows a single entry, `stash@{0}` (`c0f09ac`),
      labelled "wip-rescue-20260809: owner-approved stash (inbox 1b7f3dc3,
      answered 2026-08-09), 31 unowned files blocking cb1/cb2 merges". The
      untracked-files commit of that stash is **`b25e163`**, and it carries 22
      files and 1,327 insertions: the three source modules above, three test
      files (`tests/core/activityDigest.test.ts`,
      `tests/components/dock/ActivityPanel.test.ts`,
      `tests/components/editorial/ActivityDigest.test.ts`),
      `src/components/editorial/activity/useNow.ts`, the two playwright screen
      scripts, and all twelve activity PNGs plus their README. Inspect it
      read-only with `git show b25e163` or
      `git show b25e163:src/core/activityDigest.ts`.

      **The stash was not popped, dropped, or applied, and must not be** without
      a decision: it was created under an owner-answered ask because its
      contents were blocking two merges, so restoring it re-opens whatever that
      ask resolved. Nothing in this repository was changed by this note.

      NOT measured: whether the stashed code still builds or passes against the
      current tree, and whether the work was deliberately abandoned or simply
      lost when the stash was taken. Neither this file nor the stash label
      answers that, and an agent cannot.

- [ ] **[ETHAN] Decide the fate of stash `b25e163`, the Activity dock work.**
      Two roadmap items in this file are checked off for code that exists only
      in that stash. The options are to restore it and re-verify, to re-do the
      work fresh, or to un-check both items and drop the feature on the record.
      Raised under finding 12 on 2026-08-13. The stash stays untouched until a
      decision, and no agent pops or drops it.
- [x] <!-- workspace:id=work:bc9ad7d9-a194-5c38-8241-060756af7a9c --> **Prepare a multi-surface owner feedback session for the depth pass.**
      *(done 2026-07-20 — one Forge-rich choice now compares guided missions,
      a code-derived evidence board, and a speech-first challenge deck against
      the ordinary review packet, Visions structured input, Comms Deck, and
      in-chat feedback using one shared rubric)*
- [x] <!-- workspace:id=work:a17e8a57-751a-57c4-ad9c-26c510111654 --> **Semantic memory / RAG — build it right.** *(done 2026-07-19 — complete
      atomic local indexing across retained conversations, evaluated hybrid
      recall, untrusted evidence boundary, exact response provenance, Option 2
      source chips, and reversible Agent → Memory source controls)* Keep and elevate; manage
      memory carefully (what gets indexed, recall quality, transparency, user
      control). This is a headline capability, not a checkbox.
- [x] <!-- workspace:id=work:6d91f6ad-6030-5ee8-902a-6c15d5d2e566 --> **Search: basic + deep research.** *(done 2026-07-19 — restored concise
      Brave setup under Models, kept normal `web_search` compact, added an
      official large-context deep budget, and shipped a first-class Research
      composer action backed by visible/cancellable/retryable linked agent
      tasks with primary-source and citation-integrity instructions)* Center on
      one provider (Brave for now); do not try to support every search API.
- [x] <!-- workspace:id=work:9005525a-b3ec-56cb-acf4-1235c35d4257 --> **Model-compat auto-runner.** *(done 2026-07-19 — daily catalog policy,
      weekly/manual budget-capped live text/tool/continuation probes, durable
      JSON + Markdown Actions artifacts, and focused family reruns)* The live
      OpenRouter catalog now discovers every active Claude since Sonnet 4,
      Gemini since 2.0, and OpenAI GPT-5 route plus the three newest Meta,
      Grok, Kimi K2, GLM, Nemotron, and DeepSeek routes. Cursor Composer is
      reported as an explicit boundary rather than a false pass: its in-house
      models are not OpenRouter-addressable, and adding a Cursor provider would
      violate the three-route product floor.
- [x] <!-- workspace:id=work:8010745d-ceb2-505b-9a52-66d8e0cab334 --> **Database / library layer, redone with taste.** *(done 2026-07-19 —
      shipped a first-class Agent → Memory knowledge library for explicitly
      approved workspace documents and SQLite databases; documents join local
      semantic recall, databases expose schema only, row access stays in the
      existing bounded read-only SQLite tool, and every source can be disabled
      and re-enabled without destructive removal)* This is intentionally a
      small local capability, not a restoration of the old plugin host or
      Offline Library service.

### Parked (re-add excellently later, with documented value)

- **Schedules** — recurring automation. Value: unattended periodic agent runs
  (digests, monitors). Re-add on the v2 agent-task foundation, not the legacy
  30s app-open loop.
- **Source workspace + build runner** — in-app self-improvement loop. Value:
  the app editing/rebuilding itself under review. Heavy; revisit deliberately.
- **MCP (managed code providers)** — external tool servers. Value: connect
  third-party tool ecosystems (HTTP + stdio) as namespaced `mcp_*` tools
  without bespoke integrations. Re-add once the core tool UX is top-tier.
- **Web Lite** — frozen as a marketing demo; degrades gracefully, not a
  development target.

## Handoff plan — Now / Next / Later (2026-07-05)

Current focus: **open-source / product readiness**. The app itself is deep
(997 unit + 20 e2e tests, CI, releases at v4.5.0); what's missing is the
public-facing shell around it. Each task below is sized for one working
session by an agent with no prior context (read `docs/architecture.md` and
root `CLAUDE.md` first) and has explicit acceptance criteria. Do not modify
sibling repos (`../gatesai-bridge` etc.) from this repo's sessions.

### Now

- [x] <!-- workspace:id=work:274009eb-38fd-5d86-9b28-120ec04a724e --> [ETHAN] **Decide and execute repo visibility.** *(decided 2026-08-13:
      Ethan ruled `adr` on `repo-visibility-packet-20260810` D1: "private
      gates ai chat repo for now, no need to publicize it". Record:
      `docs/adr/2026-08-13-source-repo-visibility.md`. Measured the same day:
      the source repo is PUBLIC today (`gh api repos/Calculator5329/GatesAI-Chat`
      returns `private: false`), so the ruling still needs an owner-only flip;
      that action is the separate item below. The history secret scan was never
      run.)* The source repo
      (`Calculator5329/GatesAI-Chat`) is private; releases publish to the
      separate public `GatesAI-Chat-releases` repo (see comment in
      `.github/workflows/release.yml`). Either flip the source repo public or
      write an ADR in `docs/` saying why the split stays.
      *Acceptance:* before flipping, scan full git history for secrets
      (e.g. `gitleaks detect` or `git log -p` grep for `sk-`, `key=`, tokens)
      and record the result; after flipping, README release/download links and
      the Pages demo still resolve; if keeping split, ADR committed instead.
- [ ] [ETHAN] **Execute the D1 ruling: make the source repo private.** The
      decision is recorded; the flip is owner-only. Exact PowerShell commands,
      the consequence for the public Web Lite Pages demo, verification and undo
      are in `docs/adr/2026-08-13-source-repo-visibility.md`.
      *Acceptance:* `gh repo view Calculator5329/GatesAI-Chat --json visibility`
      prints `private`, and the Web Lite links in `../gatesai-landing` are
      re-pointed or removed if the Pages demo went down with it.
- [x] <!-- workspace:id=work:6c110178-4045-53be-af10-6f9d456ad526 --> **Demo GIF at the top of the README.** *(capture pending owner hands —
      script ready, 2026-07-17)* Everything except the recording itself is
      landed: `scripts/demo-capture.md` is an exact click-by-click 20–40s
      capture script (spawn a background agent via `spawn_task` → open the
      Task center dock panel → render an HTML `artifact`), with the two-pass
      ffmpeg `palettegen`/`paletteuse` gif one-liner and the <10 MB budget;
      `README.md` embeds the demo above the fold at `docs/media/demo.gif`
      with alt text and an HTML comment pointing at the capture script. The
      recording needs a human on a desktop machine — do the take per the
      script, drop the GIF at `docs/media/demo.gif`, and update this note
      with the ship date.
      *Acceptance:* `docs/media/demo.gif` (< 10 MB) embedded above
      the fold in `README.md`; renders on GitHub.
- [x] <!-- workspace:id=work:5cb4f879-fed8-5a36-87a5-52c9ca3c5b5c --> **README truth pass.** *(done 2026-07-10)* Fix the Memory bullet that still claims "no
      embeddings/RAG" (RAG shipped in Wave F: `src/services/rag/`, `recall`
      tool); re-verify every command, link, badge, and the tool list against
      the tree; confirm test counts with `npx vitest list ... | wc -l` and
      `npx playwright test --list`.
      *Acceptance:* no statement in README contradicts the code; counts match
      reality on the day of the pass.
- [x] <!-- workspace:id=work:7dec738d-4f0a-55f2-954b-4237c6036ac6 --> **CONTRIBUTING.md.** *(done 2026-07-10)* Setup (Node, Rust, Go/bridge), the quality gates
      (`npm run ci`, `npm run test:e2e`, `cargo test`), the layer rules in one
      table (link `docs/architecture.md`), how to add a tool/store/component,
      PR expectations, and the AGPL-3.0 contribution terms.
      *Acceptance:* file exists at repo root, linked from README; a newcomer
      can go from clone to green `npm run ci` using only it.
- [x] <!-- workspace:id=work:2116043d-b79f-5111-958f-451bca4140ab --> **Dependency audit.** *(done 2026-07-11 — npm: 10→0 via audit fix, ci green; cargo: quinn-proto RUSTSEC cleared, quick-xml pair pinned upstream by tauri — details + re-check plan in docs/audits/2026-07-11-dependency-audit.md)* Run `npm audit` and `cargo audit`
      (install `cargo-audit` if absent) — fix or explicitly waive findings.
      *Acceptance:* zero high/critical advisories, or each remaining one
      documented with justification in the PR/commit message; `npm run ci`
      still green. *(progress 2026-07-11: npm side DONE — audit fix cleared all 10 vulns, ci 1040 green; cargo side documented in docs/audits/2026-07-11-dependency-audit.md — 3 transitive RUSTSECs need targeted cargo update, ~20 unmaintained gtk3 warnings inherent to tauri v2 linux)*

- [x] <!-- workspace:id=work:e844e796-9762-52c5-9189-cf27f657bdd7 --> **Repo hygiene sweep.** *(done 2026-07-10)* Remove or ignore root scratch files
      (`debug.log`, `vite-5182.*.log`, `.codex-vite-*.log`, `.codex-tasks/`
      leftovers), retire `.env.firebase` (only sets `VITE_GATESAI_WEB=1`; fold
      into the build script or rename to something honest), prune dead
      `.firebase/` and `.cursor/` if untracked/unused.
      *Acceptance:* fresh clone root contains only purposeful files;
      `.gitignore` covers the scratch patterns; nothing tracked was deleted
      without checking `git ls-files` first.

### Next

- [x] <!-- workspace:id=work:13ef1587-4805-5b52-8c8c-fe977f1939bc --> **Offline Library plugin consumer.** *(completed 2026-07-12;
      coordinated with `../local-ai-lab`)* Integrate the host-ready,
      loopback-only Offline Library as a swappable read-only addon. The work is
      ordered so UI/tool code never outruns the versioned safety contract:
  - [x] <!-- workspace:id=work:6d1ac6c5-ab4d-5296-bbc1-478f90873af0 --> **G0 — ADR and shared contract fixture.** *(done 2026-07-12 —
        dedicated fixed-authority Tauri boundary accepted in
        `docs/adr/2026-07-12-offline-library-plugin.md`; sanitized host 1.3
        manifest/profile/benchmark fixtures pinned with contract tests)* Record the desktop proxy
        choice (dedicated Tauri command or bridge operation), loopback threat
        model, Web Lite degradation, plugin lifecycle, and citation contract.
        Import a sanitized API fixture only after local-ai-lab declares the
        benchmark/profile endpoints in its manifest and OpenAPI document.
  - [x] <!-- workspace:id=work:60ad97dc-5e93-50e9-81db-345ecfb373d8 --> **G1 — typed service client and trusted proxy.** *(done 2026-07-12 —
        dedicated Rust commands own the exact `127.0.0.1:8892/api/v1`
        authority and fixed route/method set; typed TypeScript result states
        degrade without invoking transport in Web Lite; hostile aliases,
        bounds, redirects, content types, sizes, errors, and citation identity
        are covered in Rust/frontend tests)* Add a service-layer
        client for status, sources, search, public schemas, profiles, and
        benchmark summaries. Browser code must not fetch `127.0.0.1` directly;
        the desktop backend must allow only the fixed host/port/path set, bound
        response sizes, reject redirects, and preserve offline/error states.
  - [x] <!-- workspace:id=work:66c4a36d-8cf4-5138-a3fa-217e01d3930d --> **G2 — plugin lifecycle and settings.** *(done 2026-07-12 — explicit
        default-off enablement persists locally; compatible manifest + health
        discovery exposes healthy/offline/incompatible/error states and
        declared read permissions; Web Lite stays disabled and makes zero
        transport calls)* Discover and validate the
        manifest, expose explicit enable/disable and health state, show declared
        read permissions, and remain disabled/unavailable in Web Lite with a
        clear desktop-only explanation. Do not add secrets or background cloud
        dependencies.
  - [x] <!-- workspace:id=work:5d6384cf-0343-591d-8c5e-4664d2875dd2 --> **G3 — read-only model tools.** *(done 2026-07-12 — four knowledge
        tools are exposed only while the explicitly enabled addon is healthy;
        inputs and projected outputs are bounded, public-schema results exclude
        rows, benchmark summaries retain evidence and trust-proxy labels, and
        exact offline citation URIs are covered through tool execution,
        rendering, export/import, and persisted snapshots)* Register bounded tools for library
        search, source inventory, public database schemas, and benchmark/profile
        summaries with honest read-only metadata. Preserve `kiwix://`,
        `library://`, `man:`, and `db://` citations through tool results,
        messages, persistence, export, and rendering.
  - [x] <!-- workspace:id=work:d409eae3-e860-56ed-8214-4f9a52e73278 --> **G4 — task-aware local profiles.** *(done 2026-07-12 — the host's
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
  - [x] <!-- workspace:id=work:1cf8b59d-288c-5aee-92e5-8076bca59da4 --> **G5 — user-facing addon surface.** *(done 2026-07-12 — Settings now
        combines health, declared permissions, source count, task-aware profile
        evidence/override, and a right-dock entry point; the bridge-independent
        dock explorer filters model × retrieval-setup cells and shows aggregate
        score bars, trials, 95% confidence intervals, component metrics,
        retrieval/generation latency, and trust labeling without raw answers,
        evidence passages, or private metadata)* Add compact health/source/profile
        controls and benchmark model × setup inspection using the existing
        editorial system or right-dock framework. Avoid duplicating the Offline
        Library dashboard or exposing private database metadata.
  - [x] <!-- workspace:id=work:7ea7cb11-8f08-5490-af12-9ccccc8ad277 --> **G6 — full acceptance.** *(done 2026-07-12 — pinned host `083fef6` /
        plugin 1.3.0; host 42 tests + compile gate, GatesAI 1,146 frontend
        tests + type/lint, 25/25 E2E, 39 normal Rust tests, live trusted-backend
        citation test, and controlled typed-offline test all passed; service
        restored; evidence in `docs/acceptance/offline-library-2026-07-12.md`)* Unit-test validation, SSRF/redirect/size
        limits, unavailable host, citation preservation, tool bounds, profile
        overrides, Web Lite degradation, and persistence. Pass `npm run ci`,
        `npm run test:e2e`, and Rust tests for Tauri changes, plus a live local
        desktop smoke against the matching host API version.
  - [ ] <!-- workspace:id=work:626cef17-d8ac-5d81-97ea-56165f628e0b --> **G7 — separately gated follow-ups.** Management mutations, private
        alias confirmation, row queries, and semantic hallucination judging are
        excluded until separately approved and threat-modeled.

- [x] <!-- workspace:id=work:2475b0e1-68c9-5c90-ad8d-82cf59693881 --> **Super+G Offline Knowledge entry point.** *(done 2026-07-12 — fixed
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

- [x] <!-- workspace:id=work:667e3084-f7e6-53c5-8caa-d1c888909c7c --> **W-5: Auto-updater via releases repo.** *(shipped 2026-07-12 —
      plugins + signed workflow + latest.json manifest job + sidebar
      UpdatePill; signing key in GH secrets, pubkey pinned in
      tauri.conf.json; see docs/release-checklist.md. Final acceptance —
      an older AppImage updating in-app — verifies on the first tagged
      release, tracked in "Verify published assets".)*
- [x] <!-- workspace:id=work:d9d775c7-1cc0-556b-b871-8125c492716e --> **W-4: Fullscreen toggle + discoverability (Linux first).** *(shipped
      2026-07-12 — F11 via shortcuts dispatcher → services/window/fullscreen
      (Tauri setFullscreen on desktop, browser Fullscreen API on Web Lite);
      "Toggle fullscreen" palette entry via UiStore facade.)*
- [ ] <!-- workspace:id=work:91f65b2b-c06a-5ebd-99af-4e92445854b9 --> **W-1: Right dock panel framework.** DockStore (1 col × 1–2 cells,
      movable/collapsible/persisted) + panel registry; first panels: file
      viewer (md/html/json/txt), simple code editor (CodeMirror ADR), basic
      file explorer, media viewer. Web Lite feature-gated.
      *(2026-07-18, lane `w-1-right-dock-panel-framework`; plan landed at
      `docs/plans/unblock-w-1-right-dock-panel-framework-dockstore-20260718/`,
      implementation dispatch pending.)*
      *(Slices 1+2 shipped 2026-07-12: DockStore + persisted shell + panel
      registry, FileViewerPanel + MediaViewerPanel, palette/gallery entry
      points, Web Lite + mobile gating — see the changelog entry. The basic
      read-only file explorer shipped 2026-07-15 through the existing jailed
      `fs.list`/file-viewer path, with no bridge expansion. Remaining for slice
      3: CodeMirror editor panel (dependency ADR first) and terminal panel
      (blocked on a bridge pty op). Plan:
      `docs/plans/2026-07-12-dock-framework.md`.)*
- [x] <!-- workspace:id=work:46bcf7ea-ff91-568f-94b5-fd5647f28ac1 --> **W-2: HTML artifact contract.** *(done 2026-07-16, codex lane: versioned prompt contract + CSP/sandbox/size limits, /workspace/artifacts/html/ registry with migration+revisions, pre-write static+sandboxed smoke validation into the error trail, dock panel + auto-open; 1,199 tests green.)* Versioned system-prompt block
      generated from code, artifact id registry under
      `/workspace/artifacts/html/`, smoke-render validation at creation,
      failures into the error trail; artifacts open in the dock panel.
- [x] <!-- workspace:id=work:0704cf9a-b563-511c-afbe-d65583930614 --> **W-3: Unified background-task framework.** *(done 2026-07-16, codex lane per docs/plans/07-12-unified-tasks.md — generic TaskStore with image/agent/command kinds, task-center dock panel with progress/cancel/retry/cost, ImageJobStore strangler migration kept green.)* Promote the ImageJob
      lifecycle to a generic TaskStore (`image` | `agent` | `command`
      kinds), task-center dock panel with progress/cancel/retry/cost;
      strangler migration keeping ImageJobStore's 22 tests green.

- [x] <!-- workspace:id=work:d4c1ed10-0710-534e-8b60-80d1aa908a88 --> **BUG: white screen on NVIDIA + Wayland — bake the WebKit DMABUF
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
- [x] <!-- workspace:id=work:90995d29-d5c9-50e5-92fe-a0b7f3543426 --> **BUG: 5 e2e tests failing on master (found 2026-07-11).** *(done 2026-07-11)* Pre-existing
      before the harness handshake fix (proven by stash-baseline):
      desktop.spec:171 first-run onboarding, web-lite.spec:43 onboarding,
      multiTab.spec:23 + :63 conflict handling, bridge.spec:35 gallery
      thumbnails. Likely from overnight lanes (welcome tour w18 / Web Locks
      w25 / gallery seeds) integrating on `npm run ci` without the e2e gate.
      Fix all five; then e2e returns as a hard integration gate.
- [x] <!-- workspace:id=work:4a71f7ba-24cf-5e03-8a99-109c69e0c7f2 --> **LF-3: model picker needs a LOCAL tab.** *(done 2026-07-11)* Added a
      LOCAL tab fed by the Ollama registry, with an offline-graceful empty
      state that links the user back to Local settings. (Evidence:
      screen-picker-model.png; audit 2026-07-11.)
- [x] <!-- workspace:id=work:ddcd60bd-021f-5e7a-b5dc-b1281431a0a1 --> **LF-4: first-boot hero leads cloud despite local-first banner.** *(done 2026-07-16, codex lane a14-lf4-local-first-boot-20260716: Local card leads, detected Ollama models default for untouched empty chats, explicit selections respected, offline state routes to Local settings without key-nagging, no-fallback stated; component tests cover both detection states.)*
      Primary CTA is the cloud card; tagline "chat with frontier models";
      composer defaults to keyless cloud Gemini. Give the local path equal
      or leading prominence; default composer to a detected Ollama model
      when present. (screen-chat-onboarding.png)
- [x] <!-- workspace:id=work:66fb4a79-c7c1-5204-88fa-7bde77b558fa --> **LF-5: sidebar renders "DECEMBER 1969" date group** — epoch-0
      timestamp leak in date bucketing. (screen-chat-empty.png) *(done
      2026-07-13 — `groupThreadsByDate` prefers `updatedAt`, falls back to
      `createdAt`, and parks a thread with no sane timestamp in a shared
      "Older" bucket rather than dropping it or minting a pre-2000 month;
      threadSelectors 19 + EditorialSidebar 7 green on master @730b416)
- [x] <!-- workspace:id=work:d1adb6bf-84b9-5e95-9e13-3ff8def95114 --> **LF-6: Settings leads with the OpenRouter key card** *(done 2026-07-13)*
      — reordered so local/appearance settings (Theme, Conversation, Desktop,
      OfflineLibrary) render ABOVE the OpenRouter credential card; order-only,
      no behavior change; DOM-position regression test added (SettingsSection
      5/5 green on master @92cb7ce). (screen-menu-settings.png)
- [x] <!-- workspace:id=work:72d42baf-156a-582b-b93a-fa4221be7b0b --> **LF-7: Local runtimes panel hardcodes Windows placeholders** *(done 2026-07-11)*
      (C:\Users paths, ollama.exe copy) + cramped error column — platform-
      aware copy + layout fix. (screen-menu-local.png)
- [x] <!-- workspace:id=work:ac7af5de-b8a7-5a22-99ac-9045dfdbbb1e --> **LF-8: gallery thumbnails/lightbox render black** *(fixed 2026-07-16, codex lane: image-source resolution corrected for desktop+Web Lite, regression tests added; merged after gate pass, full suite 1220/1220)* while captions
      render — image blobs not displayed. May share a root with the
      bridge.spec gallery fix (2026-07-11) — re-capture first. (screen-menu-gallery.png)
- [x] <!-- workspace:id=work:eabc6150-8ca6-57f1-a78c-e14a50c9326d --> **LF-9: tool-activity screen never actually captured** (byte-identical
      to chat-active) *(done 2026-07-31 — `npm run screens:activity` captures
      12 distinct activity states from deterministic fixture threads; corpus in
      docs/screens/activity/)* — fix the tour step to expand the activity panel
      and re-audit that surface.

      **Note 2026-08-13** (owner ruling S4 `q-batch-notes` = `notes_and_fix`,
      `doc-truth-packet-20260812`, finding 12): same defect as the "Assistant
      activity, ChatGPT-style" item earlier in this file, and the same cause.
      Measured 2026-08-13: `docs/screens/activity/` does not exist, there is no
      `screens:activity` script in `package.json`, and no commit ever added
      either. The 12 captures and the playwright spec are in git stash
      `b25e163` only. Full detail, and the owner decision this needs, are
      recorded on that earlier item. The stash was not popped or dropped.
- [x] <!-- workspace:id=work:fe864a83-6edc-5f8d-8ba9-9801a5110b54 --> **LF-1: Local menu section breaks in Web Lite.** *(done 2026-07-16, codex lane a13-weblite-local-menu-20260716: Local panel gated on a semantic desktop-capability check in core/runtime.ts, friendly desktop-only explainer in Web Lite, screens-tour asserts explainer + zero console errors; vitest green.)* Found by the screen
      audit 2026-07-11: `/#/menu/local` throws unhandled
      "Cannot read local runtime status outside the GatesAI desktop app"
      (localRuntimeService.ensureTauri) instead of degrading gracefully —
      violates the Web-Lite rule in CLAUDE.md. Gate the panel on
      `core/runtime.ts`, show a friendly desktop-only explainer, no thrown
      rejections. *Accept:* /#/menu/local renders an explainer in Web Lite
      with zero console errors; screens-tour asserts it again.
- [x] <!-- workspace:id=work:8263fd50-a572-52b8-82ce-e0f9e686464e --> **Local-first screen audit.** *(done 2026-07-11 — 22/22 screens captured + assessed: 13 GOOD / 8 GAP / 1 BLOCKED; findings LF-1..LF-9 filed as items; corpus in docs/audits/screens-2026-07/)* Extend `scripts/screens-tour.mjs` to
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

- [x] <!-- workspace:id=work:df63afab-5ad7-5fe8-a460-726eff612bf0 --> **CB-1: Composer focus highlight should be a soft background glow, not
      a ring.** (Done 2026-08-09.) Replaced the outer 2px outline + ring glow
      on `.composer-row:has(.composer-textarea:focus[-visible])` with a
      background warming: the fill shifts a few percent toward `--accent` and a
      wide low-alpha inset halo blooms inward — no crisp accent ring. Keyboard
      `:focus-visible` keeps a real, WCAG-legible affordance (stronger fill
      warming + firmer accent border), token-derived so it holds in light and
      dark. See the `/* CB-1 */` marker in `src/styles/editorial.css`.
      Today `.composer-row:has(.composer-textarea:focus-visible)`
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

- [x] <!-- workspace:id=work:6718377d-2317-5b72-bfa4-99bf73564b9a --> **CB-2: Local models deserve their own status copy, not "Waiting on
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
      *Update 2026-08-09:* wired local-runtime stall strings (`ollama`, `local-image`)
      behind `src/copy/localStatus.ts`, added cold-start vs idle branching in
      `streamingRoundExecutor`, and removed provider-framed image-card copy.

- [ ] <!-- workspace:id=work:7f044bdd-27e2-5e11-b777-2a3f0e9d90fc --> **SP-1: User-configurable system prompt.** Today the system prompt is
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

- [ ] <!-- workspace:id=work:3dfec159-d37c-5b83-aade-fae701efa492 --> **SP-2: Auto-slim the system prompt for small-context local models.**
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

- [ ] <!-- workspace:id=work:482a384e-6ebb-5123-b8d2-68717a62f501 --> **QW-1: Investigate the Qwen local-model failures.** Recent local
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

- [ ] <!-- workspace:id=work:eab46e44-b697-5cb2-93e1-13b636ddc76d --> **QA-1: Automated settings walkthrough + settings de-bloat (Playwright,
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


- [x] <!-- workspace:id=work:ff33c223-f44a-58fd-8055-160a76981d0a --> **Flaky-test sweep.** *(done 2026-07-10)* Run the unit suite 5× and the e2e suite 3× in a
      row (`npm test`, `npm run test:e2e`); record any test that fails
      non-deterministically, fix or quarantine it with a linked issue/note in
      this file. *Acceptance:* 3 consecutive fully-green runs of both suites;
      a short report of what was flaky and what changed.
      *Report: 5×995-unit + 3×20-e2e consecutive runs on Linux, all exit 0 —
      zero non-deterministic failures observed; nothing to fix or quarantine.*
- [x] <!-- workspace:id=work:e5813520-068f-531f-8453-50b78139b2c9 --> **Windows e2e job in CI + Playwright traces.** *(done 2026-07-10)* Add a windows-latest e2e
      job to `.github/workflows/ci.yml` and upload traces on failure (backlog
      item). *Acceptance:* CI green with the new job; a forced failure shows a
      downloadable trace artifact.
- [ ] <!-- workspace:id=work:f2bfe466-5c75-5fe2-a8d8-9be88263e782 --> **Signed / trusted release builds — path chosen.** *(Decided 2026-07-20 on
      card-FRGRJGAABJE0DVCH9PXYB2G8FS: ship unsigned Windows builds with
      `SHA256SUMS` now; defer paid signing. [ETHAN] marker dropped 2026-08-01,
      Ethan-approved — the decision is done, the build work below is not.)*
      Remaining work: add the README note about the SmartScreen warning and
      checksums (`SHA256SUMS` published per release). *Acceptance:* release
      workflow emits checksums; the deferral decision recorded in an ADR under
      `docs/`.
- [x] <!-- workspace:id=work:6338deba-53d0-5a5e-bbb4-71b13fa55109 --> **Release checklist doc.** *(done 2026-07-10)* One page in `docs/`: version bumps
      (`package.json` + `src-tauri/tauri.conf.json`), changelog entry, tag
      push, asset verification, Web Lite check. *Acceptance:* the next release
      is cut following only the checklist.
- [x] <!-- workspace:id=work:c5caf8c2-f357-524a-8d1e-e25c5e18dcee --> **Bridge protocol version handshake.** *(done 2026-07-10)* App sends/expects a protocol
      version on WebSocket connect; mismatch surfaces a clear BridgeStore
      error state instead of quiet failures. Coordinate the bridge half as a
      separate task in `../gatesai-bridge` (do not edit it from here).
      *Acceptance:* unit tests for the app-side handshake; graceful degraded
      message on mismatch.
- [ ] <!-- workspace:id=work:9afa188d-7789-56a7-9e14-fdb77dde4a5b --> **macOS build.** Keyring is already apple-native-capable; needs a
      macos-latest job, sidecar naming for the darwin triple, and (later)
      signing/notarization. *Acceptance:* an unsigned .dmg/.app artifact
      builds in CI even if not yet published.

### Later

- [x] <!-- workspace:id=work:ce1f51d5-598b-5d91-8e98-1f06908c7c17 --> Opt-in auto-updater — promoted to Next as W-5 (2026-07-12); tracked there.
- [ ] <!-- workspace:id=work:5b20c8a4-b0f4-51bc-bcd9-a3edc654602c --> Portable mode (zip, data beside exe).
- [ ] <!-- workspace:id=work:a08c8414-d401-599f-9b5d-4d2a4a908657 --> Agent eval harness — see `docs/IDEAS.md` #1; promotes to Next once the
      open-source track is done.
- [x] <!-- workspace:id=work:435c5575-1944-53b1-abff-a59f89b341f9 --> <!-- closed 2026-08-12: pointer-only duplicate — the Cowork mode moonshot item work:af244cfb holds the content and stays open --> Cowork mode (designed, see Moonshots below) — its own wave when picked.
- [x] <!-- workspace:id=work:f53c5e30-1008-53a7-a95e-164b263b3bf1 --> Content-parts message model unification (pre-req for several ideas). *(done 2026-07-11 — schema v3 stores ordered text/tool/image/artifact parts; legacy snapshots migrate on read; selectors preserve old read semantics across wire formatting, RAG, exports, and tests; streaming writes parts incrementally)*
- [ ] <!-- workspace:id=work:12d246aa-9761-55e7-923f-95d5e69de8aa --> LAN companion / phone access (bridge serves Web Lite with pairing code).

---

## Agentic platform (2026-07-16, Ethan)

Design and phased single-session lane boundaries:
[`docs/plans/07-16-agentic-platform-design.md`](plans/07-16-agentic-platform-design.md).
These are open Stories in the mandated Vision; unchecked workflow state does
not by itself imply acceptance of every proposed implementation detail.

> **2026-07-19 note:** the partially built AP-2/AP-3/AP-4 domain scaffolding
> (schedule/outcome ledgers, sub-agent tree, policy modules) was removed in the
> foundation sweep — it was never wired into the app. The stories below remain
> valid as designs; a future implementation starts clean from the plan docs
> (or `archive/pre-descope-2026-07-19` for reference).

- [ ] <!-- workspace:id=work:d435ebbf-030d-5582-8720-93191e86b7d2 --> **AP-1 — Downloadable database plugins.** Ship versioned, data-only
      knowledge/database bundles that users can inspect, explicitly install
      and enable; agents can initiate the approval-gated install flow and query
      enabled bundles through bounded read-only operations with stable
      citations. Carry forward the Offline Library plugin's typed lifecycle,
      fixed authority, privacy states, and no-remote-fallback rules.
      See [Story AP-1](plans/07-16-agentic-platform-design.md#story-ap-1--downloadable-database-plugins).
- [ ] <!-- workspace:id=work:1d198b22-7973-5afc-ac6c-a56e568c74e1 --> **AP-2 — Background sub-agents on TaskStore.** Make agent runs durable
      first-class tasks using W-3's existing two-agent cap, linked threads,
      task-center progress, cancel/retry/interruption, exact provider/model,
      tool/data grants, result, and round/time/token/spend caps—without a
      parallel queue or silent provider switching. See
      [Story AP-2](plans/07-16-agentic-platform-design.md#story-ap-2--background-sub-agents-on-taskstore).
- [ ] <!-- workspace:id=work:9081b621-b5c5-52bb-80d3-6615158d67cc --> **AP-3 — User-controlled self-scheduling.** Let agents propose one-shot,
      delayed, interval, and daily wakes that become ordinary TaskStore runs
      only after visible user consent, with pause/edit/run-now/archive, exact
      route, wake/overlap/catch-up/spend caps, and honest app-open-only V1
      behavior. See
      [Story AP-3](plans/07-16-agentic-platform-design.md#story-ap-3--self-scheduling-with-visible-wakes).
- [ ] <!-- workspace:id=work:ff6a7079-a42f-547c-9cf9-5299f99db4db --> **AP-4 — Outcome-driven self-improvement.** Add a local outcome/feedback
      journal and reviewable, scoped memory/prompt/skill proposals that can
      improve future task context with provenance and rollback; do not claim
      client-side weight training or permit hidden prompt, tool, provider,
      schedule, or source changes. See
      [Story AP-4](plans/07-16-agentic-platform-design.md#story-ap-4--self-improvement-through-outcomes-and-feedback).

---

## Done
- [x] <!-- workspace:id=work:4d76ebf3-5041-5b90-906c-1d62fa0c4418 --> Clean up dead code, root HTML mockups, and unused assets
- [x] <!-- workspace:id=work:4d138e5c-f16f-5d69-8697-a096dfc22303 --> Convert codebase to TypeScript
- [x] <!-- workspace:id=work:0e706610-4a77-57c3-bda5-26677a0fbe37 --> Introduce MobX object model (ChatStore / UiStore / RootStore)
- [x] <!-- workspace:id=work:9354bef3-9d3b-5c19-ac10-205fda25fe33 --> Split monolithic `chat-variant.jsx` and `gates-menu.jsx` into
      small, focused components
- [x] <!-- workspace:id=work:4aaa7e29-ecad-5b3c-bc14-4c264e27efa0 --> Document architecture, changelog, roadmap
- [x] <!-- workspace:id=work:914edb0f-d39b-50b5-8495-8599482a8ad2 --> **Phase 1**: extract `components/ui/` design-system primitives
- [x] <!-- workspace:id=work:f2c43812-d94f-5d48-ba16-01b77376ebb2 --> **Phase 2**: `LlmProvider` interface + simplified foundation router
      (OpenRouter cloud chat, Ollama local chat, local-image direct ComfyUI)
- [x] <!-- workspace:id=work:32ae9198-6532-59fe-9c93-f11b8d42bdfb --> **Phase 3**: tiny hash router (`#/thread/<id>`, `#/menu/<section>`)
- [x] <!-- workspace:id=work:5828e819-1a95-553e-b846-974552ea6d17 --> **Phase 4**: Vitest suite under top-level `tests/` + lint + typecheck CI
- [x] <!-- workspace:id=work:7bf23880-f2bc-56e8-a509-d3127a615ba9 --> **Phase 5**: Live OpenRouter catalog (`ModelRegistry` + `OpenRouterStore`,
      registry-backed model picker with pricing, API panel refresh button)
- [x] <!-- workspace:id=work:8cd93b37-4af7-596c-a0a9-91af76c5c065 --> Add minimalist Ctrl/Cmd-click copy gesture to chat messages
- [x] <!-- workspace:id=work:6e9eb501-4d66-5102-942d-c8542c687aae --> Local-only `git` tool for status, diff, add, commit, and branch work
- [x] <!-- workspace:id=work:e16bf38e-598b-5490-9e2c-5989341c2936 --> Add hybrid markdown/code Appearance tweaker with persisted presets
- [x] <!-- workspace:id=work:9f6d1d5a-6ac9-5257-84d6-c0fe051c3de5 --> Add `inspect_file` tool for compact CSV, JSON, and text inspection
- [x] <!-- workspace:id=work:f8c2bda2-a520-5843-ae42-4e5c97ff8863 --> Smooth active assistant streaming with batched text updates and incremental markdown rendering
- [x] <!-- workspace:id=work:e8c8857e-bcf5-5bef-a9bf-d5f23dc8fce7 --> Add Windows double-click launcher for chat + bridge
- [x] <!-- workspace:id=work:026c74b6-56e4-5399-bbb7-0b3a256d09d7 --> Inject runtime time, timezone, and harness context into every turn
- [x] <!-- workspace:id=work:54217281-0728-52c5-a914-4f5693dc4ee6 --> Make `inspect_file` encoding-tolerant and add artifact-first query workflows
- [x] <!-- workspace:id=work:4f42a1c8-8bac-593b-8a17-254d67d8df3d --> Start architecture boundary cleanup: move icons out of `core/`, replace
      service-to-store type imports with facades, and add staged import rules
- [x] <!-- workspace:id=work:99449c2d-5eb8-5057-a2db-9e1ea99259fb --> Extract shared tool-call rendering to `components/ui/`
- [x] <!-- workspace:id=work:62090952-f69f-5825-a6a0-90af90400e12 --> File attachments in the composer via the bridge workspace
- [x] <!-- workspace:id=work:08b30540-d491-5f1a-9335-830d12970719 --> Move attachment upload behind a `BridgeStore` facade and promote UI
      service-import boundaries to lint errors
- [x] <!-- workspace:id=work:204f0b0e-ee7b-52cc-9caa-64a3fb2166f7 --> Extract ChatStore runtime context and tool
      failure logging helpers into focused services
- [x] <!-- workspace:id=work:862bab20-a59d-5dea-a513-0d2e30c9c0cb --> Multimodal cleanup (structured tool artifacts, facade-only bridge
      service, shared `SecretKeyField`, unified image-backend types,
      `Api.tsx` split, composer upload action on `UiStore`, Routing card
      marked as Coming soon)
- [x] <!-- workspace:id=work:9c2f7c7f-8638-5ba0-afe8-bcd5c0101b45 --> Local image-gen quality pass: SDXL Lightning hi-res workflow, sweep3
      model comparison script, picker manifest auto-detect, and LLM prompt
      enhancement controls
- [x] <!-- workspace:id=work:64829e13-7846-5598-9226-1e7964746173 --> Local image-gen tuning pass: narrow FLUX.2/Z-Image winner sweep and
      Ultimate SD Upscale 2x benchmark mode
- [x] <!-- workspace:id=work:fcf9e867-0add-5907-88af-73ef6c54190d --> Prepare local image-gen finalization: SDXL quick draft lane, reusable
      final ComfyUI workflow templates, and winner selection script
- [x] <!-- workspace:id=work:e4f29eba-7d88-57d7-a4f8-9a938d9fd925 --> Add FLUX.2 Klein FP8 wide recovery benchmark for final workflow selection
- [x] <!-- workspace:id=work:aff9f24c-cc8b-583d-b4ee-3eae993946c3 --> Ollama provider — local LLMs in the model picker via the Ollama runtime
      (native NDJSON `/api/chat`, catalog refresh, status pill, per-model
      `supportsTools` allowlist, global tool-calls toggle)
- [x] <!-- workspace:id=work:9028709c-0a43-5d70-9629-195d3443df84 --> Add local image-generation size controls: named aspect ratios plus
      explicit pixel dimensions for ComfyUI
- [x] <!-- workspace:id=work:25de2480-7cc9-563d-a716-e02e22deb296 --> Add a dedicated Local menu for Ollama, ComfyUI, and local vision setup
      (auto-detect install paths, managed Start/Stop, live logs, ComfyUI CORS
      flags, local vision `describe_image` tool)
- [x] <!-- workspace:id=work:43fcdc8f-bcca-546a-8479-00f25fc83313 --> Add ComfyUI direct-image Draft / Normal / Upscale model choices plus
      FLUX.2 Klein hires-fix controls for offline local image generation
- [x] <!-- workspace:id=work:1da25d9b-036b-5d70-9eae-c557caae6ecc --> Add `image_generate` prompt-file batch mode for overnight queued local
      image runs
- [x] <!-- workspace:id=work:9df521bb-d264-5a02-a23b-79ae467717d2 --> Trim unfinished integrations back to a manual-test foundation:
      OpenRouter, Ollama, ComfyUI, memory/notes/thread, and workspace tools
- [x] <!-- workspace:id=work:ee6f8bb3-8842-5164-a5d7-e574e9b45429 --> Add model-picker Favorites with relative cost labels and provider-grouped
      OpenRouter catalog organization
- [x] <!-- workspace:id=work:ca2e0490-5137-5e82-981f-818ef1d6af6e --> Remove unfinished HTML artifact and dead theme/header/send variant
      surfaces from the foundation
- [x] <!-- workspace:id=work:08baa8e4-829b-5da5-983d-d327d867e5c8 --> Retire the Appearance tab and keep the foundation presentation fixed at
      Aside tool calls, Compact markdown, Obsidian code, and animations on
- [x] <!-- workspace:id=work:c95be622-9386-5218-9593-8bc4faa16aba --> Slim the settings menu to Agent, Models, Local, Workspace, Gallery, and
      Settings, with Profile folded into Agent and API renamed to Models
- [x] <!-- workspace:id=work:027e270b-5a04-5b28-a0d2-fe6ebe3e1318 --> Add a `PersistenceProvider<T>` boundary around local storage slots so
      future IndexedDB / Firestore work can swap repositories without store
      rewrites
- [x] <!-- workspace:id=work:5df546e2-5f43-5f2e-b2b0-db0d58715d09 --> Add workspace-backed chat-history persistence with readable HTML/Markdown
      exports and a protected `chat_history` tool for model-side recall
- [x] <!-- workspace:id=work:14c8ee1e-b77b-5dcc-a68a-56862a5be516 --> Add Brave Search-backed `web_search`, a Models-menu key surface, and an
      HTML artifact helper for validated workspace deliverables
- [x] <!-- workspace:id=work:0254e42c-ff5b-5e28-a5b1-8ac1384e441f --> Centralize assistant activity display into a unified ambient timeline
      for thinking, tools, terminal tails, image jobs, and bridge transitions
- [x] <!-- workspace:id=work:80e07006-8ab7-5ed9-9d6d-4936f7005edc --> Architecture-boundary hardening: make the ESLint import rules actually
      enforce UI→store→service direction (depth-agnostic globs, self-contained
      per-layer blocks), move runtime-mode detection into `core/runtime.ts`,
      add a `components/media/` home for shared image UI, add a
      `SourceWorkspaceStore` facade, and route remaining UI service imports
      through store facades
- [x] <!-- workspace:id=work:5fc5e928-2fe2-5c41-b958-7b38935149dd --> Project-showcase pass: recruiter-facing `README.md`, root decluttered
      (scratch notes relocated under `docs/notes/`), dead code removed
      (`core/modelMenu.ts`, unused persistence/context exports), and
      previously-silent store failures logged
- [x] <!-- workspace:id=work:b6c3979d-adfb-5b9e-9e29-5aabcd012fb9 --> Central logging + self-diagnosis: a `services/diagnostics/logger`
      (ring buffer + console + bridge-file sinks), a `logs` tool so the
      assistant can read its own logs, and a full `console.*` → logger migration
- [x] <!-- workspace:id=work:31719833-4ea7-56ca-9686-0f54dbd0b51b --> Maxed-out lint enforcement: `no-console`, `consistent-type-imports`,
      no `fetch` in stores, no `localStorage` in stores/UI, `import/no-cycle`,
      and `mobx/*-make-observable` correctness rules — with the surfaced
      violations refactored through services/facades
- [x] <!-- workspace:id=work:91ed412e-4f63-5b4d-bd5c-3f7d1d03b04e --> Sidebar body search across thread titles and message bodies, real
      persisted user-togglable model favorites, and a broad Playwright UI suite
      (faked-bridge desktop project + web-lite project, mocked OpenRouter stream)
- [x] <!-- workspace:id=work:14bf399d-0f8b-57eb-8be3-2028a76c060d --> Model picker redesign with runtime availability gating: a pure
      `core/modelPickerAvailability` decides which sources/models are usable
      (web-lite hides Local/Image; offline Ollama and not-ready ComfyUI are
      hidden, not shown-disabled), prominent live-verified catalog section,
      vision/tools/reasoning/fast/free capability chips, and a hardened
      direct-image path (ComfyUI-ready guard + forced local-comfy backend)
      with new picker/availability/guard tests
- [x] <!-- workspace:id=work:a5725bb9-176b-5c35-8b9c-a2efc6a97bbd --> Web Lite persistence fix + UX pass: the `ChatStore` autosave reaction now
      deep-observes nested thread/message edits (in-place message appends and
      streamed tokens previously never triggered a save, losing fresh
      conversations on reload), plus a sidebar cleanup (single-line titles,
      wider nav, pin/trash icons, no preview line), an intuitive first-run
      onboarding panel, explicit Web Lite desktop-only states for Workspace and
      Gallery, and an API-key-forward Settings page

## Near-term
- [x] <!-- workspace:id=work:a195bb57-d50e-5521-b2aa-b84d24a306e0 --> **Multimodal + image-gen, phased** — see `docs/plans/2026-04-26-multimodal-and-imagegen.md`
      - [x] <!-- workspace:id=work:a54e9586-4ebf-58e5-90d1-d124419b3009 --> Phase 1: Vision input (cloud + local), content-parts at the wire boundary
      - [x] <!-- workspace:id=work:97b8047a-c341-5bd0-b792-ce1bcaad2032 --> Phase 2: Historical fal.ai cloud image generation; later removed from the foundation
      - [x] <!-- workspace:id=work:0e670164-757b-52fa-acb7-49cee1cbea1c --> Phase 3: Local image-gen backend (ComfyUI) behind same `image_generate` tool
- [x] <!-- workspace:id=work:067398fa-33a7-5558-bd8e-cde6dd80b9c9 --> Add a verified default OpenRouter catalog for the current leading
      OpenAI, Anthropic, Gemini, Grok, Meta, NVIDIA Nemotron, DeepSeek, and
      Kimi models, with per-thread thinking effort controls and opt-in live
      compatibility tests.
- [x] <!-- workspace:id=work:7bd7e6d0-37fa-5e35-8b1b-4fbd418be342 --> **2026-07-02 delegated feature/refactor pipeline (waves A–C)**:
      - [x] <!-- workspace:id=work:50f75bc9-1bc3-5f42-acf0-c56cfa957f5c --> CI hygiene: Rust tests in CI (windows-latest), single vitest config,
            portable `npm run ci`
      - [x] <!-- workspace:id=work:a311064e-692b-53c3-97e3-5fcc4c1ab56a --> Ctrl/Cmd+K command palette (thread search + actions) and app
            keyboard shortcuts (Ctrl+N new thread, Ctrl+L composer, Ctrl+, menu)
      - [x] <!-- workspace:id=work:cc6c13d9-2ed1-5e95-aa09-48b1599bba35 --> Versioned JSON export/import of all app data (merge/replace modes,
            secrets excluded and tested)
      - [x] <!-- workspace:id=work:9bb33f1d-1bfd-50be-b9bf-8b7626bd6b6b --> API keys in the OS credential store on desktop (`keyring` crate,
            Windows Credential Manager) with Web Lite localStorage fallback and
            safe one-time migration
      - [x] <!-- workspace:id=work:f97aa66c-b688-5f2f-a7c4-9bfa1a3cda2b --> `StreamingRoundExecutor` extracted from `ChatStore` with a unified
            abort envelope and transient-provider retry policy (backoff, never
            after user abort or first content)
      - [x] <!-- workspace:id=work:96e0753b-7e84-5a6d-a35a-4294c23c7242 --> Message edit-and-resend, regenerate, and branch-from-message with
            inline destructive confirmations and a sidebar-clickability
            regression test
      - [x] <!-- workspace:id=work:1dbec4dd-87db-5154-bb26-2df548a19c74 --> Incremental streaming markdown chunking (append-only tail re-parse,
            stable chunk keys, seeded equivalence tests)
      - [x] <!-- workspace:id=work:8edd31f9-222d-5d23-8fd0-c16ad401b0d2 --> Real usage/cost tracking: normalized per-message usage, per-thread /
            per-model / per-day selectors, and a live Usage menu section
      - [x] <!-- workspace:id=work:47441734-47eb-5af5-8d7a-dce823ba4f3c --> Persistence hardening: snapshot `schemaVersion` + migration
            registry, future-version backup keys, IndexedDB archive tier
            (20 hot threads, stubs + async hydration, write-order safety), and
            a proactive 3.5MB archive threshold
      - [x] <!-- workspace:id=work:f5a6b799-0ac7-5670-a4d0-7faa77a02cf5 --> MCP client support (streamable HTTP): server manager UI, dynamic
            `mcp_<server>_<tool>` registry tools with schema passthrough,
            32k result cap, header secrets via `secretStorage`
- [x] <!-- workspace:id=work:094d7210-c8bc-5051-b9de-7fad04215b39 --> Wave D refactor: `TurnRunner` extraction from ChatStore, shared LLM
      stream-parsing core (openaiCompat/ollama), `useEditorial()` store facade,
      message-list windowing, ModelPopover memo consolidation
      *(done 2026-07-10 — TurnRunner, shared stream core, useEditorial facade, list windowing, ModelPopover memo)*
- [ ] <!-- workspace:id=work:d44276ce-f85a-54b7-9678-2d2af968dfe7 --> Manually test the foundation surface before rebuilding optional integrations
- [x] <!-- workspace:id=work:5b9b18c4-45cf-55b0-8d9b-162eb8e595df --> Add basic unit tests around `ChatStore` (send, stream, switch, stop) —
      covered by `tests/stores/ChatStore.test.ts` and the full Vitest suite
- [x] <!-- workspace:id=work:cabc99db-cf21-5eb7-ab7c-9e518e59e5f4 --> **Audit follow-ups** — see `docs/audits/2026-06-07-comprehensive-audit.md`
      - [x] <!-- workspace:id=work:75a45bcd-9ac3-5fe5-bc12-74fc660d2312 --> Multi-tab localStorage warning banner + save pause on chat key conflict
      - [x] <!-- workspace:id=work:f09623c4-e6c3-5657-8131-b6de96e46245 --> Chat-history protection across tool paths + mirror scope (Batch A)
      - [x] <!-- workspace:id=work:23c1dcd4-b05b-5451-88af-78b4112104e3 --> Image-job cancel serialization + stale turn finalization guards (C2/C4)
      - [x] <!-- workspace:id=work:9983a4ff-350e-5afb-afa5-624b3ae94757 --> Manual rename blocks auto-naming; summary scheduler respects background streams + deleted threads
      - [x] <!-- workspace:id=work:661c6862-2668-50c8-9f95-da93335f401d --> Per-thread composer draft and error banner scoping
      - [x] <!-- workspace:id=work:fa463f78-03de-5640-8b3b-b04200273f16 --> User-visible persistence quota / compaction notices
      - [x] <!-- workspace:id=work:bd558aaf-7a0f-562a-8d60-8d2fc11f2677 --> Batch C–E: Models copy, context-aware banners, setup checklist, image UX polish, notes limits/quarantine, Web Lite clear reload
      - [x] <!-- workspace:id=work:e8ef8734-86fc-5e66-b8ca-683b63c4b214 --> Audit documentation: test coverage matrix + implementation guide (`docs/audits/2026-06-07-*.md`)

## Wave F — agentic capabilities (shipped 2026-07-03)
- [x] <!-- workspace:id=work:c1d04c8c-0e5c-52a9-a18d-36fab0f6a1ac --> Local semantic memory (RAG): Ollama embeddings + IndexedDB vectors over
      chats/notes/memories, `recall` tool, optional auto-context injection
- [x] <!-- workspace:id=work:4db482c0-c65e-5e70-a594-6968663c8be7 --> `fetch_page` tool: Rust-side reqwest fetch + readable-text extraction
      (https-only, private-IP blocked, size-capped) so the model can read pages
- [x] <!-- workspace:id=work:2d739c8a-1f45-5329-b1ba-2bdb1170a45a --> Skills packs: `workspace/skills/*.md` prompt packs with optional tool
      allowlists, composer picker, per-thread activation
- [x] <!-- workspace:id=work:b972961f-ecdc-5ddc-bd18-89106aaccca0 --> Sub-agents v1: `spawn_task` tool running a scoped background TurnRunner
      loop (one concurrent, round-capped), status surface, results linked back

## Wave G — agentic depth (shipped 2026-07-05)
- [x] <!-- workspace:id=work:73fa547c-6a75-5ca3-885f-73ebc390dc79 --> Sub-agents v2: multiple parallel tasks, model-customizable model/system
      prompt/delayed start per task
- [x] <!-- workspace:id=work:a1628333-9f8c-53d1-855e-608e309b8c6f --> Screenshot tour harness: Playwright script capturing every screen/menu
      section (desktop-mocked + web-lite) into docs/screens/ for future audits
- [x] <!-- workspace:id=work:86297526-1fa9-5a6c-8cc3-900a0b92f5a0 --> Self-improvement loop UI: diff review for source-workspace edits,
      build-output panel, install handoff, source-change context for the model
- [x] <!-- workspace:id=work:e0351841-1e7a-5329-9409-77d85ce13299 --> Scheduled tasks v1 (app-open scheduler + schedule_task tool)
- [x] <!-- workspace:id=work:ac8a1100-e210-54b7-95d7-840351c7a41c --> MCP stdio transport (user-configured local server processes, Rust-managed)

## Wave I — daily-feel + loop depth (shipped 2026-07-06)
- [x] <!-- workspace:id=work:fe22051e-7687-508e-ae59-3dac40652fb9 --> Light theme ("paper") with dark/light/system modes, contrast unit tests,
      and a committed light-theme screenshot set
- [x] <!-- workspace:id=work:2b390c52-d26b-5e0b-b3e5-40c58b148209 --> Global summon shortcut (configurable, default Ctrl+Shift+Space), tray
      icon with toggle/new-conversation/quit, optional hide-to-tray
- [x] <!-- workspace:id=work:e77db01a-de1f-53b7-b2a5-3928a3458c09 --> Self-improvement loop: test job (npm ci/test/typecheck/lint) in the
      source copy with streamed per-step status, edit→test→build agent
      guidance, soft stale-tests warning on Run build, test state in the
      model's runtime context

## Open-models-first audit (DONE 2026-07-05 — see docs/audits/2026-07-05-open-models-audit.md; Wave H shipped fixes)
- [x] <!-- workspace:id=work:a63eb481-ae0d-5f5a-8d72-91ea8c1ace1c --> *(verified already-done, 2026-07-10 truth pass — audit doc `docs/audits/2026-07-05-open-models-audit.md` exists; section header records Wave H shipped the fixes)* Walk EVERY screen with the lens "what do I do if I'm running open/local
      models only?" — the app currently reads API-first in many surfaces
      (model picker defaults, usage panel framing, onboarding order, error
      copy, thinking-effort controls that are OpenRouter-only, catalog
      language). Use the docs/screens/ corpus + user-story review per screen.

## Future ideas backlog (2026-07-03 analysis)

> Backlog / aspirational — not scheduled (truth pass 2026-07-10)

### UI/UX
- [ ] <!-- workspace:id=work:b2aef68d-e40b-5c13-b9f2-42bb69277c29 --> Fix pre-existing e2e failure: artifactContract.spec.ts "opens a registry artifact from the palette in the dock" — dock-panel iframe [title="Preview of Status board"] never appears (fails identically on pre-merge master 7fbac5c; not a Wave-D regression; found 2026-07-18)

- [x] <!-- workspace:id=work:9683527f-7989-51cf-b8a9-7db1dfe8914c --> Light theme + follow-system (`prefers-color-scheme`); "paper" palette *(verified already-done, 2026-07-10 truth pass — Wave I; dark/light/system `ThemeMode` in `src/components/menu/sections/Settings.tsx`)*
- [x] <!-- workspace:id=work:2a9701d2-4521-58dc-9d4c-fed23ead2d8d --> Sidebar date grouping (Today / Yesterday / Previous 7 days) *(done 2026-07-10, burndown w1 — `groupThreadsByDate` in `src/core/threadSelectors.ts`; sidebar history now splits under Today / Yesterday / Previous 7 days / Previous 30 days / by-month headers)*
- [x] <!-- workspace:id=work:ae5fd319-443d-5f92-a3a6-742b633ebde9 --> Inline thread rename (F2 / right-click) and drag-to-reorder pins *(done 2026-07-11 — keyboard/context-menu rename with commit/cancel semantics; persisted user-defined pinned ordering)*
- [x] <!-- workspace:id=work:fd4ccf0c-f08c-5f3d-bbc4-44ec234ea9b3 --> Global summon shortcut + tray icon (Tauri global shortcut) *(verified already-done, 2026-07-10 truth pass — Wave I; tray in `src-tauri/src/desktop.rs`)*
- [x] <!-- workspace:id=work:56bf7225-4717-5363-9de5-2d329d468190 --> Jump-to-bottom pill with new-tokens indicator; sticky date separators *(done 2026-07-11 — history-aware follow-stream pill with live-response pulse; local-day message groups with sticky viewport headers)*
- [x] <!-- workspace:id=work:ad1e0f75-76e5-53d1-be20-73d9d2d15d8c --> Composer: up-arrow recall, paste-image, window-wide drag-drop *(done 2026-07-11)*
- [x] <!-- workspace:id=work:4ee08fe2-d8e1-583a-a11d-175e930d52c4 --> Auto-collapse tool outputs over ~40 lines *(done 2026-07-10, burndown w2)*
- [x] <!-- workspace:id=work:8bba4e41-b3d4-56dd-bfef-1678335e5c15 --> What's-new panel on version change *(done 2026-07-11)*
- [x] <!-- workspace:id=work:002406ae-0a1a-5a54-949e-68ab6560355d --> Onboarding v2: bundled "tour" thread showing tools/artifacts/images *(done 2026-07-11)*

### Architecture
- [x] <!-- workspace:id=work:ee679d03-c2e8-5588-b952-89dcb548b864 --> Unify message model into content-parts (text/tool/image/artifact parts)
      *(done 2026-07-11 — ordered part model, versioned legacy migration,
      centralized compatibility selectors/render dispatch, incremental streaming,
      and ordering/migration/round-trip coverage)*
- [x] <!-- workspace:id=work:edc5d8eb-c809-5e1c-96b3-6755deb24f91 --> Split EditorialComposer (~840 lines) into Input/AttachmentTray/
      ModelControls/SendPipeline *(done 2026-07-10, burndown w11 — pure refactor;
      `EditorialComposer.tsx` is now a ~270-line orchestrator delegating to
      `components/editorial/composer/`: `ComposerInput`, `AttachmentTray`,
      `ComposerMeta` (model/skill pickers + context/thinking selects), `ContextMeter`,
      `ComposerBanners`, `SkillPopover`, the `useComposerDraft` send/draft pipeline,
      and shared `composerStyles`/`composerAttachments`. Public props unchanged;
      DOM/classes byte-identical so the existing unit+e2e suites stay green)*
- [x] <!-- workspace:id=work:a36b5968-8512-5c16-a502-eef6e4a90a09 --> <!-- closed 2026-08-12: superseded by landed work — both halves already [x] in this file (version handshake done 2026-07-10, protocol spec done 2026-07-16; docs/bridge-protocol.md exists) --> Bridge protocol doc + version handshake (fail loud on mismatch)
- [x] <!-- workspace:id=work:4a7c74f1-3d0e-5b4d-abfe-c7083e6884d2 --> Headless core entry (boot RootStore without React) → CLI mode, scripted
      smokes, scheduler runner *(done 2026-07-11)*
- [ ] <!-- workspace:id=work:cefdd360-33cf-5cb2-880c-28bde875271e --> Decide deliberately: Go bridge vs folding into a Rust sidecar
- [ ] <!-- workspace:id=work:21c30c49-4ffc-5b1d-8937-c3e9f5ff8587 --> **Declarative bridge sandbox policy** *(deep research 2026-07-23 — see
      IDEAS #19)*: ADR on replacing the hardcoded path-jail + exec-allowlist
      with a declarative policy file (OpenShell pattern: hot-reloadable network
      policy, creation-locked filesystem policy). Apache-2.0 → pattern-first,
      not a casual copy.
- [ ] <!-- workspace:id=work:401169b1-1191-516d-a835-2525ca9d956e --> **`proxy_localhost` Rust command to retire the ComfyUI CORS workaround**
      *(deep research 2026-07-23 — see IDEAS #20)*: route localhost calls
      through Rust (pattern from a same-stack MIT peer), removing the
      `--enable-cors-header` requirement for ComfyUI/Ollama.
- [ ] <!-- workspace:id=work:50c11853-92d5-5d49-8196-08971f492963 --> **`LocalBackends` process-lifecycle manager** *(IDEAS #20)*: auto-start +
      orphan-cleanup for Ollama/ComfyUI/Whisper via Tauri's setup hook; shared
      groundwork for the voice sidecar (IDEAS #9).

### Performance
- [ ] <!-- workspace:id=work:7ae200d5-f3c2-5739-a165-ee752d9ff8a8 --> Cold-start budget (<1.5s to interactive): lazy menu sections, idle-time
      catalog hydration, audit source-snapshot resource cost in installer
- [ ] <!-- workspace:id=work:4e2de3ec-64cf-56f3-99a4-19a806288f07 --> IDB background compaction; storage stats in Usage panel
- [ ] <!-- workspace:id=work:fe949aab-1253-5f19-8fc6-46dfac8129a7 --> Rust release profile tuning (thin LTO, strip) for installer size
- [x] <!-- workspace:id=work:9edd7fe3-ed4b-5cd1-87d5-a5299becf37e --> Adaptive streaming reveal pacing (faster catch-up when far behind) *(done 2026-07-11)*

### State & data
- [x] <!-- workspace:id=work:cd58ee40-b39a-5acb-9ef3-b4dffa975714 --> Web Locks API leader election for multi-tab (replace pause-on-conflict) *(done 2026-07-11)*
- [ ] <!-- workspace:id=work:f8866426-ae5e-5c01-88e4-d9cde1d58a9d --> Generalized undo (command pattern) for destructive ops
- [ ] <!-- workspace:id=work:057a4e48-cd89-532f-82fe-5e0a274a2fa8 --> Per-thread system-prompt presets (Coding / Writing / Research) *(UX
      reference: Cherry Studio's browsable assistant/preset library — AGPL-3.0,
      borrowable; deep research 2026-07-23)*
- [ ] <!-- workspace:id=work:d66f1361-2a67-5378-9732-4ec1f31aec05 --> **RAG refinement: workspace-isolation + hybrid retrieval** *(deep research
      2026-07-23 — IDEAS borrow map)*: evaluate AnythingLLM's collection
      isolation (no cross-contamination) + HNSW+BM25 hybrid retrieval against
      our current local RAG. AnythingLLM is MIT → retrieval code is copyable.

### Platforms & compatibility
- [x] <!-- workspace:id=work:6add9d9e-c14f-572b-9b98-7d6eb3421199 --> <!-- closed 2026-08-12: duplicate — the stamped macOS-build item with acceptance criteria (work:9afa188d) stays open; this was the bare restatement --> macOS build (keyring apple-native already enabled; needs signing)
- [x] <!-- workspace:id=work:1ae784a1-7046-5c20-b91e-9bb18ea88309 --> <!-- closed 2026-08-12: shipped as W-5 auto-updater 2026-07-12 (changelog; roadmap W-5 [x]) --> Opt-in Tauri auto-updater (signed, OFF by default)
- [x] <!-- workspace:id=work:97449968-7744-50df-8336-52572d61e987 --> <!-- closed 2026-08-12: exact duplicate of the open portable-mode item work:5b20c8a4 --> Portable mode (zip, data beside exe)
- [x] <!-- workspace:id=work:f312b871-9879-5b58-9d9d-c53af696b2bb --> <!-- closed 2026-08-12: duplicate of the open LAN-companion item work:12d246aa --> LAN companion: bridge serves Web Lite on LAN with pairing code (phone
      access, data never leaves the network)

### Cloud (strictly opt-in; local-only remains the default)
- [ ] <!-- workspace:id=work:19a067af-462c-59e0-9eca-e1a33d8de41b --> E2E-encrypted sync to user-owned storage (S3/Drive/WebDAV, user key)
- [ ] <!-- workspace:id=work:9a326e3f-852d-508a-9518-99b45d794e0b --> Share thread as single-file HTML

### Docs & stories
- [ ] <!-- workspace:id=work:4ae6cc8c-8cc6-51d6-a8bd-f0a35eeee458 --> Refresh handbook user stories for palette/onboarding/MCP/usage; retire
      delivered ones
- [ ] <!-- workspace:id=work:93711465-9af2-5647-b733-bc6c162e927f --> ADRs for standing decisions (bridge language, Firestore parked, updater)
- [ ] <!-- workspace:id=work:4083be80-3b49-5aee-b848-d769317bfebd --> Refresh bundled in-app user guide
- [x] <!-- workspace:id=work:899af7a7-25ef-57fd-af23-065262061907 --> Bridge protocol spec in docs/ *(done 2026-07-16, codex lane: docs/bridge-protocol.md audited/completed against code incl. protocolVersion 2 handshake, envelope types, Privileged flag, compat matrix)*

### Tooling & release
- [x] <!-- workspace:id=work:b0b0c98a-fe9b-57c1-837f-e9bb7c1fa43c --> Changelog automation from commits *(local script half done 2026-07-16: scripts/generate-changelog.mjs drafts grouped entries from conventional commits, --write inserts a marked DRAFT section; nightly channel deferred until GitHub Actions billing is fixed)*
- [x] <!-- workspace:id=work:a4f4a67a-0870-5b88-ba8f-71c9ea94d814 --> <!-- closed 2026-08-12: duplicate of the [x] 'Windows e2e job in CI + Playwright traces (done 2026-07-10)'; ci.yml has the e2e-windows job and trace upload. Only the trailing word 'coverage' was unlanded — re-file a coverage item if still wanted --> Windows e2e job in CI; upload Playwright traces on failure; coverage
- [ ] <!-- workspace:id=work:9132ce85-9bfd-52c6-b536-861b06a5b9a9 --> Settings-only config profile export

### Moonshots / new directions
- [ ] <!-- workspace:id=work:af244cfb-149d-5113-9787-651a6c5b0ec6 --> **Cowork mode** (designed, not scheduled): the first *push* capability —
      opt-in per-folder file watching (Rust `notify`) that surfaces a
      dismissible SUGGESTION chip when a watched file changes ("new CSV — want a
      summary?"); one click spawns a background agent task with the file as
      context. Turns the app from "one you open" into "a coworker who's around,"
      composing with global summon + tray. Hard constraints: suggests, never
      auto-executes; watched-file CONTENTS are never treated as instructions
      (instruction-source boundary); rare + rate-limited + easy to mute; opt-in,
      off by default; fully local. Its own wave when picked.
- [ ] <!-- workspace:id=work:561797dc-acd2-5ca1-a559-b09fc402a7b4 --> Duel mode: two models side-by-side or cross-reviewing *(prior art:
      Cherry Studio multi-model simultaneous chat — AGPL-3.0, same license, so
      code is borrowable; deep research 2026-07-23, IDEAS #7)*
- [ ] <!-- workspace:id=work:9df8a381-2c45-51db-bb06-4625ff07e6df --> **Spatial branching-conversation canvas** *(deep research 2026-07-23 —
      IDEAS #15)*: merge branching threads + Canvas artifact into one React
      Flow node graph (branch/merge/modify visually). GitChat is the pattern
      reference (unlicensed → study only, no code copy).
- [ ] <!-- workspace:id=work:524be83b-60df-5c12-bb8f-1f8686d3f3ac --> **Async approval inbox + approve/redirect gate** *(Ethan 2026-07-23, from
      OpenWorker comparison — see IDEAS #17)*: consequential agent asks
      (write/send/shell) park in an inbox instead of blocking, turning
      spawn_task + the Task center into a real async-agent surface; the gate
      adds edit-before-run "redirect" alongside approve/deny. Highest-value of
      the OpenWorker borrowings; upgrades a subsystem we already own.
- [ ] <!-- workspace:id=work:0bd46075-655b-55cf-94d0-ebb68d4c9c8e --> **Deliverables as a first-class object** *(Ethan 2026-07-23 — see
      IDEAS #18)*: promote a task/turn's output to an openable/shareable
      workspace file with provenance back to the chat; composition of existing
      artifact/workspace/libraryExport primitives, framed for our chat-first
      identity.
- [ ] <!-- workspace:id=work:c6794eac-fe52-592b-ac8d-bb2b44d584e2 --> **Local-first voice pipeline** *(Ethan 2026-07-23 — see expanded
      IDEAS #9)*: `STT → LlmProvider → TTS` sidecar (whisper.cpp/Moonshine +
      Silero VAD + Piper), STT-input-only first; native realtime stays an
      optional cloud toggle, never v1.
- [ ] <!-- workspace:id=work:da06e3fb-2586-5dfe-9937-9fe9fe9500cc --> **External-tool add-on via plugin packs / MCP-stdio** *(Ethan 2026-07-23
      — see IDEAS #2)*: let users add tools without forking, as an opt-in
      add-on on the sanctioned plugin-pack path — NOT a revival of the
      de-scoped always-on MCP client.
- [ ] <!-- workspace:id=work:07087be8-2752-51de-9d15-bace97a5a9ec --> Canvas/whiteboard artifact type for planning sessions *(2026-07-18,
      lane `canvas-whiteboard-artifact`; plan landed at
      `docs/plans/unblock-canvas-whiteboard-artifact-type-for-plan-20260718/`;
      implementation dispatch pending)*
- [x] <!-- workspace:id=work:ba46dba4-465e-51de-8f33-51ba03ae7b0c --> In-app `ollama pull` with progress for missing local models *(done 2026-07-16, codex lane: streamed /api/pull progress UI with cancel/failure/already-installed handling, explicit user action only, Web Lite explainer degradation; service + component tests)*
- [ ] <!-- workspace:id=work:355f50f1-39cc-58c1-97cc-ea7479bc970f --> Record the self-improvement demo (app edits itself, rebuilds, asks to
      update) once the loop closes

### Suggested release sequencing
- 4.2: semantic memory + fetch_page + sidebar QoL
- 4.3: sub-agents + scheduled tasks + light theme + global summon
- 5.0: self-improvement loop closed + macOS + opt-in updater + content-parts

## Later
- [ ] <!-- workspace:id=work:c5ba7630-1af7-5cfd-8683-0802e6da8523 --> Multi-window / split-thread layouts
- [ ] <!-- workspace:id=work:3a842537-2d95-53f2-abc5-e44066aeedc5 --> Extend `inspect_file` to source-code structure (`py`, `js`, `ts`, `go`)
      *(2026-07-18, lane `extend-inspect-file-to-source-code`; plan landed at
      `docs/plans/unblock-extend-inspect-file-to-source-code-struc-20260718/`;
      implementation dispatch pending.)*
- [ ] <!-- workspace:id=work:3cda017a-0638-50fb-8baa-b2f670ffc3ee --> Extend `inspect_file` to document formats (`pdf`, `docx`, `xlsx`)
      *(2026-07-18, lane `extend-inspect-file-to-document-formats`;
      plan landed at
      `docs/plans/unblock-extend-inspect-file-to-document-formats--20260718/`;
      implementation dispatch pending.)*
- [ ] <!-- workspace:id=work:918a0bf6-513c-5397-ac07-5dce20efb539 --> Release pipeline: publish the macOS .dmg (+sig) as a stable public asset alongside win/linux — v4.6.1 shipped win+linux only (2026-07-14)
- [ ] <!-- workspace:id=work:cfbfe9f5-0430-5f71-b77a-73a25de6a70a --> Adopt headless `@shadcn/react/message-scroller` (MIT, unstyled) to replace hand-rolled chat scroll logic — owns streamed-reply anchoring, thread restore, jump-to-message (we already patched one scroll-follow bug, LF-4). Keep GatesAI's own styles; also mirror shadcn's Marker slot pattern for tool-activity/streaming rows. Ref: https://ui.shadcn.com/docs/changelog/2026-06-chat-components (Ethan design-input packet, 2026-07-14)
