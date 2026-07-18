# DISPATCH — follow-up implementation task

Source changes are required; this lane's lease covered only the plan
folder. Dispatch the following task to implement the design in
`design.md` (same folder).

## Task spec

- **title**: Canvas artifact type v1 — scene contract, tool actions, dock/chat renderer
- **model tier**: smart
- **suggested cap**: $25 (complex multi-file; per spend norms)
- **goal**: |
    Implement the canvas/whiteboard artifact type per
    docs/plans/unblock-canvas-whiteboard-artifact-type-for-plan-20260718/design.md
    (read it first; it is the authoritative design — decision already made:
    structured scene JSON + hand-rolled SVG renderer, NO tldraw/excalidraw
    dependency, no artifact-CSP changes).

    Scope (slices A + B of the design; slice C is cuttable):
    1. `src/core/canvasArtifacts.ts`: CanvasScene v1 types, policy constants
       (256 KB max / 64 KB warn, ≤400 nodes, ≤400 edges, ≤2000 chars text),
       and `validateCanvasScene` per the design's rules (closed enums,
       unique ids, referential integrity, flat frame grouping, finite
       bounds). Pure, dependency-free.
    2. Generalize `src/services/artifacts/artifactRegistry.ts` over a
       root/index path; add the canvas registry at
       /workspace/artifacts/canvas/ (files `<id>.json`, `index.json`);
       keep existing html exports and behavior stable.
    3. Extend the `artifact` tool: `create_canvas_artifact` (title +
       content = scene JSON string), `update_canvas_artifact` (id +
       content, revision bump), `list_artifacts` returns both registries
       with a `type: 'html'|'canvas'` field per record. Validation failures
       log via the existing error-trail path. Bridge-gated as today.
    4. `src/services/prompts/artifactContract.ts`: bump
       ARTIFACT_CONTRACT_VERSION to 2, append the canvas contract section;
       update the snapshot test deliberately.
    5. Surfaces: shared read-only SVG scene renderer (auto-fit, pan/zoom,
       theme-token colors, text rendered as SVG text — never HTML);
       `CanvasArtifactPanel` behind new DockPanelKind 'canvas-artifact'
       (requiresBridge: true) in `src/core/dock.ts` + `panelRegistry.tsx`;
       in-chat `CanvasArtifactPreview` mirroring HtmlArtifactPreview with
       "Open in dock"; ArtifactStore loads both indexes; gallery artifact
       tab + palette "Open artifact…" include canvases.
    6. Tests per the design's Testing section (unit matrix + one
       desktop-mocked e2e: create → preview → dock → update → revision 2).
    7. Docs: architecture.md artifact section updated, changelog entry,
       tick the roadmap item "Canvas/whiteboard artifact type for planning
       sessions" with a dated note; update the artifact-related user-guide
       claim only if one exists.

    Constraints: no new dependencies; no changes to
    htmlArtifactPolicy CSP or any security surface; no IDB schema
    change/migration (workspace files only); Web Lite degrades by hiding
    the tool/panel exactly like html-artifact; respect layer boundaries
    (core → services → stores → components). Known pre-existing e2e
    failure (artifactContract palette→dock iframe) is on master — do not
    chase it and do not add new failures.
- **owns**:
    - src/core/canvasArtifacts.ts
    - src/core/dock.ts
    - src/services/artifacts/
    - src/services/tools/artifact.ts
    - src/services/prompts/artifactContract.ts
    - src/stores/ArtifactStore.ts
    - src/components/dock/
    - src/components/editorial/
    - src/components/palette/CommandPalette.tsx
    - src/components/menu/sections/Gallery.tsx
    - tests/
    - e2e/ (or the repo's Playwright spec dir)
    - docs/architecture.md
    - docs/changelog.md
    - docs/roadmap.md
- **test-cmd**: `npm run ci && npm run test:e2e`

## Notes for the dispatcher

- No bridge-repo work is needed (existing `fs.*` ops suffice), so no
  sibling-repo task.
- Slice C (user drag-to-move + save-back) is explicitly cuttable: if the
  implementer cuts it, they must add it as a new roadmap checkbox instead.
- No Ethan gate required: no new dependency, no schema migration, no
  security-model change, no deploy. If the implementer concludes a
  dependency IS needed after all, that is a stop-and-queue, not a buy.
