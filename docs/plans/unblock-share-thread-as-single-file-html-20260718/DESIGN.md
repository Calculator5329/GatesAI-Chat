# Share thread as single-file HTML

> **Decision status:** APPROVED by Ethan (authoritative).
>
> **Roadmap source:** `docs/roadmap.md` item "Share thread as single-file HTML".

## Context

The product currently persists chats and emits a readable chat library into
`/workspace/chat-history`.
`saveReadableChatLibrary()` already renders per-thread conversation HTML for
on-disk browsing, but sharing is not a single-thread, single-file workflow for a
specific thread.

Goal:
for an active or selected thread, create a one-click flow that exports that
conversation as one standalone HTML file the user can share and open independently
of the app.

## Outcome

Users can share a thread from the thread UI and immediately get a self-contained
`.html` file in their clipboard or download prompt with:

- thread title, created/updated timestamps, and thread id
- complete message transcript in order
- attachments list + tool-call/result summaries
- an embedded raw transcript for searchability
- no dependency on app runtime or bridge APIs when opened

Desktop and Web Lite both use the same pure render path.

## UX contract

1. Thread sharing action is available from a standard thread surface:
   - sidebar context menu / row actions for the selected thread
   - command-palette action (optional for power users)
2. Share action always targets the currently selected thread object in the in-memory
   chat state.
3. If the browser has a write-capable clipboard and the operation succeeds,
   copy plain HTML text and indicate success.
4. If clipboard is unavailable or permission-limited, fall back to a file
   download with deterministic filename:
   `gatesai-thread-<safe-title>-<thread-id>.html`.
5. The generated HTML must not require external fonts, scripts, or network
   fetches.
6. For very large transcripts, still generate output (bounded only by browser
   constraints) and report a clear, non-lossy failure if serialization is
   impossible.

## Non-goals

- Does not create hosted/public web links.
- Does not change chat persistence schema.
- Does not replace the existing chat-history library.
- Does not inline binary attachments into the export (attachments remain
  reference text in the transcript).

## Technical design

### 1) Pure renderer for a single thread

Create a dedicated share renderer in `src/services/chat/threadShare.ts`:

- `renderThreadShareHtml(thread, savedAt, options)`
  - Takes one `Thread` and returns `string` HTML.
  - Reuses thread/message helpers from existing library export (`messageText`,
    `messageToolCalls`, `messageToolResults`, etc.) to keep message semantics
    aligned.
  - Keeps message rendering pure and does not touch the bridge.

- `threadShareFilename(thread)`
  - Stable, deterministic name and collision-safe.

- `serializeThreadShareHtml(thread)` helper
  - Returns `{ filename, html }` for testing and consumer use.

### 2) Share service contract (UI-facing)

Add or extend a share helper that

- selects the target thread via active thread id
- writes a safe one-file HTML export payload from the current thread snapshot
- chooses copy-vs-download path:
  - `navigator.clipboard.writeText(html)` when possible
  - fallback `Blob` download otherwise

This stays in a pure service file so behavior is testable without touching
component internals.

### 3) Thread UI entry points

- In `src/components/editorial/EditorialSidebar.tsx` thread context menu,
  add a new action row: **Share as HTML**.
- Keep it disabled/inactive for read-only threads.
- The action should always target that row's thread, not the currently
  rendering chat unless both are the same.

Optional secondary entrypoint:

- mobile topbar share control (`/thread/` mobile header) can call the same service
  and keep existing hash-copy behavior as fallback only when sharing is unavailable.

### 4) Optional discovery in command palette

- Add one action item in `src/components/palette/CommandPalette.tsx`:
  **Share thread as HTML**.
- Run only when there is an active thread.

### 5) Reuse and harden existing styles/content pipeline

Prefer extracting shared style/text helpers from `libraryExport.ts` where useful
instead of introducing a third rendering style layer. New share output must be
self-contained and not include external `<link rel=` stylesheet/script references.

## Testing and acceptance

Source changes should add/adjust tests around:

1. Pure HTML output shape and metadata from the new share renderer.
2. Clipboard/download fallback behavior.
3. Sidebar/action path for the chosen active thread only.
4. No regressions in chat-library rendering and persistence behavior.

Acceptance is complete when:

- generating share HTML from a thread succeeds and contains thread/message payload,
- generated file is valid standalone HTML and opens outside the app,
- existing chat library tests and persistence tests remain green,
- no network call is required for the exported file to render its base content.

## Risks / stop conditions

Stop and re-baseline if:

- existing `libraryExport` renderer cannot be extracted safely and duplicate logic
  grows past acceptable size.
- exported HTML must pull remote dependencies to match current visuals; in that
  case, tighten design to a functional minimal layout first.
- clipboard and file-save behavior diverges across desktop/web-lite without a
  deterministic fallback.
