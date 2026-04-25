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
      preTokenLabel?: 'thinking' | 'responding' | 'compacting';
      toolCalls?: ToolCall[];
      toolResults?: ToolResult[];     // paired to toolCalls by toolCallId
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
  ranAt: number;
}

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
  | 'fake' | 'openrouter' | 'openai' | 'anthropic'
  | 'gemini' | 'groq' | 'local';

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
                     profile|agent|settings|usage|api|appearance
```

## Storage

| Key                      | Shape              | Owner             |
| ------------------------ | ------------------ | ----------------- |
| `gatesai.state.v1`       | `ChatSnapshot`     | `ChatStore`       |
| `gatesai.providers.v1`   | `ProviderConfigs`  | `ProviderStore`   |
| `gatesai.profile.v1`     | `UserProfileSnapshot` | `UserProfileStore` |
| `gatesai.openrouter.catalog.v1` | OpenRouter catalog cache | `OpenRouterStore` |

Both saved on every observable mutation via MobX `autorun`. Provider keys
are deliberately stored under a separate key so chat exports never include
credentials.

If a full chat snapshot exceeds the browser's `localStorage` quota, the
chat persistence service retries once with an emergency-compacted snapshot.
The fallback preserves the conversation structure, assistant prose, tool
calls, and tool result metadata, but compacts oversized tool result bodies
and large payload arguments such as `fs.write` content to marked head/tail
previews. This prevents a large file/tool result from rolling the whole
conversation back to the previous successful save.

## Theming

`UiStore` holds theme keys (`bgKey`, `accentKey`, `headerKey`, `sendKey`,
`threadHeaderKey`) plus persisted reading preferences for tool calls,
markdown, and code output. `core/theme.ts:buildTheme(bg, accent)` turns the
chosen keys into a `ThemeConfig`, and `themeToCssVars(theme)` emits a
`CSSProperties` object of `--bg`, `--accent`, etc. that `App` spreads onto
the root container.

`gatesai.uiprefs.v1` persists set-and-forget output style choices:
`toolCallStyle`, `markdownStyle`, `codeStyle`, `markdownDensity`, and
`codeSize`. `App` maps those keys to root classes (`markdown-editorial`,
`code-terminal`, etc.), while `.md-body` consumes the resulting CSS variables
for prose, lists, headings, inline code, and fenced code blocks.

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
   - when the bridge is online, reads `/workspace/artifacts/**/README.md`
     files and appends their capped contents to the system prompt under
     `Artifact instructions`
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

Artifact README context is intentionally file-backed rather than persisted in
chat state. `ChatStore` lists `/workspace/artifacts` recursively before each
provider round, includes only files named `README.md` case-insensitively, sorts
paths for deterministic prompt order, skips unreadable/non-UTF-8 files, and
caps both per-file and total injected characters. The section is global across
threads as long as the bridge can read the artifact files.

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

`ToolContext` carries the stores tools may reach into: `profile`, `chat`,
`notes`, `summary`, and the calling `threadId`. `notes` and `summary` are
injected lazily via `ChatStore.setToolStoresProvider(...)` so unit tests
that exercise tools needing only `profile` / `chat` don't have to stand
up the full graph.

Tool results are budgeted before reaching the next model round. Large
`terminal`/`git` outputs are represented with command metadata, truncation
flags, and head/tail slices; `fs.read` accepts `max_chars` and returns an
explicit continuation hint when the file content is larger than the model
result budget. Token usage estimates use the flattened wire messages plus
serialized tool calls/results and the selected tool schemas, so tool-heavy
threads do not undercount context as aggressively.

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
  base64s it, and writes via `fs.write`. The composer turns the
  resulting `DraftAttachment[]` into a "📎 Attached files:" footer on
  the user message at send time so the model has paths inline.

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
   tool is the model's API into this; the Profile UI is the user's. Stored
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
