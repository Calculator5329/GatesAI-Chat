# W-1 completion plan — right-dock code editor

Date: 2026-07-18  
Decision input: **APPROVED**  
Canonical item: `docs/roadmap.md` → **W-1: Right dock panel framework**  
Implementation handoff: [DISPATCH.md](./DISPATCH.md)  
Dependency decision: [ADR-CODEMIRROR-6.md](./ADR-CODEMIRROR-6.md)

## Outcome

Finish the one missing panel named by the canonical W-1 item: a small,
workspace-jailed code editor for JavaScript, TypeScript, JSON, Markdown, and
HTML. It uses the shipped `DockStore`, two-cell shell, panel registry, bridge
filesystem contract, Web Lite gate, and persistence slot. It does not create a
second layout system, a tabbed IDE, or new bridge authority.

After this source slice ships, W-1 can close. The terminal panel is not part of
this closure: the parent workbench design assigns terminal work to Phase 3, and
an interactive terminal requires a separately versioned PTY operation in the
sibling bridge repository. Folding that authority expansion into a UI-panel
task would violate this repo's sibling-repo boundary and W-1's stated panel
list.

Roadmap disposition for this planning lane: **keep W-1 open until the source
dispatch passes its gate; then mark W-1 complete and track interactive PTY as a
separate item.**

## What already exists

The plan is based on the current tree, not the original 2026-07-12 sketch:

- `DockStore` already persists two cells, split ratio, width ratio, and the
  collapsed state in `gatesai.dock.v1`.
- The shell already resizes, swaps, collapses, restores, closes, and hides on
  mobile/Web Lite.
- The registry already hosts file viewer, file explorer, media viewer, HTML
  artifact, Offline Library, and Task Center panels.
- File viewing, sandboxed HTML, media viewing, the read-only explorer, artifact
  auto-open, task-center rendering, palette entry points, and their tests have
  shipped.
- The bridge already exposes jailed `fs.read`, `fs.stat`, and `fs.write`. No
  bridge protocol change is needed for explicit text-file saves.

The remaining source work is therefore one bounded editor slice, not a rebuild
of the dock framework.

## Scope

### In

- A new persisted dock kind, `code-editor`, with `params.path`.
- Explicit edit entry points:
  - `Edit file in dock…` in the desktop command palette.
  - A compact `Edit` action beside eligible files in File Explorer; the row's
    primary action remains read-only viewing.
- UTF-8 editing for `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts`,
  `.tsx`, `.json`, `.md`, `.markdown`, `.html`, and `.htm`.
- CodeMirror 6 syntax support, line numbers, selection, history, indentation,
  bracket matching, and ordinary keyboard editing.
- Explicit `Save` plus Ctrl/Cmd+S. No autosave.
- Best-effort external-change detection using the file's `mtime` + `size`
  fingerprint before overwrite.
- Clear loading, clean, dirty, saving, saved, offline, write-error, too-large,
  unsupported, and conflict states.
- An unsaved-change guard for dock close, panel replacement, cell promotion,
  cell swap, and browser/window unload.
- Lazy loading so CodeMirror is absent from the initial app chunk.
- Component, store, service, persistence, palette, and desktop-mocked E2E
  coverage.

### Out

- Tabs inside a dock cell, multi-file sessions, split editor panes, or a file
  tree inside the editor.
- LSP, remote language servers, formatting, lint runners, minimap, debugger,
  terminal, Git decorations, extensions, Vim mode, or AI completion.
- Binary files, files over 1 MiB, non-UTF-8 writes, rename/move/delete, and
  directory creation.
- Editing `/workspace/attachments/**`, `/workspace/.gatesai/chat/**`, or
  `/workspace/chat-history/**`. Those remain read-only/app-managed.
- Web Lite support. The whole v1 dock remains desktop-only and must make no
  bridge request in Web Lite.
- A bridge protocol or persistence-schema version bump.

## Visual decision

The required divergent layout round is preserved at
[mockups/code-editor-layouts.png](./mockups/code-editor-layouts.png) (1536 ×
1024, SHA-256 `924d1bca8525303b6f280a1ddfa41c673e1fb5e0a023274059aec1a4a7495986`).
The exact built-in generation prompt is preserved in
[MOCKUP-PROMPT.md](./MOCKUP-PROMPT.md).

| Variant | Difference | Verdict |
| --- | --- | --- |
| A | Minimal top path/status/save toolbar | **Selected foundation** |
| B | Persistent bottom status rail | Reject: too much IDE chrome for a narrow cell |
| C | Source/preview split | Reject: consumes the second reading surface inside one cell |
| D | Command-palette-first toolbar | Reject: hides the single primary action behind ceremony |
| E | Persistent dirty-state ribbon | Reject: warning weight is too loud during ordinary typing |
| F | Bottom error/conflict rail | Select only for exceptional error/conflict states |

The shipped composition combines A's quiet top toolbar with F's inline recovery
rail only when something needs attention:

```text
┌ code.ts · dock header                              swap collapse close ┐
├ /workspace/notes/code.ts                 Unsaved             Save ┤
│  1  export function ...                                       │
│  2  ...                                                       │
│                                                               │
├ Conflict: the file changed on disk.              Reload  Overwrite ┤
└────────────────────────────────────────────────────────────────┘
```

At 11pm, when Ethan is tired, the editor should feel like a sheet of code that
happens to be editable—not an IDE asking to be managed. The file path is quiet,
`Save` is the only persistent command, clean state recedes, dirty state uses a
small amber word, success uses muted emerald briefly, and red appears only for
an actionable failure.

### Mockup-generation record

The built-in image generator produced a single six-option contact sheet using
the `ui-mockup` taxonomy. The prompt required a dark charcoal editorial
workbench, narrow one-cell editor, realistic code, divergent toolbar/status/
conflict arrangements, and explicitly excluded tabs, file trees, terminal,
LSP popovers, browser chrome, neon styling, and dense IDE controls.

## Interaction contract

### Open and load

1. A user explicitly chooses `Edit`; ordinary file clicks still open the
   read-only viewer.
2. `DockStore.openEditor(path, cell?)` trims the path and opens
   `{ kind: 'code-editor', params: { path } }` only in desktop mode.
3. The editor facade validates the `/workspace/...` namespace, editable
   extension, protected/read-only trees, bridge state, and 1 MiB limit.
4. The facade obtains `fs.stat`, then `fs.read`, and returns content plus the
   `{ mtime, size }` baseline. File content must never enter logs.
5. The panel mounts one `EditorView` and destroys it on path change/unmount;
   React Strict Mode double-mount must not leak a view or listener.

### Edit and save

- The CodeMirror update listener derives dirty state by comparing the current
  document with the last successfully loaded/saved content.
- `Save` and Ctrl/Cmd+S invoke the same idempotent async action. Repeated input
  while a save is in flight does not start concurrent writes.
- A normal save stats the file again. If `mtime` or `size` differs from the
  baseline, the facade returns `conflict` and does **not** call `fs.write`.
- `Reload` asks before discarding a dirty draft, then reads the current disk
  value and establishes a new baseline.
- `Overwrite` requires a second explicit confirmation, performs one forced
  UTF-8 `fs.write`, re-stats the file, and establishes a new baseline.
- A write failure or bridge disconnect keeps the in-memory draft and dirty
  state. Retry remains possible when the bridge is online again.
- The stat-then-write check is best-effort rather than atomic; the UI and docs
  must not claim transactional conflict protection. True compare-and-swap
  would require a future bridge contract.

### Close and replacement safety

`DockStore` gains an ephemeral per-cell close/replacement guard registration.
The editor registers a guard while dirty. `closeCell()` and any `openPanel()`
that would replace an occupied editor invoke that guard before mutating cells.
Guard registrations move with `swapCells()` and cell-1 promotion; they are
never persisted. The panel also installs a standard `beforeunload` dirty-draft
warning and removes it on cleanup.

This keeps every existing dock entry point safe without teaching palette,
gallery, artifact tools, or settings about editor internals.

## Technical design

### Dependency and loading

Use the direct CodeMirror 6 packages accepted in
[ADR-CODEMIRROR-6.md](./ADR-CODEMIRROR-6.md). Do not add a React wrapper or a
theme package. Register `CodeEditorPanel` with `React.lazy`; `DockPanel` wraps
panel bodies in `Suspense` with the existing quiet loading notice. The editor
and language parsers must live in a lazy chunk loaded only when the panel is
opened.

### Layering

```text
CodeEditorPanel / FileExplorerPanel / CommandPalette
                  │
                  ▼
       DockStore + BridgeStore facades
                  │
                  ▼
 services/bridge/workspaceTextDocument.ts
                  │
                  ▼
       BridgeClient fs.stat/read/write
```

- UI imports stores/core only.
- `DockStore` owns layout and transient cell guards, not file content.
- `BridgeStore` exposes narrow read/save facade methods and logs only path,
  operation, and error metadata.
- `workspaceTextDocument.ts` owns validation, 1 MiB limit, fingerprint
  comparison, and bridge operation ordering.
- Pure extension/language classification stays in `core/dock.ts`.

### Persistence compatibility

Add `code-editor` to `DockPanelKind` and `isDockPanelKind`. The existing v1
snapshot parser then restores `{ kind: 'code-editor', params: { path } }`
without a schema change. Older app versions safely drop the unknown cell when
reading the same snapshot, so a version bump or migration adds no value.
Draft text, fingerprints, errors, and dirty flags are transient and must never
be written to `gatesai.dock.v1`.

## Execution sequence

1. Add the accepted CodeMirror dependency family and lockfile; record license
   and lazy-chunk output in the implementation ADR.
2. Extend pure dock kinds/editable-language helpers and persistence tests.
3. Add the workspace text-document service and BridgeStore facade with path,
   protected-tree, size, offline, conflict, force-write, and redacted-logging
   tests.
4. Add DockStore's editor entry point and cell guard lifecycle with tests for
   replacement, close, swap, and promotion.
5. Build the lazily loaded editor panel and its selected quiet layout.
6. Add palette and explorer entry points without changing primary file-view
   behavior.
7. Add the stateful desktop bridge mock and one edit→dirty→save E2E flow.
8. Update architecture, changelog, and the final ADR evidence; run the exact
   dispatch gate.

## Acceptance criteria

- Opening an eligible file from palette or explorer renders syntax-highlighted
  editable text in the dock and leaves ordinary file viewing unchanged.
- JS/TS (including JSX/TSX), JSON, Markdown, and HTML select the right language
  support; unsupported/read-only/oversize paths never mount CodeMirror.
- Save and Ctrl/Cmd+S write exact UTF-8 content through the BridgeStore facade;
  empty files are valid.
- Clean, dirty, saving, saved, offline, error, and conflict states are visible
  and keyboard accessible at narrow dock widths and in dark/light themes.
- External fingerprint mismatch performs zero writes until explicit
  `Overwrite`; `Reload` and failed saves never silently discard the draft.
- Closing or replacing a dirty cell prompts; cancel leaves both the cell and
  draft unchanged. Swap/promotion preserve the correct guard.
- Web Lite exposes no edit entry point and performs zero bridge calls.
- `gatesai.dock.v1` persists the editor path but never its content or dirty
  state; corrupt/old snapshots still fall back safely.
- CodeMirror and all language packages are lazy and absent from the initial
  entry chunk.
- No raw `fetch`, `localStorage`, `console`, service import from UI, bridge
  protocol change, Rust change, or sibling-repo change is introduced.
- The exact command in `DISPATCH.md` is green.

## Verification caveat

This sandbox cannot bind the Vite/Playwright listener. The implementation lane
must run the Playwright portion in the orchestrator's normal outside-sandbox
verification environment rather than weakening or skipping the test.
