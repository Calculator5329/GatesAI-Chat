# DISPATCH — Refresh bundled in-app user guide (source edit)

This lane produced the plan (`2026-07-18-refresh-user-guide.md`). The actual
edit touches `docs/user-guide.html` + `docs/user-guide-assets/` (and possibly
`src/services/bridge/userGuideInstall.ts`), which are outside this lane's lease.
Dispatch the following follow-up task to land it.

---

## Task spec

- **title:** Refresh bundled in-app user guide (content + screenshots)

- **adapter:** claude (smart) — prose-heavy HTML editing + screenshot pipeline.

- **owns (paths this task may edit):**
  - `docs/user-guide.html`
  - `docs/user-guide-assets/` (regenerate/add PNGs)
  - `src/services/bridge/userGuideInstall.ts` (**only if** a new asset such as
    `usage.png` is added — to append its `USER_GUIDE_ASSETS` entry)
  - `src/services/bridge/userGuideInstall.test.ts` (only if the above changes)
  - `scripts/screenshots.spec.mjs` (only if adding a `usage` capture state)
  - `docs/changelog.md` (append one session entry)

- **goal:**
  Refresh `docs/user-guide.html` to match GatesAI Chat v4.7.0, keeping the
  existing layout/CSS/tab mechanic. Follow the execution plan at
  `docs/plans/unblock-refresh-bundled-in-app-user-guide-20260718/2026-07-18-refresh-user-guide.md`
  (§3 scope, §4 screenshots, §5 done). Specifically, you MUST:
  1. Remove every "Gemini 3 Flash is the default" claim (~5 spots). Replace with:
     new chats use **Auto** (routes to the best available model; currently the
     free **Nemotron 3 Ultra**); any model is selectable in the picker.
     (Verify against `src/core/models.ts:102`, `src/core/defaultModel.ts`,
     `src/core/modelPicker.ts` `AUTO_MODEL`.)
  2. Reframe the first-run setup card from "OpenRouter key already added" to
     two on-ramps (cloud key **or** local Ollama), matching local-first
     first-boot (LF-4).
  3. Add the missing **Usage** menu section, and correct the menu list/order to
     Settings, Usage, Agent, Models, Local, Workspace, Gallery, with Settings as
     the landing tab (`src/components/menu/menuSectionMeta.ts`).
  4. Add curated coverage of: **Workspace Skills**, **HTML artifacts + right
     dock**, **background tasks/task center**, **command palette**, **web
     search**, **MCP servers**, **Offline Library (Super+G)**, and the seeded
     **Welcome tour thread**. Do NOT exhaustively list all 28 tools — keep it a
     new-user guide.
  5. Add a **Desktop vs Web Lite** section/callout (desktop-only: Local panel,
     dock, tray/global summon, auto-updater, Offline Library; Web Lite stores
     the key in browser storage, not the OS keychain).
  6. Extend Troubleshooting: ComfyUI "Load failed"/CORS, bridge protocol
     version mismatch, auto-updater failure, and a "missing feature? → Web Lite"
     pointer.
  7. Update any version framing to 4.7.0.
  8. Regenerate screenshots where drifted (at minimum `models-openrouter.png`,
     now provider cards) and add a `usage.png`; if adding it, wire it into
     `USER_GUIDE_ASSETS` in `userGuideInstall.ts`. Use the deterministic
     pipeline `npm run screenshots` (`scripts/screenshots.spec.mjs`, mocked
     bridge/OpenRouter/Ollama, 1440×900). Never capture a real API key.

  Keep the page a standalone, browser-openable HTML with the working `#tour`
  tab script and resolving nav anchors. Do not redesign it, do not change the
  install/seed plumbing beyond the `USER_GUIDE_ASSETS` array, and do not weaken
  layer/eslint boundaries.

- **test-cmd:**
  ```sh
  npm run ci && npm run test:e2e
  ```
  Rationale: the guide HTML and each PNG are imported by
  `userGuideInstall.ts` via `?raw`/`?url`, so a broken/renamed asset fails
  typecheck+build inside `npm run ci`; `test:e2e` covers the seed/open path and
  Web-Lite behavior. If screenshots were regenerated, also run
  `npm run screenshots` locally and eyeball the outputs before committing.
  (`cargo test` not required — no `src-tauri/` change.)

- **acceptance / done:** plan §5. No false default-model claim; Usage + Skills +
  artifacts/dock + Desktop-vs-Web-Lite present; screenshots current and
  secret-free; gates green; changelog entry appended. Roadmap item
  "Refresh bundled in-app user guide" is ticked by the harvesting session from
  the resulting change, not by the edit lane.

- **notes / guardrails:**
  - Version bumps are NOT part of this task; if a release bump is needed it
    touches both `package.json` and `src-tauri/tauri.conf.json` — out of scope
    here, leave it to a release lane.
  - Release asset names are stable — do not rename existing
    `docs/user-guide-assets/*.png` files.
