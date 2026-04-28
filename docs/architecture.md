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
Services (persistence, llm/, tools/, bridge, router)
        │
        ▼
Core (types, theme, models, providers, llm contract, seed)
```

## Folder layout

```
src/
  main.tsx                        # entry: mounts <App> with the root store
  index.css
  app/
    App.tsx                       # top-level shell — sidebar + (chat | menu)
  components/
    ui/                           # design-system primitives (feature-agnostic)
      Toggle.tsx Pill.tsx Card.tsx Button.tsx
      Input.tsx Select.tsx Textarea.tsx
      SettingsRow.tsx SegmentedControl.tsx
      ToolCallRender.tsx          # shared tool-call/result renderers
      icons.tsx
      index.ts
    editorial/                    # the chat surface
      EditorialSidebar.tsx
      EditorialChat.tsx
      EditorialMessage.tsx
      EditorialComposer.tsx
      EditorialThreadHeader.tsx
      ModelPopover.tsx
      headers.tsx                 # 4 brand-header treatments
    menu/                         # the GatesMenu surface
      GatesMenu.tsx
      sections/
        Profile.tsx Agent.tsx Settings.tsx
        Usage.tsx Api.tsx Appearance.tsx Workspace.tsx
        Local.tsx                 # local runtimes (Ollama + ComfyUI) + image-gen settings
        Gallery.tsx               # completed image-job history
  stores/
    RootStore.ts                  # composes the store graph
    ChatStore.ts                  # threads, messages, streaming via LlmRouter
    UiStore.ts                    # theme keys, draft text, persisted reading prefs
    ProviderStore.ts              # API keys + LlmRouter, persisted separately
    RouterStore.ts                # observable URL hash
    ModelRegistry.ts              # curated + dynamic model catalog (MobX)
    OpenRouterStore.ts            # live OpenRouter catalog: refresh / cache / errors
    OllamaStore.ts                # Ollama config + /api/tags catalog
    LocalRuntimeStore.ts          # Ollama + ComfyUI install paths, base URLs, vision model
    ImageGenStore.ts              # image-gen backend selection + workflow override + prompt-enhance settings
    ImageJobStore.ts              # image-job queue, runner, completed history
    UserProfileStore.ts           # bio, durable facts, base system prompt
    SummaryStore.ts               # lazy cross-thread summaries
    NotesStore.ts                 # durable user/model notes
    BridgeStore.ts                # bridge health + WebSocket client
    ExecStreamStore.ts            # live terminal output tail for UI
    context.tsx                   # React context + use*Store hooks
  services/
    persistence.ts                # chat snapshot localStorage
    providerStorage.ts            # provider configs localStorage
    profileStorage.ts             # user profile localStorage
    notesStorage.ts               # notes localStorage
    uiPrefsStorage.ts             # output style prefs localStorage
    openrouterCache.ts            # gatesai.openrouter.catalog.v1 cache
    imageGenStorage.ts            # gatesai.imagegen.v1 (backend + workflow override + prompt-enhance prefs)
    imageJobsStorage.ts           # gatesai.imagejobs.v1 (completed-job history; in-flight discarded)
    router.ts                     # tiny hash-router parser/writer
    llm/
      router.ts                   # LlmRouter — picks a provider per Model
      fake.ts                     # canned offline responses (always ready)
      openaiCompat.ts             # base for any OpenAI-shaped /chat/completions
      openrouterCatalog.ts        # fetch /api/v1/models → Model[]
      openai.ts groq.ts openrouter.ts local.ts
      anthropic.ts gemini.ts      # bespoke shapes
      ollama.ts ollamaCatalog.ts  # Ollama provider + /api/tags → Model[] mapper
      sse.ts                      # shared SSE parser
      wireFormat.ts               # storage shape ↔ provider wire shape
      index.ts                    # barrel
    image/
      types.ts                    # GenerateImageRequest/Result, dims/aspect helpers, validators
      imageBackend.ts             # resolveBackend + dispatchImageGenerate
      a1111Client.ts              # AUTOMATIC1111 txt2img adapter
    comfyClient.ts              # ComfyUI workflow queue adapter
      promptEnhancer.ts           # optional LLM-driven prompt rewrite
      jobs/
        types.ts                  # ImageJob, ImageJobInput, CompletedJob, status union
        progress.ts               # JobProgress interface (open/cancel/onUpdate)
        comfyProgress.ts          # ComfyUI WebSocket progress adapter
        a1111Progress.ts          # A1111 /sdapi/v1/progress poll adapter
      workflows/
        finalFlux2Klein.ts        # FLUX.2 Klein FP8 ComfyUI workflow builder
        sdxlLightning.ts          # SDXL Lightning draft workflow template
  core/
    types.ts                      # all domain interfaces & key unions
    llm.ts                        # provider-agnostic LLM contract
    models.ts                     # curated Model catalog + DEFAULT_MODEL_ID
    providers.ts                  # ProviderInfo (name, desc, key URL, etc.)
    theme.ts                      # accent/bg palettes, CSS-var builder
    styleTokens.ts                # typography/layout style objects
    seed.ts                       # initial threads + welcome conversation

tests/                            # Vitest, completely separate from src/
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
| `components/<feat>/` | `core/`, `stores/`, `components/ui/`           | Observers; never import other features.        |
| `app/`               | everything                                     | Composition root.                              |
| `tests/`             | anything in `src/`                             | Lives outside `src/` so the app build is pure. |

`stores/context.tsx` is the explicit React bridge exception: it hosts
`StoreProvider` and the `use*Store()` hooks so feature components never import
`RootStore` directly. `eslint.config.js` contains staged
`no-restricted-imports` rules that enforce these boundaries for production
source while keeping tests looser.

## State management

- **MobX** with class-based stores; each store is a plain object model that
  exposes observable state, computed getters, and action methods.
- `ChatStore` owns threads + the active selection + the in-flight stream.
  An `autorun` writes the snapshot to `localStorage` whenever it changes.
- `UiStore` owns UI state (theme keys, draft text, reading preferences).
  Draft/theme keys are ephemeral today; output style preferences persist under
  `gatesai.uiprefs.v1`.
- `ProviderStore` owns API keys + a long-lived `LlmRouter`. Persisted under
  `gatesai.providers.v1` separately from chat data so keys don't leak into
  thread exports.
- `RouterStore` is two-way bound to `window.location.hash`. `RootStore`
  wires it to `ChatStore.activeThreadId` so deep links and the back button
  just work.
- `ModelRegistry` is the single source of truth for "all known models" —
  curated entries from `core/models.ts` plus dynamic entries hydrated at
  runtime. Dedupes by `(providerId, providerModelId)`; dynamic wins.
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
- `RootStore` composes them and is provided through React context. Components
  use `observer()` from `mobx-react-lite` and read state via `use*Store()`.

## Tools

Tools live under `services/tools/`. Each implements `Tool` from
`services/tools/types.ts`: a `ToolDef` the model sees, optional
`meta` for category / read-only hints, and `execute(args, ctx)`.
`execute` returns either a string (the common case — the model gets it
verbatim as the tool result) or `{ content, artifacts }` where
`artifacts: ToolResultArtifact[]` is a UI-only side channel for rich
rendering. The `image_generate` tool uses this to surface the saved
artifact path so the chat renderer can mount a thumbnail without
parsing the human-facing result string.

`ChatStore.executeOneToolCall` runs the registry, persists the
`content` onto the assistant message's `toolResults`, and stashes
`artifacts` next to it when present.

## Image jobs

`image_generate` is decoupled from the chat turn. The tool enqueues an
`ImageJob` into `ImageJobStore` and returns immediately with an
`{ kind: 'image-job', jobId, count }` artifact. `ImageJobStore` owns:

- a serial **queue** + an **active** in-flight job
- a **runner** that pulls one job, opens a per-backend progress adapter
  (Comfy WebSocket `/ws` or A1111 `/sdapi/v1/progress` poll), dispatches
  the configured number of renders through `dispatchImageGenerate`, and
  writes each result into `/workspace/artifacts/` via `bridge.fs.write`
- a **completed-job history** persisted under `gatesai.imagejobs.v1`
  (capped at 200 entries) so the Gallery menu and ImageJobCards survive
  reloads

Cancel aborts the inflight controller and asks the progress adapter to
hit the backend's `/interrupt` endpoint best-effort. The chat-side
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
`providerId`, and either returns the configured provider or falls back to
`FakeProvider` (offline canned responses). `ChatStore.sendMessage` consumes
the resulting `AsyncIterable` with `for await` and uses `AbortController`
to cancel on stop / thread switch.

Supported providers (v1): OpenRouter, Anthropic, OpenAI, Gemini, Groq, Local
(any OpenAI-compatible endpoint — LM Studio, vLLM, llama.cpp), Ollama, and the
synthetic `local-image` provider used by the direct ComfyUI image model. The
`local-image` provider is registered only for catalog/router exhaustiveness;
`ChatStore.runTurn` short-circuits before streaming and enqueues an image job
directly.
See `TODO.md` for the planned future list.

## Routing

Tiny hash router (`#/thread/<id>` and `#/menu/<section>`) implemented in
`services/router.ts` — pure functions for `parseHash` / `formatHash` and
side-effecting `read/write/subscribeRoute` for `window.location.hash`.
`RouterStore` wraps the side effects in MobX observables.

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
| `gatesai.imagejobs.v1`           | completed-job history    | `ImageJobStore`    |

Chat, provider, profile, notes, and UI preference snapshots are saved from
their owning stores. OpenRouter cache writes happen on explicit
`refresh()`/`clearCache()` instead of on every observable mutation. The
Ollama snapshot persists on every config mutation so a fresh boot has
a populated picker before the first `/api/tags` probe completes. Provider
routing and transient UI state live in memory only.

## Testing

- **Vitest** in jsdom, configured by `vitest.config.ts`.
- Tests live in a top-level `tests/` folder — `tsconfig.app.json` only
  includes `src/`, so the production build never sees test code.
- `tsconfig.test.json` extends the app config with test-specific settings
  (`vitest/globals` + `node` types, relaxed `verbatimModuleSyntax`).
- The MockProvider in `tests/helpers/mockProvider.ts` implements
  `LlmProvider` so `ChatStore` can be exercised without `fetch`.

## CI

```
npm run typecheck   # tsc -b && tsc -p tsconfig.test.json --noEmit
npm run lint        # ESLint over src/ + tests/
npm run test        # Vitest
npm run ci          # all three, in order
```
