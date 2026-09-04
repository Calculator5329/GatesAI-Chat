# Journeys and scenarios

This is the catalog of named paths through GatesAI Chat that are replayed on every
`npm run test:e2e`. Each journey is a list of steps over stable control identities
(`data-testid` values from `testid-registry.json`), compiled by agent-handles into
`tests/e2e/journeys.generated.spec.ts`. Each journey starts from a **scenario**, a
deterministic app state plus mocked answers for every network seam, selected with
the `?scenario=<name>` query parameter on the dev server.

The manifest is `journeys/manifest.json`; the scenario definitions are
`src/dev/scenarios/catalog.ts`. Keep this page in step with both.

## Running

```sh
npx agent-handles journeys compile   # manifest -> generated Playwright spec
npx playwright test tests/e2e/journeys.generated.spec.ts --project=desktop-mocked --project=web-lite-journeys
npx agent-handles journeys map       # journeys-map.html, a visual index
npx agent-handles adopt verify       # the full adoption gate, runs the journeys twice
```

To look at a scenario by hand, open the dev server with the query before the hash,
for example `http://localhost:5273/?scenario=tool-turn#/workspace`. Add `&persist=1`
to keep whatever the previous page load stored, which is how reload journeys prove
persistence. Nothing under `src/dev/` reaches a production bundle:
`scripts/check-dev-bundle.mjs` fails the build if the scenario sentinel lands in `dist/`.

## What a green run proves, and what it does not

After every step the generated spec reconciles the page: any visible interactive
control without a `data-testid`, any visible identity missing from the registry, and
any duplicated visible identity fails the journey. So a green catalog proves that
every state these journeys visited was fully identified. It says nothing about states
no journey visits; those remain uncovered, not green. The adoption receipt
(`agent-handles-adoption.json`) records the observed controls per journey.

Two assertions are weaker than they look. The theme journeys can only check that the
theme controls are present after a reload, because the segmented control is a set of
`aria-pressed` buttons and the journey grammar has no pressed predicate. The pin journey
only checks the row survives the click.

## Scenarios

| Scenario | Title | What it sets up |
|---|---|---|
| `first-run` | First run, nothing configured | No provider key, onboarding still showing, no threads, version already acknowledged so no welcome tour. OpenRouter answers once a key is added; Ollama and the bridge are unreachable. |
| `desktop-ready` | Desktop, everything online | OpenRouter key present, four seeded threads, profile, an image job in history, bridge online with a workspace, Ollama online with three models. |
| `slow-stream` | Desktop, slow streamed reply | Same as desktop-ready, but the assistant reply streams one small delta every 350 ms so the stop control stays visible. |
| `tool-turn` | Desktop, assistant calls the time tool | The first reply is a tool call to `time`; the follow-up reply reads the result back, so the activity row and the final answer both render. |
| `web-search` | Desktop, web search grounded reply | Brave key present. The first reply calls web_search, Brave returns two mocked sources, and the follow-up reply cites them. |
| `image-job` | Desktop, assistant generates an image | The first reply calls image_generate; OpenRouter returns a small SVG as a data URL, the bridge stores it, and the job card renders the result. |
| `local-ollama` | Local only, Ollama online | No cloud key. Ollama answers with three models and the active thread is pinned to qwen2.5:7b, so a turn stays on the machine. |
| `bridge-offline` | Desktop, bridge and Ollama unreachable | OpenRouter works, but the bridge health poll and its WebSocket fail and Ollama refuses connections, so workspace features degrade. |
| `provider-error` | Desktop, OpenRouter returns an error | Every chat request fails with HTTP 500, so the error banner and its dismiss control are reachable. |
| `whats-new` | Desktop, upgraded since last visit | desktop-ready, but the last acknowledged version is older than the running one, so the whats-new panel opens on boot. |
| `light-theme` | Desktop, light theme preselected | desktop-ready with the paper light theme already chosen, for journeys that must start from the light palette. |

Every scenario seeds localStorage before the stores boot and patches `fetch` and
`WebSocket` so OpenRouter, Ollama, the bridge, Brave and image generation answer
locally. `window.__gatesaiScenario.calls` lists every mocked call the page made.

## Journeys

### `first-run`: First run, nothing configured

| Journey | What it proves | Steps |
|---|---|---|
| `first-run-look-around` | With nothing configured, the onboarding offers a look around and lands in the composer. | 3 |
| `first-run-connect-openrouter-and-chat` | Enter a placeholder key in onboarding, connect, and get the first mocked cloud reply. | 8 |

### `desktop-ready`: Desktop, everything online

| Journey | What it proves | Steps |
|---|---|---|
| `open-workspace-directly` | The shareable workspace path loads a usable composer with no prior navigation. | 3 |
| `start-a-new-conversation` | The sidebar control creates a thread and the composer is ready with the send control idle. | 3 |
| `send-message-and-read-streamed-reply` | Type a prompt, send it, and watch the mocked OpenRouter stream land in the transcript. | 5 |
| `rename-thread-from-context-menu` | Right-click a thread, choose Rename, type a new title, and confirm it in the sidebar. | 5 |
| `pin-thread-from-row-actions` | Hover a thread row and pin it; the row stays present. | 3 |
| `delete-thread-and-undo` | Deleting a thread shows an undo toast; undo restores the thread. | 5 |
| `switch-between-threads` | Open the tool-activity thread, then return to the active one; each transcript renders its own content. | 4 |
| `edit-message-and-resend` | Edit the user message, confirm the truncation, and a fresh reply streams in. | 7 |
| `regenerate-assistant-reply` | Ask for a new answer to the same prompt and read the regenerated stream. | 3 |
| `branch-conversation-from-message` | Branching from the user message opens a new thread carrying that message. | 4 |
| `inspect-memory-disclosure` | Open a memory chip to see why it was used and where it lives. | 5 |
| `exclude-memory-source-and-undo` | Mark a memory source as not to be used, confirm, and reverse the choice from the undo control. | 9 |
| `search-models-in-popover` | Open the model popover, filter by name, then clear the filter. | 6 |
| `choose-a-local-model` | Switch the picker to local models and select the Ollama model for this thread. | 5 |
| `filter-models-by-capability` | Toggle a capability filter in the model picker and keep the popover open. | 5 |
| `set-thinking-effort` | Change the reasoning effort selector in the composer meta bar. | 2 |
| `command-palette-find-thread` | Open the palette with the keyboard, search for a thread, and open it. | 8 |
| `command-palette-new-conversation` | The palette action creates a thread and leaves the composer idle. | 6 |
| `command-palette-open-settings` | The palette action opens the settings menu. | 5 |
| `browse-workspace-files-in-dock` | Open the file explorer from the palette, enter a folder, and go back up. | 9 |
| `open-task-center-and-close-it` | The task center lists the seeded image job; closing its cell returns to the plain workspace. | 8 |
| `collapse-a-dock-cell` | Open the explorer in the dock, collapse it to the rail, and expand it again. | 9 |
| `open-settings-and-switch-theme` | Reach Settings through the sidebar control and select the Light theme. | 4 |
| `theme-persists-across-reload` | Pick the light theme, reload with storage kept straight into the settings route, and find the theme control still there. | 7 |
| `open-model-provider-settings` | Open the menu, select Models, and verify the web-search provider card renders. | 4 |
| `replace-openrouter-key` | Remove the stored key, enter a placeholder, connect, and see it stored again. | 8 |
| `set-ollama-endpoint` | Enter the local Ollama URL under Models and commit it. | 5 |
| `open-agent-memory-settings` | Open the menu, select Agent, and verify the persistent-instructions editor renders. | 4 |
| `add-an-agent-memory-fact` | Type a new fact under Agent, add it, and see a third editable fact appear. | 5 |
| `preview-memory-retrieval` | Run the memory preview for a query and keep the results panel reachable. | 5 |
| `web-lite-open-workspace` | The browser build loads with attachments and deep research disabled, and the composer idle. | 4 |
| `web-lite-send-message` | A cloud turn streams in the browser build exactly as on desktop. | 4 |
| `web-lite-open-model-settings` | Settings open from the sidebar and the Models tab renders the web-search card. | 4 |
| `web-lite-command-palette` | The keyboard shortcut opens the palette in the browser build. | 4 |

### `slow-stream`: Desktop, slow streamed reply

| Journey | What it proves | Steps |
|---|---|---|
| `stop-a-slow-streamed-reply` | With a slow stream, the send control turns into stop; pressing it ends the turn and the composer goes idle. | 7 |

### `tool-turn`: Desktop, assistant calls the time tool

| Journey | What it proves | Steps |
|---|---|---|
| `tool-turn-shows-activity-and-answer` | The first reply is a tool call; its activity row expands and the follow-up answer reads the result back. | 6 |

### `web-search`: Desktop, web search grounded reply

| Journey | What it proves | Steps |
|---|---|---|
| `web-search-grounded-reply` | The assistant calls web_search, Brave answers with mocked sources, and the follow-up cites them. | 5 |

### `image-job`: Desktop, assistant generates an image

| Journey | What it proves | Steps |
|---|---|---|
| `image-generation-job-card` | The assistant calls image_generate, the job runs against the mocked OpenRouter image endpoint, and the card renders the result. | 6 |

### `local-ollama`: Local only, Ollama online

| Journey | What it proves | Steps |
|---|---|---|
| `local-ollama-reply` | With no cloud key and Ollama online, a turn is answered by the mocked local model. | 4 |

### `bridge-offline`: Desktop, bridge and Ollama unreachable

| Journey | What it proves | Steps |
|---|---|---|
| `bridge-offline-degrades-gracefully` | With the bridge and Ollama unreachable, attachments are disabled but a cloud turn still completes. | 5 |

### `provider-error`: Desktop, OpenRouter returns an error

| Journey | What it proves | Steps |
|---|---|---|
| `provider-error-dismiss` | OpenRouter fails with HTTP 500; the error surfaces in the transcript and the composer error can be dismissed. | 7 |

### `whats-new`: Desktop, upgraded since last visit

| Journey | What it proves | Steps |
|---|---|---|
| `whats-new-acknowledge` | After an upgrade the panel opens on boot; Got it closes it and the composer is usable. | 3 |

### `light-theme`: Desktop, light theme preselected

| Journey | What it proves | Steps |
|---|---|---|
| `light-theme-preselected` | The light-theme scenario opens with Light already selected in settings. | 3 |

Journeys whose name starts with `web-lite-` run only against the browser build
(Playwright project `web-lite-journeys`, Vite mode `web-lite`); every other journey runs
against the default desktop build with the bridge mocked online where the scenario says so.

## Adding a journey

1. Pick or add a scenario in `src/dev/scenarios/catalog.ts` (add a unit test in
   `tests/dev/scenarios.test.ts` for any new mock behaviour).
2. Observe the identities you need on the running dev server, either through the
   agent-handles drive API (`POST /__agent-handles/session`, then
   `/__agent-handles/command` with an `observe` action) or from `testid-registry.json`.
3. Add the journey to `journeys/manifest.json` with `context.path` carrying the
   scenario query, then `npx agent-handles journeys compile` and run the spec.
4. Add the row to this page.

Repeated rows (messages, threads, model rows, palette rows, dock cells, explorer
entries, tasks) carry the item id as a qualifier, for example
`workspace.editorial-message.copy-<messageId>` or `app.command-palette.row-thread:<threadId>`.
Seeded ids are stable (`active`, `agent-task`, `tool`, `usage`) so journeys can name them.

