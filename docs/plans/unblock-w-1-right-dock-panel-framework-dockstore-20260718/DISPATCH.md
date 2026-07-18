# Follow-up source dispatch

## Task

**Title:** W-1.3 — Ship the safe CodeMirror dock editor

**Goal:** Complete W-1 by adding a lazily loaded CodeMirror 6 editor panel for
jailed workspace JS/TS/JSON/Markdown/HTML files. Preserve the shipped dock,
viewer, explorer, persistence, desktop/Web Lite boundaries, and calm editorial
UI. Saves are explicit, conflict-aware, draft-safe, and mediated by
`BridgeStore`; no bridge protocol, sibling-repo, terminal, LSP, or persistence
schema change is allowed. Implement every acceptance criterion in `PLAN.md`
and the dependency decision in `ADR-CODEMIRROR-6.md`.

**Repo:** `ai/gatesai-chat`

**Depends on:** none. Existing bridge protocol v2 already has jailed
`fs.stat`, `fs.read`, and `fs.write`.

## Owns

Claim these literal repo-relative paths/prefixes before editing:

```text
package.json
package-lock.json
src/core/dock.ts
src/services/bridge/workspaceTextDocument.ts
src/services/storage/dockStorage.ts
src/stores/BridgeStore.ts
src/stores/DockStore.ts
src/components/dock
src/components/palette/CommandPalette.tsx
src/styles/dock.css
tests/services/bridge/workspaceTextDocument.test.ts
tests/services/storage/dockStorage.test.ts
tests/stores/BridgeStore.test.ts
tests/stores/DockStore.test.ts
tests/components/dock
tests/components/palette/CommandPalette.test.ts
tests/e2e/dock.spec.ts
tests/e2e/fixtures/harness.ts
docs/adr/2026-07-18-codemirror-dock-editor.md
docs/architecture.md
docs/changelog.md
```

Do not claim or edit `docs/roadmap.md`; the harvesting session owns the
canonical checkbox transition after verified source completion.

## Required implementation

1. Install only the eight official CodeMirror packages listed in the ADR. Add
   no React wrapper or theme package.
2. Add `code-editor` to the dock kind/parser, `openEditor(path, cell?)`, and
   persisted-path coverage without changing `DOCK_SNAPSHOT_VERSION`.
3. Add an ephemeral per-cell close/replacement guard to `DockStore`; guards
   must block mutation on cancel and move correctly on swap/promotion.
4. Add `workspaceTextDocument.ts` and narrow BridgeStore facades for validated
   load/save. Enforce `/workspace`, eligible extensions, 1 MiB maximum,
   read-only attachments, protected chat/app history, bridge availability,
   `mtime`+`size` conflict detection, explicit force overwrite, and content-
   free logs.
5. Register `CodeEditorPanel` with `React.lazy` and a quiet `Suspense` fallback.
   Mount/destroy `EditorView` safely under React Strict Mode. Keep the selected
   A-layout toolbar and exceptional-only F-layout recovery rail from the plan.
6. Add explicit desktop-only palette and File Explorer edit actions. Primary
   explorer row clicks must still use the read-only viewer. Hide edit affordance
   for unsupported/read-only files and all Web Lite/mobile contexts.
7. Cover language mapping, empty content, dirty/save/Ctrl+S, offline/error,
   oversize, conflict/reload/overwrite, cleanup, dirty close/replacement,
   persistence, palette/explorer routing, Web Lite no-op, and exact bridge op
   order. Extend the mocked bridge statefully and add an edit→save E2E.
8. Copy the accepted decision into the repo ADR, update architecture/changelog,
   and record the resolved package versions plus initial/lazy gzip chunk sizes.

## Acceptance

- All acceptance criteria in `PLAN.md` pass.
- CodeMirror is absent from the initial entry chunk and the editor lazy chunk
  is at most 300 KiB gzip.
- Tests assert that conflict, cancel, invalid paths, protected paths, oversize
  files, and Web Lite issue no unauthorized `fs.write`.
- No file content appears in diagnostics, dock persistence, or test snapshots
  intended as logs.
- No terminal/PTTY, Rust, Go bridge, sibling repo, dependency beyond the
  accepted family, or roadmap edit is present.

## test-cmd

Run from the repo root:

```sh
npm run ci && npm run build && npx playwright test tests/e2e/dock.spec.ts --project=desktop-mocked
```

The Playwright command needs the orchestrator's outside-sandbox verifier because
the Codex workspace sandbox cannot bind the Vite listener. Do not weaken or
skip it inside a sandboxed lane.
