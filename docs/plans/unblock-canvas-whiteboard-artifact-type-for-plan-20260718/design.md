# Canvas/whiteboard artifact type for planning sessions — design & execution plan

*2026-07-18, orchestrator lane `unblock-canvas-whiteboard-artifact-type-for-plan-20260718`.*
*Roadmap item: "Canvas/whiteboard artifact type for planning sessions"
(Moonshots / new directions). IDEAS.md #15 (Impact Low-Med · Effort Med).
Ethan's decision: APPROVED. This doc is the deliverable; source changes go
through the follow-up task specced in `DISPATCH.md` in this folder.*

## Intent

Planning sessions ("map out this feature", "lay out the migration phases",
"what are the options here") today produce prose or, at best, an HTML
artifact. A canvas artifact gives them a spatial form the model can create
and **revise in place**: sticky notes, labeled boxes, arrows, and
frames/lanes — a whiteboard the conversation keeps updating instead of a
wall of regenerated text.

The prize is not a drawing app. It is that the *model* owns the board:
"move auth to phase 2" should be an `update` that shifts one node, exactly
like the HTML-artifact update-in-place contract that already works.

## Required first step: tldraw/excalidraw vs the artifact sandbox (evaluation)

IDEAS #15's stated first step is to evaluate embedding tldraw or excalidraw
**inside the sandboxed artifact webview** against the existing artifact CSP
rules. Verdict: **not viable.** Three independent blockers:

1. **The artifact document CSP forbids it.** `HTML_ARTIFACT_DOCUMENT_CSP`
   (`src/core/htmlArtifactPolicy.ts`) is `default-src 'none'`,
   `connect-src 'none'`, `script-src 'unsafe-inline' 'unsafe-eval'` only —
   no `https:` script source, so loading either library from a CDN inside
   the artifact iframe is blocked, and the model-facing contract already
   mandates a self-contained single file with no external network. (The
   Tauri app-shell CSP tested in `tests/services/tauriConfig.test.ts` does
   allow some CDNs, but that policy governs the app shell, not the artifact
   document policy — the artifact contract deliberately mirrors the
   stricter per-document CSP.) There is also no `worker-src`/`blob:` script
   allowance, and both libraries want workers and font/asset fetches.
2. **The size budget forbids inlining.** A self-contained artifact is capped
   at `HTML_ARTIFACT_MAX_BYTES` = 1 MB. Excalidraw's and tldraw's minified
   bundles are multi-megabyte before fonts; inlining them into every canvas
   artifact busts the cap and would bloat every scene file with a copy of
   the editor.
3. **Licensing (tldraw).** tldraw v2+ ships under its own non-OSS license
   (watermark or paid license key). Excalidraw is MIT. If a library is ever
   bought, it's excalidraw, not tldraw.

That leaves two viable architectures, both rendering **in the app, not in
the artifact iframe**:

- **(A) Excalidraw as an app dependency**: a dock panel mounting
  `@excalidraw/excalidraw`, scenes stored as excalidraw JSON. Full freehand
  editing for the user; but it is a very large new dependency (the repo's
  dependency list is deliberately short, and the workbench program already
  named CodeMirror as "the one new dep this program should buy"), its scene
  schema is verbose and library-versioned (a poor model-facing contract),
  and it drags in a large bundle for Web Lite.
- **(B) Structured scene JSON + small hand-rolled SVG renderer**: the
  artifact *content* is a compact, versioned scene schema this repo owns
  (nodes + edges), validated like HTML artifacts are validated, rendered by
  a ~small SVG component in the dock and in chat.

**Decision: (B) for v1.** The planning-session use case is boxes, stickies,
arrows, and lanes — not freehand ink. LLMs author structured JSON reliably
and freehand vector strokes badly, so (B) is *better* for the actual user
("the model keeps the board current"), not just cheaper. Zero new
dependencies, no CSP or licensing questions, theme-aware rendering for
free, and the scene schema stays a stable contract we own. (A) is the
recorded fallback if real usage demands user-side freeform editing; that
would be a dependency decision for Ethan (ADR + queue item), and the scene
schema below is deliberately simple enough to migrate into excalidraw
elements if that day comes.

## Scene schema (the model-facing contract)

New pure module `src/core/canvasArtifacts.ts`, mirroring
`core/htmlArtifacts.ts` + `core/htmlArtifactPolicy.ts`:

```ts
interface CanvasScene {
  version: 1;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}
interface CanvasNode {
  id: string;                 // unique slug, same charset as artifact ids
  kind: 'sticky' | 'box' | 'text' | 'frame';
  x: number; y: number;       // top-left, abstract canvas units
  w: number; h: number;
  text: string;               // plain text; renderer wraps + clips
  color?: 'yellow' | 'blue' | 'green' | 'pink' | 'purple' | 'gray';
  parent?: string;            // id of a 'frame' node (grouping/lane)
}
interface CanvasEdge {
  id: string;
  from: string; to: string;   // node ids
  label?: string;
  style?: 'solid' | 'dashed';
}
```

Colors are **tokens**, mapped to theme-aware fills in CSS (light + dark),
never raw hex from the model.

`validateCanvasScene(raw: string): { scene } | { issues: string[] }` is the
whole validation gate — deterministic, no smoke render needed (there is no
script execution; that is a feature). Rules:

- parses as JSON, `version === 1`, arrays present;
- ids unique across nodes and edges; edge `from`/`to` reference existing
  nodes; `parent` references a `frame` node, and frames have no `parent`
  (flat one-level grouping — no cycles possible);
- finite coordinates within ±100 000; `w`,`h` in [1, 10 000];
- caps: ≤ 400 nodes, ≤ 400 edges, ≤ 2 000 chars per `text`/`label`,
  `CANVAS_ARTIFACT_MAX_BYTES` = 256 KB (warn at 64 KB) — mirrors the HTML
  size-policy shape;
- unknown `kind`/`color`/`style` values rejected (closed enums, versioned).

Scene text is **data, never instructions** — it is rendered as SVG text
nodes, never as HTML/markdown, so a scene cannot inject markup or script.
No new security surface: no iframe, no CSP change, no exec, no network.

## Storage & registry

Mirror the HTML layout exactly:

- Files: `/workspace/artifacts/canvas/<id>.json`; index:
  `/workspace/artifacts/canvas/index.json` with records
  `{ id, title, threadId, createdAt, updatedAt, revision, sizeBytes }`.
- `src/services/artifacts/artifactRegistry.ts` generalizes its load/write
  helpers over a root + index path (keep the existing `loadHtmlArtifactIndex`
  / `writeHtmlArtifactIndex` exports stable; add canvas twins). Stable slug
  ids via the existing `nextHtmlArtifactId` logic, shared.
- `ArtifactStore` loads both indexes and exposes canvases alongside HTML
  artifacts for gallery/dock/palette.
- Workspace-file storage only — **no IDB persistence schema change, so no
  migration or `schemaVersion` bump** is needed.

## Tool contract

Extend the existing `artifact` tool (`src/services/tools/artifact.ts`) —
one deliverable system, not a second tool:

- `create_canvas_artifact` — `{ title, content }` where `content` is the
  scene JSON string (reuses the existing strict-schema `content` param).
  Validates via `validateCanvasScene`, assigns id, writes file + index,
  refreshes `ArtifactStore`, opens the dock panel via `artifactSurface`
  (same post-create flow as HTML).
- `update_canvas_artifact` — `{ id, content }`; same id ⇒ bump revision,
  rewrite, update index. Update-in-place rules identical to HTML.
- `list_artifacts` — now returns both registries; each record gains
  `type: 'html' | 'canvas'` (index files on disk stay separate and
  unversioned-change-free; only the tool's merged view is new).
- Validation failures log to the error trail via the existing
  `logArtifactFailure` path with `phase: 'static'`.
- `src/services/prompts/artifactContract.ts`: bump
  `ARTIFACT_CONTRACT_VERSION` to 2 and append a canvas section — schema
  sketch, the closed enums, caps, "canvas for spatial planning boards, HTML
  for documents/apps", and the same create-once/update-in-place rule.
  Snapshot test updated deliberately (existing pattern).

## Surfaces

- **Dock panel** (primary): new `DockPanelKind` `'canvas-artifact'`
  (`src/core/dock.ts` union + `panelRegistry.tsx` entry + new
  `components/dock/CanvasArtifactPanel.tsx`), params `{ id }`,
  `requiresBridge: true` like `html-artifact`. Loading a persisted dock
  snapshot with the new kind on an old build is already safe (unknown kinds
  are dropped on load — verify in `dockStorage` tests).
- **In-chat preview**: `components/editorial/CanvasArtifactPreview.tsx`
  mirroring `HtmlArtifactPreview` wiring — renders the scene inline after
  create/update, with "Open in dock". Same renderer component underneath.
- **Renderer** (shared by panel + preview): one SVG component. v1: auto-fit
  viewBox on open, wheel/drag pan-zoom, fit button, nodes (sticky/box/text,
  frames drawn behind children with title), edges as straight lines with
  arrowheads + optional labels, theme-token colors. **Read-only in v1** —
  the model is the editor; user editing is the explicitly cut line (below).
- **Gallery / palette**: gallery's artifact tab and the palette's "Open
  artifact…" list include canvases (type badge), from `ArtifactStore`.

## Web Lite

Same posture as HTML artifacts: the tool is bridge-gated (`requireBridge`),
the dock panel is hidden (`requiresBridge: true`), and Web Lite shows the
existing degradation notices. No half-working surface.

## Execution slices (all in the one follow-up task; C is the cut line)

- **A — contract core**: `core/canvasArtifacts.ts` (types, validation,
  policy constants), registry generalization, tool actions, contract prompt
  v2. Fully unit-testable without UI.
- **B — surfaces**: renderer + dock panel + in-chat preview + gallery/
  palette listing + dock kind.
- **C (optional, cuttable)**: user drag-to-move with explicit Save
  (writes through `ArtifactStore` → bridge, bumps revision). If the task
  runs long, C ships as a roadmap follow-up instead — v1 is complete
  without it.

## Testing

- Unit: `validateCanvasScene` accept/reject matrix (dupe ids, dangling
  edges, non-frame parent, caps, byte limits); registry round-trip for the
  canvas index; tool create/update/list including update-in-place revision
  bump and error-trail logging; contract prompt snapshot + version-bump
  assertion; renderer component render + fit/pan basics; dock registry
  entry + unknown-kind snapshot load.
- E2e (desktop-mocked): create canvas → inline preview renders → opens in
  dock → update moves a node → preview reflects revision 2.
- Known state: one **pre-existing** e2e failure exists on master
  (artifactContract palette→dock iframe — filed in roadmap, changelog
  2026-07-18). Don't chase it; don't add to it.

## Risks & non-goals

- *Schema too weak for real boards* → closed v1 enums + `version` field
  give a cheap migration path; excalidraw remains the recorded fallback.
- *Renderer scope creep (mini-Figma)* → v1 is read-only + pan/zoom; any
  editing beyond slice C is a new roadmap item.
- Non-goals: freehand ink, image nodes, multi-select, collaboration,
  export-to-PNG (all Later at most).
