# Refresh bundled in-app user guide — execution plan

**Roadmap item:** "Refresh bundled in-app user guide" (Docs & stories, `docs/roadmap.md`).
**Ethan's decision:** APPROVED.
**Task:** `unblock-refresh-bundled-in-app-user-guide-20260718`.
**This lane's output:** this plan + `DISPATCH.md` (the source edit lands in a
follow-up task; editing `docs/user-guide.html` is outside this lane's lease).

---

## 1. What the "bundled in-app user guide" actually is

- Source file: **`docs/user-guide.html`** — a single self-contained, styled
  HTML page (~26 KB, ~847 lines; inline CSS + a small tab-switch `<script>`).
- Assets: **`docs/user-guide-assets/*.png`** — 6 screenshots
  (`chat-home`, `models-openrouter`, `model-picker`, `agent-memory`,
  `workspace`, `gallery`).
- Delivery path: `src/services/bridge/userGuideInstall.ts` imports the HTML
  with `?raw` and the PNGs with `?url`, then on first bridge connection seeds
  them into the workspace at
  `/workspace/artifacts/reports/GatesAI-User-Guide.html` (+ `user-guide-assets/`)
  and opens it once (`openUserGuideOnFirstInstall`, gated on
  `gatesai.userGuide.opened.v1`). Caller: `src/stores/BridgeStore.ts`.
- So "refresh the guide" = **edit `docs/user-guide.html` + regenerate/refresh
  the PNGs**. The install/seed plumbing is correct and needs no changes; only
  content changes.
- Structure (keep it — the design is good): a left rail (brand, "assumption"
  setup card, 6-item nav, screenshot disclaimer) + a main column with sections
  `#start`, `#map`, `#tour` (JS tab panels), `#prompts`, `#optional`,
  `#trouble`, footer.

## 2. Why it needs a refresh (audit, source-verified 2026-07-18)

The guide predates a wave of shipped changes (app is now **v4.7.0**; guide
still reflects ~v4.6.1 and a cloud-first framing). Concrete drift:

### A. False / outdated claims (must fix)

| # | Guide says | Reality | Source of truth |
|---|---|---|---|
| A1 | New conversations start on **"Gemini 3 Flash"** (repeated ~5×: lines ~575, 657, 662, 681, 733) | Default is **Nemotron 3 Ultra free** (`or-nemotron-3-ultra-free`, `nvidia/nemotron-3-ultra-550b-a55b:free`). A **"Auto"** model (`AUTO_MODEL`, vendor "Recommended", "best available chat model") is offered as the recommended pick. Gemini 3 Flash now exists only as a cheap *background/summary* model. | `src/core/models.ts:102`, `src/core/defaultModel.ts` (`resolveDefaultModelId`), `src/core/modelPicker.ts` (`AUTO_MODEL`); changelog 2026-07-12 "Default chat model → Nemotron 3 Ultra free" |
| A2 | Setup card: "an OpenRouter API key is already added" as the premise | App is now **local-first on first boot** (LF-4): a detected Ollama model defaults untouched chats, the Local card leads, and offline states route to Local settings instead of nagging for a cloud key. Cloud is one of two on-ramps, not the assumed one. | changelog 2026-07-16 (LF-4), `defaultModel.ts`, `menuSectionMeta.ts` (Settings leads) |
| A3 | Menu = Agent, Models, Local, Workspace, Gallery, Settings | Actual `MENU_SECTIONS` (in order): **Settings, Usage, Agent, Models, Local, Workspace, Gallery**. Guide is **missing Usage** and the menu now **lands on Settings**. "Models" tab renders `ApiSection` (provider cards), not a bare key form. | `src/components/menu/menuSectionMeta.ts` |
| A4 | Version framing = 4.6.x | Repo shipped **v4.7.0** (changelog 2026-07-18). | `package.json`, `docs/changelog.md` |

### B. Notable current features the guide never mentions (add, curated)

Curate — do **not** dump all 28 tools. Prioritise what a new user sees/uses:

- **Usage page** — tokens + USD by day/model (`sections/Usage.tsx`, `core/usage.ts`).
- **Workspace Skills** — user-authored `/workspace/skills/*.md` prompt packs,
  one active per conversation (`services/skills/*`, `composer/SkillPopover.tsx`;
  seeded README via `defaultWorkspaceGuide.ts`).
- **HTML artifacts + right dock** — the assistant builds sandboxed HTML
  reports/apps that open in a right-side dock panel (File/Media/Explorer viewers),
  desktop only (W-2/W-1; `services/tools/artifact.ts`, `components/dock/`).
- **Background tasks / task center** — image, agent, and command jobs with
  progress/cancel/retry/cost (W-3; `TaskStore`, `spawn_task`).
- **Command palette** — quick actions ("open file in dock", "toggle fullscreen")
  (`components/palette/CommandPalette.tsx`).
- **Global summon + tray + Super+G Offline Knowledge** — configurable chord,
  close-to-tray, fixed Offline-Library shortcut (`services/desktop/ambient.ts`,
  `sections/ChordRecorder.tsx`); desktop only.
- **Auto-updater** — self-updating desktop build + sidebar UpdatePill (W-5).
- **MCP servers** — connect external Model Context Protocol tools
  (`sections/McpSettings.tsx`, `services/mcp/*`).
- **Offline Library addon** — cited local search / sources / DB schemas
  (`services/tools/offlineLibrary.ts`); desktop only.
- **Web search + fetch_page**, **inspect_file** (artifact-first file discovery),
  **Mermaid** diagram rendering, **schedules** tool — worth a one-line mention
  each in the feature map / "what the assistant can do".
- **Seeded Welcome tour thread** — a real first-run conversation
  (`src/tourThread.ts`, `WELCOME_TOUR_THREAD_ID`) distinct from the guide's own
  static tour tabs. The guide should acknowledge it ("a Welcome tour chat is
  waiting in your sidebar").

### C. Missing runtime dimension: Web Lite vs Desktop

The guide never mentions the browser-only **Web Lite** build, which is
materially reduced. Add a short "Desktop vs Web Lite" callout/section:
desktop-only = Local runtimes panel, right dock, tray/global summon,
auto-updater, Offline Library; Web Lite stores the API key in **browser
storage** (not the OS keychain) and fullscreen uses the browser API.
Refs: changelog LF-1/A13 (Local panel desktop-only explainer), W-1 (dock hidden
on Web Lite), W-4/W-5 fallbacks.

### D. Troubleshooting gaps

Existing entries (send button, vision, catalog load, bridge offline, empty
gallery) stay valid. Add: ComfyUI "Load failed" (CORS root-cause, persistent
error trail), bridge **protocol version mismatch**, auto-updater failure, and a
"why is this feature missing? → you're on Web Lite" pointer.

## 3. Refresh scope (what the follow-up task edits)

Keep the existing layout, CSS, and the 6-tab interactive-tour mechanic. This is
a **content + screenshot** refresh, not a redesign.

1. **Global correctness pass** — remove every "Gemini 3 Flash is the default"
   claim; replace with "New chats use **Auto** (routes to the best available
   model; currently the free **Nemotron 3 Ultra**). You can pick any model in
   the picker." Soften the setup card to present **two on-ramps** (OpenRouter
   key *or* local Ollama), matching local-first first-boot. Update any version
   string to 4.7.0.
2. **`#start` (first run)** — reframe to "add a cloud key **or** point at local
   Ollama"; mention the seeded Welcome tour thread; keep the 4 first-steps but
   fix the model-picker step.
3. **`#map` (feature map)** — keep the 6 cards; refresh copy and add cards/rows
   for **Usage (spend)**, **Skills**, and **Artifacts + dock**. One-line
   mentions of web search, MCP, background tasks.
4. **`#tour` (tabs)** — fix default-model copy in Chat/Models/Model-Picker
   panels; update the **Models** panel to describe **provider cards** (not a
   bare key form); note Settings is the landing tab; **add a Usage tab** (or
   fold Usage into an existing panel if a 7th tab crowds the layout — author's
   call, but Usage must appear somewhere).
5. **`#prompts`** — keep; swap one example toward artifacts/skills
   ("Save this as an HTML report I can open" / "Use my code-reviewer skill").
6. **`#optional` (local)** — expand: Ollama (local chat/vision), ComfyUI
   (`full`/`quick` presets + upscale, `ComfyQualityPreset`), and add
   **Offline Library (Super+G)** and **MCP servers** as additional
   tool/knowledge backends. Mark desktop-only items clearly.
7. **NEW `#runtimes` (Desktop vs Web Lite)** — the §2C callout. Add a 7th nav
   item, or inline it into `#optional`.
8. **`#trouble`** — add the §2D entries.
9. **Screenshots** — see §4.

**Explicitly out of scope:** redesigning the page, changing
`userGuideInstall.ts` plumbing, documenting all 28 tools exhaustively, or
turning this into developer/architecture docs (that's `docs/architecture.md`).
Keep it a *new-user* guide.

## 4. Screenshots

The 6 PNGs are regenerated deterministically by the Playwright pipeline
**`scripts/screenshots.spec.mjs`** (`npm run screenshots`), which mocks the
bridge, OpenRouter, and Ollama and captures named states (e.g.
`models-openrouter`, `fresh-load`, `seeded-thread`). Notes for the follow-up:

- Likely visually stale: **`models-openrouter.png`** (Models page is now
  provider cards via `ApiSection`/`ProviderCard`) and any shot showing the menu
  (menu now leads with **Settings** and has a **Usage** tab).
- Add a new **`usage.png`** for the Usage section (extend the pipeline's
  `EXPECTED_STATES` with a `usage` capture, or capture manually at the
  1440×900 viewport the pipeline uses).
- `chat-home`, `model-picker`, `agent-memory`, `gallery`, `workspace`:
  re-verify against the current UI; re-capture only where drift is visible.
  Update captions regardless where copy references the default model.
- Keep filenames stable where they already exist (they are referenced by
  `USER_GUIDE_ASSETS` in `userGuideInstall.ts`); if you add `usage.png`, add a
  matching entry to that array in the same follow-up.
- Do **not** commit any screenshot containing a real API key — the pipeline
  uses mocks/placeholders; keep it that way.

## 5. Definition of done (for the follow-up task)

- `docs/user-guide.html` contains no false default-model claim; Usage,
  Skills, artifacts/dock, and a Desktop-vs-Web-Lite note are present; version
  framing is current; troubleshooting covers the new failure surfaces.
- Screenshots refreshed where drifted; `usage.png` added and wired into
  `USER_GUIDE_ASSETS` if introduced; no real secrets in any asset.
- The guide still renders standalone (open the file in a browser) and the
  `#tour` tab script still works; nav anchors resolve.
- Gates green: `npm run ci` (the `?raw`/`?url` imports must still resolve, so a
  renamed/removed asset would fail typecheck/build) and `npm run test:e2e`.
  If `userGuideInstall.ts` or its tests are touched, keep
  `src/services/bridge/userGuideInstall.test.ts` (if present) green.
- `docs/changelog.md` entry appended; roadmap item checked off by the
  harvesting session (not by the edit lane — this repo's convention).

## 6. Verification for this planning lane

No source was changed here. Facts in §2 were verified directly against the
files cited (`models.ts:102`, `defaultModel.ts`, `menuSectionMeta.ts`,
`modelPicker.ts`, `userGuideInstall.ts`, `tourThread.ts`,
`scripts/screenshots.spec.mjs`) and `docs/changelog.md` on 2026-07-18.
