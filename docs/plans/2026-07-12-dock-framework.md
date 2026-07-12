# W-1 implementation plan — right dock panel framework

Parent design: `2026-07-12-workbench-vision-design.md` (Phase 1). This plan
covers the **framework + read-only panels**; the code editor (CodeMirror ADR)
and file explorer land in a follow-up lane once the shell is proven.

## Slice 1 — DockStore + shell (this lane)

- `src/stores/DockStore.ts`: observable `{ cells: [PanelRef|null, PanelRef|null],
  splitRatio: number, dockRatio: number, collapsed: boolean }`;
  `PanelRef = { kind: 'file-viewer'|'media-viewer', params: { path?: string } }`.
  Actions: `openPanel(kind, params, cell?)` (defaults: first empty cell, else
  cell 0), `closeCell(i)`, `swapCells()`, `setCollapsed`, `setSplitRatio`,
  `setDockRatio`. Persist via the ui-prefs pattern (own storage slot
  `services/storage/dockStorage.ts`, versioned snapshot, corrupt → defaults).
- Panel registry `src/components/dock/panelRegistry.tsx`: maps kind →
  `{ title, icon, Component }` — same registration shape as the tool registry.
- `src/components/dock/DockPanel.tsx` shell: renders right of the chat column
  in the app layout; column resizer on its left edge; cell divider when both
  cells are occupied; per-cell header (icon, title, swap, close). Collapsed
  state renders a thin reopen rail. Mobile (`MOBILE_SHELL_QUERY`): dock
  hidden entirely in v1.
- Layout integration: the chat column keeps its current centered max-width;
  the dock takes `dockRatio` of the remaining width. No changes to sidebar.

## Slice 2 — first panels (this lane)

- `FileViewerPanel`: bridge `fs.read` by path; render markdown through the
  existing markdown chunk components, JSON pretty-printed (collapsible via
  `<details>` per top-level key is enough for v1), plain text in a `<pre>`,
  HTML in the same sandboxed iframe policy as `HtmlArtifactPreview` (reuse
  its sandboxing helper, do not fork it). Errors render in-panel, logged
  to the error trail.
- `MediaViewerPanel`: images via the existing workspace-image resolution
  (`WorkspaceImage` machinery), video/audio via native elements with
  controls.
- Entry points: command palette action ("Open file in dock…" — prompt for a
  workspace path in v1), plus `dock.openPanel` calls from the gallery item
  menu ("Open in dock").
- Web Lite: `DockStore` exists; panels that need the bridge register a
  capability flag and the "+"/palette entries hide when unavailable
  (`core/runtime.ts` gating, consistent with existing feature gates).

## Boundaries & tests

- Layer rules: components → stores (`useDockStore` hook in context.tsx) →
  services. No direct service imports from dock components.
- Tests: DockStore unit tests (open/close/swap/persist/corrupt-snapshot),
  dockStorage round-trip, panel registry lookup, FileViewerPanel content-type
  dispatch (mocked bridge), and one e2e that opens a markdown file in the
  dock on the desktop-mocked project.
- Definition of done: `npm run ci` + `npm run test:e2e` green; architecture
  doc gains a Dock section; changelog entry; roadmap W-1 updated.

## Slice 3 — follow-up lane (NOT this lane)

CodeMirror-based editor panel (dependency ADR first), basic file explorer
(`fs.list`), terminal panel (blocked on bridge pty op — sibling-repo task).
