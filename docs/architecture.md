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
Services (persistence, llm/, router)
        │
        ▼
Core (types, theme, models, providers, llm contract, seed, icons)
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
        Usage.tsx Api.tsx Appearance.tsx
  stores/
    RootStore.ts                  # composes registry + providers + chat + ui + router + openrouter
    ChatStore.ts                  # threads, messages, streaming via LlmRouter
    UiStore.ts                    # theme keys, draft text
    ProviderStore.ts              # API keys + LlmRouter, persisted separately
    RouterStore.ts                # observable URL hash
    ModelRegistry.ts              # curated + dynamic model catalog (MobX)
    OpenRouterStore.ts            # live OpenRouter catalog: refresh / cache / errors
    context.tsx                   # React context + use*Store hooks
  services/
    persistence.ts                # chat snapshot localStorage
    providerStorage.ts            # provider configs localStorage
    openrouterCache.ts            # gatesai.openrouter.catalog.v1 cache
    router.ts                     # tiny hash-router parser/writer
    llm/
      router.ts                   # LlmRouter — picks a provider per Model
      fake.ts                     # canned offline responses (always ready)
      openaiCompat.ts             # base for any OpenAI-shaped /chat/completions
      openrouterCatalog.ts        # fetch /api/v1/models → Model[]
      openai.ts groq.ts openrouter.ts local.ts
      anthropic.ts gemini.ts      # bespoke shapes
      sse.ts                      # shared SSE parser
      index.ts                    # barrel
  core/
    types.ts                      # all domain interfaces & key unions
    llm.ts                        # provider-agnostic LLM contract
    models.ts                     # curated Model catalog + DEFAULT_MODEL_ID
    providers.ts                  # ProviderInfo (name, desc, key URL, etc.)
    theme.ts                      # accent/bg palettes, CSS-var builder
    styleTokens.ts                # typography/layout style objects
    seed.ts                       # initial threads + welcome conversation
    icons.tsx                     # SVG icon set

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

## State management

- **MobX** with class-based stores; each store is a plain object model that
  exposes observable state, computed getters, and action methods.
- `ChatStore` owns threads + the active selection + the in-flight stream.
  An `autorun` writes the snapshot to `localStorage` whenever it changes.
- `UiStore` owns ephemeral UI state (theme keys, draft text). Not persisted.
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
  `clearCache()` (no auto-TTL), and pushes the result into the registry.
- `RootStore` composes them and is provided through React context. Components
  use `observer()` from `mobx-react-lite` and read state via `use*Store()`.

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
(any OpenAI-compatible endpoint — Ollama, LM Studio, vLLM, llama.cpp).
See `TODO.md` for the planned future list.

## Routing

Tiny hash router (`#/thread/<id>` and `#/menu/<section>`) implemented in
`services/router.ts` — pure functions for `parseHash` / `formatHash` and
side-effecting `read/write/subscribeRoute` for `window.location.hash`.
`RouterStore` wraps the side effects in MobX observables.

## Persistence

| Key                        | Shape            | Owner             |
| -------------------------- | ---------------- | ----------------- |
| `gatesai.state.v1`              | `ChatSnapshot`            | `ChatStore`        |
| `gatesai.providers.v1`          | `ProviderConfigs`         | `ProviderStore`    |
| `gatesai.openrouter.catalog.v1` | `{ fetchedAt, models[] }` | `OpenRouterStore`  |

Both are saved on every observable mutation via `autorun`. UI state and
provider routing live in memory only.

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
