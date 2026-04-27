# Ollama integration — design

## Goal

First-class local LLMs in the model picker via Ollama. The user installs Ollama, pulls a model, opens Settings → API, and the model shows up in the picker the way OpenRouter / Anthropic / OpenAI models do today. Tool calls and (for capable models) image inputs work the same as cloud providers.

This is "make local LLMs run on my PC through the interface," not a full local-models product. The opinionated install/onboarding flow (recommended models, guided setup) is explicitly out of scope.

## Architecture

A new dedicated provider, parallel to the existing `local` (generic OpenAI-compatible) provider, not a replacement for it:

```
core/
  llm.ts                      # add 'ollama' to ProviderId

services/
  llm/
    ollama.ts                 # NEW: OllamaProvider — speaks /api/chat (NDJSON)
    LlmRouter.ts              # already routes by providerId, no change

stores/
  OllamaStore.ts              # NEW: base URL, optional key, status, catalog,
                              # refresh(), startStatusPoll/stopStatusPoll
  context.tsx                 # wire useOllamaStore + provide to LlmRouter

components/
  menu/sections/api/
    OllamaCard.tsx            # NEW: status pill, base URL, key, catalog refresh,
                              # tools-off toggle. Sits between ProviderCard
                              # and ImageGenCard in ApiSection.
```

The Ollama card lives in the API panel as a sibling to the existing provider cards. The existing "Local endpoint" provider stays untouched — it serves LM Studio / vLLM / llama.cpp users.

## Data flow

**Boot:**
1. `RootStore` constructs `OllamaStore`, which loads `gatesai.ollama.v1` from localStorage (base URL, optional key, cached catalog).
2. `OllamaStore.start()` fires one `/api/tags` probe. If it succeeds, hydrates the catalog into `ModelRegistry` and sets status to online.
3. While the API panel is open, a 30-second poll keeps the status pill honest.

**Sending a message with an Ollama model:**
1. User picks an `ollama-<tag>` model in the composer.
2. `ChatStore.sendMessage` builds the `LlmRequest` as usual.
3. `LlmRouter.resolve('ollama')` returns `OllamaProvider`.
4. `OllamaProvider.stream` POSTs to `<baseUrl>/api/chat` with `stream: true`, mapping our `LlmMessage[]` → Ollama's `messages: [{role, content, images?, tool_calls?}]` shape.
5. NDJSON response yields `LlmChunk` events: text deltas from `message.content`, fully-buffered tool calls when `message.tool_calls` arrives, `done: true` → `{ type:'done', finishReason:'stop'|'tool_use' }`.

**Refreshing the catalog:**
1. User clicks "Refresh" or app boots.
2. `OllamaStore.refresh()` fetches `/api/tags`, maps each entry to a `Model`:
   - `id: 'ollama-' + tag`
   - `providerId: 'ollama'`, `providerModelId: tag`
   - `name: tag` (raw, e.g. `llama3.1:8b-instruct-q4_K_M`)
   - `vendor: 'Ollama'`
   - `supportsVision`: matched against the existing `modelSupportsVision` heuristic, extended for `llama3.2-vision`, `bakllava`, `moondream`, `minicpm-v`
   - `supportsTools`: `false` for known-bad families (`gemma*`, `phi*`); `true` otherwise; user-toggleable global override on the card
   - `contextLength`: undefined (deferred to a future `/api/show` lazy fetch)
3. Pushes the resolved list into `ModelRegistry`, replacing previous Ollama entries.

## Components

### OllamaProvider (`services/llm/ollama.ts`)

Implements `LlmProvider`. Talks Ollama's native `/api/chat` rather than the OpenAI-compatible `/v1/chat/completions` shim because:
- the shim mangles tool-call streaming for some models
- we want to pass `keep_alive` (default `5m`) so model loads aren't repeated per turn
- vision input goes via `images: ["<base64>"]` on each user message, not OpenAI content-parts

Tool-call shape: Ollama emits `message.tool_calls: [{function: {name, arguments}}]` once the model is done; map these into our `ToolCall` events. No call ids — synthesize `tool-<n>` on our side. Tool results go back as a `role: 'tool'` message with `content` set; the existing `wireFormat.ts` translation already produces this.

Auth: `Authorization: Bearer <key>` only when `OllamaStore.config.apiKey` is set.

Vision: at the wire boundary, walk user messages; for each `LlmImagePart`, append its `base64` to the message's `images` array and strip the part. The existing `resolveImages.ts` helper already pre-resolves bytes — Ollama just consumes them in a different shape than OpenAI/Anthropic/Gemini.

### OllamaStore

Owns:
- `config: { baseUrl: string; apiKey?: string; toolsEnabled: boolean }` — persisted under `gatesai.ollama.v1`
- `state: 'unknown' | 'online' | 'offline'`
- `lastError: string | undefined`
- `catalog: Model[]` (pushed into `ModelRegistry` on refresh)
- `lastRefreshAt: number | null`

Actions: `setBaseUrl`, `setKey`, `setToolsEnabled`, `refresh()`, `start()`, `stop()`. The poll runs only while the OllamaCard is mounted (subscribed via a ref-counting hook), to avoid background traffic when the user isn't looking.

Default base URL: `http://127.0.0.1:11434`.

### OllamaCard

Same visual rhythm as `ProviderCard`:
- ProviderAvatar ("Ollama" → "O")
- Status pill: `● Connected` / `○ Not running` / `○ Unknown`
- Base URL field (mono input, default placeholder shown)
- Optional API key via `SecretKeyField` (the user said they don't need it; default empty)
- Catalog row: "N models · last refreshed …" + Refresh / Clear buttons (mirrors `OpenRouterCatalogRow` pattern; can extract a shared `CatalogStatusRow` later, but YAGNI for v1)
- Small toggle: "Allow tool calls" — flips `toolsEnabled`. When off, `LlmRequest.tools` is dropped before the wire request leaves.
- Hint line below: "Run `ollama pull llama3.1` to add a model. Restart the Ollama service if the status stays offline."

## Error handling

- **Server unreachable:** `OllamaStore.refresh` rejects → set `state: 'offline'`, surface `lastError` under the status pill ("Connection refused"). The catalog stays at its last cached value so the picker still works while the server is restarting.
- **Model not loaded yet:** Ollama returns `{error: "model 'foo' not found, try pulling it first"}`. The provider wraps this into a `done: { error: ..., finishReason: 'error' }` chunk; `ChatStore` surfaces it as the assistant's message body.
- **Tool calls on a model that doesn't support them:** Ollama returns the tool calls as plain text. We can't fully fix this; the `supportsTools: false` allowlist catches the worst offenders. Users can flip the global toggle off.
- **Streaming connection drops mid-turn:** existing `AbortController` path handles this; the partial text already streamed stays in the message.

## Testing

- Unit: `tests/services/llm/ollama.test.ts` with mock fetch — verify request shape, NDJSON parsing, tool-call mapping, image rewriting, error path.
- Unit: `tests/stores/OllamaStore.test.ts` — refresh populates registry, status transitions, persistence round-trip.
- Skip integration tests against a real Ollama (out of scope for the suite; manual smoke covers it).

## Manual smoke (acceptance)

1. `ollama serve` running, `ollama pull llama3.1:8b`.
2. Open Settings → API. Ollama card shows ● Connected with 1 model after refresh.
3. Pick `ollama-llama3.1:8b` from the composer's model picker.
4. Send "what's 2+2" — get a streamed response.
5. Send "list the files in /workspace" — model calls the `fs` tool, result renders.
6. Stop the Ollama service. Status pill flips to ○ Not running within ~30s. Picker still shows the cached model. Sending a turn surfaces a clear error.

## Out of scope

- In-app `ollama pull` / `ollama rm` / model management UI
- GPU / VRAM telemetry
- Per-model parameter tuning (temperature, top_p, repeat_penalty sliders)
- `/api/embeddings`
- Onboarding flow that walks the user through installing Ollama and pulling a recommended model — explicitly deferred until the v1 integration is in hand
- Centering on a single recommended vision model — deferred
- Auto-detecting Ollama under the existing "Local endpoint" provider

## Persistence

| Key                  | Shape                                       | Owner         |
| -------------------- | ------------------------------------------- | ------------- |
| `gatesai.ollama.v1`  | `{ baseUrl, apiKey?, toolsEnabled, catalog: Model[], lastRefreshAt }` | `OllamaStore` |

Catalog is cached so a fresh boot has a populated picker before the first probe completes; refresh overwrites.
