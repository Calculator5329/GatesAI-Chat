# Changelog

## 2026-04-25 — Fresh-install UX

Removed the demo-mode feel from a fresh install. New installs land in one
empty untitled thread instead of eleven seeded fakes. Sending a message
without a configured provider no longer falls back to canned responses —
the composer's send button is disabled and a banner above it links to the
API settings panel until a real provider is configured. `FakeProvider` and
`src/core/seed.ts` are gone; the router throws `NoProviderConfiguredError`
when no real provider can serve a request. The installer now ships with
the brand icon instead of the Tauri placeholder.

## 2026-04-25 — Desktop app

GatesAI Chat now ships as a native Windows installer that bundles the Go
bridge automatically. The previous `Start GatesAI Chat.cmd` launcher has been
removed.

## 2026-04-25 — Architecture cleanup sprint

Moved shared tool-call/result rendering into `components/ui/` so editorial and
menu surfaces no longer import from each other. Removed React type dependencies
from `core/` style modules and tightened ESLint boundary rules for core,
stores, and cross-feature component imports.

Resynced architecture docs with the current store graph, menu routes, and
storage keys, including profile, notes, UI preferences, bridge, exec stream,
and workspace menu state. Roadmap and TODO entries now distinguish completed
attachment/tooling work from the remaining cleanup.

Centralized attachment footer formatting/parsing in `core/attachments.ts`, then
moved file uploads behind `BridgeStore.uploadAttachment()` so UI components no
longer import bridge services directly. Extracted ChatStore helper logic for
runtime context, artifact README loading, and tool failure logging into focused
service modules with regression tests.

## 2026-04-25 — Streaming markdown rendering and scroll UX fix

`EditorialChat` no longer forces the scroll container to the bottom on every
streaming token. The `useEffect` dependency on `chat.streamingMessageId` was
removed so the viewport only scrolls when a new message row appears or the
active thread switches — users can now freely scroll while the assistant streams.

`EditorialMessage` now routes active assistant stream content through the same
`ReactMarkdown` / remark-gfm / rehype pipeline used for finalized messages.
The old `StreamingPlainText` component is gone; a shared `MarkdownBody` helper
deduplicates the plugin configuration. The `WorkingIndicator` remains visible
outside the markdown tree during streaming. Tests updated to reflect markdown
rendering during active streams.

## 2026-04-25 — Architecture boundary cleanup, P0

Moved the shared SVG icon set from `core/` into `components/ui/` so the core
layer no longer owns React components. Removed unused icon exports and the
unused `fieldStyle` barrel export.

Replaced service-layer imports of store classes with narrow facades: tools now
type against service-owned context interfaces, `LlmRouter` accepts a
`ModelCatalog` interface, `threadNamer` accepts a router facade, and attachment
upload accepts a bridge-shaped facade. Added staged `no-restricted-imports`
rules so service-layer violations fail while the remaining UI-to-service
attachment import is tracked as a warning until the attachment store lands.

Made `FakeProvider` response rotation instance-local and moved duplicated
provider JSON parsing into a shared `services/llm/json.ts` helper.

## 2026-04-25 — Inspect workflow and query-script guidance

`inspect_file` now handles common uploaded data encodings instead of rejecting
binary/base64 bridge reads. It decodes UTF-8/BOM, UTF-16LE/BE, and
Windows-1252/Latin-1 style CSV/text inputs, reports detected encoding, and adds
richer CSV profiling with delimiter, row/column counts, likely date columns,
numeric min/max/sample, and empty/ragged row counts.

Added `inspect_file({ action: "workspace_profile" })` for artifact-first
workspace discovery using bridge `fs.list` and optional `fs.search`, plus a
`query_script` template tool for reusable scripts under
`/workspace/notes/query_scripts/` and final JSON outputs under
`/workspace/artifacts/`.

## 2026-04-25 — Scoped Python and SQLite wrappers

Added scoped `python_inline` and `sqlite_query` tools so the model can run
short Python snippets and read-only SQLite queries without broad shell access.
Both wrappers route through bridge `exec.run` with `cmd: "python"` and explicit
argv, avoiding PowerShell, cmd.exe, shell pipes, redirects, and the raw
`sqlite3` shell.

The SQLite wrapper accepts workspace-relative `.sqlite`, `.sqlite3`, and `.db`
paths, rejects dot-commands and multiple statements, and returns compact
JSON-shaped row output. Docs now mark broad shells as power-user escape hatches,
not default-safe workflow tools.

## 2026-04-25 — Emergency persistence for oversized tool results

Root cause for lost recent chat state: `ChatStore` saved snapshots to
`localStorage`, but `saveSnapshot` silently ignored quota failures. Large
tool/file results could push `gatesai.state.v1` past the browser limit, so a
crash or reload restored the older last-successful snapshot.

`saveSnapshot` now retries with an emergency-compacted snapshot that preserves
threads, user messages, assistant prose, tool calls, and tool result metadata
while replacing oversized tool result bodies and large tool-call payload
arguments with head/tail snippets and explicit compaction markers. Added
quota-style regression tests.

## 2026-04-25 — Runtime context in system prompt

Every provider request now includes a fresh `Runtime context` system section
with local time, timezone, ISO timestamp, bridge state, workspace path layout,
and terminal cwd semantics. This gives the model stable information about
where it is and how the harness works without needing a tool call.

The `time` tool remains registered for compatibility, but ordinary turns no
longer advertise it because the current time is already present in the system
prompt.

## 2026-04-25 — Artifact README system context

Artifact README files now act as global instructions. Before each provider
round, `ChatStore` reads `/workspace/artifacts/**/README.md` files through the
bridge, sorts them deterministically, caps their content, and appends them to
the composed system prompt under `Artifact instructions`.

This keeps generated artifact guidance available across all threads without
duplicating file contents into persisted chat state.

## 2026-04-25 — Tool harness guidance and failure logging

Updated the always-on bridge harness prompt to steer models toward
command-style tool use: choose a narrow action, pass explicit arguments, read
status/error output, and retry with corrected arguments when appropriate. The
prompt now also tells models to use `inspect_file` before `fs.read` for CSV,
JSON, and text files.

Updated attachment footers to reinforce the same rule so CSV/JSON/text
attachments point the model at `inspect_file`, reserving `fs` for byte-level
reads/writes.

Added structured console warnings for failed tool calls at the central
`ChatStore` execution boundary. Failure logs include tool/call/thread ids,
reason, result previews, redacted argument previews, bridge-online state,
read-only classification, duration, and timestamp for harness improvement.
Non-zero `terminal` and `git` exits are logged as failures too.

## 2026-04-25 — Chat-side guard for stale bridge empty results

Confirmed a live bridge process was still returning `entries: null` for an
empty `fs.list` response, even though the bridge source now returns empty
arrays. Updated the chat-side `fs` tool formatter to treat legacy `null`
`entries`/`hits` values as empty arrays so stale bridge processes no longer
surface `Cannot read properties of null (reading 'length')` to the model.

## 2026-04-25 — Semantic file inspection tool

Added a read-only `inspect_file` tool for compact CSV, JSON, and text
inspection. The assistant can now profile, preview, search, extract, and
aggregate supported files through the bridge without dumping full file contents
into model context.

Added focused regression coverage for CSV profiling/extraction, JSON shape
profiling, text line extraction, and tool registry selection.

## 2026-04-25 — Idempotent Windows launcher

Updated `Start GatesAI Chat.cmd` to probe the bridge health endpoint before
starting `gatesai-bridge`. If a bridge is already listening on
`127.0.0.1:7331`, the launcher reuses it and only opens the chat dev server,
avoiding the duplicate-socket `bind: Only one usage of each socket address`
error.

## 2026-04-25 — Working indicator during streamed text

Active assistant messages now keep a subtle `working` indicator under streamed
plain text after the first token arrives, matching the existing pre-token
`thinking` / `responding` / `compacting` status treatment. Streaming assistant
rows also hide their bottom divider until the response is complete, so the UI
doesn't imply the answer has finished early.

## 2026-04-25 — Context accounting and auto-compaction

Made the context meter use the same provider payload shape as `runTurn`,
including the composed system prompt, expanded tool results, tool schemas, and
reserved reply budget. `ChatStore` now preflights each request before calling
the provider so oversized threads fail locally with a friendly message instead
of surfacing raw OpenRouter context-limit JSON.

Added automatic compaction for large tool results. When a thread approaches the
model context window, the store prefers a cheap configured small model to
summarize old bulky tool output, falls back to deterministic path/size
summaries when needed, then retries the original model request. Empty assistant
rows can now show `compacting` during that pre-token step.

## 2026-04-25 — Windows chat + bridge launcher

Added `Start GatesAI Chat.cmd`, a double-click Windows launcher that starts
the sibling `gatesai-bridge` process and the Vite chat dev server in separate
PowerShell windows. The script validates the expected project layout and
required commands before launching, prefers a built bridge binary when present,
and falls back to `go run ./cmd/gatesai-bridge`.

The launcher also supports `Start GatesAI Chat.cmd /check` for a non-launching
sanity check.

## 2026-04-25 — Smoother assistant text streaming

Reduced choppy assistant text loading by batching streamed text deltas before
writing them into MobX state. The batcher flushes on a short frame-sized timer
or sooner when enough text accumulates, which cuts down render churn without
leaving long responses visually stalled.

Active assistant streams now render as lightweight pre-wrapped text and switch
back to full markdown once finalized. This avoids reparsing the entire markdown
tree on every small token update while preserving final markdown formatting.

## 2026-04-25 — Bridge empty-list response fix

Fixed a bridge protocol edge case where empty `fs.list` and no-match
`fs.search` responses marshaled Go nil slices as JSON `null`. The chat-side
tool formatters expect arrays and could surface
`Error: Cannot read properties of null (reading 'length')` during tool-heavy
turns that probed empty workspace folders before reading an attachment.

The bridge now initializes those response slices so empty results are sent as
`entries: []` and `hits: []`. Added Go regression coverage for both cases.

## 2026-04-25 — Harness accuracy and performance

Added a model-facing `workspace` tool so the assistant can query bridge runtime
facts instead of relying only on prompt prose. The tool reports bridge state,
platform, workspace root, allowlist, known caps, and the cwd-based script recipe.

The tool registry now stores capability metadata, selects a smaller conservative
tool schema set per round, budgets large `fs`, `terminal`, and `git` results,
and lets `ChatStore` run independent read-only tool calls concurrently while
preserving result order. Context estimates now include flattened wire messages,
serialized tool calls/results, and selected tool schemas.

Hardened `gatesai-bridge` by rejecting oversized `fs.read` files before loading
them and throttling streamed `exec.run` events once the output budget is spent.
Added TS/Go regression tests for workspace info, schema selection, result
compaction, token accounting, wire-format ordering, and bridge read/stream caps.

## 2026-04-25 — Responding indicator after interrupt

Added a context-aware pre-token label for interrupted-and-replaced replies.
Fresh empty assistant streams still show `thinking`, while a replacement turn
created by sending during an active stream now shows `responding` until the
first token arrives.

Added regressions for the `responding` indicator and for continued streaming
after an interrupted turn starts its replacement response.

## 2026-04-25 — Remove orphan streaming caret

Removed the post-markdown streaming caret from assistant messages. React
Markdown renders paragraphs as block elements, so the inline caret could fall
onto its own line and appear as an isolated green rectangle while a response
was still streaming. Pre-token responses still use the `thinking` indicator.

Added a renderer regression test so streamed markdown content does not render
the orphan caret.

## 2026-04-25 — Extended visible tool-loop cap

Raised `ChatStore`'s per-turn tool round cap from 6 to 16 so larger file and
artifact workflows can complete without premature interruption. If a model
still hits the cap, the assistant message now gets a visible explanation
instead of ending with blank content and only setting `lastError`.

Added a regression test covering extended tool work and the visible cap message.

## 2026-04-25 — User attachment chip rendering

Changed user messages with uploaded files to render only the model-facing
attachment footer as a compact green chip. The visible message now shows a
minimal `CSV · 10.7KB` style label, while the stored raw text still keeps the
`/workspace/attachments/...` path and fs reminder the model needs for reads.

Added a renderer regression test so attachment footers stay separate from the
user's prose and do not leak workspace paths or tool reminders into the
visible message body.

## 2026-04-25 — Markdown and code Appearance tweaker

Added a hybrid Appearance tweaker for assistant output: markdown preset cards
(`Editorial`, `Technical`, `Compact`), code-block preset cards (`Obsidian`,
`Terminal`, `Paper`), and compact advanced controls for markdown density and
code size.

The choices persist through `gatesai.uiprefs.v1` and apply live via root
classes plus `.md-body` CSS variables, keeping rendering in the UI layer and
leaving chat data unchanged.

## 2026-04-25 — Currency-safe markdown math

Fixed assistant message rendering where ordinary currency prose like
`$120,000 gross/$85,700 take-home` could be parsed as inline KaTeX math.
That caused spaces to collapse inside phrases such as "going into investments"
and made normal financial summaries look garbled. Markdown math now requires
double-dollar delimiters, preserving single-dollar currency formatting.

Added a renderer regression test covering financial-plan prose with multiple
dollar amounts and bold currency text.

## 2026-04-25 — Local-only Git tool

Added a dedicated `git` tool that wraps safe local Git porcelain through the
bridge instead of asking the model to use raw terminal commands. The first
version supports status, diff, log, show, branch listing, add, commit, and
local branch create/switch. Restore actions require the explicit confirmation
string `restore local changes`.

The tool intentionally exposes no push, pull, fetch, remote, reset, rebase,
merge, or force operations. Regression tests cover bridge-offline handling,
command argv construction, required commit messages, guarded restore behavior,
and rejection of unsupported remote/destructive actions.

## 2026-04-25 — Minimalist message copy gesture

Added a low-chrome copy affordance to chat messages: Ctrl/Cmd-click a rendered
user or assistant message to copy its raw text. A one-time hover hint teaches
the gesture, normal text selection is left alone, and the existing kicker line
briefly reports `copied` or `copy failed`.

The interaction lives entirely in the editorial UI layer. A small helper keeps
the gesture rules testable without involving stores or services.

## 2026-04-25 — Bridge harness prompt

Added an always-on bridge harness section to the composed system prompt so
models get the local workspace contract every turn before user-editable
instructions. The prompt now distinguishes model-facing `/workspace/...`
paths from subprocess working directories, tells scripts to use cwd/relative
paths, warns against shell-only syntax in direct argv terminal calls, and
sets expectations for dependent action ordering, bulk-data validation, and
long-running command results.

Tightened the `fs` and `terminal` tool descriptions with the same guidance,
covering bridge path semantics, script execution from the workspace root,
sequential write-then-run flows, artifact placement under `/workspace/artifacts`,
and timeout/final-result handling for async terminal work.

## 2026-04-25 — Tool-call error handling for OpenRouter Claude

Fixed a two-part tool loop failure seen with OpenRouter-routed Claude models:
malformed `fs` tool calls with empty arguments now return a clear
`` `action` is required for fs `` result instead of the confusing
`unknown action ""`, and OpenRouter Anthropic model requests now serialize
tool results as user continuations so Claude does not reject the follow-up as
assistant prefill.

Added regression coverage for empty `fs` actions, `fs` calls flowing through
`ChatStore`'s tool loop, and scoped OpenRouter formatting so non-Anthropic
OpenRouter models keep the standard OpenAI-compatible `tool` message shape.

## 2026-04-25 — Bridge large-request read limit

Fixed a `gatesai-bridge` WebSocket disconnect where requests larger than the
`coder/websocket` default 32 KiB read limit logged
`read limited at 32769 bytes` and closed the socket before the operation could
run. The bridge now sets its inbound WebSocket message limit from
`max_file_bytes` with room for base64 expansion and JSON overhead, keeping the
existing `fs.write` size cap as the source of truth.

Added a Go regression test that sends a >32 KiB `fs.write` request through the
real WebSocket route and verifies it receives a normal `result` response.

## 2026-04-25 — GPT-5.5 catalog refresh

Verified the new OpenAI and OpenRouter model slugs from provider pages, then
added the supported GPT-5.5 entries to the curated catalog:

- Direct OpenAI: `gpt-5.5`, `gpt-5.5-pro`
- OpenRouter mirrors: `openai/gpt-5.5`, `openai/gpt-5.5-pro`

No GPT-5.5 mini or nano entries were added because the provider docs point
cost-sensitive usage at the existing `gpt-5.4-mini` and `gpt-5.4-nano`
models instead. The model picker metadata and Agent default-model dropdown now
include GPT-5.5 and GPT-5.5 Pro, with a regression test guarding the catalog
slugs.

## 2026-04-23 — Workspace + terminal via the `gatesai-bridge` companion

Introduced a second product alongside the chat app: a small Go companion
process (`../gatesai-bridge/`) that owns a workspace folder and exposes
filesystem + shell ops over a single WebSocket. Pairing the chat app with
a local process unlocks two long-pending capabilities — real file
read/write and real terminal commands — without compromising the
"chat-app stays a static SPA" property.

### Bridge (Go)

- **Module**: `github.com/etgates/gatesai-bridge`. One dep, `coder/websocket`.
- **Workspace root**: `~/GatesAI/workspace/` with auto-created
  `attachments/`, `notes/`, `artifacts/` subfolders.
- **Path jail**: every fs op resolves through `workspace.Resolve()`,
  which calls `filepath.EvalSymlinks` and rejects anything that exits
  the root. Unit-tested for `..`, absolute paths, and symlink escapes.
- **Protocol**: WebSocket + JSON envelopes (`request | event | result |
  error`) with id correlation. One connection multiplexes everything;
  `exec.run` streams `event` envelopes for live stdout/stderr lines and
  closes with a `result` carrying the full captured output.
- **Allowlist**: `~/.gatesai/bridge.json` ships with a safe default set
  (`ls, tree, cat, head, tail, grep, find, wc, stat, mkdir, mv, cp, rm,
  touch, echo, pwd, date, whoami`). Edit + restart to add more. Rejects
  before fork.
- **Listen**: `127.0.0.1:7331` only. No auth — loopback is the entire
  trust boundary for v1.
- **Endpoints**: `GET /health` (poll target) + `WS /ws` (everything else).

### Chat (TS)

- **`core/workspace.ts`** — typed shapes mirroring the bridge's response
  structs (`FsReadResp`, `ExecRunResp`, etc.). Single source of truth
  for the wire types.
- **`services/bridge/client.ts`** — `BridgeClient` keeps one WebSocket,
  routes `result | event | error` envelopes back to per-call promises by
  id. `BridgeOfflineError` is the one error tools translate into a
  friendly string for the model.
- **`stores/BridgeStore.ts`** — owns the connection lifecycle. Polls
  `/health` every 5s; on offline → online it opens the socket; on
  online → offline it tears it down (in-flight requests reject cleanly).
- **`stores/ExecStreamStore.ts`** — keeps a "last 10 lines" tail of each
  in-flight `terminal` job purely for the UI. The model never sees the
  live stream; it gets the full captured output as the tool result.
- **Two new tools, both registered always-on**:
  - `fs` — `read | write | append | list | delete | move | copy |
    mkdir | stat | search` over the workspace.
  - `terminal` — runs allowlisted shell commands; emits live updates
    into `ExecStreamStore`.
- **Composer**: paperclip + drag-drop. Files upload to
  `/workspace/attachments/<safe-name>` via `fs.write` and become chips
  on the draft; on send, the user message gains a footer like:
  ```
  📎 Attached files (read with the `fs` tool):
    - /workspace/attachments/foo.csv · 12.3KB · text/csv
  ```
  The model reads them on demand instead of inflating every prompt.
- **Bridge status pill** at the bottom of the sidebar — green/red dot +
  click-to-repoll. Hover for the workspace root, version, allowlist
  size, and last error.
- **Live exec tail** beneath any `terminal` tool call that's still
  running — accent left-rule + last 10 stdout/stderr lines + caret.
  Replaced by the real `ToolResultView` once the bridge sends `result`.
- **Workspace settings page** under `#/menu/workspace` showing the
  status, root path, allowlist (as chips), and a recursive `fs.list` of
  the workspace contents with refresh.

### Auto-named threads + animation

After the first successful turn finishes, `ChatStore` fire-and-forgets a
`generateThreadTitle()` cascade:

```
gemini-2.5-flash-lite  →  gpt-5.4-nano  →  gemini-3-flash
                       →  gpt-5.4-mini  →  thread's own model
```

Each candidate is checked for `provider.ready()` before we waste a
request. `Thread.autoNamed` flips true once a title lands so we don't
re-run; `Thread.naming` is a transient flag (stripped on save) that
drives a `<ThreadTitle>` component in the sidebar — quiet `…` while
naming, then a one-shot 22ms/char typewriter animation when the new
title arrives.

### Tests

- `tests/services/tools.test.ts` gained 7 new tests covering `fs` and
  `terminal` against a fake bridge (offline error, validation errors,
  list formatting, run output formatting, op routing).
- Total: 78 → 85 tests, all green.
- `gatesai-bridge` has its own Go unit tests covering the path jail
  (allowed reads, escape rejections, symlink boundary confusion,
  subfolder auto-create).

### Notes

- The chat app degrades gracefully when the bridge is offline. Tools
  return `Error: bridge offline. Start gatesai-bridge.`; the composer's
  paperclip dims and tooltips explain why; the status pill goes red.
  No crashes, no spinners hanging forever.
- `Thread.naming` is intentionally non-persisted. If a tab closes
  mid-name, the title falls back to "first 40 chars of opener" until
  the next turn (which won't re-run the namer because the auto-named
  flag isn't set — small UX bug, logged in TODO).

## 2026-04-23 — Three new tools: `time`, `notes`, `thread`

Expanded the tool catalog from one (`memory`) to four. The picks were
chosen to play to the architecture's strengths — every tool runs in the
browser with no backend, and each one works with every model the user
plugs in (Claude, GPT, Gemini, OpenRouter, local).

- **`time`** — single-action tool. Returns ISO + human-readable + tz +
  unix_ms. Five-line implementation; closes the "what day is it" gap
  every model has.
- **`notes`** — six-verb tool (`create | read | update | delete |
  search | list`) backed by a new `NotesStore` and `gatesai.notes.v1`
  localStorage key. The companion to `memory`: short atomic facts go in
  `memory` (and the system prompt every turn); long-form documents go in
  `notes` (and are read on demand). Notes never leak into the system
  prompt automatically, keeping cost predictable as the corpus grows.
- **`thread`** — six-verb meta-tool (`rename | set_context |
  get_context | summarize_now | switch_to | list`). Finally gives
  `Thread.threadContext` a way to be set end-to-end (it's been in the
  data model with no UI for weeks). The model can also force-summarize
  a thread on demand and switch the active thread.

Wiring touched:

- `ToolContext` gained `notes: NotesStore` and `summary: SummaryStore`.
  These are injected lazily via `ChatStore.setToolStoresProvider(...)`
  so existing tests that don't use those tools didn't need updating.
- `SummaryStore.summarizeNow(threadId)` added — public force-summarize
  for the `thread` tool, ignoring the lazy scheduler's filters.
- `ChatStore.renameThread(id, title)` added — the `thread` tool's
  `rename` verb routes through it.
- `Agent` settings page lists the four live tools and adjusted
  "planned" set: `web_search`, `web_fetch`, `code_run`.

Tests: 12 new tool tests (`tests/services/tools.test.ts`) covering each
verb's success and error paths. Total now 70 passing.

## 2026-04-23 — One assistant message per turn (collapsed multi-round tool work)

The previous refactor put tool results on the assistant message that
called them, but each model→tool round trip was still its own assistant
message. That meant a single user turn ("forget jazz") could produce two
stacked assistant rows — the tool round and the prose round — each with
its own kicker, requiring `hideKicker` / `isOpener` / `isContinuation`
gymnastics in the renderer to make them look like one reply. The fix
was to collapse them at the storage layer, not the rendering layer.

- **One stored `AssistantMessage` per user turn**, no matter how many
  internal tool round trips happen. `toolCalls` and `toolResults`
  accumulate across rounds; `content` holds the model's final closing
  prose. The renderer sees one speaker boundary per turn.
- **`flattenForWire` does the round-splitting** when sending to
  providers — one stored message expands to `[assistant(toolCalls),
  tool, tool, ..., assistant(text)]` if needed. All wire-format
  knowledge stays in this one helper.
- **Renderer dropped 60% of its conditional logic.** No more `hideKicker`
  prop, no `isContinuation` peek-back from the parent, no `isOpener`
  border tricks, no calls-only bare-frame branch. One frame, one kicker,
  always. Tools render above the prose because chronologically that's
  what happened: the model used tools first, then composed its reply.
- **`EditorialChat` simplified** — no longer compares `messages[i-1]` to
  detect runs; it just maps each message to a renderer.
- **Persistence migration extended** to also fold consecutive assistant
  messages from the same turn (legacy snapshots may have one row per
  round). The merged row keeps the first round's id/createdAt so
  references survive, accumulates calls/results, and uses the last
  non-empty `content` as the final prose. Idempotent.

## 2026-04-23 — Tool results live on the assistant message that called them

Restructured the chat domain so a tool result is no longer its own
"message" — it's metadata on the assistant message that triggered the
call. One assistant message per round trip, with `toolCalls` and a
parallel `toolResults` array on the same object. The renderer became
trivial (no pairing, no calls-only suppression hack), persistence got
cleaner (one row per round), and the data model now matches the mental
model — nobody "said" the tool result; it's the function's return value
the model reads on its next round.

- **`Message` discriminated union shrinks to `UserMessage |
  AssistantMessage`.** `ToolMessage` is gone. `AssistantMessage` gains
  `toolResults?: ToolResult[]` paired to `toolCalls` by `toolCallId`.
  (`src/core/types.ts`)
- **`flattenForWire(messages)` is now the single boundary between
  storage and the wire format.** The wire-level `LlmMessage` shape that
  providers expect is unchanged (`user | assistant | system | tool`);
  every provider call routes through this helper, which expands one
  stored assistant-with-results into the `[assistant, tool, tool, …]`
  sequence the APIs want. Missing results (interrupted runs) get a
  synthetic placeholder so we never emit a dangling tool-call id.
  (`src/services/llm/wireFormat.ts`)
- **Forward migration in `loadSnapshot`.** Old snapshots stored tool
  results as `role: 'tool'` rows. On load we walk each thread, fold
  every tool message into the preceding assistant's `toolResults`, and
  drop the row. Idempotent — clean snapshots round-trip unchanged.
  Test: `tests/services/persistence.test.ts`.
- **`ChatStore.runTurn` rewritten.** Each round appends exactly one
  assistant message and mutates it in place: text streams into
  `content`, calls into `toolCalls`, results into `toolResults` as each
  tool finishes (so a slow tool reveals progressively in the UI).
  (`src/stores/ChatStore.ts`)
- **`EditorialMessage` simplified.** Dropped the `role === 'tool'`
  branch and the calls-only suppression hack that hid the redundant
  kicker. Now renders one assistant frame per round: kicker → markdown
  body → tool calls + their results inline, paired by id. The
  "Memory · Saved …" line appears below the model's prose, under its
  own kicker, where it belongs. (`src/components/editorial/EditorialMessage.tsx`)
- **`ToolCallRender` now takes `ToolResult` directly** instead of a
  `ToolMessage`. Variants are unchanged in look — `whisper`, `dot`,
  `aside`, `mark`, `hidden` — just bound to a cleaner data type.
- **`SummaryStore` transcript renderer updated.** Indents `[tool name
  → result]` under the assistant line that produced it, so the
  summarizer correctly attributes tool activity rather than treating
  it as a separate speaker.

## 2026-04-23 — Memory v2: unified `memory` tool + cross-thread summaries + Profile UI

Memory caught up to what the leading labs do. Three structural changes:
the `add_memory` tool became the broader `memory` tool with `add | remove |
update | list` actions; a new `SummaryStore` writes one-line digests of
idle threads in the background (using the cheapest fast model that's
configured); and the Profile section now actually lets you see and edit
what the assistant remembers.

- **Unified `memory` tool replaces `add_memory`.** One tool, four verbs
  (`action: 'add' | 'remove' | 'update' | 'list'`), mirroring OpenAI's `bio`
  pattern. Concentrating verbs into one tool keeps the catalog small as we
  add more domains and gives the model a single mental address for "the
  memory thing." `remove` and `update` accept either an `index` (from
  `list`) or a substring `fact` to match. (`src/services/tools/memory.ts`)
- **`UserProfileStore.facts` getter + full CRUD.** Bio is still stored as a
  newline-separated string (one fact per line, optional `· ` prefix) but is
  now exposed as a parsed array via `facts`. New actions: `addFact`,
  `removeFactAt`, `removeFactMatching`, `updateFactAt`, `updateFactMatching`,
  `clearFacts`. `addFact` is case-insensitive-deduped so the model's
  occasional re-fires don't grow the bio.
- **`SummaryStore` — lazy cross-thread digests.** A `setInterval`-driven
  scheduler that scans threads every 15s and picks the most-recently-touched
  one that meets the criteria (≥ 4 messages, not the active thread,
  either no summary or ≥ 4 new messages since the last one) — but only
  fires when the user has been idle for ≥ 60s. Mirrors what ChatGPT
  appears to do: lazy, debounced, off the hot path. (`src/stores/SummaryStore.ts`)
- **Cheap-fast summarizer routing.** Tries `gemini-3-flash` →
  `gpt-5.4-nano` → `gpt-5.4-mini` → `groq-llama-3.1-8b` →
  `claude-haiku-4.5` → `or-gpt-5.4-mini`, falls back to the thread's own
  model if none of those are configured. 120-token cap, single-sentence
  instruction. Tool messages in the transcript are flattened to
  `[tool name → result]` lines so summaries can reference saved memories.
- **Cross-thread awareness in every system prompt.** `composeSystemPrompt`
  now accepts `{ threadContext, recentSummaries }`. Recent summaries land
  under `## Recent conversations:` between the bio and the per-thread
  context. Capped at 15 entries, sorted by `summaryUpdatedAt` desc,
  excludes the active thread (since it's already in full context).
  ChatStore wires the source via a late-bound provider so tests stay
  isolated.
- **Implicit-save nudge.** When any memory context exists (bio non-empty
  or recent summaries available), the system prompt is suffixed with a
  short instruction reminding the model to use the `memory` tool
  proactively for durable facts. Mirrors how ChatGPT's hidden prompt
  nudges its `bio` tool.
- **Thread fields for summary tracking.** `Thread.summary?: string`,
  `summaryUpdatedAt?: number`, `summaryMessageCount?: number`. All
  optional so existing snapshots round-trip. The message-count field is
  the staleness lever — re-summarize only when the thread has grown by
  ≥ 4 messages since the last write.
- **Profile section is now the home for memory.** Account info, an
  editable list of bio facts (add/edit/delete inline + clear-all), and
  a read-only list of recent thread summaries with timestamps. The Agent
  section's old bio textarea is gone (one source of truth) and its tool
  list now reflects what's actually wired (`memory · live`, others
  `planned`, no toggles since "all tools always on" is the design).
- **Tests.** Test suite up to **56 passing.** New coverage:
  `tests/stores/toolLoop.test.ts` exercises every memory action through
  the scripted-provider tool loop; `tests/stores/SummaryStore.test.ts`
  covers the trigger gate (too-few-messages skip, basic generation, no
  re-summarize until threshold), and `recentSummariesExcluding`
  behavior. The existing toolLoop tests were updated for the new
  `memory` tool name and `composeSystemPrompt({ ... })` shape.

## 2026-04-23 — Tool calling (add_memory) + per-thread context

The model can now persist things you tell it. First tool: `add_memory`. Works
across every direct provider — OpenAI, Anthropic, Gemini — and through
OpenRouter for everything else. Architecture is set up to add more tools by
dropping a file in `src/services/tools/` and registering it.

- **Discriminated `Message` union by `role`.** Added `'tool'` as a third
  message kind alongside `'user'` and `'assistant'`. Existing stored messages
  already have valid `role` values so no migration is needed — they just
  become two of three union members. Assistant messages can now carry an
  optional `toolCalls: ToolCall[]`. (`src/core/types.ts`)
- **`Thread.threadContext?: string`.** Per-thread context that's appended to
  the system prompt under `## About this conversation:`. No editor UI yet —
  written by the model (eventually) and exposed via `chat.setThreadContext()`
  for programmatic use. Persists with the thread snapshot.
- **`composeSystemPrompt` reorganized.** Now follows the same structure
  every leading product uses (ChatGPT Custom Instructions / Claude Project
  Instructions / Gemini Gems): behavior first → about-the-user (bio) →
  about-this-conversation (threadContext). Each section omitted when empty.
- **Tool registry.** `services/tools/registry.ts` is a singleton that holds
  every registered tool. `add_memory` registers itself. `LlmRequest.tools`
  carries the def list to providers; tool definitions use a small JSON-Schema
  subset.
- **`add_memory` tool.** Mutates `UserProfileStore.bio` via a new
  `appendBioFact()` action that prepends `· <fact>` so the newest memories
  are most prominent. Description steers the model toward durable facts and
  away from passing context. 500-char per-fact cap. Returns a confirmation
  the model sees on its next round so it can acknowledge the save in its
  reply. (`src/services/tools/addMemory.ts`)
- **Tool execution loop in `ChatStore`.** A user turn is no longer one
  round trip — `runTurn` cycles through model→tools→model rounds until the
  model produces a round with no tool calls. Each round writes into a fresh
  assistant message, so multi-turn tool use renders inline as
  `assistant(text + tool_call) → tool(result) → assistant(final reply)`. Hard
  cap of 6 rounds prevents runaway loops if a model misbehaves.
- **Provider adapters carry tools.** All four shapes implemented per their
  native conventions:
    - OpenAI/compat (OpenRouter, Groq, local): `tools: [{ type: 'function', function: {...} }]`,
      streamed `delta.tool_calls[]` accumulated by index, `tool_call_id` echoed
      on `role: 'tool'` results.
    - Anthropic: `tools: [{ name, description, input_schema }]`,
      `content_block_start (tool_use)` + `input_json_delta` accumulated until
      `content_block_stop`, results sent as `tool_result` blocks under a `user`
      role per Anthropic's convention (adjacent results merged into one user
      message).
    - Gemini: `tools: [{ functionDeclarations: [...] }]`, `parts[].functionCall`
      arrives pre-parsed (Google does the JSON assembly server-side), results
      go back as `parts[].functionResponse: { name, response: { result } }`.
- **`LlmChunk` union grows by one variant.** New `{ type: 'tool_call', call }`
  for fully-buffered tool calls (we don't surface argument-deltas to the
  store/UI — keeps the contract small and matches how tool JSON arrives in
  practice). `finishReason` gains `'tool_use'`.
- **Inline tool UI.** Tool-call badges render below the assistant message
  that called them (compact mono row: `↳ add_memory(fact: "…")`). Tool
  results render as a near-invisible mono row between assistant messages
  (`· add_memory → "Saved to memory: …"`). No menu sections, no toggles,
  just visual transparency in the conversation flow.
- **No tool toggles.** Per the user's call: tools are always-on. Adding more
  tools later means dropping a file in `services/tools/` and one
  `toolRegistry.register()` line — no UI plumbing.
- **Tests.** Seven new tests covering the tool loop happy path, multi-round
  message-history shape, threadContext composition, the round cap, and the
  `composeSystemPrompt` ordering / `appendBioFact` formatting. 49 tests pass.

## 2026-04-23 — Per-thread streaming, interrupt-and-send, better thinking state

Made the chat actually behave like a chat. Previously, switching threads or
tabs aborted the in-flight reply and partial messages just sat there mute.
And — embarrassingly — text was *technically* streaming on the wire but
appearing to land all at once because the leaf message component had been
un-`observer`'d in a recent refactor.

- **Streaming actually streams again.** Re-wrapped
  `EditorialMessage` in `observer`. Without this, `message.content`
  mutations during streaming weren't being tracked at the leaf, so the
  parent only re-rendered on length/id changes — making the assistant's
  reply appear to land in one chunk on `done`. One-line regression, immediate
  fix. (`src/components/editorial/EditorialMessage.tsx`)
- **Per-thread streams.** `ChatStore` now tracks
  `streamingByThread: Record<threadId, messageId>` and
  `controllersByThread: Map<threadId, AbortController>`. The old
  single `streamingMessageId` field is now a derived getter that reads
  the active thread's slot — preserves the existing UI contract.
  Switching threads no longer aborts the reply on the previous one, so
  you can fire off a long prompt, jump to another conversation, and
  come back to a finished message.
- **Sidebar streaming dot.** Each sidebar thread row shows a small
  pulsing accent dot while a reply is in flight on that thread, so you
  always know which conversations are still cooking.
- **Send-while-streaming = interrupt + send.** If the active thread is
  streaming and the user types + hits enter (or clicks send), the
  in-flight reply is aborted, the partial assistant message is annotated
  `*[interrupted]*` (or replaced with `*[no response]*` if the model hadn't
  yielded a single token yet), and the new turn starts immediately. The
  composer's right-side hint flips to `↵ to interrupt` while text is in the
  draft and a stream is running.
- **Stop control.** When streaming with an empty composer, the send
  button morphs into a compact stop square. As soon as the user starts
  typing, it swaps back to the regular send button (which is now the
  interrupt-and-send affordance).
- **Better thinking indicator.** Pre-token state used to be three small
  dim dots with no label. Now: an uppercase mono `THINKING` kicker (in
  the accent color) followed by larger, brighter pulsing dots with a
  faint accent glow. Reads as part of the typographic system, matches
  the role kicker style above it, and is much more visible.
- **Tests.** Replaced the now-incorrect "selectThread aborts the stream"
  test with three new ones: switching threads keeps the stream going,
  interrupt-and-send produces a 4-message sequence with the partial
  annotated, and a zero-token interrupt yields the `*[no response]*`
  placeholder. 42/42 passing.

Architecture stayed honest. `streamingByThread` is a plain `Record`
(not an `observable.map`) so `makeAutoObservable` can deep-convert it
cleanly — initial attempts using `observable.map` silently broke
persistence because MobX double-wrapped the field. Lesson: when in doubt
with `makeAutoObservable`, use plain JS containers and let MobX wrap them.

## 2026-04-23 — Memory wiring + context meter + equal voices

Three small, compounding wins.

- **Equal message font sizes.** User and assistant both render at 16px Source
  Serif 4 — same family, same size. Role distinction now lives in the kicker
  (color-coded `YOU` vs `CLAUDE SONNET 4.6`) instead of size + family swap.
  One file: `src/components/editorial/EditorialMessage.tsx`.
- **Live context-window meter.** Replaced the static
  `↵ send · ⇧↵ newline` hint under the composer with a real-time bar showing
  `tokensUsed / contextWindow` for the active thread, including the unsent
  draft. Color shifts amber at 75%, red at 90%. New `core/tokens.ts` (heuristic
  4-chars-per-token estimator + per-provider window defaults), new
  `ChatStore.tokenUsage(draft)` getter, new `ContextMeter` co-located in
  `EditorialComposer`.
- **System prompt + user bio (memory wiring).** The `LlmRequest.systemPrompt`
  contract that's been declared since Phase 2 is now actually populated.
  - **`UserProfileStore`** (`src/stores/UserProfileStore.ts`): owns
    `bio` and `defaultSystemPrompt`. Persisted to `gatesai.profile.v1`,
    independent of chat history so wiping conversations doesn't wipe memory.
    Exposes `composeSystemPrompt(threadOverride?)` which merges the two into
    the final string sent to the provider.
  - **`ChatStore.sendMessage`** now calls `profile.composeSystemPrompt()` and
    sets `request.systemPrompt` when non-empty.
  - **Agent menu section** rewritten as the single home for AI behavior:
    Instructions textarea (system prompt) and Memory textarea (bio) at the
    top, both wired live to the store. The old hard-coded "47 facts" theatrical
    UI is gone. The Tools section is dimmed and labeled "coming soon" until
    the tool runtime lands. `add_memory` is in the tools list as a teaser for
    the eventual model-driven memory writes.
  - **Profile section** demoted to account-only (name, plan, sessions). A
    note at the top points users to **Agent** for instructions/memory so the
    settings tree stays self-explanatory.

`tsc -b`, `vitest run` (40 tests), and `eslint .` all green. The 8 remaining
lint warnings are pre-existing fast-refresh advisories on co-located helper
components in `ModelPopover.tsx`, `Api.tsx`, and `core/icons.tsx`.

## 2026-04-23 — Live OpenRouter model catalog

Wired the model picker to OpenRouter's live `/api/v1/models` so users see the
real, current set of routable models (~350 on launch day) instead of just the
17 we hand-picked.

- **`Model` type**: gained optional `description`, `contextLength`,
  `pricing: { prompt, completion }` (USD per 1M tokens), and a `dynamic: true`
  marker that distinguishes runtime-fetched entries from the curated list.
- **New `ModelRegistry` store** (`src/stores/ModelRegistry.ts`): single source
  of truth that merges curated + dynamic entries, dedupes by
  `(providerId, providerModelId)` (dynamic wins on overlap), and exposes
  `findById`, `byProvider`, `byVendor`. Replaces the now-deleted helpers in
  `core/models.ts`. The router and every UI surface read from the registry,
  so a refreshed catalog flows everywhere through MobX without manual fan-out.
- **`OpenRouterStore`** (`src/stores/OpenRouterStore.ts`): owns
  `models`, `fetchedAt`, `fetching`, `fetchError`, plus `refresh()` and
  `clearCache()`. Hydrates from `gatesai.openrouter.catalog.v1` on boot, never
  auto-refreshes (explicit user action only).
- **Catalog fetcher** (`src/services/llm/openrouterCatalog.ts`): pulls the
  `/api/v1/models` endpoint, filters out non-text outputs (audio, image,
  embeddings) so the picker stays usable, namespaces ids as `or-live-<slug>`
  to avoid collisions, infers vendors from the slug prefix, and converts
  pricing from per-token strings to USD-per-1M-tokens.
- **API panel**: the OpenRouter card now shows
  *"N models · last refreshed Apr 23, 11:42"* with a `Refresh` /
  `Load models` button, error inline, and a `Clear` button that wipes the
  cache and registry slice in one shot.
- **Model popover**: now reads from the registry. Dynamic entries are grouped
  under a separate "OPENROUTER CATALOG · LIVE" heading at the bottom; their
  tag line shows context length and prompt/completion pricing instead of the
  hand-written one-liners we keep for curated models. Curated `or-*` entries
  are auto-hidden when a dynamic duplicate is present.
- **Tests**: added `openrouterCatalog`, `openrouterCache`, and `OpenRouterStore`
  suites; updated `LlmRouter` and `ChatStore` tests to inject a registry.
  39/39 green, 0 lint errors.

## 2026-04-23 — Gemini 3 catalog refresh + model picker restyle

- **Gemini**: replaced the stale 2.5 Pro / 2.5 Flash entries with the current
  Gemini 3 series. Direct Gemini API now exposes `gemini-3.1-pro`
  (`gemini-3.1-pro-preview` — note the original `gemini-3-pro-preview` was
  shut down 2026-03-09 and now resolves to 3.1), `gemini-3-flash`
  (`gemini-3-flash-preview`), `gemini-3.1-flash-image`
  (`gemini-3.1-flash-image-preview`, aka Nano Banana 2), and the still-
  production `gemini-2.5-flash-lite`. The OpenRouter Gemini entry was
  re-pointed to `google/gemini-3-pro-preview`.
- Refreshed `ModelPopover` `META` with new tags / capabilities / star flags
  for the Gemini 3 line, plus filled-in entries for the rest of the catalog
  (Anthropic 4.5–4.7, GPT-5.4 family, Groq GPT-OSS, OR Gemini 3 Pro).
- Updated demo references in `Agent.tsx`, `Usage.tsx`, and `seed.ts` to use
  the new Gemini ids.
- **Restyled the model popover to match the editorial theme.** Dropped the
  glassmorphic `--palette-*` tokens, big shadows, and 12px radius — the
  popover now uses solid `var(--panel)` with a 1px `var(--border)` outline,
  2px corners, and an accent left-bar for the selected row (mirroring the
  sidebar). Section labels are uppercase Geist Mono with 0.12em tracking,
  and the per-model tag line is rendered in italic Source Serif 4 to echo
  the sidebar previews. No more visual mismatch with the rest of the app.

## 2026-04-22 — Model catalog audit

Verified every `providerModelId` against live provider docs and OpenRouter's
`/api/v1/models` response (348 models on 2026-04-22). Findings + fixes:

- **Anthropic**: API uses dashes, not dots. Replaced stale `claude-sonnet-4-5`,
  `claude-opus-4`, `claude-haiku-4` with the current generation:
  `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-opus-4-6`,
  `claude-haiku-4-5`, plus stable `claude-sonnet-4-5`.
- **OpenAI**: added the current GPT-5.4 line (`gpt-5.4`, `gpt-5.4-pro`,
  `gpt-5.4-mini`, `gpt-5.4-nano`); kept `gpt-5` for back-compat. Removed
  `o3` (superseded by GPT-5.4 with `reasoning.effort`).
- **Groq**: removed `mixtral-8x7b-32768` (deprecated 2025-03-20). Added
  the current production menu: `llama-3.1-8b-instant`,
  `openai/gpt-oss-120b`, `openai/gpt-oss-20b`. Kept `llama-3.3-70b-versatile`.
- **Gemini**: kept `gemini-2.5-pro` / `gemini-2.5-flash`, added
  `gemini-2.5-flash-lite`. (Gemini 3.x is still preview-only.)
- **OpenRouter**: dropped the bogus `qwen/qwen-3-235b` slug. Expanded from
  3 → 17 curated entries covering frontier (Claude 4.7, GPT-5.4, Gemini 2.5
  Pro), xAI (Grok 4.20, Grok 4 Fast, Grok Code Fast), open weights (Llama 4
  Maverick/Scout, DeepSeek V3.2 + R1, Qwen3 Max + VL 235B, Kimi K2.6, Mistral
  Large 3 + Medium 3.1), and search (Perplexity Sonar Pro + Reasoning Pro).
- `DEFAULT_MODEL_ID` updated to `claude-sonnet-4.6`.
- `ModelPopover` META, `Usage`, `Agent`, and seed threads all refreshed to
  reference the new ids.
- Pre-existing `react-hooks/set-state-in-effect` lint error in
  `ModelPopover` fixed as a bonus — `setActiveIdx(0)` now happens in the
  search input's `onChange` handler instead of a `useEffect`.

## 2026-04-22 — Model picker overhaul

- Rebuilt `components/editorial/ModelPopover.tsx` as a richer, search-first
  command-palette-style picker while preserving all theme tokens
- New affordances: live filter, keyboard navigation (↑/↓/↵/esc), vendor
  grouping with brand glyphs, model descriptions, capability badges
  (vision / reasoning / fast / tools), price-tier `$` indicators, and a
  recommended `★` flag
- Local-only `META` map in `ModelPopover.tsx` powers descriptions/capabilities;
  no changes to `core/models.ts` so thread-persisted `modelId`s stay stable
- Selected model now shows an accent rail on the left edge instead of a tinted
  background — reads better on every accent palette

## 2026-04-22 — Phase 4: tests + CI gates

- Added Vitest in a top-level `tests/` folder, fully separate from `src/`
- 26 tests across 5 files: `ChatStore`, `ProviderStore`, `persistence`,
  `services/router`, `services/llm/router`
- `tests/helpers/mockProvider.ts` implements the `LlmProvider` contract for
  deterministic store tests
- New scripts: `npm run typecheck`, `npm run test`, `npm run test:watch`,
  `npm run ci` (typecheck → lint → test)
- ESLint config split into `src/` and `tests/` blocks; tests get node globals
- New `tsconfig.test.json` with `vitest/globals + node + vite/client` types

## 2026-04-22 — Phase 3: hash router

- Added `services/router.ts` — pure `parseHash` / `formatHash` + side-effecting
  `read/write/subscribeRoute`
- Added `stores/RouterStore.ts` — observable two-way binding to
  `window.location.hash`
- `RootStore` now wires the router to `ChatStore.activeThreadId` so deep
  links and back/forward buttons work
- `App` reads `router.isMenu` instead of `ui.menuOpen`
- `EditorialSidebar` clicks now navigate via `router.goThread` / `router.goMenu`
- Removed `menuOpen`, `menuSection`, and the `open/close/toggleMenu` API from
  `UiStore` — surface routing is fully owned by `RouterStore`
- Routes: `#/`, `#/thread/<id>`, `#/menu/<section>`

## 2026-04-22 — Phase 2: LLM provider abstraction

- Added `core/llm.ts` — provider-agnostic contract (`LlmProvider`,
  `LlmRequest`, `LlmChunk`, `ProviderId`, `ProviderConfig`)
- Added `core/providers.ts` — `PROVIDERS` info table for the API menu
- Expanded `core/models.ts` — every `Model` now declares its `providerId`
  and `providerModelId`; added v1 catalog entries for Anthropic, OpenAI,
  Google, Groq, OpenRouter, and Local
- Added `services/llm/`:
  - `sse.ts` — minimal SSE parser shared by all HTTP providers
  - `openaiCompat.ts` — base class for OpenAI-shaped `/chat/completions`
  - `openai.ts`, `groq.ts`, `openrouter.ts`, `local.ts` — thin wrappers
  - `anthropic.ts`, `gemini.ts` — bespoke request/response shapes
  - `fake.ts` — offline canned responder (always ready)
  - `router.ts` — `LlmRouter.resolve(modelId)` with fake fallback
  - `index.ts` barrel
- Added `services/providerStorage.ts` — `gatesai.providers.v1` localStorage
- Added `stores/ProviderStore.ts` — owns API keys + the long-lived `LlmRouter`
- `ChatStore.sendMessage` rewritten to use `for await ... of stream` with
  `AbortController`. New `lastError` field surfaces provider failures.
- `ApiSection` is fully wired: paste a key, see the provider connect; reveal,
  rotate, remove. Includes external "Get a key" links per provider.
- Removed the old callback-based `services/fakeLlm.ts` (replaced by
  `services/llm/fake.ts` which implements the same `LlmProvider` interface)

## 2026-04-22 — Phase 1: UI primitives

Extracted recurring inline-style patterns into a dedicated design-system layer.

### Added
- `src/components/ui/` — `Toggle`, `Pill`, `Card`, `Button`, `Input`, `Select`,
  `Textarea`, `SettingsRow`, `SegmentedControl`, plus an `index.ts` barrel
- `src/core/styleTokens.ts` — typography & layout tokens that don't have a
  natural component shape (`h1`, `kicker`, `section`, `sectionTitle`, `mono`,
  `number`, `numberLabel`)

### Changed
- All six menu sections (`Profile`, `Agent`, `Settings`, `Usage`, `Api`,
  `Appearance`) migrated from `menuStyles` + `MenuRow` + `MenuToggle` to the
  new primitives. UI is pixel-identical.
- `Button` got a `variant` API (`default | accent | danger`)
- `Pill` got a `tone` API (`accent | muted`)
- `SegmentedControl` is now a proper generic component (was inline JSX in
  three places)

### Removed
- `src/components/menu/shared.tsx` — fully replaced

### Architecture
- New layer rule: `components/ui/` may only import from `core/` — no stores,
  no features. Feature folders (`editorial/`, `menu/`) compose primitives.

---

## 2026-04-22 — Cleanup & restructure

Full refactor to TypeScript, MobX object models, and a clean three-layer
architecture. UI is pixel-identical to the previous build.

### Removed (dead code)
- Root: `browser-window.jsx`, `design-canvas.jsx`, `GatesAI.html`,
  `Personal AI.html`, `Personal AI Editorial.html`, `uploads/`
- `src/`: `app.jsx`, `composer.jsx`, `sidebar.jsx`, `palette.jsx`,
  `tools.jsx`, `tweaks.jsx`, `message.jsx`, `data.jsx` (split + trimmed),
  `chat-variant.jsx` (split, terminal/workbench variants dropped),
  `gates-menu.jsx` (split, three unused layouts dropped),
  `store.js`, `fake-llm.js`, `icons.jsx`, `variants.jsx`
- `src/assets/` (unused Vite template assets)

### Added
- `src/core/` — `types.ts`, `models.ts`, `theme.ts`, `seed.ts`, `icons.tsx`
- `src/services/` — `persistence.ts`, `fakeLlm.ts`
- `src/stores/` — `ChatStore.ts`, `UiStore.ts`, `RootStore.ts`, `context.tsx`
- `src/components/editorial/` — sidebar, chat panel, message, composer, etc.
- `src/components/menu/` — menu shell + six sections
- `src/app/App.tsx` — composition root
- `docs/` — this folder

### Dependencies
- Added `mobx`, `mobx-react-lite`
- Replaced hand-rolled `useSyncExternalStore` store with MobX object models

### Behavior changes
- Only the Editorial variant ships (Terminal/Workbench were never wired in)
- GatesMenu uses only the `topTabs` layout (the active one)
- `localStorage` key is unchanged (`gatesai.state.v1`), so existing user
  state survives the refactor
