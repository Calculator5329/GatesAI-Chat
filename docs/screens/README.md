# Screens Tour

Regenerate with:

```sh
SCREENS_TOUR=1 npx playwright test screensTour   # docs/screens galleries below
npm run screens:tour                             # source-audited corpus in docs/audits/
```

The tour writes stable, overwritten PNGs under `docs/screens/<project>/` with no timestamps. The normal e2e command (`npm run test:e2e`) excludes `tests/e2e/screensTour.spec.ts`; the tour runs only when `SCREENS_TOUR=1` is set.

## desktop-mocked

| Screenshot | Route/state | Description |
| --- | --- | --- |
| `desktop-mocked/01-first-run-onboarding.png` | `/` without provider | Desktop first-run onboarding with local and cloud paths. |
| `desktop-mocked/02-active-chat-streamed-reply.png` | `/` after mocked OpenRouter stream | Active chat with realistic assistant reply and forced message actions. |
| `desktop-mocked/03-chat-tool-activity.png` | `/#/thread/tool` | Assistant turn with a terminal activity timeline entry. |
| `desktop-mocked/04-command-palette.png` | Active chat + command palette | Command palette over seeded threads and actions. |
| `desktop-mocked/05-model-popover.png` | Active chat + model picker | Composer model popover with source and capability controls. |
| `desktop-mocked/06-menu-agent.png` | `/#/menu/agent` | Agent settings with instructions, memory, and semantic memory. |
| `desktop-mocked/07-menu-models.png` | `/#/menu/models` | OpenRouter key, local models, search, and image model controls. |
| `desktop-mocked/08-menu-settings.png` | `/#/menu/settings` | Settings with conversations, theme, export/import, and danger zone. |
| `desktop-mocked/09-sidebar-agent-task-group.png` | `/#/thread/active` with agent task | Sidebar showing a seeded Agent tasks group. |
| `desktop-mocked/10-mobile-first-run.png` | Mobile `/` without provider | Mobile first-run onboarding. |
| `desktop-mocked/11-mobile-active-chat.png` | Mobile `/#/thread/active` | Mobile active chat surface. |

## web-lite

| Screenshot | Route/state | Description |
| --- | --- | --- |
| `web-lite/01-first-run-openrouter-onboarding.png` | `/` without provider | Web Lite OpenRouter-only first-run onboarding. |
| `web-lite/02-active-chat-streamed-reply.png` | `/` after mocked OpenRouter stream | Web Lite chat with realistic streamed assistant content. |
| `web-lite/03-menu-models.png` | `/#/menu/models` | Web Lite Models menu. |
| `web-lite/04-menu-settings.png` | `/#/menu/settings` | Web Lite Settings with browser-local data block. |
| `web-lite/05-mobile-first-run.png` | Mobile `/` without provider | Mobile Web Lite first-run onboarding. |
| `web-lite/06-mobile-active-chat.png` | Mobile `/#/thread/active` | Mobile Web Lite active chat surface. |

## local-only

| Screenshot | Route/state | Description |
| --- | --- | --- |
| `local-only/01-first-run-local-online.png` | `/` without cloud key, mocked Ollama online | Desktop first-run onboarding with the local card ready to use an Ollama model. |
| `local-only/02-active-chat-local-model.png` | `/#/thread/local-active` after mocked Ollama stream | Active chat on a local Ollama model with local usage. |
| `local-only/03-model-popover-local-section.png` | Active chat + local source filter | Model picker showing the Local section from the mocked Ollama catalog. |
| `local-only/04-menu-models-local-row.png` | `/#/menu/models` with mocked Ollama online | Models menu cloud framing plus the compact local-model status row. |
