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
| Chat — first-run onboarding | [screen-chat-onboarding.png](screens-2026-07/screen-chat-onboarding.png) | TBD | |
| Chat — empty conversation | [screen-chat-empty.png](screens-2026-07/screen-chat-empty.png) | TBD | |
| Chat — populated conversation | [screen-chat-active.png](screens-2026-07/screen-chat-active.png) | TBD | |
| Chat — tool activity panel | [screen-chat-tool-activity.png](screens-2026-07/screen-chat-tool-activity.png) | TBD | |
| Chat — edit message panel | [screen-chat-message-edit.png](screens-2026-07/screen-chat-message-edit.png) | TBD | |
| Chat — regenerate confirmation panel | [screen-chat-regenerate-confirm.png](screens-2026-07/screen-chat-regenerate-confirm.png) | TBD | |
| Sidebar — mobile drawer open | [screen-sidebar-mobile-open.png](screens-2026-07/screen-sidebar-mobile-open.png) | TBD | |
| Menu — Settings | [screen-menu-settings.png](screens-2026-07/screen-menu-settings.png) | TBD | |
| Menu — Usage | [screen-menu-usage.png](screens-2026-07/screen-menu-usage.png) | TBD | |
| Menu — Agent | [screen-menu-agent.png](screens-2026-07/screen-menu-agent.png) | TBD | |
| Menu — Models | [screen-menu-models.png](screens-2026-07/screen-menu-models.png) | TBD | |
| Menu — Local | [screen-menu-local.png](screens-2026-07/screen-menu-local.png) | TBD | |
| Menu — Workspace | [screen-menu-workspace.png](screens-2026-07/screen-menu-workspace.png) | TBD | |
| Menu — Gallery | [screen-menu-gallery.png](screens-2026-07/screen-menu-gallery.png) | TBD | |
| Command palette — default results | [screen-palette-default.png](screens-2026-07/screen-palette-default.png) | TBD | |
| Command palette — no results | [screen-palette-empty.png](screens-2026-07/screen-palette-empty.png) | TBD | |
| Model picker popover | [screen-picker-model.png](screens-2026-07/screen-picker-model.png) | TBD | |
| Workspace skill picker popover | [screen-picker-skill.png](screens-2026-07/screen-picker-skill.png) | TBD | |
| Gallery image lightbox | [screen-modal-gallery-lightbox.png](screens-2026-07/screen-modal-gallery-lightbox.png) | TBD | |
| HTML artifact full-screen preview | [screen-modal-html-artifact.png](screens-2026-07/screen-modal-html-artifact.png) | TBD | |
| What’s New modal | [screen-modal-whats-new.png](screens-2026-07/screen-modal-whats-new.png) | TBD | |
| Settings danger-zone confirmation | [screen-panel-settings-confirm.png](screens-2026-07/screen-panel-settings-confirm.png) | TBD | |

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
