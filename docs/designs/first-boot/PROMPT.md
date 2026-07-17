# First boot — current functional spec

Extracted 2026-07-16 from live code at `6439e33d7619e34c1f464725e2b0fd57c62551a6`. This is the source prompt for design rounds, not a proposal. When this document and the app disagree, the app is authoritative and this document should be regenerated.

## Surface boundary

“First boot” means the empty active chat, its onboarding/ready states, the composer immediately beneath it, and the persistent navigation chrome around it. The bundled read-only Welcome tour is a separate conversation surface; it is relevant only where its seed policy affects whether onboarding appears.

Primary implementation:

- `src/components/editorial/EditorialChat.tsx`
- `src/components/editorial/EditorialComposer.tsx` and `src/components/editorial/composer/*`
- `src/components/editorial/EditorialSidebar.tsx`
- `src/styles/editorial.css`, `src/styles/responsive.css`, `src/styles/base.css`
- `src/stores/{RootStore,ChatStore,UiStore,ProviderStore,LocalRuntimeStore,OllamaStore,OpenRouterStore}.ts`
- `src/services/{uiPrefsStorage,secretStorage}.ts`
- `src/services/local/*`, `src/services/llm/{ollamaCatalog,ollamaPull,openrouterCatalog}.ts`

Binding product/taste sources:

- `docs/handbook/ux-principles.md`
- `docs/handbook/direction.md`
- `docs/purpose.md`

## Purpose

Help a person reach a usable first conversation without pretending unavailable capabilities work or forcing a cloud account. Desktop must lead with a complete local path, offer bring-your-own OpenRouter as an explicit choice, and allow the person to dismiss setup. Web Lite must remain useful and honest while pointing to Desktop for local files, tools, runtimes, and image generation.

The desired impression is a calm editorial workspace with quiet power, not a SaaS signup funnel. Local is a first-class citizen, not a fallback. The user stays in control of provider choice; the app must never silently switch an Ollama conversation to cloud.

## When the surface appears

The empty-state hero appears when the active thread has zero messages and is not hydrating. Its setup panel appears only when all of these are true:

1. `ui.onboardingDismissed === false`.
2. The active thread has zero messages.
3. No non-read-only thread anywhere has prior messages.
4. Either the active provider is not ready, or Desktop has a ready Ollama model selected while no OpenRouter key exists (`localFirstRunReady`).

Consequences of the current logic:

- A configured/ready cloud provider skips setup and shows the quiet ready state.
- A detected, ready Ollama model without an OpenRouter key still shows setup so the person can explicitly continue locally.
- Any real prior chat permanently dismisses setup through the persisted UI preference.
- The component deliberately ignores the read-only Welcome tour when deciding whether the person has chatted.
- Current boot wiring has a collision worth preserving as truth in design review: `RootStore.boot()` dismisses onboarding when *any* thread has messages, while the first-run Welcome tour is seeded with messages. Unlike `ChatEmptyState`, that boot-level check does not exclude read-only threads. Do not assume the tour and setup panel reliably coexist until implementation resolves that mismatch.

The dismissal bit defaults to `false`, is stored in `gatesai.uiprefs.v1`, and is written through `UiStore`; components do not access storage directly.

## Information architecture and exact visible content

### Persistent shell

On desktop, the full viewport contains a 270 px sidebar and flexible chat column. The default first-run sidebar can show:

- Serif `GatesAI` wordmark and accent dot. Activating it opens the menu.
- A first-run coachmark, `Settings & menu live here`, until the menu is opened or nine seconds elapse.
- `Begin a new conversation`.
- Visible conversation groups and titles. With no history the empty copy is `No conversations yet.`; a seeded tour appears as pinned `Welcome tour` while the empty draft conversation remains available.
- Optional update pill, only when an update store state is visible.
- Runtime status: `checking…`, `workspace ready`, `bridge offline`, `bridge update required`, or `web lite`.

At the mobile-shell breakpoint (`max-width: 640px`, or `max-width: 960px` with `max-height: 480px`), the sidebar becomes a drawer with a scrim and a fixed top bar. The top bar shows the current title (`New conversation` for the initial thread), new-conversation, copy-link, and sidebar controls. Edge swipe right opens the drawer; swipe left closes it.

### Hero, always shown for an empty non-hydrating thread

- Eyebrow: `Local-first AI workspace`.
- H1: `GatesAI Chat`.
- Desktop lede: `Chat locally on your own machine, run tools over your files, and bring frontier cloud models when you choose.`
- Web Lite lede: `Chat with frontier models from this browser. Move to desktop when you want local files, tools, and image generation in the same workspace.`

The hero is centered, text-first, and capped at 560 px. On a roomy desktop the Local and Cloud cards share the first row, in that DOM order, with Explore below; at 900 px and narrower the cards are one column.

### Desktop Local card

Invariant labels:

- Kicker: `Local`.
- Heading: `Start with local models`.

The body and actions depend on Ollama state:

| Condition | Copy/data shown | Actions/status |
| --- | --- | --- |
| Runtime online and one or more chat models exist | `Ollama detected - {N model/models} ready. {selected model name} is selected for this chat, and GatesAI will not switch providers unless you choose another model.` | Primary `Continue with {model name}`. |
| Runtime online, zero chat models | `Ollama is running, but no chat models are pulled yet. Add one here and keep the whole conversation on this machine.` | Primary `Get a starter model`; while active, `Pulling {rounded percent}%`. Pull status is `{phase} · {rounded percent}%` or the error. Secondary `Open Local settings`. |
| No install path and runtime not online | `Run chat and tools on your machine with Ollama - no account or cloud key. Local settings can help you install or connect it.` | Primary `Open Local settings`; secondary `Check again` / disabled `Checking...`. |
| Install path exists but runtime is not online | `Ollama is configured but not running. Start it from Local settings; GatesAI will not silently fall back to cloud.` | Primary `Open Local settings`; secondary `Check again` / disabled `Checking...`. |

Any local auto-detect, runtime refresh, or catalog error appears at the bottom of the card as an alert in the danger token. The current chosen local model is the active thread’s Ollama model when there is one; otherwise it is the highest-ranked available local chat model, preferring tool support and then larger known context.

### Cloud card, Desktop and Web Lite

- Kicker: `Cloud`.
- Heading: `Bring cloud models`.
- Copy: `Choose OpenRouter when you want a cloud model. Free and paid routes both use your own API key.`
- Password input placeholder: `Paste your OpenRouter API key...`.
- Submit button: `Connect`, changing to `Checking...` while validation is in flight.
- Help line: `Get a key → openrouter.ai/keys`; the link opens a new tab.
- During validation: `Checking OpenRouter...` as a status.
- Valid key: `Key works - {N model/models} available.`
- HTTP 401/403: `OpenRouter rejected this key. Check the key and paste it again.`
- Other failures: `Could not validate the key: {raw store error}`.

When a key is already stored, the shared secret field instead shows a masked, read-only key plus `Reveal`/`Hide` and `Remove`. Masking keeps the first seven and last four characters for keys longer than eight; short keys are fully masked.

### Explore card

- Kicker: `Explore`.
- Heading: `Just look around`.
- Copy: `Hide this setup panel and keep the normal empty chat surface. You can connect a provider later.`
- Primary action: `Look around`.

### Empty ready state after setup is hidden

The hero remains. The cards are replaced by one italic serif line:

- A provider is ready: `A blank thread is ready; write below when you want to begin.`
- No provider is ready: `A blank thread is waiting; connect a cloud or local model when you are ready.`
- Successful OpenRouter validation: `Key works - {N model/models} available.`
- Explicit local continuation: `Ollama detected - {N model/models} ready.`
- Successful starter pull: `Ollama detected - {model name} ready.`

For a Desktop Ollama chat without `nomic-embed-text`, an optional semantic-memory row follows:

- `Optional: add semantic memory`.
- Idle action: `Pull nomic-embed-text`.
- Pulling data: `{phase or Pulling} · {rounded percent}%`, with `Cancel`.
- Always-available local dismissal: `Dismiss`.
- Pull error: raw error text as an alert.

This semantic-memory dismissal is component-local and is not persisted.

### Web Lite-only information

Web Lite never renders the Local card or workspace-skill picker. Beneath the hero/setup it always says `Your conversations are saved locally in this browser.`

While the thread is empty, a temporary desktop cue also appears:

- `Want local files, tools, and image generation? Get the desktop app.`
- Platform action: `Download for Windows (64-bit)`, `Download for Linux (AppImage)`, or `Get it on GitHub`.
- Runtime detail: Windows 10/11 x64, Linux x86_64 AppImage, macOS source-build notice, or generic source-build requirements.
- Windows ARM additionally explains that the x64 installer uses built-in emulation.

The cue fades in, begins leaving at 10.84 seconds, and unmounts at 11 seconds (or at transition end).

### Composer shown below the first-boot content

The composer remains visible throughout first boot:

- Hidden multi-file input and paperclip button. Desktop enables it only when the bridge is online; Web Lite and read-only tour disable it.
- Autosizing serif textarea, one row to a 200 px maximum.
- Placeholder is `Ask your first question...` only when the selected route is ready and the thread is empty. With the usual unconfigured cloud default it is currently `Continue the thought...`.
- Arrow-up send icon. Send is disabled until there is text or an attachment *and* the selected provider route is ready.
- Selected model name with accent dot and chevron.
- Desktop-only workspace-skill control; with no active skill it renders the brain icon and chevron without a text label.
- Provider-specific progressive control: Ollama context mode (`full context`, `system + tools`, `bare prompt`, `micro tools`) or OpenRouter thinking effort. On fine pointers this stays hidden until composer hover/focus; on touch it stays visible.
- Context meter bar and `{used} / {window}` token estimate; chat spend appears only once nonzero.
- Route banners are normally suppressed while first-run setup is visible to avoid duplicating the cards. After setup is dismissed, unavailable cloud/Ollama routes show their normal settings banner.

Opening the model control uses the existing lazy-loaded model picker. It exposes runtime-available source tabs, model search, capability filters, recommended/recent/favorite/vendor groups, selection, and count. Choosing a model updates the active thread and closes the popover.

## Interactions and state changes

### Local path

- On Desktop/Tauri panel mount, refresh both local runtimes without blocking first paint.
- `Check again` runs auto-detection only if it has not completed and no Ollama install path is known, then refreshes Ollama status and, if online, fetches its model tags. Repeated clicks are guarded while checking.
- `Open Local settings` routes to `/#/menu/local`; it does not claim Ollama was installed or started.
- When Ollama is online and models hydrate, an untouched empty thread still on the compiled cloud default adopts the best local model and `micro` context. A thread with messages or any explicit model choice is never overwritten.
- `Continue with …` explicitly assigns the selected local model, dismisses onboarding, replaces the cards with the local-ready message, and focuses the composer at the end of its draft.
- `Get a starter model` pulls exactly `llama3.2:3b`. On success it chooses that newly registered model if present, otherwise the best local model, dismisses onboarding, shows the ready message, and focuses the composer. Failure stays in the card.
- Local conversation routing must remain pinned to the chosen Ollama model unless the person selects another model. No cloud fallback.

### Cloud path

- Empty Connect does nothing and the button remains disabled.
- Enter submits a trimmed input. Because this surface sets `submitOnPaste`, pasting any nonblank text prevents the normal paste and submits the trimmed pasted value immediately.
- Validation calls the OpenRouter catalog with the candidate key. A failed request does not persist the key or dismiss onboarding.
- A successful request persists the key through `ProviderStore`, dismisses onboarding, shows the model count ready message, and focuses the composer.
- Revalidation is guarded while already checking.
- Stored-key `Reveal`/`Hide` is local UI state. `Remove` deletes the provider config and returns the field to connect mode.

### Explore and automatic exits

- `Look around` only persists `onboardingDismissed = true`; it does not connect or select a provider.
- The first non-read-only conversation message anywhere dismisses onboarding.
- Selecting a ready provider can cause the cards to disappear through the visibility predicate.

### Composer and shell

- Clicking the brand opens the menu; the first activation marks the coachmark seen. Enter and Space activate the keyboard-focusable brand.
- New conversation actions create and route to a new empty thread.
- Desktop bridge status supports click, Enter, or Space to poll again. Web Lite status is inert.
- File picker, pasted image, or window drop uploads through the bridge. Upload failures stay near the composer; no file bytes belong in onboarding state.
- Enter sends; Shift+Enter inserts a newline. Send remains a no-op while the selected route is unavailable.
- On an empty composer at caret position zero, ArrowUp recalls the most recent user prompt; repeated Up/Down walks history. Down after the newest or Escape restores the pre-recall draft. This normally has no entries on a genuine first chat.
- The model picker supports ArrowUp/ArrowDown, Enter to pick, and Escape to close. Its trigger also closes on Escape.
- Native buttons and links activate with normal keyboard semantics. The setup cards do not introduce custom roving focus.

Global shortcuts available on this surface:

| Shortcut | Behavior |
| --- | --- |
| `Ctrl/Cmd+K` | Toggle command palette, including from an editable control. |
| `Ctrl/Cmd+N` | New conversation, except while focus is in an input/textarea/select/contenteditable. |
| `Ctrl/Cmd+L` | Return from menu if needed and focus composer, except from an editable control. |
| `Ctrl/Cmd+,` | Toggle Settings, except from an editable control. |
| `Ctrl/Cmd+Z` | App undo, except from an editable control where native text undo wins. |
| `F11` | Toggle fullscreen, including from editable controls. |
| `Escape` | Close palette first, then eligible overlays/menu; otherwise no global action. |

## State matrix

| State | Required rendering |
| --- | --- |
| Thread hydration | Replace hero with `Loading conversation...` in a `role="status"`; keep composer mounted. |
| True first run, Desktop, Ollama absent | Hero + Local not-detected card first + Cloud + Explore; unready composer send. |
| Desktop, Ollama configured but stopped/offline | Local configured-not-running card with explicit no-fallback copy and Local settings path. |
| Desktop, Ollama online, zero chat models | Starter-pull state with progress/error and Local settings escape hatch. |
| Desktop, Ollama online with models, no cloud key | Best eligible local model becomes default for untouched empty chats; Local ready card still asks for explicit continuation. |
| Cloud key validation in flight | Connect label `Checking...`; inline status `Checking OpenRouter...`; ignore duplicate submits. |
| Cloud key rejected | Keep panel and candidate unpersisted; inline alert with actionable key retry copy. |
| Runtime/catalog/pull error | Keep current card branch and show adjacent alert; never replace it with raw JSON or assistant prose. |
| Setup dismissed but no route ready | Quiet waiting line; composer’s normal provider banner becomes eligible; send disabled. |
| Setup dismissed with Ollama ready | Quiet ready line + optional semantic-memory nudge when embedding tag is absent. |
| Web Lite, no provider | Hero + Cloud + Explore only, browser-local note, desktop cue, disabled attachments/send. |
| Existing real conversation history | Do not show onboarding again; persisted dismissal becomes true. |

## Available data and endpoints

Designs may rearrange or progressively disclose this existing data. They must not invent a new backend, account, telemetry feed, installer API, or provider.

### Store/model shapes

```ts
type GatesRuntimeMode = 'desktop' | 'web-lite' | 'headless';

type RuntimeState = {
  installPath: string;
  managed: boolean;
  baseUrl: string; // Ollama default http://127.0.0.1:11434
  status: 'stopped' | 'starting' | 'online' | 'offline' | 'crashed';
  pid?: number;
  uptimeMs?: number;
  lastError?: string;
  lastErrorKind?: 'not-found' | 'error';
  logs: string[];
};

type OllamaPullState = {
  percent: number;
  phase: string;
  error?: string;
};

type ProviderConfig = {
  apiKey?: string;
  baseUrl?: string;
  label?: string;
  available?: boolean;
  toolsEnabled?: boolean;
};

type Model = {
  id: string;
  name: string;
  vendor: string;
  providerId: 'openrouter' | 'openai-compat' | 'ollama' | 'local-image';
  providerModelId: string;
  description?: string;
  contextLength?: number;
  contextWindow?: number;
  pricing?: { prompt?: number; completion?: number }; // USD per 1M tokens
  dynamic?: boolean;
  supportsVision?: boolean;
  supportsTools?: boolean;
};

type EmptyThreadInputs = {
  activeThread: { id: string; modelId: string; messages: []; readOnly?: boolean };
  onboardingDismissed: boolean;
  hasPriorNonReadOnlyMessages: boolean;
  providerReady: boolean;
  openRouterKeyPresent: boolean;
};
```

Example hydrated local model:

```json
{
  "id": "ollama-qwen2.5:7b",
  "name": "qwen2.5:7b",
  "vendor": "Ollama",
  "providerId": "ollama",
  "providerModelId": "qwen2.5:7b",
  "dynamic": true,
  "supportsVision": false,
  "supportsTools": true
}
```

Example OpenRouter catalog model after mapping:

```json
{
  "id": "or-live-google_gemini-3-flash",
  "name": "Gemini 3 Flash",
  "vendor": "Google",
  "providerId": "openrouter",
  "providerModelId": "google/gemini-3-flash",
  "contextLength": 1000000,
  "pricing": { "prompt": 0.5, "completion": 3.0 },
  "dynamic": true
}
```

### Calls already available

| Capability | Existing call/endpoint | Example response/input |
| --- | --- | --- |
| Runtime status | Tauri `runtime_status({ id: 'ollama' })` | `{ "running": true, "status": "online", "pid": 1234, "uptimeMs": 42000, "logs": [] }` |
| Runtime discovery | Tauri `runtime_candidate_paths`, `path_exists`; store `autoDetect()` | `{ "platform": "linux", "homeDir": "/home/user", "localAppData": "", "comfyCandidates": [] }` |
| Runtime health | Tauri `probe_http`; Ollama probe `${baseUrl}/api/version` | Success/failure only. |
| Ollama catalog | Tauri `ollama_tags` on Desktop or `GET ${baseUrl}/api/tags` | `{ "models": [{ "name": "qwen2.5:7b" }, { "name": "nomic-embed-text:latest" }] }`; embedding tags are excluded from chat `Model[]` but retained in `tagNames`. |
| Ollama pull | `POST ${baseUrl}/api/pull` with `{ "model": "llama3.2:3b", "stream": true }` | NDJSON `{ "status": "pulling manifest", "digest": "sha256:…", "total": 100, "completed": 20 }`; mapped to phase/percent. |
| OpenRouter validation/catalog | `GET https://openrouter.ai/api/v1/models` with candidate key as Bearer authorization | `{ "data": [{ "id": "google/gemini-3-flash", "name": "Gemini 3 Flash", "context_length": 1000000, "pricing": { "prompt": "0.0000005", "completion": "0.000003" }, "architecture": { "output_modalities": ["text"] } }] }` |
| Provider readiness | `providers.isConnected(providerId)` / `providers.hasUsableProvider` | Boolean, derived from the routed provider’s `ready()` state. |
| Desktop downloads | Pure `recommendedDownload(os, arch)` data | `{ "kind": "linux-appimage", "label": "Download for Linux (AppImage)", "runsOn": "Linux x86_64 (AppImage)", "url": "…" }` |

## Hard constraints

### Product and content

- Preserve the local-leading order on Desktop. Cloud may be co-equal but must not become the default visual or behavioral path for a keyless user.
- Preserve explicit provider choice and the promise that Ollama will not silently fall back to cloud.
- Apply the UX principles: calm canvas first, progressive power, capability-aware UI, tested choices before catalogs, visible-but-quiet local ownership, actionable concise errors, honest Web Lite degradation, and user control.
- Keep copy direct and humane. No promotional hero, signup funnel, mascot, security lecture, raw JSON, or fake assistant messages for background setup events.
- Desktop is the complete product. Web Lite must never expose local-runtime controls that cannot work.

### Visual system

- Support the existing dark charcoal/emerald theme and paper-like light theme through tokens, never a one-off hard-coded palette.
- Core tokens: `--bg`, `--panel`, `--panel-2`, `--panel-3`, `--border`, `--text`, `--text-dim`, `--text-faint`, `--accent`, `--accent-2`, `--accent-glow`, `--accent-contrast`, `--danger`, `--warning`, `--success`.
- Default dark values include `--bg: #121212`, `--panel: #181818`, `--text: #e4e7ef`, `--text-dim: #a0a9bd`, `--accent: #3ecf8e`; default light values include `--bg: #f4efe6`, `--panel: #faf8f3`, `--text: #1d211d`, `--text-dim: #5f645d`, `--accent: #0f6b46`.
- Type stacks: Source Serif 4/Georgia for editorial headings and input voice; Geist/system sans for UI copy; Geist Mono/monospace for kickers, counts, paths, and status metadata.
- Keep surfaces flat and quiet: low-contrast one-pixel borders, 6–10 px radii, restrained accent, no nested card stack, glassmorphism, bright full-screen gradient, or decorative dashboard treatment.
- Maintain existing centered reading/composer widths and responsive behavior. No horizontal scroll or focus/hover-driven layout shift.

### Accessibility and input

- Preserve semantic H1/H2 hierarchy, native button/input elements, and the onboarding group label `Choose how to start chatting`.
- Preserve `role="status"` for loading/success/progress and `role="alert"` for validation/runtime/pull errors. Do not rely on color alone.
- Preserve explicit accessible names for attach, send, model, skill, mobile sidebar, new-conversation, copy-link, and dismissal controls.
- All functionality must be reachable by keyboard; keep tab order aligned with visual/DOM order (Local before Cloud before Explore on Desktop).
- Preserve the global two-pixel focus ring using `--focus-ring` and `--focus-ring-glow`; do not remove focus without an equivalent visible treatment.
- Disabled controls must be truly disabled and remain visibly distinct. Do not announce unavailable actions as successful.
- Respect `prefers-reduced-motion` and the app’s `.no-animations` mode; both reduce all animation/transition durations to zero.
- Support coarse pointers and mobile safe-area insets. Do not shrink first-run actions below the existing touch/mobile targets.

### Performance

- First paint must not wait on runtime auto-detection, health probes, catalog fetches, high-entropy client hints, or update checks.
- Keep duplicate async submissions guarded and abort/replace stale catalog fetches as the stores do now.
- Keep large secondary UI such as the model picker lazy-loaded. Do not add a dependency, image payload, video, or blocking font/network requirement to first boot.
- Store state in MobX/services; components remain presentational. No raw `fetch`, direct `localStorage`, polling loop, or runtime process logic in the UI.
- Avoid layout instability when counts, status messages, progress, scrollbars, or model names change.

### Privacy and security

- No account, telemetry, or GatesAI-hosted billing layer.
- Desktop API keys go through `secretStorage` to the OS credential store and are stripped from normal provider JSON persistence. Web Lite’s explicit limitation is browser-local storage.
- Inputs are password fields; persisted keys are masked by default and revealed only on a direct user action. Never put a key in visible status, error copy, logs, screenshots, design fixtures, URLs, or exported chat state.
- The candidate OpenRouter key may be sent only to OpenRouter as Bearer authorization for validation/catalog and subsequent chosen cloud requests.
- Local runtime probes stay on explicit configured loopback/local URLs. Do not silently send local prompts, file names, paths, model inventory, or runtime errors to cloud services.
- Keep desktop file/tool actions behind the jailed bridge/Tauri capability boundaries. First boot must not broaden filesystem or command authority.

## Explicit NON-goals

- Redesigning the active conversation/message renderer, activity timeline, dock, menu pages, model-picker internals, Welcome tour contents, or settings information architecture.
- Adding authentication, hosted accounts, subscriptions, cloud sync, telemetry, enterprise admin/SSO, or a GatesAI billing intermediary.
- Adding provider integrations beyond the existing OpenRouter, Ollama, and already-existing generic OpenAI-compatible infrastructure.
- Installing or starting Ollama automatically from this panel, managing arbitrary local runtimes, or hiding installation/runtime failures.
- Turning first boot into a beginner course, multi-step wizard, marketing page, feature carousel, or mandatory checklist.
- Executing a prompt before the person explicitly sends it, auto-connecting a cloud provider, or silently changing an explicit model selection.
- Exposing Desktop-only local runtime, workspace, tool, attachment, or image-generation affordances in Web Lite.
- Solving the Welcome-tour/onboarding boot collision inside a design artifact; record any proposed resolution for the later implementation lane.
- Treating old screenshots as current truth. The committed first-run captures predate LF-4 and show Cloud first. A current post-LF-4 screenshot was not capturable in this sandbox because the app/E2E harness requires a listening server; refresh the corpus before visual implementation review.

## Current acceptance anchors

- Local card exists and precedes Cloud in the DOM.
- Keyless Desktop can route to Local settings without an OpenRouter nag.
- Detected local models default only untouched empty chats; explicit model choices remain intact.
- Online Ollama with no models can pull `llama3.2:3b` and then select it.
- Valid OpenRouter paste validates, persists, dismisses setup, and reports model count; rejected key stays unpersisted.
- Look around persists dismissal.
- Web Lite omits Local and disables attachments.
- First-run send remains disabled until the selected provider route is ready.
