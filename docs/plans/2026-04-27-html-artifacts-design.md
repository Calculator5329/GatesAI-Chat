# HTML Artifacts — Design

Date: 2026-04-27

## Goal

Let the model return self-contained, interactive HTML/CSS/JS artifacts that
render inline in the chat — Claude.ai-style Artifacts, scoped to the local
Tauri app. Mini-tools, calculators, visualizations, demos. Eventually these
become saveable/reusable assets in their own gallery (deferred).

## Tool: `artifact`

One registry tool with two modes:

- `create` — `{ title, html, summary? }` → `{ artifact_id, version: 1 }`
- `update` — `{ artifact_id, html, change_note? }` → bumps version

Single-file HTML only. Inline `<style>` / `<script>` allowed; external CDN
imports allowed (we run local, no offline constraint). Size cap **1 MB**.
Always-on in `toolDefsForTurn` (no keyword gating).

## Rendering

`ArtifactCard` component, modeled on `ImageJobCard`:

- `<iframe srcdoc=…>` with `sandbox="allow-scripts allow-popups"` — no
  `allow-same-origin`, so the artifact is isolated from host cookies /
  localStorage. External CDN scripts still work.
- Default height ~420px, "Expand" → full-screen modal (Lightbox shell).
- Actions: **Open in browser** (writes temp file, shells open),
  **Download .html**, title + version pill.
- Source-code toggle: out of scope for v1.

## Workspace bridge

Preamble script injected into every artifact exposes `window.gates`:

```js
gates.readFile(path)            // workspace-wide read
gates.listDir(path)             // workspace-wide list
gates.writeFile(path, content)  // scoped to artifact's own data/ folder
```

Implemented via `postMessage` between iframe and host. Host routes calls
through existing workspace plumbing (`fs` tool internals). Write paths are
rewritten / validated to live under `workspace/artifacts/<id>/data/`.

## Persistence

```
workspace/artifacts/<artifact-id>/
  meta.json     # id, title, slug, createdAt, updatedAt, threadId,
                # originMessageId, currentVersion, versions[]
  v1.html
  v2.html
  data/         # writable from inside the artifact
```

`artifact-id` = `<slug>-<nanoid6>` (e.g. `pomodoro-a1b2c3`). All versions
kept on disk.

New `ArtifactStore` (Zustand, mirrors `ImageJobStore`) + `artifactStorage.ts`
(mirrors `imageGenStorage.ts`).

## Chat integration

Tool returns immediately with `{ artifact_id, version }`. Thread message
content carries an artifact ref `{ kind: 'artifact', id, version }`, not
the HTML blob — keeps history small and lets `update` re-render the same
card cleanly.

## Out of scope (deferred)

- Multi-file artifacts
- Source-code toggle
- Gallery menu section
- Sharing / export beyond download
- Re-run / regenerate from original prompt
