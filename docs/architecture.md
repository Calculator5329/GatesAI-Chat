# Architecture

GatesAI Chat is a React 19 + TypeScript single-page app organized into a
strict layered architecture with one-way dependencies.

```
UI (components/, app/)
        │
        ▼
Stores (MobX object models)
        │
        ▼
Services (persistence, llm/, tools/, image/, bridge, router, source*)
        │
        ▼
Core (types, theme, models, providers, runtime, llm contract, seed)
```

## Folder layout

```
src/
  main.tsx                        # entry: mounts <App> with the root store
  index.css                       # @import manifest only — real CSS lives in styles/
  styles/                         # layered CSS: base / editorial / markdown / menu / responsive
  app/
    App.tsx                       # top-level shell — sidebar + (chat | menu)
  components/
    ui/                           # design-system primitives (feature-agnostic)
      Toggle.tsx Pill.tsx Card.tsx Button.tsx
      Input.tsx Select.tsx Textarea.tsx
      SettingsRow.tsx SegmentedControl.tsx
      icons.tsx
      index.ts
    media/                        # shared image UI used by >1 feature
      Lightbox.tsx                # full-screen image viewer
      useImageDataUrl.ts          # workspace/hosted image loader hook
    editorial/                    # the chat surface
      activity/                   # ambient assistant activity timeline rows
      EditorialSidebar.tsx
      EditorialChat.tsx
      EditorialMessage.tsx
      EditorialComposer.tsx
      ModelPopover.tsx            # presentation only (lazy-loaded); logic in core/modelPicker
    menu/                         # the GatesMenu surface
      GatesMenu.tsx
      sections/
        Agent.tsx Settings.tsx api/ApiSection.tsx Workspace.tsx
        Local.tsx                 # local runtimes (Ollama + ComfyUI) + image-gen settings
        Gallery.tsx               # completed image-job history
  stores/
    RootStore.ts                  # composes the store graph
    ChatStore.ts                  # threads, messages, streaming via LlmRouter
    chatPersistenceCoordinator.ts # chat snapshot policy: throttled local autosave,
                                  # unload flush, multi-tab pause, workspace save queue
    UiStore.ts                    # composer draft + persisted reading prefs
    ProviderStore.ts              # API keys + LlmRouter, persisted separately
    RouterStore.ts                # observable URL hash
    ModelRegistry.ts              # curated + dynamic model catalog (MobX)
    OpenRouterStore.ts            # live OpenRouter catalog: refresh / cache / errors
    OpenRouterCompatibilityStore.ts  # Models-menu live compatibility runner
    OllamaStore.ts                # Ollama config + /api/tags catalog
    LocalRuntimeStore.ts          # Ollama + ComfyUI install paths, base URLs, vision model
    ImageGenStore.ts              # image-gen backend selection + workflow override settings
    ImageJobStore.ts              # image-job queue, runner, completed history
    SearchStore.ts                # Brave Search key, short-lived query cache, web_search facade
    UserProfileStore.ts           # bio, durable facts, base system prompt
    SummaryStore.ts               # lazy cross-thread summaries
    NotesStore.ts                 # durable user/model notes
    BridgeStore.ts                # bridge health + WebSocket client
    ExecStreamStore.ts            # live terminal output tail for UI
    SourceWorkspaceStore.ts       # facade over desktop source-workspace + source-build services
    context.tsx                   # React context + use*Store hooks
  services/
    persistence.ts                # chat snapshot localStorage
    providerStorage.ts            # provider configs localStorage
    profileStorage.ts             # user profile localStorage
    notesStorage.ts               # notes localStorage
    uiPrefsStorage.ts             # output style prefs localStorage
    openrouterCache.ts            # gatesai.openrouter.catalog.v1 cache
    imageGenStorage.ts            # gatesai.imagegen.v1 (ComfyUI quality + workflow override)
    imageJobsStorage.ts           # gatesai.imagejobs.v1 (completed-job history; in-flight discarded)
    searchStorage.ts              # gatesai.search.v1 (Brave Search key)
    workspaceChatPersistence.ts   # bridge-backed chat snapshot (privileged bridge requests)
    chat/                         # chat-turn helpers extracted from ChatStore
      contextModes.ts             #   full/micro/bare prompt + tools shaping
      toolBatchExecutor.ts        #   validates + runs a turn's tool-call batch
      activityProjection.ts       #   tool calls/results → ActivityItem[]
      turnFormatting.ts           #   error/recovery/interrupt display text
      imageTurnFormatting.ts      #   image-turn display text + terminal results
      pseudoToolRescue.ts         #   rescue Ollama tool calls emitted as text
      libraryExport.ts            #   /workspace/chat-history HTML/Markdown library renderer
    storage/
      persistenceProvider.ts      # injectable persistence ports + localStorage adapter
      jsonSlot.ts                 # compatibility wrapper for JSON-backed slots
      modelPickerStorage.ts       # model-picker source filter + recent models
    router.ts                     # tiny hash-router parser/writer
    diagnostics/
      logger.ts                   # central logger: ring buffer + console + bridge-file sinks
      chatLog.ts                  # per-thread forensic JSONL trail
    bridge/
      health.ts                   # /health probe (network kept out of the store)
    llm/
      router.ts                   # LlmRouter — picks a provider per Model
      openaiCompat.ts             # base for any OpenAI-shaped /chat/completions
      openrouterCatalog.ts        # fetch /api/v1/models → Model[]
      openrouter.ts               # OpenRouter chat adapter
      ollama.ts ollamaCatalog.ts  # Ollama provider + /api/tags → Model[] mapper
      sse.ts                      # shared SSE parser
      wireFormat.ts               # storage shape ↔ provider wire shape
      index.ts                    # barrel
    image/
      types.ts                    # GenerateImageRequest/Result, dims/aspect helpers, validators
      imageBackend.ts             # resolveBackend + dispatchImageGenerate
      comfyClient.ts              # ComfyUI workflow queue adapter
      jobs/
        types.ts                  # ImageJob, ImageJobInput, CompletedJob, status union
        progress.ts               # JobProgress interface (open/cancel/onUpdate)
        comfyProgress.ts          # ComfyUI WebSocket progress adapter
      workflows/
        finalFlux2Klein.ts        # FLUX.2 Klein FP8 ComfyUI workflow builder
        sdxlLightning.ts          # SDXL Lightning draft workflow template
  core/
    types.ts                      # domain interfaces & persisted preference unions
    llm.ts                        # provider-agnostic LLM contract
    models.ts                     # curated Model catalog + DEFAULT_MODEL_ID
    modelPicker.ts                # pure picker logic: sections, filters, badges, copy
    threadSelectors.ts            # pure thread selectors (spend, sidebar search match)
    breakpoints.ts                # MOBILE_SHELL_QUERY — the one mobile matchMedia source
    providers.ts                  # provider metadata (name, desc, key URL, etc.)
    runtime.ts                    # pure desktop-vs-web-lite mode detection (importable by every layer)
    theme.ts                      # accent/bg palettes, CSS-var builder
    styleTokens.ts                # typography/layout style objects

tests/                            # Vitest + Playwright e2e, separate from src/
  helpers/
    mockProvider.ts               # scriptable LlmProvider for ChatStore tests
    storage.ts
  stores/
    ChatStore.test.ts ProviderStore.test.ts OpenRouterStore.test.ts
  services/
    persistence.test.ts router.test.ts llmRouter.test.ts
    openrouterCatalog.test.ts openrouterCache.test.ts
```

## Layer rules

| Layer                | May import from                                | Notes                                          |
| -------------------- | ---------------------------------------------- | ---------------------------------------------- |
| `core/`              | (nothing else)                                 | Pure data + types. No React.                   |
| `services/`          | `core/`                                        | Stateless. No MobX, no React, no app state.    |
| `stores/`            | `core/`, `services/`                           | MobX classes. No React/UI imports.             |
| `components/ui/`     | `core/` only                                   | Stateless primitives.                          |
| `components/media/`  | `core/`, `stores/`, `components/ui/`           | Shared image UI; neutral so >1 feature can use it. |
| `components/<feat>/` | `core/`, `stores/`, `components/ui/`, `components/media/` | Observers; never import other features.   |
| `app/`               | everything                                     | Composition root.                              |
| `tests/`             | anything in `src/`                             | Lives outside `src/` so the app build is pure. |

`stores/context.tsx` is the explicit React bridge exception: it hosts
`StoreProvider` and the `use*Store()` hooks so feature components never import
`RootStore` directly. `eslint.config.js` enforces these boundaries with
depth-agnostic `no-restricted-imports` rules (each layer's block is
self-contained because ESLint flat config replaces rather than merges a
rule across config objects): UI may not import `services/`, features may not
import sibling features, and stores/services may not import UI. Tests are
kept looser so they can reach into `src/` freely.

On top of the import-direction rules, the lint config mechanically enforces
several project patterns so the codebase stays safe for humans and AI agents to
extend:

| Rule | Scope | What it locks in |
| --- | --- | --- |
| `no-console` (logger exempt) | all `src/` | Runtime diagnostics go through `services/diagnostics/logger`, never raw `console.*`. |
| `@typescript-eslint/consistent-type-imports` | all `src/` | Type-only deps use `import type`. |
| `no-restricted-syntax` (no `fetch()`) | `stores/` | Network lives in services; stores consume it. |
| `no-restricted-globals` (no `localStorage`/`sessionStorage`) | `stores/`, `components/` | Persistence goes through a `services/storage/*` facade. |
| `import/no-cycle` | all `src/` | No circular imports (which ESM allows but the layers must not have). |
| `mobx/{missing,exhaustive,unconditional}-make-observable` | `stores/` | Every observable store class is correctly wired. |

## State management

- **MobX** with class-based stores; each store is a plain object model that
  exposes observable state, computed getters, and action methods.
- `ChatStore` owns threads + the active selection + the in-flight stream.
  An `autorun` writes the snapshot to `localStorage` whenever it changes.
- `UiStore` owns UI state (draft text, attachment upload state, and fixed
  reading defaults). Output styling is normalized to the foundation defaults.
- `ProviderStore` owns API keys + a long-lived `LlmRouter`. Persisted under
  `gatesai.providers.v1` separately from chat data so keys don't leak into
  thread exports.
- `RouterStore` is two-way bound to `window.location.hash`. `RootStore`
  wires it to `ChatStore.activeThreadId` so deep links and the back button
  just work.
- `ModelRegistry` is the single source of truth for "all known models" —
  curated entries from `core/models.ts` plus dynamic entries hydrated at
  runtime. Dedupes by `(providerId, providerModelId)`; dynamic wins.
- Direct local image generation is represented as synthetic `local-image`
  model entries: Draft maps to SDXL Lightning, Normal maps to FLUX.2 Klein
  without upscale, and Upscale maps to FLUX.2 Klein with a 2× hires-fix pass.
  `ChatStore` enqueues the selected mode on the image job; `ImageJobStore`
  translates that mode into ComfyUI preset/upscale settings before dispatch.
- `OpenRouterStore` owns the live OpenRouter catalog. It hydrates from
  `gatesai.openrouter.catalog.v1` on boot, exposes `refresh()` /
  `clearCache()` (no auto-TTL), writes cache on explicit refresh/clear, and
  pushes the result into the registry.
- `UserProfileStore` owns durable user facts and composes the base system
  prompt sections used by `ChatStore`.
- `SummaryStore` lazily writes one-line digests for inactive threads so the
  active prompt can include recent cross-thread context.
- `NotesStore` owns durable long-form notes exposed through the `notes` tool.
- `BridgeStore` owns bridge health polling and the WebSocket client.
- `ExecStreamStore` owns the live terminal output tail rendered while
  `terminal` calls are in flight.
- `SearchStore` owns the Brave Search API key, a short-lived in-memory result
  cache, and the facade consumed by the `web_search` tool.
- `RootStore` composes them and is provided through React context. Components
  use `observer()` from `mobx-react-lite` and read state via `use*Store()`.

## Tools

Tools live under `services/tools/`. Each implements `Tool` from
`services/tools/types.ts`: a `ToolDef` the model sees, optional
`meta` for category / read-only hints, and `execute(args, ctx)`.
`execute` returns either a string (the common case — the model gets it
verbatim as the tool result) or `{ content, summary, artifacts }` where
`summary` is the concise UI-facing one-liner and
`artifacts: ToolResultArtifact[]` is a UI-only side channel for rich
rendering. Each registered tool also exposes pure `ui` metadata
(`verb`, optional `target`, optional result `summary`) so the chat
surface can describe activity without parsing result strings or importing
tool internals. The `image_generate` tool uses artifacts to surface the
queued image job so the unified activity renderer can mount progress and
results without regexing the human-facing result string.

`services/chat/toolBatchExecutor.executeToolBatch` (called by `ChatStore`)
validates a turn's tool-call batch, runs the registry (read-only calls in
parallel), persists the `content` and `summary` onto the assistant message's
`toolResults`, and stashes `artifacts` next to it when present. Tools that
need the bridge share the `services/tools/requireBridge` guard middleware
instead of copy-pasting offline checks.

The `logs` tool (category `diagnostics`) lets the assistant read the app's own
recent log entries (see Logging below) so it can self-diagnose failures instead
of guessing.

## Logging & diagnostics

All runtime diagnostics flow through `services/diagnostics/logger.ts`, the single
sanctioned `console` boundary (the `no-console` lint rule exempts only this
file). `logger.{debug,info,warn,error}(scope, message, data?)`:

- keeps an in-memory **ring buffer** (last 500 entries) that the `logs` tool
  reads, so self-diagnosis works in every runtime including Web Lite;
- writes a **level-filtered console** (everything in dev; warn/error in prod);
- appends a **JSONL file** to `/workspace/logs/app-<date>.log` via the bridge
  when desktop is online, so failures survive reloads.

`RootStore` wires the file sink (`configureLogSink`) alongside the per-thread
forensic `chatLog`. Errors normalize to `{ name, message, stack }`. UI never
logs directly — it dispatches to a store, which logs.

Common log scopes (grep the ring buffer or JSONL by `scope`):

| Scope | Typical events |
| ----- | -------------- |
| `chat` | `runTurn` failures, stale finalize skip, auto-naming errors |
| `persistence` | quarantine, emergency compaction, multi-tab pause/reload, workspace save, dropped threads |
| `security` | protected chat-history denials (`fs`, `terminal`, `python_inline`, `sqlite_query`, `inspect_file`) |
| `bridge` | WebSocket connect failure after health OK, offline transition |
| `image-jobs` | dispatch, cancel/recovery, progress adapter failures |
| `summary` | background/manual summarization stream failures |
| `models` | OpenRouter/Ollama catalog fetch failures |
| `llm` | provider stream errors (OpenRouter compat, Ollama) |
| `local-runtime` | auto-detect / start failures |
| `attachments` | bridge upload failures |
| `search` | Brave search failures |
| `tools` | uncaught tool execution exceptions |

## Activity timeline

Assistant-side work is projected through a single `ActivityItem[]`
contract rather than separate bespoke renderers. `ChatStore.activitiesForMessage(...)`
merges:

- tool calls and tool results using the registry's tool UI metadata
- pre-tool `workNotes` as expandable thinking rows
- live pre-token state (`thinking`, `responding`, `compacting`, `generating`)
- `ExecStreamStore` tails for running terminal calls
- `ImageJobStore` status for image-job artifacts
- bridge transition events captured during the active assistant turn

`components/editorial/activity/ActivityStream` and `ActivityRow` are the
only live renderer for this surface. Rows stay ambient by default
(mono, single line, running dots), and expand in place for markdown
detail, terminal tails, and image artifacts. The older `ToolCallRender`,
`LiveExecTail`, and selectable `toolCallStyle` preference were retired.

Workspace chat history is app-managed: `ChatStore` saves a JSON envelope under
`/workspace/.gatesai/chat/state.v1.json` when the bridge is online and writes a
readable `/workspace/chat-history` HTML/Markdown library for users. App tools
block direct access to **both** the JSON scope and the `chat-history/` mirror
(`fs`, `inspect_file`, `terminal`, `python_inline`, `sqlite_query`); models
use `chat_history` for bounded recent/search/read operations instead. The Go
bridge (sibling repo) now also enforces this server-side: unprivileged
envelopes are denied fs access to `.gatesai/chat` + `chat-history` subtrees
(hidden from list/search) and exec commands mentioning them are refused; only
app-originated requests marked `privileged: true` (the wrapped client inside
`workspaceChatPersistence`) may touch them. `web_search`
routes through `SearchStore` and Brave's LLM Context endpoint, using a desktop
Tauri proxy when running inside the packaged app.

## Image jobs

`image_generate` is decoupled from the chat turn. The tool enqueues an
`ImageJob` into `ImageJobStore` and returns immediately with an
`{ kind: 'image-job', jobId, count }` artifact. `ImageJobStore` owns:

- a serial **queue** + an **active** in-flight job
- a **runner** that pulls one job, opens the ComfyUI progress adapter
  (WebSocket `/ws`), dispatches
  the configured number of renders through `dispatchImageGenerate`, and
  writes each result into `/workspace/artifacts/` via `bridge.fs.write`
- a **completed-job history** persisted under `gatesai.imagejobs.v1`
  (capped at 200 entries) so the Gallery menu and ImageJobCards survive
  reloads

Cancel aborts the inflight controller and asks the progress adapter to
hit the backend's `/interrupt` endpoint best-effort. The runner **does not**
start the next queued job until the cancelled job's `runJob` promise settles
(C2 runner lock — the cancelled job's `finally` must not clobber the next
job's abort controller). The chat-side
`ImageJobCard` observes the store and dispatches its render to a
status-specific sub-card (running / done-single / done-grid /
failed / cancelled), with a Lightbox for click-through.

## LLM provider abstraction

Every provider in `src/services/llm/` implements the `LlmProvider` contract:

```ts
interface LlmProvider {
  readonly id: ProviderId;
  ready(): boolean;
  stream(req: LlmRequest, signal: AbortSignal): AsyncIterable<LlmChunk>;
}
```

`LlmRouter.resolve(modelId)` looks up the model in the catalog, finds its
`providerId`, and returns the configured provider. There is no fake or
direct-provider fallback in the foundation build. `ChatStore.sendMessage`
consumes the resulting `AsyncIterable` with `for await` and uses
`AbortController` to cancel on stop / thread switch.

Supported providers in the foundation: OpenRouter, Ollama, and the synthetic
`local-image` provider used by the direct ComfyUI image model. The `local-image`
provider is registered only for catalog/router exhaustiveness; `ChatStore.runTurn`
short-circuits before streaming and enqueues an image job directly.

## Routing

Tiny hash router (`#/thread/<id>` and `#/menu/<section>`) implemented in
`services/router.ts` — pure functions for `parseHash` / `formatHash` and
side-effecting `read/write/subscribeRoute` for `window.location.hash`.
`RouterStore` wraps the side effects in MobX observables. Menu sections are
`agent`, `models`, `local`, `workspace`, `gallery`, and `settings`; retired
hashes such as `profile`, `api`, `usage`, and `appearance` redirect to the
closest current section.

## Persistence

| Key                              | Shape                    | Owner              |
| -------------------------------- | ------------------------ | ------------------ |
| `gatesai.state.v1`               | `ChatSnapshot`           | `ChatStore`        |
| `gatesai.providers.v1`           | `ProviderConfigs`        | `ProviderStore`    |
| `gatesai.profile.v1`             | `UserProfileSnapshot`    | `UserProfileStore` |
| `gatesai.notes.v1`               | `Note[]`                 | `NotesStore`       |
| `gatesai.uiprefs.v1`             | output style prefs       | `UiStore`          |
| `gatesai.openrouter.catalog.v1`  | `{ fetchedAt, models[] }`| `OpenRouterStore`  |
| `gatesai.ollama.v1`              | Ollama config + catalog  | `OllamaStore`      |
| `gatesai.local.v1`               | runtime paths + toggles  | `LocalRuntimeStore`|
| `gatesai.imagegen.v1`            | ComfyUI quality + workflow | `ImageGenStore`  |
| `gatesai.imagejobs.v1`           | completed-job history    | `ImageJobStore`    |
| `gatesai.search.v1`              | Brave Search key         | `SearchStore`      |
| `gatesai.modelPicker.source.v1`  | picker source filter     | `ModelRegistry`    |
| `gatesai.modelPicker.recent.v1`  | recent model ids         | `ModelRegistry`    |
| `gatesai.modelPicker.favorites.v1` | favorited model ids    | `ModelRegistry`    |
| `gatesai.userGuide.opened.v1`    | first-run guide flag     | user guide service |

Chat, provider, profile, notes, and UI preference snapshots are saved from
their owning stores through small `PersistenceProvider<T>` ports in
`services/storage/persistenceProvider.ts`. The current production adapters
still use localStorage, but the storage backend is injectable at the slot
boundary so future IndexedDB or Firestore repositories can replace local slots
without changing store APIs. OpenRouter cache writes happen on explicit
`refresh()`/`clearCache()` instead of on every observable mutation. The
Ollama snapshot persists on every config mutation so a fresh boot has
a populated picker before the first `/api/tags` probe completes. Provider
routing and transient UI state live in memory only.

**Multi-tab coordination (partial):** `installMultiTabStorageListener` logs
cross-tab `localStorage` writes. When another tab mutates `gatesai.state.v1`,
`ChatStore` pauses autosave and shows a composer banner (Reload or Dismiss).
There is no merge — Dismiss resumes last-write-wins saves.

**Compaction notice:** when emergency chat compaction succeeds after a quota
error, `ChatStore.compactionNotice` surfaces a user-visible banner; profile,
notes, and ui-prefs save failures are log-only via `createJsonPersistenceProvider`.

**Per-thread composer state:** `UiStore.bindDraftThread` isolates draft text and
attachments per thread; `ChatStore.lastErrorByThread` scopes provider errors to
the active thread's composer banner.

## Testing

- **Vitest** in jsdom, configured by `vitest.config.ts` (`npm run test`).
- **Playwright** e2e in `tests/e2e/` (`npm run test:e2e`): two projects —
  `desktop-mocked` (faked bridge + OpenRouter SSE) and `web-lite` (firebase
  build, degraded surfaces).
- Tests live in a top-level `tests/` folder — `tsconfig.app.json` only
  includes `src/`, so the production build never sees test code.
- `tsconfig.test.json` extends the app config with test-specific settings
  (`vitest/globals` + `node` types, relaxed `verbatimModuleSyntax`).
- The MockProvider in `tests/helpers/mockProvider.ts` implements
  `LlmProvider` so `ChatStore` can be exercised without `fetch`.

## CI

```
npm run typecheck   # tsc -b && tsc -p tsconfig.test.json --noEmit (strict mode on)
npm run lint        # ESLint over the repo (eslint .)
npm run test        # Vitest (700+ offline tests)
npm run ci          # all three, in order (e2e is separate: npm run test:e2e)
```

`.github/workflows/ci.yml` runs the unit/typecheck/lint job plus a Playwright
e2e job on every push to `master` and on pull requests, so releases and
deploys no longer ship ungated.
