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
npx playwright test tests/e2e/journeys.generated.spec.ts --project=desktop-mocked --project=web-lite-journeys --project=mobile-journeys
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
checks that the row actions appear on hover and that the row survives the click.

## What no journey can reach

The coverage census (every literal identity and pattern in `testid-registry.json`
against every step in the manifest) leaves 22 identities untouched, all by
construction rather than by omission:

- Hidden file inputs (`settings.preferences.file-input`,
  `workspace.composer-input.file-input`): the OS file chooser has no DOM control.
- Literal fallbacks that only exist so the scanner can name a primitive without
  a caller-supplied identity (`ui.button.unscoped`, `ui.input.unscoped`,
  `ui.select.unscoped`, `ui.textarea.unscoped`, `ui.toggle.unscoped`,
  `workspace.composer.draft-unscoped`, `workspace.composer.attach-unscoped`,
  `workspace.image-job.open-unscoped`, `workspace.skill-picker.option-unscoped`):
  every live caller passes an identity, so the fallback never renders.
- Components with no live caller (`workspace.bridge-status-pill.bridge-status-pill`,
  `app.lightbox.open-in-os-no-prompt`, `workspace.html-preview.document-card`,
  `workspace.html-artifact-preview.open`, `workspace.html-artifact-preview.download`):
  their interaction sites are in the sealed ratchet, so removing them needs an
  owner verdict before the ratchet can be re-baselined.
- `workspace.markdown-fallback.a` and `workspace.markdown-fallback.open`: the plain
  renderer only mounts when the markdown pipeline throws.
- `workspace.image-job-card.cancel-render`: appears after a render has run for
  about 106 seconds, which no journey waits for.
- `workspace.media-viewer.empty`, `workspace.media-viewer.image-loading`,
  `workspace.media-viewer.av-loading`: transient or unreachable dock states.

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
| `rich-transcript` | Desktop, transcript surfaces of every kind | desktop-ready plus seven more threads: an HTML artifact reply, an 84-message conversation, a message with attachments, a four-turn exchange, grouped terminal activity, memory sources of every kind, and image jobs done, failed and cancelled. One approved library source. Image replies take 2.5 s so a retried job stays visibly running. |
| `aurora-pack` | Desktop, Aurora interface pack | desktop-ready with the Aurora pack selected and a reply that carries a diff artifact past the fold, a finished image job, a source footer and a follow-up offer. |
| `prompt-cards` | Desktop, assistant is asking three questions | desktop-ready with three pending assistant prompts on the active thread: an approval with two options, a recommendation that allows a free-text answer, and one to skip. |
| `update-available` | Desktop, an update is available | desktop-ready with the updater reporting version 9.9.9 available, so the update pill and its dismiss control render. Installing outside the desktop shell reports an error, which the pill also shows. |
| `attachments-drafted` | Desktop, two files already attached to the draft | desktop-ready with a PNG and a text file staged in the composer tray, and a persistence-conflict notice above the draft. |
| `first-run-local-ready` | First run, Ollama online with models | No provider key and onboarding showing, but Ollama answers with three models, so the local card offers to continue with one. The menu coach mark has not been seen. |
| `first-run-local-empty` | First run, Ollama online without models | Onboarding showing and Ollama online with no models pulled, so the local card offers a starter pull; the mocked pull streams twelve progress frames. |
| `first-run-local-installed` | First run, Ollama installed but stopped | Onboarding showing, Ollama installed at a known path but not running, so the local card offers to start it and check again. |
| `local-no-embed` | Local only, embedding model missing | Ollama online with chat models but no nomic-embed-text, and an empty conversation pinned to a local model, so the semantic-memory nudge and the Install button in Agent settings render. The mocked pull streams slowly enough to cancel. |
| `local-ollama-offline` | Local only, Ollama unreachable | The active conversation is pinned to a local model but Ollama refuses connections, so the composer shows the local-settings banner. |
| `local-image-model` | Desktop, direct image model with ComfyUI stopped | The active conversation is pinned to the direct local image model while ComfyUI is stopped, so the composer shows the local-image-settings banner. |
| `desktop-bare` | Desktop, one conversation and nothing queued | OpenRouter key present, a single plain thread, no image jobs and no background tasks, so the task center is empty. |

Every scenario seeds localStorage before the stores boot and patches `fetch` and
`WebSocket` so OpenRouter, Ollama, the bridge, Brave and image generation answer
locally. `window.__gatesaiScenario.calls` lists every mocked call the page made.

## Journeys

### `first-run`: First run, nothing configured

| Journey | What it proves | Steps |
|---|---|---|
| `first-run-look-around` | With nothing configured, the onboarding offers a look around and lands in the composer. | 3 |
| `first-run-connect-openrouter-and-chat` | Enter a placeholder key in onboarding, connect, and get the first mocked cloud reply. | 8 |
| `first-run-install-ollama` | No Ollama found: Check again re-runs detection and the primary action opens Local settings. | 5 |
| `banner-no-model-open-models` | Nothing configured after Look around: the composer banner opens the models tab. | 4 |

### `desktop-ready`: Desktop, everything online

| Journey | What it proves | Steps |
|---|---|---|
| `open-workspace-directly` | The shareable workspace path loads a usable composer with no prior navigation. | 3 |
| `start-a-new-conversation` | The sidebar control creates a thread and the composer is ready with the send control idle. | 3 |
| `send-message-and-read-streamed-reply` | Type a prompt, send it, and watch the mocked OpenRouter stream land in the transcript. | 5 |
| `rename-thread-from-context-menu` | Right-click a thread, choose Rename, type a new title, and confirm it in the sidebar. | 6 |
| `pin-thread-from-row-actions` | Hover a thread row and pin it; the row stays present. | 4 |
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
| `command-palette-empty-and-backdrop` | A query nothing matches shows the empty row; clicking the backdrop closes the palette. | 8 |
| `agent-facts-edit-and-clear` | Facts can be edited in place, the edit cancelled, one deleted, and the rest cleared after confirmation. | 13 |
| `preferences-toggles-and-shortcut` | Flip a preference toggle, record a new summon chord and reset it, switch global summon off (the recorder disables) and back on, and toggle close-to-tray. | 15 |
| `preferences-export-and-import-modes` | Export writes a JSON file; Replace mode demands the confirmation phrase before the import button enables. | 11 |
| `preferences-danger-zone` | Each delete asks to confirm; cancel one and run another. | 10 |
| `models-catalog-refresh-and-clear` | Load models pulls the mocked catalog; Clear drops it. The stored key can be revealed, and Get key is only hovered. | 10 |
| `skill-picker-choose-and-clear` | The skill control opens a picker; choose Research, then clear back to none. | 7 |
| `favorite-a-model` | Starring a model adds it to the Favorites section; unstarring it from there removes the section again; picking the model from the Favorites row selects it for the composer. | 10 |
| `sidebar-brand-and-bridge-dot` | Clicking the brand mark opens the menu; the settings dot re-polls the bridge. | 4 |
| `mobile-open-sidebar-and-menu` | On a phone the top bar opens the sidebar; from it the menu opens and the back control returns to the chat. | 7 |
| `mobile-sidebar-close-controls` | The title opens the sidebar, the close control shuts it, the backdrop shuts it, and the hamburger opens it again. | 6 |
| `mobile-new-conversation-and-copy-link` | The top bar starts a new conversation and copies the thread link. | 4 |
| `web-lite-download-cue` | An empty conversation in Web Lite shows the desktop download cue; the link is hovered, never followed. | 4 |

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
| `image-generation-job-card` | The assistant calls image_generate, the job runs against the mocked OpenRouter image endpoint, and the card renders the result, even when the prompt is sent before the first bridge health poll answers. | 6 |

### `local-ollama`: Local only, Ollama online

| Journey | What it proves | Steps |
|---|---|---|
| `local-ollama-reply` | With no cloud key and Ollama online, a turn is answered by the mocked local model. | 4 |
| `local-context-mode` | With a local model selected the composer offers a context mode; pick bare prompt. | 3 |

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
| `whats-new-dismiss` | The close control on the welcome panel dismisses it without Got it. | 3 |

### `light-theme`: Desktop, light theme preselected

| Journey | What it proves | Steps |
|---|---|---|
| `light-theme-preselected` | The light-theme scenario opens with Light already selected in settings. | 3 |

### `rich-transcript`: Desktop, transcript surfaces of every kind

| Journey | What it proves | Steps |
|---|---|---|
| `code-block-toolbar` | On a reply carrying an HTML document, toggle line numbers and wrapping, copy the block, then switch the block to its preview view. | 7 |
| `code-block-open-and-download` | Open hands the HTML document to a new browser tab and Download saves it; neither leaves the thread. | 5 |
| `html-artifact-view-fullscreen` | The inline artifact card enables View once the bridge has read the file; the full-screen viewer offers Open in OS and Close. | 7 |
| `html-artifact-open-in-dock` | Open in dock renders the HTML file in a dock file viewer with an inline preview; Open in OS is a no-op against the mocked bridge. | 7 |
| `registered-artifact-panel` | The artifact registry lists a landing page; opening it from the palette shows the dock artifact panel with source toggle, open and download. | 16 |
| `markdown-links-open-workspace-path` | A workspace path in a reply hands the file to the OS through the bridge; an external link is hovered but never followed. | 3 |
| `message-copy-from-hover-actions` | Hovering a message reveals its action row; Copy puts the text on the clipboard. | 4 |
| `long-thread-show-earlier` | Past one page the transcript collapses its head behind a Show control; clicking it renders the earliest turns. | 3 |
| `long-thread-jump-to-latest` | Scrolling up a long transcript shows Jump to latest; clicking it returns to the newest turn and hides the control. | 5 |
| `regenerate-confirm-and-cancel` | Regenerating an answer that is not the last one shows a confirm panel; Cancel keeps the thread as it was. | 6 |
| `edit-mid-thread-confirm-and-cancel` | Editing an earlier question opens the edit panel; Save asks to confirm because later turns would be dropped, and both cancels back out. | 9 |
| `grouped-activity-timeline` | Consecutive tool calls fold into one group; the group control expands and collapses them. | 3 |
| `memory-sources-open-and-unavailable` | A reply grounded in a message, a vanished message and a library file: each chip opens its detail, and the vanished one is marked unavailable. | 13 |
| `memory-source-open-thread` | Open source on a message chip navigates to the conversation that holds it. | 4 |
| `attachment-thumbnail-open` | A message attachment thumbnail hands the file to the OS through the bridge; the markdown attachment is listed by name. | 4 |
| `image-lightbox-navigation` | A finished two-image job opens in the lightbox with next and previous, the full prompt, copy and open in OS. | 11 |
| `image-job-retry-failed-and-cancelled` | Failed and cancelled image jobs keep Retry; Copy error copies the failure and a retried job can be cancelled while it is still pending. | 7 |
| `activity-rows-toggle` | Each image job row on the thread can be expanded and collapsed. | 4 |
| `task-center-cancel-and-retry` | The task ledger lists an agent task and two image jobs; cancel the task and retry both jobs. | 10 |
| `agent-recall-sources` | Expand the message group, search it, exclude a thread, re-include all, and toggle a whole source type. | 14 |
| `agent-library-and-index` | Toggle the seeded library file, refresh the library, and rebuild the index while the danger controls stay visible. | 13 |
| `dock-two-cells-swap-and-resize` | Opening a file beside the explorer fills the second cell; swap exchanges them and the resize handles are hoverable. | 15 |
| `dock-explorer-crumbs-and-refresh` | Descend into a folder, climb back through the breadcrumb and the parent control, and refresh the listing. | 13 |
| `dock-media-viewers` | Audio plays inline, a still image renders, and unreadable media shows its error notices. | 16 |
| `dock-file-viewers` | A JSON file renders as collapsible keys, a text file as plain text, and an unreadable file as a notice, and a markdown note renders as markdown. | 19 |

### `aurora-pack`: Desktop, Aurora interface pack

| Journey | What it proves | Steps |
|---|---|---|
| `aurora-activity-stream-diff` | In the Aurora pack the reply folds its work behind chips; expanding shows the work note and the edit call with its diff card. | 8 |
| `aurora-fine-tune-render` | The cover render exposes a fine-tune card: adjust images, size and seed, reset, then render again. | 12 |
| `aurora-reply-footer` | The suggested follow-up sends as the next message; the source chip then opens the Agent tab of the menu, where recall sources live. | 5 |
| `aurora-command-palette-empty` | In the Aurora pack, a query that matches nothing shows the empty state that names the query, and the backdrop closes the palette. | 8 |

### `prompt-cards`: Desktop, assistant is asking three questions

| Journey | What it proves | Steps |
|---|---|---|
| `prompt-cards-answer-each-way` | Three pending prompts: pick an option, write a free answer and send it, and skip the last. | 8 |
| `prompt-cards-skip-and-option` | Skip the approval prompt outright and answer the recommendation with one of its options. | 3 |

### `update-available`: Desktop, an update is available

| Journey | What it proves | Steps |
|---|---|---|
| `update-pill-install-and-dismiss` | With an update staged the pill offers install; dismiss hides the notice. | 4 |

### `attachments-drafted`: Desktop, two files already attached to the draft

| Journey | What it proves | Steps |
|---|---|---|
| `attachment-tray-and-notice` | Two staged attachments can be handed to the OS and removed; the persistence notice above the draft can be dismissed. | 8 |
| `persistence-notice-reload` | The conflict notice's Reload action reloads the app and the workspace comes back. | 3 |

### `first-run-local-ready`: First run, Ollama online with models

| Journey | What it proves | Steps |
|---|---|---|
| `first-run-local-ready-continue` | Ollama has models: the local card offers to continue with the selected one, and the sidebar hint points at the menu. | 4 |
| `first-run-menu-hint` | The one-time hint on the brand mark opens the menu. | 2 |

### `first-run-local-empty`: First run, Ollama online without models

| Journey | What it proves | Steps |
|---|---|---|
| `first-run-local-empty-starter-pull` | Ollama runs with no models: the primary action pulls a starter and the secondary opens Local settings. | 4 |

### `first-run-local-installed`: First run, Ollama installed but stopped

| Journey | What it proves | Steps |
|---|---|---|
| `first-run-local-installed-recheck` | Ollama is installed but stopped: Check again re-polls and Open Local settings goes to the models tab. | 5 |

### `local-no-embed`: Local only, embedding model missing

| Journey | What it proves | Steps |
|---|---|---|
| `local-embed-pull-cancel-dismiss` | The semantic-memory nudge pulls nomic-embed-text; the pull can be cancelled and the nudge dismissed. | 7 |
| `agent-settings-install-embedding` | With the embedding model missing, Agent settings offers Install; clicking it starts the pull and turns into Cancel. | 7 |

### `local-ollama-offline`: Local only, Ollama unreachable

| Journey | What it proves | Steps |
|---|---|---|
| `banner-ollama-offline` | A local model is selected but Ollama is unreachable: the composer banner opens Local settings. | 3 |

### `local-image-model`: Desktop, direct image model with ComfyUI stopped

| Journey | What it proves | Steps |
|---|---|---|
| `banner-local-image-offline` | A direct image model is selected but ComfyUI is stopped: the banner opens local settings. | 3 |

### `desktop-bare`: Desktop, one conversation and nothing queued

| Journey | What it proves | Steps |
|---|---|---|
| `task-center-empty` | A bare desktop shows the empty task ledger. | 6 |

Journeys whose name starts with `web-lite-` run only against the browser build
(Playwright project `web-lite-journeys`, Vite mode `web-lite`), journeys whose name
starts with `mobile-` run on the `mobile-journeys` project at a 390x844 viewport, and
every other journey runs against the default desktop build with the bridge mocked
online where the scenario says so.

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

