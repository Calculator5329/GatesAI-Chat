# Architecture

GatesAI Chat is a React 19 + TypeScript single-page app organized into a
strict layered architecture with one-way dependencies. The same React app runs
as a Tauri 2 desktop app and as a Web Lite browser build; desktop-only
features are gated through runtime checks, the Tauri command layer, or the
local bridge.

```
UI (components/, app/)
        |
        v
Stores (MobX object models)
        |
        v
Services (persistence, llm/, chat/, tools/, image/, bridge, mcp/, rag/, sourceWorkspace)
        |
        v
Core (types, theme, models, tokens, schedules, providers, runtime)
```

## Folder layout

```
src/
  main.tsx                        # entry: mounts <App> with the root store
  index.css                       # @import manifest only; real CSS lives in styles/
  styles/                         # layered CSS: base / editorial / markdown / menu / responsive
  app/
    App.tsx                       # top-level shell, keyboard shortcuts, command palette mount
  components/
    ui/                           # design-system primitives
    media/                        # shared image UI and workspace/hosted image loader
    editorial/                    # chat surface, activity stream, composer, sidebar
    menu/                         # GatesMenu sections: agent/models/local/workspace/gallery/usage/settings
    palette/                      # command palette and ranking helpers
  stores/
    RootStore.ts                  # composes and wires the store graph
    ChatStore.ts                  # threads/messages, persistence host, TurnRunner host facade
    UiStore.ts                    # draft state, view prefs, palette state, local data usage facade
    ProviderStore.ts              # provider configs + LlmRouter
    RouterStore.ts                # observable URL hash
    ModelRegistry.ts              # curated + dynamic model catalog
    OpenRouterStore.ts            # live OpenRouter model catalog
    OpenRouterCompatibilityStore.ts # compatibility runner/report state
    OpenAiCompatEndpointStore.ts  # user-configured OpenAI-compatible endpoint probe/catalog
    OllamaStore.ts                # Ollama auth, tool setting, catalog, pulls/deletes
    LocalRuntimeStore.ts          # Ollama/ComfyUI process config, probing, auto-detect
    ImageGenStore.ts              # image backend selection and credentials
    ImageJobStore.ts              # queued/active/completed image jobs
    SearchStore.ts                # Brave key and web search facade
    UserProfileStore.ts           # bio, durable facts, base system prompt
    SummaryStore.ts               # lazy cross-thread summaries
    NotesStore.ts                 # durable notes
    SchedulesStore.ts             # recurring automation loop
    McpStore.ts                   # MCP server configs, clients, status, remote tools
    SkillsStore.ts                # workspace skills loaded through the bridge
    BridgeStore.ts                # bridge health, WebSocket client, workspace helpers
    ExecStreamStore.ts            # live terminal tails
    SourceWorkspaceStore.ts       # source-workspace review/build facade
    context.tsx                   # React context + use*Store hooks
  services/
    chat/                         # TurnRunner, StreamingRoundExecutor, context modes, tool batches
    llm/                          # providers, router, SSE/NDJSON helpers, streamCore helpers
    tools/                        # model-callable tool implementations and registry
    bridge/                       # app-side bridge client, attachments, previews, guide installers
    mcp/                          # HTTP and stdio MCP clients/transports/storage
    rag/                          # embeddings, indexer, vector store, RagStore
    image/                        # image backend dispatch, ComfyUI client/progress/workflows
    local/                        # local runtime storage/service/auto-detect
    persistence/                  # chat schema migrations + IndexedDB thread archive
    storage/                      # localStorage slot facades
    sourceWorkspace.ts            # Tauri source workspace commands
    sourceBuild.ts                # Tauri source build commands
    secretStorage.ts              # Tauri keychain/localStorage secret abstraction
  core/
    types.ts                      # domain interfaces
    llm.ts                        # provider-agnostic LLM contract
    models.ts                     # curated Model catalog + DEFAULT_MODEL_ID
    modelCapabilities.ts          # tool/vision capability helpers
    threadSelectors.ts            # spend, usage, thread search selectors
    schedules.ts                  # schedule cadence math
    tokens.ts usage.ts            # token/cost accounting
    runtime.ts                    # desktop vs Web Lite detection

src-tauri/src/
  lib.rs                          # Tauri setup, sidecar launch, command registration
  brave_search.rs fetch_page.rs secrets.rs local_runtime.rs
  mcp_stdio.rs source_workspace.rs source_build.rs http_health.rs

tests/                            # Vitest + jsdom, plus Playwright e2e under tests/e2e/
```

## Layer rules

| Layer | May import from | Notes |
| --- | --- | --- |
| `core/` | nothing else | Pure data, types, selectors, and calculations. No React, MobX, fetch, or Tauri. |
| `services/` | `core/` | Side-effecting adapters and pure service helpers. Stores pass dependencies in. |
| `stores/` | `core/`, `services/` | MobX object models. No React/UI imports. |
| `components/ui/` | `core/` only | Stateless primitives. |
| `components/media/` | `core/`, `stores/`, `components/ui/` | Shared media UI used by more than one feature. |
| `components/<feature>/` | `core/`, `stores/`, `components/ui/`, `components/media/` | `observer()` components; no sibling feature imports. |
| `app/` | everything | Composition root. |
| `tests/` | anything in `src/` | Outside app build inputs. |

`stores/context.tsx` is the explicit React bridge exception: it hosts
`StoreProvider` and the `use*Store()` hooks so feature components never import
`RootStore` directly. `eslint.config.js` enforces the import boundaries and
project rules such as no raw `console` outside `services/diagnostics/logger.ts`,
type-only imports, no raw `fetch()` in stores, no direct `localStorage` in
stores/components, no import cycles, and MobX observable wiring rules.

## Store graph

`src/stores/RootStore.ts` constructs every long-lived store. Construction order
is deliberate: low-level registries/config stores are created first, then chat
and auxiliary stores, then one-way providers are injected into `ChatStore`.

| Store | Purpose | Key modules | Data flow |
| --- | --- | --- | --- |
| `ModelRegistry` | Single catalog of curated and dynamic models. | `src/stores/ModelRegistry.ts`, `src/core/models.ts` | OpenRouter, Ollama, and OpenAI-compatible endpoint stores push dynamic provider catalogs into it; chat/model UI reads from it. |
| `UserProfileStore` | User bio, durable facts, and base system prompt sections. | `src/stores/UserProfileStore.ts`, `src/services/profileStorage.ts` | Tools mutate facts; `TurnRunner` reads composed prompt text through the profile facade. |
| `UiStore` | Drafts, view prefs, palette state, onboarding flags, local data usage facade. | `src/stores/UiStore.ts`, `src/services/uiPrefsStorage.ts`, `src/services/storage/webLiteLocalData.ts` | Components mutate UI state; persistence slots store durable prefs. |
| `RouterStore` | Observable hash route. | `src/stores/RouterStore.ts`, `src/services/router.ts` | `RootStore.bindRouterToChat()` syncs `#/thread/<id>` with `ChatStore.activeThreadId` and keeps menu routes explicit. |
| `LocalRuntimeStore` | Local Ollama/ComfyUI paths, managed process state, base URLs, vision model. | `src/stores/LocalRuntimeStore.ts`, `src/services/local/localRuntimeService.ts` | Tauri commands start/probe runtimes; Ollama/Image stores read base URLs and readiness. |
| `SearchStore` | Brave API key and web-search facade. | `src/stores/SearchStore.ts`, `src/services/searchStorage.ts`, `src/services/search/braveClient.ts` | `web_search` calls through this store; secrets hydrate at boot. |
| `McpStore` | User-configured MCP servers, connection state, dynamic tool inventory. | `src/stores/McpStore.ts`, `src/services/mcp/client.ts`, `src/services/mcp/stdioTransport.ts` | Configs load from `gatesai.mcp.v1`; secrets hydrate; connected tools become registry tools through a dynamic provider. |
| `OllamaStore` | Ollama catalog, API key, tool-call setting, pull/delete state. | `src/stores/OllamaStore.ts`, `src/services/llm/ollamaCatalog.ts`, `src/services/llm/ollamaPull.ts` | Reads `LocalRuntimeStore` base URL/status; writes dynamic Ollama models to the registry. |
| `ProviderStore` | Provider configs and the live `LlmRouter`. | `src/stores/ProviderStore.ts`, `src/services/providerStorage.ts`, `src/services/llm/router.ts` | Config reactions update provider instances; chat resolves each thread model through the router. |
| `OpenRouterStore` | OpenRouter live catalog cache and refresh state. | `src/stores/OpenRouterStore.ts`, `src/services/llm/openrouterCatalog.ts` | Fetches models when a key is available; pushes dynamic OpenRouter models into the registry. |
| `OpenAiCompatEndpointStore` | User-provided OpenAI-compatible endpoint probe and catalog. | `src/stores/OpenAiCompatEndpointStore.ts`, `src/services/llm/openaiCompatCatalog.ts` | Validates base URL, fetches `/models`, marks provider available, registers dynamic models. |
| `ChatStore` | Thread/message state, persistence host, turn lifecycle, agent tasks. | `src/stores/ChatStore.ts`, `src/services/chat/turnRunner.ts` | UI appends user messages; `TurnRunner` writes one assistant message through the `TurnHost` facade. |
| `SummaryStore` | Cross-thread one-line summaries. | `src/stores/SummaryStore.ts` | Runs in the background and provides recent summaries to chat prompts through a one-way provider. |
| `NotesStore` | Durable notes used by the `notes` tool. | `src/stores/NotesStore.ts`, `src/services/notesStorage.ts` | Tool calls mutate/search notes; UI lists them through store state. |
| `SchedulesStore` | Recurring schedule definitions and app-open scheduler loop. | `src/stores/SchedulesStore.ts`, `src/core/schedules.ts` | Every 30s it starts due schedules by calling `ChatStore.spawnTask()`. |
| `RagStore` | Embeddings index, vector recall, semantic context injection. | `src/services/rag/RagStore.ts`, `src/services/rag/indexer.ts`, `src/services/rag/vectorStore.ts` | Indexes chat/notes/facts when Ollama embeddings are available; `TurnRunner` asks it for semantic context and the `recall` tool queries it. |
| `BridgeStore` | Desktop bridge health, WebSocket client, workspace helpers. | `src/stores/BridgeStore.ts`, `src/services/bridge/client.ts`, `src/services/bridge/health.ts` | Polls `/health`, opens `ws://127.0.0.1:7331/ws`, exposes a request facade to tools and workspace services. |
| `SkillsStore` | Workspace skill list and active skill metadata. | `src/stores/SkillsStore.ts`, `src/services/skills/skillsService.ts` | Loads skill files from `/workspace/.gatesai/skills`; selected skill instructions/tool allowlists feed turns. |
| `OpenRouterCompatibilityStore` | Model compatibility run/report state. | `src/stores/OpenRouterCompatibilityStore.ts`, `src/services/compat/openRouterCompatibility.ts` | Uses provider/router/bridge to run probes and write reports under workspace artifacts. |
| `SourceWorkspaceStore` | Desktop source-workspace review and source build facade. | `src/stores/SourceWorkspaceStore.ts`, `src/services/sourceWorkspace.ts`, `src/services/sourceBuild.ts` | UI and tools call Tauri commands through the store; runtime snapshot is injected into prompts. |
| `ExecStreamStore` | Live terminal output tails. | `src/stores/ExecStreamStore.ts` | `terminal` streams bridge event chunks into it; activity rows render the live tail. |
| `ImageGenStore` | Image backend credentials/settings. | `src/stores/ImageGenStore.ts`, `src/services/imageGenStorage.ts` | Converts UI settings into backend config for `image_generate` and `ImageJobStore`. |
| `ImageJobStore` | Image queue, active job, completed history, gallery data. | `src/stores/ImageJobStore.ts`, `src/services/image/imageBackend.ts`, `src/services/image/comfyClient.ts` | `image_generate` enqueues; the runner dispatches to ComfyUI/OpenRouter image APIs and writes final files through the bridge. |

`RootStore` then wires four provider hooks into `ChatStore`:

- `setRecentSummariesProvider()` reads `SummaryStore.recentSummariesExcluding()`.
- `setSemanticContextProvider()` reads `RagStore.semanticContextForUserText()`.
- `setActiveSkillProvider()` maps the thread's `skillId` to a `SkillsStore` record.
- `setToolStoresProvider()` returns notes, schedules, summary, bridge, exec stream, image, local runtime, search, RAG, and source workspace facades for tool execution.

The wiring is intentionally one-way. `ChatStore` does not import those stores;
it only calls provider functions when building a request or executing tools.
That keeps the store graph acyclic and lets tests inject narrow facades.

## Chat turn pipeline

Purpose: turn a user message into one durable assistant message, even when the
model performs many model/tool round trips. Key modules are
`src/stores/ChatStore.ts`, `src/services/chat/turnRunner.ts`,
`src/services/chat/streamingRoundExecutor.ts`,
`src/services/chat/toolBatchExecutor.ts`, `src/services/chat/contextModes.ts`,
`src/services/chat/activityProjection.ts`, `src/services/llm/router.ts`, and
provider adapters under `src/services/llm/`.

Data flow:

1. The UI calls `ChatStore.sendMessage()`. `ChatStore` appends the user message,
   owns the `AbortController`, and calls its private `runTurn()`.
2. `ChatStore` delegates the turn to `TurnRunner` through a `TurnHost` facade.
   The facade is the only way the runner mutates MobX state: append assistant,
   queue text, flush/cancel text, update activity, set errors, and auto-name.
3. `TurnRunner` creates one assistant message, builds the request from context
   mode, recent summaries, semantic context, active skill instructions, runtime
   context, attachments, and selected tools.
4. `LlmRouter.resolve()` maps the thread model to a ready provider and provider
   model id. Providers implement `LlmProvider.stream(req, signal)`.
5. `StreamingRoundExecutor` runs one provider round. It emits connecting,
   streaming, stalled, text, tool calls, finish reason, usage, and typed errors.
6. Provider adapters normalize vendor output into `LlmChunk` events.
   `openaiCompat.ts` and `ollama.ts` share helpers from
   `src/services/llm/streamCore.ts` for tool-call delta accumulation, finish
   reason normalization, JSON argument recovery, finite number checks, and
   UTF-8 line iteration.
7. If a round returns tool calls, `TurnRunner` stores the pre-tool text as a
   work note, appends tool calls, and calls `executeToolBatch()`.
8. `executeToolBatch()` validates every call, executes valid prefix calls before
   the first invalid call, runs adjacent read-only calls in parallel, serializes
   side-effecting calls, and returns structured `ToolResult` records.
9. Tool results are appended to the same assistant message and the loop repeats
   until the model returns final prose, errors, aborts, or reaches the cap.
10. `activityProjection.ts` projects message work notes, stream phase, tool
    calls/results, bridge events, terminal tails, image jobs, and agent-task
   events into `ActivityItem[]` for the `src/components/editorial/activity`
   renderers.

Semantics:

- Retry: `StreamingRoundExecutor` retries transient provider failures
  (`TypeError`, HTTP 429/5xx-like messages, common network reset/refused/timeout
  messages) after 1s and 4s, but only before any provider content was received.
- Stall: initial provider silence is capped at 180s; later idle provider silence
  is capped at 120s. A stall aborts only the provider attempt and returns a
  stalled outcome for `TurnRunner` to format as an error.
- Abort: user stop/thread switch aborts the turn signal. Provider attempts,
  retry delays, and unfinished tool calls observe that signal; unexecuted tool
  calls become cancelled results.
- Caps: normal turns allow 16 tool rounds. Agent tasks default to 6 and clamp
  requested `max_rounds` to 1..10. Repeated writes/appends to the same path are
  stopped after three prior side-effect calls.
- Context pressure: before streaming, large tool results can be compacted when
  the estimated payload approaches the model context window; oversized payloads
  are rejected with a user-visible recovery message.
- Direct image models short-circuit the provider stream and enqueue an image job
  directly through `ImageJobStore`.

## Tools

Purpose: expose model-callable local capabilities with validation, runtime
gating, activity metadata, and deterministic string results. Key modules are
`src/services/tools/registry.ts`, `src/services/tools/types.ts`, individual
tool files under `src/services/tools/`, `src/services/chat/contextModes.ts`,
`src/services/chat/toolBatchExecutor.ts`, and `src/services/mcp/toolIntegration.ts`.

Every tool implements `Tool`: a model-visible `ToolDef`, optional metadata
(`category`, risk, side-effect/read-only predicates, validation, result policy),
optional UI activity metadata, and `execute(args, ctx)`. The model sees only the
string `content`; optional `summary` and `artifacts` are UI side channels.

Availability is gated in layers:

- Web Lite vs desktop: `src/core/runtime.ts` and `contextModes.ts` hide
  desktop-only tools such as source workspace/build and bridge-backed file
  tools when unavailable.
- Bridge state: `BridgeStore.isOnline` and `requireBridge()` gate workspace,
  filesystem, terminal, Python, SQLite, git, inspect, artifact, attachment,
  and image file writes.
- Local/runtime state: image generation appears only when bridge is online and
  either OpenRouter image credentials or ComfyUI readiness exists. `recall`
  appears only when RAG is active. `web_search` appears only with a Brave key.
- Provider/model state: context mode hides tools if the model lacks tool
  support; Ollama defaults to `micro` mode with a smaller tool set.
- Skill allowlists: an active skill can restrict tools; `thread` is always
  allowed so the model can work with the active thread.
- MCP dynamic tools: connected MCP servers contribute `mcp_<server>_<tool>`
  tools through `toolRegistry.registerDynamicProvider()`.

Context modes in `contextModes.ts` select prompt/messages/tools:

- `full`: full message history, normal system prompt, summaries, semantic
  context, skill instructions, and relevance-selected tools.
- `system-tools`: latest user message with normal system/tools.
- `bare`: latest user message only and no tools.
- `micro`: default for Ollama; minimal local system prompt, latest user message,
  a small filesystem schema when relevant, web search/recall when available,
  source tools on desktop, and MCP tools.

Static tool list generated from `src/services/tools/registry.ts` on this
refresh: 24 tools:

`memory`, `recall`, `time`, `logs`, `notes`, `schedules`, `thread`,
`chat_history`, `workspace`, `source_workspace`, `source_build`, `fs`,
`inspect_file`, `artifact`, `terminal`, `python_inline`, `sqlite_query`,
`query_script`, `git`, `image_generate`, `describe_image`, `web_search`,
`fetch_page`, `spawn_task`.

Dynamic MCP tools are additional and are named by
`src/services/mcp/toolIntegration.ts` as `mcp_<server-label>_<remote-tool>`,
truncated to 64 characters with numeric suffixes for collisions.

## Persistence

Purpose: keep chat state local-first, migrate old shapes, avoid browser storage
quota failures, mirror desktop workspaces, and keep secrets out of normal JSON
slots where the desktop keychain is available. Key modules are
`src/services/persistence.ts`, `src/services/persistence/migrations.ts`,
`src/services/persistence/idb.ts`, `src/stores/chatPersistenceCoordinator.ts`,
`src/services/workspaceChatPersistence.ts`, `src/services/chat/libraryExport.ts`,
`src/services/secretStorage.ts`, and per-feature storage files.

Chat persistence flow:

1. `ChatPersistenceCoordinator` installs a MobX `autorun` that deeply touches
   thread/message fields, then throttles writes to 250ms.
2. It schedules a local `gatesai.state.v1` snapshot through
   `services/persistence.ts` and flushes synchronously on `pagehide` /
   `beforeunload`.
3. `persistence.ts` writes a hot localStorage snapshot with
   `schemaVersion: 2`. Raw migrations live in `persistence/migrations.ts`;
   version 1 to 2 normalizes thinking-effort aliases.
4. If there are more than 20 full threads, or the serialized snapshot exceeds
   3,500,000 chars, older threads move to the IndexedDB archive
   `gatesai-chat` / object store `threads`; the localStorage snapshot keeps
   archived stubs.
5. Unreadable snapshots are quarantined under
   `gatesai.state.v1.corrupt-<timestamp>`. Future schema snapshots are backed
   up under `gatesai.state.backup.<timestamp>`.
6. If localStorage rejects a write, emergency compaction shortens large tool
   arguments/results and surfaces a composer notice if even the compacted save
   fails.
7. When desktop bridge workspace persistence is ready,
   `workspaceChatPersistence.ts` writes `/workspace/.gatesai/chat/state.v1.json`
   through a privileged bridge client and also writes a best-effort readable
   `/workspace/chat-history` HTML/Markdown mirror.
8. Multi-tab storage events pause autosave and show reload/dismiss behavior;
   there is no merge.

Secrets:

- `secretStorage.ts` uses Tauri commands `secret_set`, `secret_get`, and
  `secret_delete` on desktop. Web Lite falls back to localStorage-backed
  fields.
- On desktop boot, `RootStore.hydrateSecretsAtBoot()` migrates known secrets
  from localStorage into the keychain and then starts provider/search/MCP/Ollama
  persistence reactions.
- Known secrets are OpenRouter API key, OpenAI-compatible API key, Brave API
  key, Ollama API key, and MCP HTTP header / stdio env values.

Feature storage slots:

| Slot | Owner |
| --- | --- |
| `gatesai.state.v1` | Chat hot snapshot |
| IndexedDB `gatesai-chat` / `threads` | Archived full threads |
| `gatesai.providers.v1` | Provider config and Web Lite provider keys |
| `gatesai.profile.v1` | User profile/facts |
| `gatesai.notes.v1` | Notes |
| `gatesai.schedules.v1` | Schedules |
| `gatesai.uiprefs.v1` | UI preferences |
| `gatesai.openrouter.catalog.v1` | OpenRouter catalog cache |
| `gatesai.ollama.v1` | Ollama config/catalog and Web Lite key fallback |
| `gatesai.local.v1` | Local runtime settings |
| `gatesai.imagegen.v1` | Image backend settings |
| `gatesai.imagejobs.v1` | Image job history plus interrupted recovery state |
| `gatesai.search.v1` | Brave config and Web Lite key fallback |
| `gatesai.mcp.v1` | MCP server configs with secret values redacted |
| `gatesai.rag.settings.v1` | RAG enabled/model/settings |
| `gatesai.rag.watermarks.v1` | RAG indexing watermarks |
| IndexedDB RAG chunk store | Vector chunks from `services/rag/vectorStore.ts` |
| `gatesai.modelPicker.source.v1` | Model picker source filter |
| `gatesai.modelPicker.recent.v1` | Recent model ids |
| `gatesai.modelPicker.favorites.v1` | Favorite model ids |
| `gatesai.userGuide.opened.v1` | First-run guide flag |
| `gatesai.menuHintSeen.v1` | Menu hint flag |
| `gatesai.secrets.migrated.v1` | Desktop secret migration marker |

## Local runtimes and providers

Purpose: let the desktop app use local models/image generation while keeping the
browser build functional. Key modules are `src/stores/LocalRuntimeStore.ts`,
`src/stores/OllamaStore.ts`, `src/services/llm/ollama.ts`,
`src/services/llm/ollamaCatalog.ts`, `src/services/llm/ollamaPull.ts`,
`src/stores/ImageGenStore.ts`, `src/stores/ImageJobStore.ts`,
`src/services/image/imageBackend.ts`, `src/services/image/comfyClient.ts`,
`src/services/image/openrouterImageClient.ts`,
`src/stores/OpenAiCompatEndpointStore.ts`, and
`src/services/llm/openaiCompat.ts`.

Ollama:

- `LocalRuntimeStore` owns install path, managed toggle, base URL, process
  status, logs, auto-detection, and health probes.
- `OllamaStore` owns API key, `toolsEnabled`, `/api/tags` catalog hydration,
  dynamic model registration, model pulls, cancellation, and deletion.
- `OllamaProvider` streams local chat responses and emits local usage with
  `costUsd: 0`. `contextModes.ts` defaults Ollama threads to `micro` mode.

ComfyUI image jobs:

- `ImageGenStore` chooses `openrouter-image` or `local-comfy`, stores backend
  credentials/settings, and exposes backend config.
- `image_generate` enqueues an `ImageJob`; the tool returns immediately with an
  `image-job` artifact.
- `ImageJobStore` drains one job at a time, opens ComfyUI progress WebSocket
  when possible, dispatches renders, writes final bytes to
  `/workspace/artifacts/images/local/` or `/workspace/artifacts/images/api/`,
  persists terminal history, and posts completion back to chat.

RAG:

- `RagStore` reads chat threads, notes, and profile facts from RootStore
  providers. It requires Ollama availability and a configured embeddings model.
- `indexer.ts` tracks source watermarks in localStorage; `vectorStore.ts`
  persists chunks in IndexedDB.
- `TurnRunner` injects semantic context for full-context turns, and the
  `recall` tool exposes explicit vector recall.

OpenAI-compatible endpoint:

- `OpenAiCompatEndpointStore` lets the user provide a `/v1`-style base URL,
  optional key, and label. HTTP remote endpoints are blocked unless local;
  remote endpoints must use HTTPS.
- A successful `/models` probe marks the provider available and registers
  dynamic `openai-compat` models. `LlmRouter` routes those models through
  `OpenAiCompatProvider`.

Cloud providers:

- OpenRouter uses `OpenRouterProvider`, the OpenAI-compatible streaming adapter,
  catalog fetch/cache, usage inclusion, and optional OpenRouter image backend.
- `LocalImageProvider` is synthetic so local image models fit the catalog, but
  `TurnRunner` short-circuits before streaming.

## MCP

Purpose: let users attach external tool servers while keeping remote tools
namespaced and user-configured. Key modules are `src/stores/McpStore.ts`,
`src/services/mcp/client.ts`, `src/services/mcp/stdioTransport.ts`,
`src/services/mcp/mcpStorage.ts`, `src/services/mcp/toolIntegration.ts`, and
`src-tauri/src/mcp_stdio.rs`.

Data flow:

1. MCP server configs load from `gatesai.mcp.v1`; header/env secret values are
   redacted in the slot and hydrated from `secretStorage`.
2. HTTP servers use JSON-RPC over POST with `Accept: application/json,
   text/event-stream`, `Mcp-Session-Id` tracking, and protocol version
   `2025-03-26`.
3. Stdio servers are desktop-only. `McpStdioTransport` starts a user-configured
   command through Tauri commands, listens to `mcp-stdio-message`,
   `mcp-stdio-stderr`, and `mcp-stdio-exit`, and writes JSON-RPC lines back
   through `mcp_stdio_send`.
4. The client initializes, sends `notifications/initialized`, lists tools
   (paging through cursors), and calls `tools/call`.
5. Connected tools are exposed to the model as `mcp_<server>_<tool>` and routed
   back to `McpStore.callTool()`.

Security model:

- MCP servers are configured by the user in the app. The app does not discover
  arbitrary local commands.
- Stdio config validation rejects empty commands, NUL bytes, invalid env names,
  and `cmd /c` / `cmd /k`.
- HTTP header values and stdio env values are stored as secrets when possible.
- MCP tool results are truncated at 32,000 chars before entering the model
  transcript.

## Agent tasks and schedules

Purpose: run scoped non-interactive work in separate agent threads, either
immediately, after a delay, or on a recurring schedule. Key modules are
`src/services/tools/spawnTask.ts`, `src/services/chat/agentTasks.ts`,
`src/stores/ChatStore.ts`, `src/stores/SchedulesStore.ts`, and
`src/core/schedules.ts`.

`spawn_task` v2 semantics:

- Creates a separate thread with `agentTask: true`, title `Agent: <title>`,
  the task instructions as its first user message, and a link back to the
  origin thread.
- Agent tasks cannot spawn nested tasks.
- Up to 3 agent-task slots can run concurrently. A task with
  `start_delay_minutes` is created immediately with `agentTaskStatus:
  "scheduled"` and does not consume a running slot until it starts.
- `max_rounds` clamps to 1..10 and defaults to 6. `system_prompt` replaces the
  default task body but keeps the non-interactive background-task prefix and is
  capped at 4,000 chars.
- If all slots are full when a scheduled task is due, it retries every 60s.
- On completion/error/interruption, `ChatStore.finalizeAgentTask()` appends an
  `agent-task` activity event to the origin thread with a summary and link.
- On boot, scheduled tasks are re-armed and previously running tasks are marked
  interrupted.

`SchedulesStore` owns recurring schedules:

- Schedules persist in `gatesai.schedules.v1`.
- The app-open scheduler ticks every 30s, calculates due runs with
  `core/schedules.ts`, and starts due work through `ChatStore.spawnTask()`.
- `catchUp` controls whether missed runs fire immediately on boot or skip to
  the next future run.
- Manual `runNow()` uses the same spawn path and task slot checks.

## Source workspace and self-improvement loop

Purpose: give the desktop app a controlled source snapshot, review UI, and
build/test/package runner without exposing arbitrary app source paths in Web
Lite. Key modules are `src/stores/SourceWorkspaceStore.ts`,
`src/services/sourceWorkspace.ts`, `src/services/sourceBuild.ts`,
`src/services/tools/sourceWorkspace.ts`, `src/services/tools/sourceBuild.ts`,
`src/components/menu/sections/Workspace.tsx`,
`src-tauri/src/source_workspace.rs`, and `src-tauri/src/source_build.rs`.

Data flow:

1. `scripts/create-source-snapshot.mjs` prepares bundled source data for builds.
2. Desktop Tauri commands report whether a source workspace is available,
   prepared, stale, and where the workspace/source roots are.
3. The Workspace menu can prepare/open the source workspace, list changed files,
   show diffs through `services/diff/lineDiff.ts`, revert files, and run build
   commands (`install`, `test`, `build`, `package`).
4. Model tools `source_workspace` and `source_build` call the same Tauri-backed
   services, so assistant-driven source edits and the human review UI share one
   command surface.
5. `SourceWorkspaceStore.runtimeSnapshot` is injected into prompt runtime
   context so the model can see prepared/change/build status without reading UI
   state.

## Rust layer

Purpose: provide desktop-only OS integration while the React app stays portable.
Commands are registered in `src-tauri/src/lib.rs` and implemented by module.
The bridge sidecar is launched from `lib.rs` when `gatesai-bridge` is available
and no existing bridge answers `http://127.0.0.1:7331/health`.

Generated from the `tauri::generate_handler!` registration in
`src-tauri/src/lib.rs`:

| Module | Commands |
| --- | --- |
| `lib.rs` | `open_path` |
| `brave_search.rs` | `brave_llm_context` |
| `fetch_page.rs` | `fetch_page` |
| `secrets.rs` | `secret_set`, `secret_get`, `secret_delete` |
| `local_runtime.rs` | `spawn_runtime`, `stop_runtime`, `runtime_status`, `probe_http`, `ollama_tags`, `path_exists`, `pick_directory`, `pick_file`, `runtime_candidate_paths` |
| `mcp_stdio.rs` | `mcp_stdio_start`, `mcp_stdio_send`, `mcp_stdio_stop`, `mcp_stdio_status` |
| `source_workspace.rs` | `source_workspace_status`, `source_workspace_prepare`, `source_workspace_open`, `source_workspace_list`, `source_workspace_read`, `source_workspace_write`, `source_workspace_stat`, `source_workspace_search`, `source_changed_files`, `source_revert_file` |
| `source_build.rs` | `source_build_status`, `source_build_start`, `source_build_clear` |

Other Rust modules:

- `http_health.rs` contains the lightweight health probe helper used before
  spawning the bridge sidecar.
- `main.rs` delegates to `lib::run()`.

## Bridge and workspace

Purpose: desktop workspace, shell, artifact, attachment, and app persistence
operations are mediated by a local Go bridge sidecar reached by the app over
WebSocket. The app-side protocol is documented separately in
`docs/bridge-protocol.md`.

App flow:

- `BridgeStore` polls bridge health every 5s, opens one WebSocket client, and
  exposes version, platform, workspace root, and exec allowlist.
- Tools use `requireBridge()` and fail gracefully when offline. Web Lite keeps
  bridge-only surfaces disabled or informational.
- Model-facing workspace paths use `/workspace/...`; the bridge maps them to
  the actual local workspace root.
- App tools block generic access to `.gatesai/chat/` and `chat-history/` via
  `src/services/tools/protectedWorkspacePaths.ts`; the `chat_history` tool is
  the bounded model-facing read path.
- Workspace persistence uses a privileged bridge request wrapper in
  `workspaceChatPersistence.ts`; model-originated tool calls never set the
  privileged flag.

## Activity, command palette, and usage

Activity timeline:

- `activityProjection.ts` is the canonical projection layer.
- `ActivityStream` and `ActivityRow` render work notes, stream phases, tool
  statuses, terminal tails, image job cards, bridge events, and agent-task
  events from one `ActivityItem[]` contract.

Command palette:

- `App.tsx` mounts `components/palette/CommandPalette.tsx` when
  `UiStore.paletteOpen` is true.
- Palette rows include app actions/menu targets and thread search results.
  Ranking is pure and tested in `components/palette/ranking.ts`.

Usage tracking:

- Providers emit `LlmUsage` chunks; `TurnRunner` normalizes them with
  `core/usage.ts` and stores them on assistant messages.
- `core/threadSelectors.ts` derives all-time, 30-day, cloud/local, by-model,
  and by-day usage. No separate usage counter is persisted outside messages.
- Image jobs track `costUsd` when image backends return it and expose per-thread
  image spend from `ImageJobStore`.

## Routing

Tiny hash router (`#/thread/<id>` and `#/menu/<section>`) lives in
`src/services/router.ts`. Current menu sections are `agent`, `models`, `local`,
`workspace`, `gallery`, `settings`, and `usage`; retired hashes redirect to the
nearest current section. `RootStore.bindRouterToChat()` binds thread routes and
the active thread in both directions while leaving menu routes explicit.

## Logging and diagnostics

All runtime diagnostics flow through `src/services/diagnostics/logger.ts`, the
only sanctioned console boundary. The logger keeps a 500-entry ring buffer for
the `logs` tool, writes level-filtered console output, and appends JSONL files
under `/workspace/logs/app-<date>.log` when the bridge is online. Per-thread
forensic events go through `src/services/diagnostics/chatLog.ts` and are enabled
by `gatesai.debug.chatLog`.

Common scopes include `chat`, `persistence`, `security`, `bridge`,
`image-jobs`, `summary`, `models`, `llm`, `local-runtime`, `attachments`,
`search`, `tools`, `mcp`, `rag`, and `skills`.

## Testing

Purpose: keep the architecture verifiable at unit, component, integration,
desktop/Web Lite e2e, and Rust command layers.

Local commands:

```
npm test              # Vitest suite
npm run typecheck     # app + test TypeScript
npm run lint          # ESLint import/layer/rule guardrails
npm run test:e2e      # Playwright desktop-mocked + Web Lite projects
npm run screens:tour  # scripted screenshot/tour capture
```

Test layers:

- Unit/service/store tests live under `tests/core`, `tests/services`, and
  `tests/stores`. They cover turn runner/executor behavior, persistence
  migrations and archive tier, tools, MCP, RAG, local runtimes, image jobs,
  provider adapters, source workspace, schedules, usage, and secret storage.
- Component tests under `tests/components` cover the editorial surface, menu
  sections, source review UI, image job cards, command palette, and ranking.
- E2E tests under `tests/e2e` run mocked desktop and Web Lite flows, including
  bridge behavior, multi-tab persistence, screens tour, and degraded Web Lite
  surfaces.
- Live integration tests under `tests/integration` and `npm run test:models`
  are separate from default CI.
- Rust tests run with `cargo test --manifest-path src-tauri/Cargo.toml`.

Guard-rail suites worth knowing:

- `tests/services/tools/protectedWorkspacePaths.test.ts` and related tool
  tests protect app-managed chat history paths.
- `tests/services/chat/streamingRoundExecutor.test.ts` and
  `tests/services/chat/turnRunner.test.ts` cover retry/stall/tool-loop turn
  semantics.
- `tests/services/persistence.test.ts` covers schema migration, corruption
  quarantine, compaction, and archive behavior.
- `tests/services/mcp/client.test.ts`, `tests/services/mcp/stdioTransport.test.ts`,
  `tests/services/mcp/toolIntegration.test.ts`, and
  `tests/stores/McpStore.test.ts` cover MCP
  protocol, storage, stdio transport, and namespacing.
- `tests/e2e/web-lite.spec.ts` verifies bridge-only features degrade in the
  browser build.

## CI

`.github/workflows/ci.yml` runs on pushes to `master`, pull requests, and manual
dispatch:

- `rust-test` on Windows: `cargo test --manifest-path src-tauri/Cargo.toml`.
- `test` on Ubuntu with Node 22: `npm test`, `npm run typecheck`, and
  `npm run lint`.
- `e2e` on Ubuntu: installs Chromium and runs `npm run test:e2e`, uploading the
  Playwright report on failure.

Additional workflows build Linux artifacts, deploy Web Lite, and package
releases, but the CI workflow above is the main correctness gate.
