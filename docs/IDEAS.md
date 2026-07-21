# Expansion ideas — ranked

Ranked by leverage (impact relative to effort) for the project's actual goals:
a portfolio-flagship, local-first AI workspace that is credible as an
open-source product. Ratings: impact and effort are Low / Med / High. "First
step" is sized so a context-free agent session can start immediately. Existing
groundwork is cited so nobody rebuilds what exists.

Complements `docs/roadmap.md` (execution plan) — this file is the option pool.
The "Future ideas backlog" section of the roadmap holds smaller UX items;
these are the strategic bets.

---

### 1. Agent eval harness (regression-tracked tool benchmarks)
- **Impact: High · Effort: Med**
- **Rationale:** The differentiator. Almost no local-first chat app can *prove*
  its agent tooling works; this repo already has repeatable infrastructure —
  a mocked-bridge Playwright project, a live model-compat runner
  (`scripts/model-compat/` writes reports to
  workspace artifacts), and deterministic tools. A harness that runs fixed
  tasks ("summarize this CSV via `inspect_file`", "find X via `fetch_page`",
  "multi-step fs edit") against a model matrix and diffs scores per release
  turns "trust me" into a chart — great for the README and genuinely useful
  for choosing local models.
- **First step:** Design doc in `docs/plans/`: task format (YAML/JSON of
  prompt + expected checks), scoring (exact/regex/LLM-judge-optional), and
  where results live (`/workspace/artifacts/evals/`). Reuse the
  compatibility-store pattern; prototype 3 tasks against Ollama.

### 2. Tool/plugin packs (formalize the one-file tool SDK)
- **Impact: High · Effort: Med**
- **Rationale:** Adding a tool is already "one file plus one registry line"
  (`src/services/tools/registry.ts`), and Skills packs already load prompt
  packs with tool allowlists from `/workspace/.gatesai/skills`. Extending that
  to *tool* packs (declarative manifest + sandboxed execution via the bridge)
  creates an ecosystem story without inventing a runtime.
- **First step:** Write `docs/plans/` design: what a pack manifest declares and
  whether packs map to native registry tools or a future parked MCP-stdio path.

### 3. MCP *server* mode (expose GatesAI tools to other agents) — parked
- **Impact: High · Effort: Med**
- **Status (2026-07-19):** MCP client support was parked in the depth-over-breadth
  de-scope. This idea stays as a future inversion (GatesAI as a loopback MCP
  server) once the core tool UX is top-tier again; do not treat the app as an
  MCP client today.
- **First step when unparked:** Spec which registry tools are safe to expose and
  the consent UX; implement in `../gatesai-bridge`, not as a half-wired client.

### 4. Cowork mode (already designed — see roadmap Moonshots)
- **Impact: High · Effort: High**
- **Rationale:** The first *push* capability: opt-in folder watching surfaces
  a suggestion chip ("new CSV — want a summary?") that spawns an agent task.
  Design and hard constraints (suggest-never-execute, instruction-source
  boundary, rate limits) are already written in `docs/roadmap.md`. Turns the
  app from "one you open" into "a coworker who's around."
- **First step:** Rust `notify`-based watcher command in `src-tauri/` behind a
  feature flag + a `SuggestionsStore` with the rate-limit rules; UI chip last.

### 5. Native Anthropic + OpenAI providers — intentionally out of floor
- **Impact: Med · Effort: Med**
- **Status (2026-07-19):** Routing floor is OpenRouter + Ollama (+ ComfyUI for
  image). Direct Anthropic/OpenAI adapters and the custom OpenAI-compatible
  endpoint were removed on purpose; new cloud models arrive as OpenRouter
  routes, not new first-party adapters.
- **Revisit only if:** OpenRouter cannot carry a capability users need, and
  the product principle still allows a second cloud key path.

### 6. Headless core / CLI mode
- **Impact: Med-High · Effort: Med**
- **Rationale:** Backlog item with outsized payoff: boot `RootStore` without
  React → scripted smokes, a real scheduler runner, and the eval harness (#1)
  gets an execution vehicle for free. Also the cleanest proof that the
  UI→store→service layering is real.
- **First step:** A `scripts/headless-smoke.mjs` (or vitest "integration"
  entry) that constructs RootStore with node-friendly persistence fakes and
  runs one mocked turn end-to-end; document what breaks.

### 7. Duel mode (two models side-by-side / cross-review)
- **Impact: Med · Effort: Med**
- **Rationale:** Great demo material and genuinely useful for model choice —
  and it feeds #1's scoring UX. The turn pipeline already supports parallel
  agent tasks (3 slots), so the mechanics exist; the work is UI (split thread
  view) and a comparison affordance.
- **First step:** Spec a minimal version: one prompt fans out to two
  `spawn_task` threads pinned side-by-side; defer inline diffing.

### 8. Share thread as single-file HTML
- **Impact: Med · Effort: Low**
- **Rationale:** The readable HTML/Markdown chat-history mirror
  (`services/chat/libraryExport.ts`, `workspaceChatPersistence.ts`) already
  renders threads to HTML. Packaging one thread as a self-contained file is a
  small step and gives users the first way to show their work — a viral loop
  for an otherwise fully-local app.
- **First step:** Add an "Export thread as HTML" action reusing libraryExport,
  inlining CSS/images (data URIs), with a footer crediting the app.

### 9. Whisper-based local voice input
- **Impact: Med · Effort: Med-High**
- **Rationale:** "Talk to your local model, fully offline" matches the product
  promise and demos brilliantly with global summon + tray (already shipped).
  whisper.cpp via a Tauri sidecar or the bridge keeps it local. Scope creep
  risk: input only, no TTS at first.
- **First step:** Feasibility spike doc: sidecar vs bridge process, model
  download UX (reuse the in-app Ollama-pull pattern), push-to-talk in the
  composer.

### 10. E2E-encrypted sync to user-owned storage
- **Impact: Med-High · Effort: High**
- **Rationale:** The most-requested feature category for local-first apps
  (second device, phone later). User-key-encrypted blobs to S3/Drive/WebDAV
  preserves the "your data" promise. High effort: conflict resolution needs
  the multi-tab merge problem solved first (Web Locks backlog item), and the
  message model ideally becomes content-parts before the schema calcifies.
- **First step:** ADR: sync unit (thread vs slot), encryption scheme, and the
  dependency ordering vs content-parts; no code.

### 11. Content-parts message model
- **Impact: Med (enabler) · Effort: High**
- **Rationale:** Backlog item; unlocks #10, cleaner multimodal, richer
  artifacts. Pure refactor with migration risk — schedule deliberately, with
  the persistence migration registry (`services/persistence/migrations.ts`)
  doing the heavy lifting.
- **First step:** Write the target schema + migration plan doc; inventory
  every reader of `message.text`/tool fields.

### 12. Public benchmark page fed by the eval harness
- **Impact: Med · Effort: Low (after #1)**
- **Rationale:** Publish harness results ("local model X completes 7/10 agent
  tasks") as a static page next to the Web Lite demo. Recruiter-visible,
  community-attracting, zero runtime cost.
- **First step:** Blocked on #1; then a script converting eval artifacts to a
  static HTML table deployed with the Pages workflow.

### 13. In-app "What's new" + guided tour thread
- **Impact: Low-Med · Effort: Low**
- **Rationale:** Backlog items (what's-new panel, onboarding tour thread) that
  matter disproportionately once strangers install the app from a public
  README. Cheap polish for the open-source push.
- **First step:** Ship a bundled read-only tour thread demonstrating tools,
  artifacts, and images; version-gate a what's-new dialog off
  `tauri.conf.json` version.

### 14. Mobile access via LAN companion
- **Impact: Med · Effort: High**
- **Rationale:** Backlog moonshot: bridge serves Web Lite on the LAN with a
  pairing code — phone access with data never leaving the network. Cheaper
  than native mobile and consistent with local-first. Depends on bridge work
  (sibling repo) and a security review of moving off loopback.
- **First step:** Threat-model doc only: auth, pairing, TLS on LAN.

### 15. Canvas / whiteboard artifact type
- **Impact: Low-Med · Effort: Med**
- **Rationale:** Backlog idea; differentiates the artifact system for planning
  sessions. Lower priority than agent/eval work — visual wow, less strategic.
- **First step:** Evaluate embedding tldraw/excalidraw in the sandboxed
  artifact webview against the existing artifact CSP rules
  (`tests/services/tauriConfig.test.ts` documents what previews may load).

### 16. Comparison Arena — prompts, models, and orchestrator configs side-by-side
- **Impact: High · Effort: Med-High**
- **Rationale (Ethan, 2026-07-20):** One surface to *compare answers and run
  benchmarks* across three axes: system prompts, models, and — when routed
  through agent-orchestrator — orchestrator rules/settings. Today those
  comparisons live in scattered places (AO `benchmarks/` runs, model-compat
  reports, ad-hoc chat re-asks); nothing lets Ethan instigate an A/B/N run and
  see the answers next to each other with scores. This is also the natural
  consumer of AO's ForgeBench (F30) and judge-calibration substrate: the
  arena renders what those already measure.
- **The interface rule (core design constraint):** orchestrator rules/settings
  surface as a few **big levers** — e.g. Verification strictness
  (off / standard / earn-the-dark), Budget posture (thrifty / standard /
  generous), Autonomy (review-everything / auto-merge-eligible), Model tier
  routing (fast / balanced / best) — NOT a listing of every knob. Each lever
  compiles down to a full AO config bundle (routing.json + campaign flags +
  verification profile). An **Advanced mode** exposes the compiled bundle for
  per-knob overrides later; v1 ships levers only. Presets are named, saved,
  and diffable so a benchmark row can say "Standard vs Earn-the-dark" in
  plain words.
- **Shape:** pick a task set (single prompt, saved prompt list, or a
  ForgeBench/benchmark slice) × pick 2–4 configurations (prompt/model/lever
  preset) → run → side-by-side answer panes + score row (judge verdict,
  cost, latency, pass/fail where a verifier exists) → one-click "adopt this
  config" writes the winning preset back. Reuses AO's order-swap judge
  calibration (F15) so pairwise scoring is position-bias-safe.
- **Home:** GatesAI Chat is the front-runner (it already owns the chat
  workbench + artifacts dock + eval-harness groundwork in idea #1; a
  comparison view is a workbench feature, honoring the two-surface rule — no
  new surfaces). Visions is the fallback home if the arena turns out to be
  more about orchestrator-config benchmarking than chat answers. Decide at
  design-doc time, not now.
- **First step:** design doc (`/design-doc`) covering: the lever→config
  compilation table (which AO settings each lever moves), the run envelope
  (arena runs are real spend — caps + `--max-runtime-minutes` mandatory), and
  the v1 cut (2 columns, single prompt, manual judge). Groundwork to cite:
  AO `benchmarks/` + `benchTracker.ts`, model-compat runner here, F15
  calibration, F30 ForgeBench spec.
