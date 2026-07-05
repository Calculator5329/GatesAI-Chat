# Screens Tour

Regenerate with:

```sh
npm run screens:tour
```

The tour writes stable, overwritten PNGs under `docs/screens/<project>/` with no timestamps. The normal e2e command (`npm run test:e2e`) excludes `tests/e2e/screensTour.spec.ts`; the tour runs only when `SCREENS_TOUR=1` is set by the npm script.

## desktop-mocked

| Screenshot | Route/state | Description |
| --- | --- | --- |
| `desktop-mocked/01-first-run-onboarding.png` | `/` without provider | Desktop first-run onboarding with cloud, local, and explore paths. |
| `desktop-mocked/02-active-chat-streamed-reply.png` | `/` after mocked OpenRouter stream | Active chat with realistic assistant reply and forced message actions. |
| `desktop-mocked/03-chat-tool-activity.png` | `/#/thread/tool` | Assistant turn with a terminal activity timeline entry. |
| `desktop-mocked/04-command-palette.png` | Active chat + command palette | Command palette over seeded threads and actions. |
| `desktop-mocked/05-model-popover.png` | Active chat + model picker | Composer model popover with source and capability controls. |
| `desktop-mocked/06-menu-agent.png` | `/#/menu/agent` | Agent settings with instructions, memory, and semantic memory. |
| `desktop-mocked/07-menu-agent-mcp-skills.png` | `/#/menu/agent` scrolled | Agent MCP configuration block and seeded MCP server. |
| `desktop-mocked/08-menu-agent-skills-list.png` | `/#/menu/agent` scrolled | Workspace skills list discovered through the mocked bridge. |
| `desktop-mocked/09-menu-models.png` | `/#/menu/models` | Cloud provider, compatibility, search, and image model controls. |
| `desktop-mocked/10-menu-local.png` | `/#/menu/local` | Local runtime controls for Ollama, ComfyUI, and vision. |
| `desktop-mocked/11-menu-workspace.png` | `/#/menu/workspace` | Bridge status, workspace root, allowlist, and mocked file tree. |
| `desktop-mocked/12-menu-gallery.png` | `/#/menu/gallery` | Gallery populated from mocked image history. |
| `desktop-mocked/13-menu-usage.png` | `/#/menu/usage` | Token and cost rollups from seeded message usage. |
| `desktop-mocked/14-menu-settings.png` | `/#/menu/settings` | Settings with export/import and reset blocks. |
| `desktop-mocked/15-sidebar-agent-task-group.png` | `/#/thread/active` with agent task | Sidebar showing a seeded Agent tasks group. |
| `desktop-mocked/16-mobile-first-run.png` | Mobile `/` without provider | Mobile first-run onboarding. |
| `desktop-mocked/17-mobile-active-chat.png` | Mobile `/#/thread/active` | Mobile active chat surface. |

## web-lite

| Screenshot | Route/state | Description |
| --- | --- | --- |
| `web-lite/01-first-run-openrouter-onboarding.png` | `/` without provider | Web Lite OpenRouter-only first-run onboarding. |
| `web-lite/02-active-chat-streamed-reply.png` | `/` after mocked OpenRouter stream | Web Lite chat with realistic streamed assistant content. |
| `web-lite/03-menu-models.png` | `/#/menu/models` | Web Lite Models menu. |
| `web-lite/04-menu-settings.png` | `/#/menu/settings` | Web Lite Settings with browser-local data block. |
| `web-lite/05-bridge-gated-workspace-notice.png` | `/#/menu/workspace` | Bridge-gated Workspace section with Web Lite notice. |
| `web-lite/06-mobile-first-run.png` | Mobile `/` without provider | Mobile Web Lite first-run onboarding. |
| `web-lite/07-mobile-active-chat.png` | Mobile `/#/thread/active` | Mobile Web Lite active chat surface. |
