# Local-first screen audit

This is the July 2026 screen-by-screen audit scaffold for GatesAI Chat. The
capture list is source-audited against the hash routes in `src/services/router.ts`
and the dedicated panels, popovers, and modals under `src/components`.

## Capture

From the repository root, install dependencies and browsers once, then run:

```sh
npm install
npx playwright install chromium
npm run screens:tour
```

The command starts deterministic mocked desktop and Web Lite Vite servers via
the existing Playwright setup, clears prior `screen-*.png` audit captures, and writes the
corpus to `docs/audits/screens-2026-07/`. Use `npm run screens:tour -- --list`
to inspect the expected corpus without starting the app. Optional theme flags
are `--light` or `--theme=dark|light|system`.

The corpus covers every routed app surface and every dedicated in-app overlay
or panel found in `src/components`. Calls to the browser's native
`window.confirm` are not DOM-rendered and therefore cannot appear in a
Playwright page screenshot; the app-rendered message and settings confirmation
panels are included.

## Audit matrix

`TBD` means the screenshot exists in the capture manifest but the local-only
behavior still needs a human product audit. Record the first concrete network,
account, bridge, persistence, or offline gap in the final column.

| Screen / state | Screenshot | Local-only verdict | Gap notes |
|---|---|---|---|
| Chat — first-run onboarding | [screen-chat-onboarding.png](screens-2026-07/screen-chat-onboarding.png) | GAP | "LOCAL-FIRST AI WORKSPACE" eyebrow is present and a Local card with "Check again" degrades gracefully when Ollama is missing — but the Cloud card leads (left, primary "Connect" CTA), the tagline is "Chat with frontier models", and the composer already defaults to cloud "Gemini 3 Flash" for a keyless user (LF-4). |
| Chat — empty conversation | [screen-chat-empty.png](screens-2026-07/screen-chat-empty.png) | GAP | Empty state itself is calm and offline-safe, but the sidebar date group renders "DECEMBER 1969" — a Unix-epoch timestamp leaking into the UI (LF-5). Composer again defaults to a cloud model with no key present. |
| Chat — populated conversation | [screen-chat-active.png](screens-2026-07/screen-chat-active.png) | GOOD | Conversation, tool trace ("Reading workspace"), and HTML artifact card all reference local workspace paths; no cloud nags. History and rendering are fully local. |
| Chat — tool activity panel | [screen-chat-tool-activity.png](screens-2026-07/screen-chat-tool-activity.png) | GAP | File is byte-identical (same md5) to screen-chat-active.png — the expanded tool-activity panel was never actually captured, so this surface is unaudited (LF-9). The collapsed "Thinking / Reading workspace" rows visible are local-friendly. |
| Chat — edit message panel | [screen-chat-message-edit.png](screens-2026-07/screen-chat-message-edit.png) | GOOD | Inline edit with Cancel / Save & resend is a fully local interaction. Minor visual: the "CTRL/CMD + CL…" shortcut hint is clipped behind the message action buttons. |
| Chat — regenerate confirmation panel | [screen-chat-regenerate-confirm.png](screens-2026-07/screen-chat-regenerate-confirm.png) | GOOD | Clear inline confirm ("This removes 2 later messages") with Cancel/Regenerate; app-rendered, local, no network implication. |
| Sidebar — mobile drawer open | [screen-sidebar-mobile-open.png](screens-2026-07/screen-sidebar-mobile-open.png) | GOOD | Drawer works, "workspace ready" status visible, all-local actions. A11y duplicate aria-label issue already tracked as LF-2. |
| Menu — Settings | [screen-menu-settings.png](screens-2026-07/screen-menu-settings.png) | GAP | First section of Settings is "OpenRouter API key" ("API KEY · APP DATA · DANGER ZONE") — the cloud key is the first thing a local-only user sees; local runtimes are only a cross-link ("installed runtimes (Ollama, ComfyUI) under Local") (LF-6). Also shows red "Shortcut unavailable – in use by another app" error state. |
| Menu — Usage | [screen-menu-usage.png](screens-2026-07/screen-menu-usage.png) | GOOD | Explicitly local-aware: "CLOUD SPEND AND LOCAL TOKENS", "Cloud $0.00 – Local 0 tokens (free)". Zero-state copy is graceful and doesn't push keys. |
| Menu — Agent | [screen-menu-agent.png](screens-2026-07/screen-menu-agent.png) | GOOD | Semantic memory copy is exemplary local-first: "Embeddings come from Ollama and vectors stay in this browser profile", with a graceful "Ollama offline" status badge rather than an error. |
| Menu — Models | [screen-menu-models.png](screens-2026-07/screen-menu-models.png) | GAP | Page heading equates Models with cloud: "CLOUD MODEL ACCESS – OPENROUTER KEY – LIVE CATALOG – WEB SEARCH". Local models get one slim status row ("Ollama not running" + "Open Local") above full OpenRouter/Brave sections. The "optional cloud access" framing in the intro is good, but the page named "Models" is 90% cloud (supports LF-3). |
| Menu — Local | [screen-menu-local.png](screens-2026-07/screen-menu-local.png) | BLOCKED | Web Lite hard-throws (LF-1). The desktop-mocked capture also shows hardcoded Windows placeholders — "C:\Users\you\AppData\Local\Programs\Ollama\ol…", "could not find ollama.exe" — misleading on macOS/Linux, plus a cramped one-word-per-line error column (LF-7). |
| Menu — Workspace | [screen-menu-workspace.png](screens-2026-07/screen-menu-workspace.png) | GOOD | Bridge status, local workspace root, and allowlisted commands are all local concepts; desktop-only "Source workspace" section degrades with an explicit "Desktop app only" badge and explanation instead of breaking. |
| Menu — Gallery | [screen-menu-gallery.png](screens-2026-07/screen-menu-gallery.png) | GAP | Local history model is right (Clear history, per-image delete), but both thumbnails render solid black — image bytes aren't displayed in the capture (LF-8). |
| Command palette — default results | [screen-palette-default.png](screens-2026-07/screen-palette-default.png) | GOOD | All default actions (new conversation, open settings/models/workspace/gallery, threads) are local navigations; no cloud-dependent commands surfaced. |
| Command palette — no results | [screen-palette-empty.png](screens-2026-07/screen-palette-empty.png) | GOOD | Graceful empty state: "No matching command or thread." No network dependency. |
| Model picker popover | [screen-picker-model.png](screens-2026-07/screen-picker-model.png) | GAP | Tabs are "AUTO | CLOUD" only — there is no LOCAL tab, and every visible entry (Auto, Gemini 3 Flash, GPT-5.5…) is a cloud model; footer says "31 MODELS". An Ollama-only user cannot discover or select a local model from the composer (LF-3). |
| Workspace skill picker popover | [screen-picker-skill.png](screens-2026-07/screen-picker-skill.png) | GOOD | Skills load from the local workspace ("Add markdown packs in /workspace/skills/"); "No skill" fallback documented. Fully offline-capable. |
| Gallery image lightbox | [screen-modal-gallery-lightbox.png](screens-2026-07/screen-modal-gallery-lightbox.png) | GAP | Prompt panel, Copy prompt, and Open in OS are all local-first, but the image area renders black/blank (1 / 2) — same missing-image symptom as the Gallery grid (LF-8). |
| HTML artifact full-screen preview | [screen-modal-html-artifact.png](screens-2026-07/screen-modal-html-artifact.png) | GOOD | Renders a workspace file (`/workspace/artifacts/reports/audit-report.html`) with Open in OS / Close; entirely local. |
| What’s New modal | [screen-modal-whats-new.png](screens-2026-07/screen-modal-whats-new.png) | GOOD | Release notes lead with local capabilities (bridge v2 handshake, faster turns, history grouping); no cloud upsell anywhere in the modal. |
| Settings danger-zone confirmation | [screen-panel-settings-confirm.png](screens-2026-07/screen-panel-settings-confirm.png) | GOOD | App-rendered inline Confirm/Cancel with honest local scoping: "App resets only affect local GatesAI data unless the row explicitly names a /workspace folder." Export/Import JSON keeps data ownership local. |

## Coverage maintenance

When a route or dedicated overlay is added, add its stable `screen-<area>-<state>.png`
name to `scripts/screens-audit-manifest.mjs`, add the capture interaction to
`scripts/screens-local-first-audit.spec.mjs`, and add a row above. The test
fails if a manifest entry was not captured, so incomplete additions do not
silently produce a partial corpus.

## Findings (running)

- **LF-1 (menu/local, Web Lite):** hard-throws "Cannot read local runtime
  status outside the GatesAI desktop app" — no graceful degradation. Filed as
  roadmap item. Evidence: screen-menu-local.png (degraded state), tour log
  2026-07-11.
- **LF-2 (mobile topbar, a11y):** two buttons share aria-label "Open sidebar"
  (`editorial-mobile-topbar__button` and `__more`) — ambiguous for screen
  readers and strict selectors. Candidate fix: distinct labels ("Open
  sidebar", "More options").
- **Bridge handshake works as designed:** mocked v0 bridge yields loud
  BridgeProtocolMismatchError warnings in console during tours — correct
  behavior, noisy in logs; consider single-warning throttle.
- **LF-3 (model picker, composer):** the model picker popover offers only
  "AUTO | CLOUD" tabs — no LOCAL tab — and every listed model (Auto,
  Gemini 3 Flash, GPT-5.5, GPT-5.5 Pro, …) is a cloud/OpenRouter model.
  An Ollama-only user has no way to discover or select a local model at the
  point of use; the Models menu page reinforces this with the heading
  "CLOUD MODEL ACCESS – OPENROUTER KEY – LIVE CATALOG – WEB SEARCH".
  Evidence: screen-picker-model.png, screen-menu-models.png.
- **LF-4 (onboarding hero, hierarchy):** the first-boot hero does say
  "LOCAL-FIRST AI WORKSPACE", but the layout contradicts it: the Cloud card
  is first (top-left) with the only filled/primary CTA ("Connect"), the
  tagline reads "Chat with frontier models, run tools over local files…",
  and the composer defaults to cloud "Gemini 3 Flash" before any key exists.
  The Local card ("Ollama is not detected… Check again") is secondary. Local
  path should be at least co-equal. Evidence: screen-chat-onboarding.png.
- **LF-5 (sidebar dates):** the empty-conversation capture shows the sidebar
  history group header "DECEMBER 1969" — a zero/missing timestamp rendering
  as the Unix epoch instead of being coerced to now or hidden. Evidence:
  screen-chat-empty.png.
- **LF-6 (settings ordering):** the Settings page leads with the
  "OpenRouter API key" card ("API KEY · APP DATA · DANGER ZONE"), so the
  first thing a local-only user reads in Settings is a cloud-key prompt;
  local runtimes are only a body-text cross-link to Local. Reorder or add a
  local-status card so keyless users don't parse Settings as "needs key".
  Evidence: screen-menu-settings.png.
- **LF-7 (Local page, cross-platform copy + layout):** the runtimes panel
  shows hardcoded Windows-only placeholders — path values like
  `C:\Users\you\AppData\Local\Programs\Ollama\ol…` /
  `C:\Users\you\ComfyUI\ComfyUI_windows_portable` and the hint "Auto-detect
  could not find ollama.exe" — which is wrong or confusing on macOS/Linux.
  The inline error text also wraps into a cramped one-or-two-words-per-line
  column. (Web Lite crash on this route is LF-1.) Evidence:
  screen-menu-local.png.
- **LF-8 (gallery images render black):** both Gallery grid thumbnails and
  the lightbox image area render solid black while captions, prompt text,
  and Copy prompt / Open in OS render fine — image bytes/blob URLs are not
  being displayed in the mocked tour. Verify whether this is a fixture gap
  or a real blob/asset-URL regression for locally stored images. Evidence:
  screen-menu-gallery.png, screen-modal-gallery-lightbox.png.
- **LF-9 (corpus fidelity, tool activity):** screen-chat-tool-activity.png
  is byte-identical (same md5) to screen-chat-active.png — the expanded tool
  activity panel was never actually captured, so that surface remains
  unaudited. Fix the tour interaction so the capture opens the panel before
  shooting. Evidence: md5 a59663fa160003ec3f062b0ebd27de3a for both files.
