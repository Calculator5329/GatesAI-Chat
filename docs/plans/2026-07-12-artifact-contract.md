# W-2 implementation plan — HTML artifact contract

Parent design: `2026-07-12-workbench-vision-design.md` (Phase 2). Goal: make
HTML artifacts a tracked, validated, updatable contract instead of one-off
files. Depends on W-1 only for the dock panel (registry/prompt work is
independent).

## 1. Versioned system-prompt block

- `src/services/prompts/artifactContract.ts` exports
  `ARTIFACT_CONTRACT_VERSION` and `artifactContractPrompt()` — the single
  source for what the model is told: self-contained single HTML file, no
  external network (mirror the EXACT CSP the preview iframe enforces —
  derive both from one constant so they cannot drift), size budget
  (warn > 256 KB, reject > 1 MB), and update-in-place semantics ("reuse the
  artifact id to revise; never create art-2 for a fix to art-1").
- The chat system prompt assembly includes this block whenever the artifact
  tool is enabled; snapshot-test the rendered block so contract edits are
  deliberate (version bump asserted).

## 2. Artifact registry

- Files stay under `/workspace/artifacts/html/<id>.html`; new sidecar index
  `/workspace/artifacts/html/index.json` maintained by the artifact tool:
  `{ id, title, threadId, createdAt, updatedAt, revision, sizeBytes }`.
- `artifact` tool actions gain `update_html_artifact` (same id → bump
  revision, rewrite file, update index) and `list_artifacts`. Creation
  assigns stable slug ids (`sanitize(title)-<n>`).
- `ArtifactStore` (new, small): loads the index via bridge, exposes
  observables for gallery/dock; gallery's artifact tab reads it instead of
  scanning the folder.

## 3. Validation as the gate

- Keep the existing static `validate_html`; add a smoke render: load the
  candidate HTML in the same sandboxed iframe policy used for display
  (hidden, timeboxed ~3s), capture `window.onerror`/CSP violations, and fail
  creation with the collected errors so the model can fix and retry.
- Failures append to the error trail (`errors-*.jsonl`) with the artifact id
  and revision — the data feed for "which artifact patterns keep breaking".

## 4. Surfaces

- Artifacts open in the dock's artifact panel (W-1 registry kind
  `html-artifact`, params `{ id }`); the in-chat preview stays.
- Palette: "Open artifact…" listing from the registry.

## Tests / done

Unit: contract snapshot + version bump, registry index round-trip and
migration from an index-less folder, update-in-place revision logic, smoke
validator catches a throwing artifact. E2e: create → render → update flow on
desktop-mocked. Docs: architecture section + changelog + roadmap tick.
