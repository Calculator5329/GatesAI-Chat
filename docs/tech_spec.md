# Tech spec

## Stack
- **React 19** + **TypeScript 5**
- **Vite 7** (dev server, build)
- **MobX 6** + **mobx-react-lite** (state)
- **react-markdown** + **remark-gfm** + **rehype-highlight** (rendering)
- **Vitest 3** + **jsdom** (tests)
- **ESLint 9** + **typescript-eslint** (lint)

## Domain model

```ts
type Role = 'user' | 'assistant';

// Discriminated union by `role`. One row per round trip: user message OR
// one assistant message that may carry text, tool calls, AND the results
// of those calls — all on the same object. Tool results are NOT separate
// messages; nobody "said" them. The wire format still uses `role: 'tool'`
// rows; that translation lives in `services/llm/wireFormat.ts`.
type Message =
  | { id: string; role: 'user';      content: string; createdAt: number }
  | {
      id: string; role: 'assistant'; content: string; createdAt: number;
      model?: string;
      preTokenLabel?: 'thinking' | 'responding' | 'compacting' | 'generating';
      toolCalls?: ToolCall[];
      toolResults?: ToolResult[];     // paired to toolCalls by toolCallId
      activityEvents?: ActivityItem[]; // bridge/non-tool transition rows
    };

interface ToolCall {
  id: string;                                  // provider-supplied; echoed back on the result
  name: string;                                // matches a registered tool
  arguments: Record<string, unknown>;          // already-parsed JSON
}

interface ToolResult {
  toolCallId: string;   // matches the corresponding ToolCall.id
  toolName: string;     // denormalized so the renderer doesn't need a join
  content: string;      // what the tool returned (and the model sees next round)
  summary?: string;     // concise UI one-liner; never parsed from content
  ranAt: number;
  artifacts?: ToolResultArtifact[];   // UI-only side channel (image thumbnails, ...)
}

type ToolResultArtifact =
  | {
      kind: 'image';
      path: string;     // workspace path the UI can render
      mime: string;
    }
  | {
      kind: 'image-job';
      jobId: string;    // reference into ImageJobStore
      count: number;    // expected number of images this job produces
    };

type ActivityItem = {
  id: string;
  kind: 'thinking' | 'tool' | 'image-job' | 'exec-tail' | 'bridge';
  state: 'running' | 'done' | 'failed' | 'cancelled';
  verb: string;
  target?: string;
  summary?: string;
  detail?: { type: 'markdown' | 'terminal'; content?: string; lines?: { stream: 'stdout' | 'stderr'; text: string }[] };
  artifacts?: ToolResultArtifact[];
  startedAt: number;
  finishedAt?: number;
  toolCallId?: string;
};

interface Thread {
  id: string;
  title: string;
  subtitle: string;
  modelId: string;             // references core/models.ts
  messages: Message[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  threadContext?: string;      // appended to system prompt under "About this conversation:"
  summary?: string;            // 1-sentence digest written by SummaryStore
  summaryUpdatedAt?: number;   // last write time (ms)
  summaryMessageCount?: number;// messages.length at last write — staleness lever
}

interface ChatSnapshot {
  threads: Thread[];
  activeThreadId: string | null;
}

interface Model {
  id: string;                 // user-facing id (curated or `or-live-<slug>`)
  name: string;
  vendor: string;
  providerId: ProviderId;     // which adapter handles requests
  providerModelId: string;    // what the provider's API actually expects
  description?: string;
  contextLength?: number;
  pricing?: { prompt?: number; completion?: number }; // USD per 1M tokens
  dynamic?: boolean;          // true for runtime-fetched entries
}
```

## LLM contract

```ts
type ProviderId =
  | 'openrouter' | 'ollama' | 'local-image';

interface LlmRequest {
  modelId: string;            // provider-native id
  messages: LlmMessage[];     // user / assistant / system / tool
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  tools?: ToolDef[];          // omit or [] to disable tool calling
}

interface LlmMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];     // assistant only — set when the model called tools
  toolCallId?: string;        // tool only — matches the assistant's call id
  toolName?: string;          // tool only — some providers (Gemini, OpenAI) want this on results
}

interface ToolDef {
  name: string;
  description: string;
  parameters: JsonSchema;
}

type LlmChunk =
  | { type: 'text';      delta: string }
  | { type: 'tool_call'; call: ToolCall }   // fully-buffered call (name + parsed args)
  | { type: 'done';      finishReason?: 'stop' | 'length' | 'tool_use' | 'cancelled' | 'error'; error?: string };

interface LlmProvider {
  readonly id: ProviderId;
  ready(): boolean;
  stream(req: LlmRequest, signal: AbortSignal): AsyncIterable<LlmChunk>;
}
```

## Routing

```
#/                 → default (active thread)
#/thread/<id>      → select thread
#/menu/<section>   → open menu surface; section ∈
                     agent|models|local|workspace|gallery|settings
```

## Storage

| Key                              | Shape                     | Owner              |
| -------------------------------- | ------------------------- | ------------------ |
| `gatesai.state.v1`               | `ChatSnapshot`            | `ChatStore`        |
| `gatesai.providers.v1`           | `ProviderConfigs`         | `ProviderStore`    |
| `gatesai.profile.v1`             | `UserProfileSnapshot`     | `UserProfileStore` |
| `gatesai.notes.v1`               | `Note[]`                  | `NotesStore`       |
| `gatesai.uiprefs.v1`             | output style preferences  | `UiStore`          |
| `gatesai.openrouter.catalog.v1`  | OpenRouter catalog cache  | `OpenRouterStore`  |
| `gatesai.ollama.v1`              | Ollama config + catalog   | `OllamaStore`      |
| `gatesai.local.v1`               | runtime paths + toggles   | `LocalRuntimeStore`|
| `gatesai.imagejobs.v1`           | completed-job history     | `ImageJobStore`    |
| `gatesai.search.v1`              | Brave Search key          | `SearchStore`      |

Chat, provider, profile, notes, and UI preference snapshots are saved by their
owning stores through the `PersistenceProvider<T>` boundary in
`services/storage/persistenceProvider.ts`. The shipped providers are
localStorage-backed JSON slots, but the storage dependency is injectable so a
future Firestore or IndexedDB implementation can preserve the existing store
surface. Provider keys are deliberately stored under a separate key so
chat exports never include credentials. In the foundation build,
`gatesai.providers.v1` persists only the OpenRouter key; older direct-provider
entries are ignored on load, while older OpenRouter key field names normalize
back to `openrouter.apiKey`. The OpenRouter catalog cache is written
only when refreshed or cleared. The Ollama snapshot bundles auth (optional
bearer key), the `toolsEnabled` toggle, and the cached `/api/tags` catalog so a
fresh boot has a populated picker before the first probe. `gatesai.imagegen.v1`
carries only ComfyUI quality/upscale settings and the workflow override path.
Older cloud/A1111/prompt-enhancement image settings migrate back to ComfyUI.
`gatesai.local.v1` is the single source of truth for local
runtime install paths, managed-process toggles, the Ollama and ComfyUI base
URLs, and the selected local vision model. On first boot with no
`gatesai.local.v1`, auto-detect populates default ports and paths; legacy URL
fields on the Ollama / image-gen keys are no longer read.

If a full chat snapshot exceeds the browser's `localStorage` quota, the
chat persistence service retries once with an emergency-compacted snapshot.
The fallback preserves the conversation structure, assistant prose, tool
calls, and tool result metadata, but compacts oversized tool result bodies
and large payload arguments such as `fs.write` content to marked head/tail
previews. This prevents a large file/tool result from rolling the whole
conversation back to the previous successful save.

When the bridge is online in desktop mode, `ChatStore` also mirrors the cleaned
chat snapshot into `/workspace/.gatesai/chat/state.v1.json` and writes a
readable `/workspace/chat-history` library as HTML and Markdown. The JSON state
scope is app-managed: `fs` and `inspect_file` block direct access to it, while
the `chat_history` tool exposes bounded `recent`, `search`, and `read_thread`
operations for model recall.

## Theming

`App` uses the fixed foundation theme (`charcoal` + `emerald`) from
`core/theme.ts`. `themeToCssVars(theme)` emits a plain style object of
`--bg`, `--accent`, etc. that `App` spreads onto the root container.
`UiStore` owns the composer draft plus persisted reading preferences for tool
calls, markdown, and code output.

`gatesai.uiprefs.v1` is normalized to the fixed foundation presentation:
markdown uses `compact`, code blocks use `obsidian`, compact density
remains active, and animations stay enabled. Tool calls no longer have a
selectable presentation setting; all assistant work renders through the
unified ambient activity timeline.
`App` maps those keys to root classes while `.md-body` consumes the resulting
CSS variables for prose, lists, headings, inline code, and fenced code blocks.

## Streaming contract

`ChatStore.sendMessage(text)`:
1. appends a user message
2. opens one `AbortController` for the whole turn
3. appends ONE assistant message that will represent the entire turn
4. drives `runTurn(threadId, signal)` — a tool-execution loop bounded by
   `MAX_TOOL_ROUNDS` (currently 16). Each round:
   - resolves `provider, providerModelId` and calls `provider.stream(req,
     signal)` with `flattenForWire(thread.messages)` for the messages
   - composes a fresh runtime section with local time, timezone, ISO
     timestamp, bridge state, model-facing workspace paths, and terminal cwd
     semantics
   - estimates the complete provider payload (system prompt, expanded wire
     messages, tool schemas, and reserved completion budget) against the
     selected model's context window
   - when the payload is near/over budget, automatically compacts old large
     tool results with the cheapest configured small model, falling back to
     deterministic path/size summaries if no compactor is available
   - text chunks append to `content`; `tool_call` chunks are collected
   - on `done`: if no tool calls → that prose is the final reply, exit.
     Otherwise: discard the round's prose (it was a "let me check"
     preamble), append the calls to the running `toolCalls`, execute
     read-only calls concurrently where safe, push results back in the
     model's original call order, then loop.
5. clears `streamingMessageId` (and the controller) when the turn ends

When the selected model has provider `'local-image'`, `ChatStore.runTurn`
does not call an LLM provider. It uses only the latest user-authored text body
as an image prompt, strips attachment footer metadata, ignores prior messages
and system context, enqueues one image job through `ImageJobStore`, and attaches
the same `image-job` artifact shape that the `image_generate` tool uses. This
keeps direct ComfyUI generation available offline and reuses the existing chat
image card renderer.

The same `AssistantMessage` is mutated across all rounds — one stored
row per user turn, regardless of how many round trips happened. This
keeps the renderer trivial (one speaker boundary per turn, no
continuation logic) and the data model honest (a turn is a turn).

`flattenForWire(messages)` (`services/llm/wireFormat.ts`) is the single
boundary between storage shape (one assistant per turn, with
`toolCalls` / `toolResults` arrays) and the wire shape providers want
(separate assistant-with-calls + tool rows + assistant-with-text per
round). Every provider request goes through it; nothing else translates
between the two.

`stopStreaming()` aborts the controller and annotates the partial assistant
message (`*[interrupted]*`, or `*[no response]*` if zero tokens). `selectThread`
no longer aborts — streams survive thread switches and continue writing into
their original thread.

Runtime context is regenerated for every provider request and sits directly
under the bridge harness in the system prompt. It carries the user's local time
and timezone, an ISO timestamp, bridge online/offline status, bridge platform
and version when known, and the key path contract: `/workspace/...` is
model-facing for tools while terminal commands run from the bridge workspace
root. Because this section includes fresh time, the `time` tool is retained for
compatibility but is no longer selected for ordinary turns.

## Tools

Every tool registers itself with `toolRegistry` at module-load time. Each
tool also carries internal metadata for category, read-only/side-effect
classification, result policy, and safe concurrency decisions. The registry
selects a conservative `ToolDef[]` per provider round via
`toolDefsForTurn(...)`: `memory` and `thread` are always available;
bridge tools (`workspace`, `fs`, `inspect_file`, `terminal`, `python_inline`,
`sqlite_query`, `query_script`, `git`) are included when the bridge is online
or the turn mentions files, attachments, code, commands, Git, tests/builds,
artifacts, CSV/JSON/text data, or workspace; `notes` is included
for note/document/search/plan language. If the selector cannot make a useful
choice, it falls back to the full catalog. Provider adapters translate to/from each
vendor's native tool-call shape (OpenAI `tool_calls[]`, Anthropic
`tool_use`/`tool_result`, Gemini `functionCall`/`functionResponse`).
OpenRouter normally uses the OpenAI-compatible shape, but Anthropic-routed
OpenRouter model ids (`anthropic/...`) rewrite tool result messages as user
continuations before the request is sent. That keeps Claude's upstream
"conversation must end with a user message" invariant intact while leaving
the stored chat model unchanged.

Adding a tool: drop `services/tools/<name>.ts` exporting a `Tool`, then add
one `toolRegistry.register()` line in `services/tools/registry.ts`. No UI
wiring required.

Tools may return either a plain `string` (the common case — the string
becomes the tool result the model sees next round), a structured
`ToolOutcome`, or `{ content: string; summary?: string; artifacts?: ToolResultArtifact[] }`.
The `content` remains the model-facing payload; `summary` is the
UI-facing activity line; `artifacts` is a UI-only side channel the chat
renderer reads to show rich outputs. Concretely, `image_generate`
enqueues work into `ImageJobStore`. For a single prompt it returns immediately
with `{ content: 'Queued … (job <id>).', artifacts: [{ kind:'image-job', jobId, count }] }`.
The unified activity renderer mounts an `ImageJobCard` bound to that
`jobId` inside the activity expansion, observes the store for live
progress, and swaps to the rendered images (and the optional Lightbox
click-through) once the runner persists results to `/workspace/artifacts/`.

For overnight batches, `image_generate` also accepts `prompt_file`, a
`/workspace` JSON file shaped as `{ defaults?: {...}, prompts: [...] }`. Each
prompt entry fans out into its own queued image job, inheriting `count`,
`aspect_ratio`, `width`/`height`, `seed`, and `filename` from `defaults` unless
overridden per entry. The tool caps a single batch call at 500 prompts, returns
a compact summary such as `Queued 120 jobs / 1200 image renders`, and does not
attach hundreds of chat artifacts.

`ToolContext` carries narrow facades tools may reach into: `profile`, `chat`,
optional `notes`, optional `summary`, optional `bridge`, optional `execStream`,
and the calling `threadId`. The facade interfaces live in
`services/tools/types.ts` so tools stay in the service layer without importing
MobX store classes. Auxiliary facades are injected lazily via
`ChatStore.setToolStoresProvider(...)` so unit tests that exercise tools needing
only `profile` / `chat` don't have to stand up the full graph.

Tool results are budgeted before reaching the next model round. Large
`terminal`/`git` outputs are represented with command metadata, truncation
flags, and head/tail slices; `fs.read` accepts `max_chars` and returns an
explicit continuation hint when the file content is larger than the model
result budget. Token usage estimates use the flattened wire messages plus
serialized tool calls/results and the selected tool schemas, so tool-heavy
threads do not undercount context as aggressively.

Per-model `Model.supportsTools` flag is honored at request build time:
when the active thread's model has `supportsTools: false` (set by the
Ollama catalog mapper for known-bad tool families like `gemma*`,
`phi*`, `codellama`), `ChatStore.buildTurnRequest` omits the `tools`
field entirely so the model isn't asked to call tools it can't reliably
emit. The `OllamaProvider` independently honors a global `toolsEnabled`
toggle that suppresses tool calls across all Ollama models — both gates
must allow tools for them to reach the wire.

Tool failures are logged from the central `ChatStore.executeOneToolCall`
boundary whenever a tool result starts with `Error:` or a `terminal` / `git`
result reports a non-zero `[exit N]`. The warning payload includes tool name,
call id, thread id, failure reason, result preview, redacted argument preview,
read-only classification, bridge-online state, duration, and timestamp. This
keeps failed tool usage visible for harness iteration without changing the
model-facing tool result contract.

Current tool catalog:
- `memory({ action, fact?, index?, next? })` — unified memory tool with four
  verbs: `add` / `remove` / `update` / `list`. Operates on
  `UserProfileStore.facts` (parsed from `bio`). `remove` and `update`
  accept either an `index` (from a prior `list`) or a substring `fact` to
  match. Mirrors OpenAI's `bio` tool — one tool, many actions, keeps the
  catalog small.
- `notes({ action, id?, title?, body?, tags?, query?, limit? })` — six
  verbs: `create` / `read` / `update` / `delete` / `search` / `list`.
  Backed by `NotesStore` and the `gatesai.notes.v1` localStorage key.
  Notes are searched on demand and never auto-injected into the system
  prompt — they're the long-form companion to `memory`'s atomic facts.
- `thread({ action, id?, title?, context?, limit? })` — six verbs:
  `rename` / `set_context` / `get_context` / `summarize_now` /
  `switch_to` / `list`. Lets the model manage the conversation it lives
  inside; most actions default to the calling thread when `id` is
  omitted. `set_context` is the only end-to-end path for writing
  `Thread.threadContext`, which is then injected into every subsequent
  system prompt under "About this conversation".
- `chat_history({ action, id?, query?, limit?, offset? })` — read-only access to
  bounded slices of persisted conversations. It lists recent visible threads,
  searches titles/messages/tool metadata/workspace paths, and reads transcript
  slices without exposing app-managed JSON files through `fs`.
- `web_search({ queries, freshness?, country?, search_lang? })` — live web
  grounding through Brave LLM Context. `SearchStore` owns the locally persisted
  Brave key and a short in-memory query cache; desktop builds call the Tauri
  `brave_llm_context` command to avoid browser CORS.
- `artifact({ action, path, content? })` — validates or creates finished HTML
  artifacts under `/workspace/artifacts/...`, checking file existence, basic
  HTML shape, inline script syntax, and local asset references.
- `time({})` — no arguments. Returns ISO + human-readable + timezone +
  unix_ms. Used whenever the model needs the current date/time.
- `workspace({ action })` — bridge runtime facade. `info` returns platform,
  workspace root, allowlist, and path semantics; `limits` returns known caps;
  `how_to_run_scripts` gives the artifact-first query script recipe: check
  artifacts first, inspect sources with `inspect_file`, write scripts under
  `/workspace/notes/query_scripts/`, and write reusable outputs under
  `/workspace/artifacts/`.
- `fs({ action, path?, content?, encoding?, ... })` — workspace
  filesystem ops via the bridge. Verbs: `read | write | append | list |
  delete | move | copy | mkdir | stat | search`. All paths resolve
  inside `~/GatesAI/workspace/`; the bridge enforces a path jail.
  Returns "Error: bridge offline. Start gatesai-bridge." when the
  companion process isn't running. `list` and `search` defensively normalize
  legacy bridge `null` arrays to empty arrays so stale bridge processes cannot
  leak JavaScript formatter errors into tool results.
- `inspect_file({ action, path?, format?, ... })` — read-only semantic
  inspection for CSV, JSON, and text files. Verbs: `workspace_profile |
  profile | preview | search | extract | aggregate`. `workspace_profile`
  uses bridge `fs.list` and optional `fs.search` to return an artifact-first
  view of `/workspace/artifacts`, `/workspace/attachments`, and
  `/workspace/notes`. File actions use bridge `fs.read` internally, decode
  UTF-8/BOM, UTF-16LE/BE, and Windows-1252/Latin-1 style base64 reads, then
  return compact structure, selected rows/paths/line ranges, and CSV
  aggregates instead of dumping full file contents into model context.
  CSV profiles include detected delimiter, detected encoding, row/column
  counts, likely date columns, numeric min/max/sample, and empty/ragged row
  counts. Attachment footers reinforce the same rule: use `inspect_file` for
  CSV/JSON/text and `fs` only for byte-level reads/writes.
- `python_inline({ code, stdin?, timeout_ms? })` — scoped short Python
  snippets through `exec.run` with `cmd: "python"` and argv
  `["-c", code]`. It intentionally does not use PowerShell, cmd.exe, pipes,
  redirects, or shell expansion. Longer reusable work should still be written
  as scripts under `/workspace/notes/query_scripts/`.
- `sqlite_query({ path, sql, params?, max_rows?, timeout_ms? })` — scoped
  read-only SQLite queries over workspace-relative `.sqlite`, `.sqlite3`, or
  `.db` files. It rejects dot-commands, multiple statements, absolute paths,
  and path traversal, then executes through Python's stdlib `sqlite3` helper
  rather than the raw `sqlite3` shell.
- `query_script({ action, topic? })` — model-facing templates for organized
  data scripts. Actions: `template_python_csv_query`, `template_json_query`,
  and `template_artifact_audit`. Templates keep scripts under
  `/workspace/notes/query_scripts/<topic>.py`, final reusable JSON under
  `/workspace/artifacts/<topic>.json`, use cwd-relative paths, and include
  validation checkpoints before reporting results.
- `git({ action, paths?, message?, branch?, ref?, staged?, cwd?, limit?,
  confirm? })` — local-only Git porcelain through the bridge. Read actions:
  `status | diff | log | show | branch_list`; safe local writes:
  `add | commit | branch_create | branch_switch`; guarded restore actions:
  `restore | restore_staged` require `confirm: "restore local changes"`.
  The tool deliberately exposes no push, pull, fetch, remote, reset, rebase,
  merge, or force operations.
- `describe_image({ path, question? })` — reads an image from the workspace
  through `BridgeStore.readAttachmentBase64` and sends it to the selected
  Ollama vision model from `LocalRuntimeStore`. This lets non-vision chat
  models delegate screenshot/artifact inspection to a local vision model.
- `terminal({ cmd, args?, cwd?, stdin?, timeout_ms? })` — runs an
  allowlisted shell command via the bridge. Allowlist lives in
  `~/.gatesai/bridge.json`; defaults are read-mostly + safe writes
  (`ls, cat, grep, mkdir, mv, rm, …`). Streams stdout/stderr lines
  into `ExecStreamStore` for the live UI tail; the model's tool result
  contains a compact captured output summary + exit code.

## Companion bridge (`gatesai-bridge`)

A separate Go process at `../gatesai-bridge/`. Owns the workspace folder
and exposes filesystem + shell ops over a single WebSocket. Loopback-only
binding (`127.0.0.1:7331`) is the entire trust boundary — no auth header.
On Windows, `Start GatesAI Chat.cmd` in the chat repo root starts this bridge
and the Vite dev server in separate PowerShell windows. The launcher uses a
built `../gatesai-bridge/bin/gatesai-bridge.exe` when present, otherwise it
falls back to `go run ./cmd/gatesai-bridge` from the sibling bridge repo. It
probes `http://127.0.0.1:7331/health` first and reuses an already-running
bridge instead of starting a second process on the same socket.

- **Protocol**: JSON envelopes `{ id, type, op?, data? }` with
  `type ∈ {request, event, result, error}`. id-correlated promises in
  `BridgeClient`. `event` envelopes carry mid-call streaming updates
  (currently only used by `exec.run` for stdout/stderr lines).
- **Workspace layout**: `attachments/` (user uploads), `notes/` (model
  scratch), `artifacts/` (model outputs). Auto-created on first run.
- **Path jail**: every path resolves through
  `workspace.Resolve(p)` → `filepath.EvalSymlinks` →
  in-root check. Rejects `..` walks, absolute paths, and symlinks
  pointing out of root.
- **Allowlist**: per-binary basenames in `~/.gatesai/bridge.json`. Edit +
  restart to add more. Broad shells such as `powershell` or `cmd` are not
  default-safe because they bypass command-level allowlist intent; prefer
  scoped tools such as `python_inline` and `sqlite_query` for common
  composition/query workflows.
- **Inbound request limit**: the WebSocket server raises the default
  `coder/websocket` 32 KiB read limit to match the configured
  `max_file_bytes` cap (including base64 expansion + JSON overhead), so
  large `fs.write` / attachment uploads reach the bridge's normal file-size
  validation instead of dropping the socket.
- **Read/output caps**: `fs.read` rejects files larger than the configured
  file cap before loading them into memory. `exec.run` applies the output cap
  to both the final result and streamed `event` chunks, emitting a single
  `[output truncated]` marker per stream after the budget is exhausted.
- **Empty collections**: `fs.list` and `fs.search` always return JSON arrays
  (`entries: []`, `hits: []`) for empty results. They must never emit `null`
  because the chat tool formatters treat those fields as array contracts.

Chat-side wiring:
- `BridgeStore` polls `/health` every 5s; on offline → online opens the
  WebSocket, on online → offline closes it (in-flight requests reject
  with `BridgeOfflineError` via the `onclose` handler).
- `ExecStreamStore` keeps a 10-line tail of in-flight `terminal` jobs
  for the UI; the model never sees the live stream, only the final
  captured output in the tool result.
- `services/bridge/attachments.ts` reads a `File` via FileReader,
  base64s it, and writes via `fs.write`. `BridgeStore.uploadAttachment()`
  is the UI-facing facade. The composer sends the resulting
  `DraftAttachment[]` to `ChatStore`, which formats a "📎 Attached files:"
  footer on the user message so the model has paths inline.

## Image jobs

`image_generate` does not block the chat turn. The tool builds an
`ImageJobInput` from `args` (clamped `count` 1–10, dims from
`aspect_ratio` or explicit `width`/`height`) and calls
`imageJobs.enqueue(...)`, which returns a synthetic `jobId`. The tool
result is `{ content, artifacts: [{ kind: 'image-job', jobId, count }] }`.

`ImageJobStore` runs jobs serially:

1. Pull the next pending job, mark `running`, set `startedAt`.
2. Resolve the ComfyUI backend config. For Comfy `full` mode,
   pass the configured hires-fix upscale factor through to the built-in
   FLUX.2 Klein workflow builder; if the user supplied a workflow path,
   fetch that JSON via `bridge.fs.read`.
3. Spin up the Comfy WebSocket progress adapter
   (`/ws?clientId=...`). Each event updates `job.progress`.
4. Loop `count` times: derive a per-iteration seed (`seed + i` if the
   user supplied one, else `Math.floor(Math.random() * 2**31)`),
   dispatch through `dispatchImageGenerate`, and write the bytes via
   `bridge.fs.write` into `/workspace/artifacts/`. Backends such as ComfyUI
   that return a hosted `/view` URL are fetched by the runner and persisted
   the same way, so Gallery history does not depend on direct localhost image
   loading or on ComfyUI keeping an output URL alive. Each saved path is pushed
   onto `job.results`.
5. Mark `done` and move into history.

Cancel from the UI calls `imageJobs.cancel(jobId)`, which aborts the
inflight `AbortController`, asks the Comfy progress adapter to POST
`/interrupt`, and moves the job into history with `cancelled`.
Per-iteration cancel checks bail out of the multi-image loop.

History is persisted under `gatesai.imagejobs.v1` (capped at 200
entries). Pending and running jobs do not persist — closing the app
mid-render loses in-flight work.

## Local runtimes

`LocalRuntimeStore` owns the app-facing state for Ollama and ComfyUI. It follows
the normal UI → Store → Service direction:

- UI: `components/menu/sections/Local.tsx` renders runtime rows, local LLM
  controls, ComfyUI image-generation settings, and the local vision picker.
- Store: `LocalRuntimeStore` persists install paths / managed flags under
  `gatesai.local.v1`, runs auto-detect once, starts/stops runtimes, polls
  `runtime_status`, and exposes `ollamaBaseUrl`, `comfyBaseUrl`, and
  `visionModel` facades to other stores/tools.
- Service: `services/local/localRuntimeService.ts` wraps Tauri invokes only;
  `services/local/autoDetect.ts` contains deterministic path-candidate logic
  seeded by host-side home/AppData paths.
- Host: `src-tauri/src/local_runtime.rs` parses the runtime id into a
  `RuntimeKind` enum (`Ollama` | `ComfyUI`) that owns the health URL and
  process spec, spawns child processes, captures stdout/stderr into a bounded
  log buffer, reports health via the shared `http_health::probe_health` helper,
  and kills managed children when the app window is destroyed. The same probe
  helper is reused by the bridge sidecar's "already running?" check in
  `lib.rs`. Mutex poisoning recovers via `into_inner()` with a logged warning
  rather than surfacing a string error to the WebView.

Ollama is launched as `ollama serve` and health-checked at
`http://127.0.0.1:11434/api/version`. ComfyUI is launched through the portable
Python runtime with `--windows-standalone-build` and the WebView CORS origins
appended automatically; health is `http://127.0.0.1:8188/system_stats`. Health
URLs are derived in Rust from the runtime id, not accepted from the WebView.

`ImageGenStore` keeps the image-generation backend contract but reads the
ComfyUI base URL from `LocalRuntimeStore` at the point of use — the URL is no
longer mirrored into `ImageGenConfig`. `OllamaStore` likewise reads
`localRuntime.ollamaBaseUrl` on each request rather than persisting its own
copy. `ProviderStore.effectiveConfigs` is a lazy getter that overlays the
current Ollama base URL onto the persisted provider configs, so the LLM router
sees a fresh URL without any autorun mirror chain.

## Auto-named threads

After the first successful turn, `ChatStore.maybeAutoName(...)`
fire-and-forgets `generateThreadTitle()` from
`services/threadNamer.ts`. The cascade tries the cheapest available
model first and walks down to the thread's own model as a guaranteed
fallback:

```
gemini-2.5-flash-lite  →  gpt-5.4-nano  →  gemini-3-flash
                       →  gpt-5.4-mini  →  thread.modelId
```

Each candidate is `provider.ready()`-checked before issuing a request.
Output is sanitized aggressively (strip quotes, strip trailing punct,
≤5 words, ≤60 chars). `Thread.autoNamed` flips true once a title lands
so we never re-run; `Thread.naming` is a transient flag (stripped on
save) that drives `<ThreadTitle>`'s typewriter animation.

## Memory & cross-thread summaries

The system prompt is the only delivery mechanism — there is no retrieval
layer, no embeddings store, no RAG. Memory is two layers stacked into the
prompt:

1. **`UserProfileStore.bio`** — durable, hand-curated facts. The `memory`
   tool is the model's API into this; the Agent UI is the user's. Stored
   as a newline-separated string for textarea round-trip; exposed as
   `facts: string[]` for tools and the UI.
2. **`Thread.summary`** — one-line digest of each *other* thread, written
   lazily by `SummaryStore`.

`SummaryStore`'s scheduler runs on a 15-second interval and picks the
most-recently-touched eligible thread. Eligibility:

```
not the active thread
AND messages.length ≥ 4
AND (no summary OR new-message-count since last summary ≥ 4)
AND idle-since-last-activity ≥ 60s
AND no summary already in flight
```

Summarizer model selection prefers cheap-fast over thread-native:
`gemini-3-flash` → `gpt-5.4-nano` → `gpt-5.4-mini` → `groq-llama-3.1-8b`
→ `claude-haiku-4.5` → `or-gpt-5.4-mini`, falling back to the thread's
own model. Mirrors what ChatGPT appears to do (lazy, debounced,
out-of-band).

## System prompt composition

`UserProfileStore.composeSystemPrompt({ threadContext, recentSummaries })`
always starts with a base bridge harness contract, then appends up to four
user/context sections, omitting any that are empty. When memory context
is present, a short nudge is appended encouraging the model to use the
`memory` tool proactively.

```
Bridge workspace contract:
- /workspace/... paths are for the fs tool and user-facing artifact refs
- Tools should be treated like command-style utilities: narrow action,
  explicit arguments, read status/error, retry corrected arguments
- Use inspect_file before fs.read for CSV, JSON, and text files
- terminal commands run from the real bridge workspace root; scripts use cwd/relative paths
- direct argv execution, dependent actions run sequentially, bulk work is file-backed and validated

<defaultSystemPrompt>

About the user:
<bio>

Recent conversations:
· <Thread title>: <summary>
· …                                    (capped at 15, sorted by summaryUpdatedAt desc)

About this conversation:
<threadContext>

You have a `memory` tool. When the user mentions a durable fact …
```

`recentSummaries` is sourced via a late-bound provider on `ChatStore`
(set by `RootStore` to `summary.recentSummariesExcluding(activeThreadId)`)
so tests can run without `SummaryStore` being wired. The base harness means
a non-empty system prompt is always sent.
