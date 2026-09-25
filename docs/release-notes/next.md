# Next release notes

Draft from the changes after v4.6.1. Review before cutting the release.

## Local models and desktop workspaces

- First boot gives local Ollama models equal priority with cloud models. When
  local models are available, a new chat can start locally without silently
  switching a user's provider choice.
- Ollama setup reports local cold starts and failures clearly. Missing local
  embedding models can be installed with visible progress and cancellation.
- The desktop app ships with the bridge protocol v2 sidecar and checks the
  protocol version before enabling bridge tools.
- The bridge gives the assistant a real workspace with jailed file access,
  allowlisted command execution, streamed terminal output, Python and SQLite
  helpers, git access, and artifact writes. Protected app-owned chat storage is
  not available through ordinary model tools.
- Added a read-only workspace file explorer in the desktop dock. It stays
  inside the same workspace jail and is not available in Web Lite.
- Web Lite disables bridge-only capabilities instead of pretending that the
  browser can access local files or run local commands.

## Chat, tools, and artifacts

- Tool activity now uses plain-English progress labels. The timeline groups
  consecutive work, shows live terminal output, and exposes the result or
  failure for each step.
- File writes can show a bounded reviewable diff in the activity row.
- Workspace HTML artifacts have a registry, inline cards, dock previews, and
  safer handoff from the transcript to the full viewer.
- The assistant can render small validated inline views for stats, tables,
  lists, progress, badges, callouts, and clickable follow-up actions.
- Responses can be downloaded with their source provenance.
- Background tasks have durable status, a task center, cancellation, retry,
  delayed starts, and result links back to the origin conversation.

## Memory and local knowledge

- Desktop users can approve workspace documents and SQLite databases for the
  local knowledge library. The library exposes source controls and provenance.
- Semantic recall now shows the excerpts supplied to the model, supports source
  exclusions, and rebuilds its local index atomically.
- Recall filters eligible sources before ranking limits, so relevant sources are
  not lost behind unrelated chunks.

## Browser build and interface

- The browser build is available at [gatesai.web.app](https://gatesai.web.app/).
- Web Lite has clearer OpenRouter key errors, a refreshed model catalog, a
  smaller runtime-aware settings surface, and a dismissible desktop download
  cue.
- The chat shell is tighter, with settings in the sidebar footer and a
  switchable Classic or Aurora presentation pack.
- The site now has stable generated-UI controls, Open Graph metadata, and a
  preview image for shared links.

## Reliability and polish

- Workspace hydration and autosave now respect the current write authority and
  coalesce redundant writes.
- Readable chat exports retain stale and foreign files when the app cannot prove
  that they are safe to replace.
- Interrupted streams and cancelled tasks keep their actual state instead of
  being reported as completed or failed work.
- Theme switching, artifact cards, dock motion, undo feedback, mobile shell
  controls, and image gallery behavior received focused fixes.
