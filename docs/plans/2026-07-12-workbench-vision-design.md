# Workbench vision — right dock, unified tasks, artifact contract, updater

*Direction from Ethan, 2026-07-12. This is the design frame; each phase below
should get its own dated plan doc before implementation. Nothing here is
started yet.*

## The shift

Today the app is **sidebar + centered chat column**. The direction is a
three-region **workbench**:

```
┌──────────┬──────────────────────┬───────────────────┐
│ sidebar  │  chat (fixed-ish     │  right dock       │
│ (threads)│  comfortable width)  │  1 col × 1–2 rows │
│          │                      │  movable panels   │
└──────────┴──────────────────────┴───────────────────┘
```

- Right dock: one column, one **or two** stacked cells; user can swap what
  lives in each cell, collapse the dock entirely, and resize the splits.
- Chat stays the center of gravity; the dock is where *things the chat
  produces or works on* live (artifacts, files, tasks, terminals).

## Phase 1 — Dock shell + panel framework

The enabler for everything else. Build the dock as a generic panel host, not
five bespoke sidebars.

- `DockStore` (MobX): `cells: [PanelRef | null, PanelRef | null]`, split
  ratio, collapsed flag — persisted per… app, not per thread (v1).
- `PanelRef = { kind: PanelKind, params }`; a registry maps `PanelKind` →
  component + title + icon, same shape as the tool registry pattern.
- Panels are openable from: chat content (e.g. "open in dock" on a file
  mention or artifact), the command palette, and a dock "+" menu.
- Layer rules hold: panel components are UI; each panel talks to an existing
  store/service (fs via bridge, terminal via a new pty bridge op, etc.).

Panel kinds, roughly in build order:

| Panel | v1 scope | Backing |
|---|---|---|
| **File viewer** | md (rendered), html (sandboxed iframe, same policy as artifact preview), json (pretty/collapsible), txt | existing `fs.read` bridge op |
| **Code viewer/editor** | syntax highlight + edit + save for js/ts/json/md/html; *simple* — CodeMirror 6, no LSP, no tabs-inside-panel | `fs.read`/`fs.write`; dependency decision: CodeMirror is the one new dep this program should buy |
| **File explorer** | single-root workspace tree, expand/collapse, click→opens viewer/editor panel, no drag-drop/rename in v1 | new `fs.list` recursive bridge op (or iterate existing) |
| **Media viewer** | images (incl. generated), video/audio via native elements | existing `/view`-style bridge file serving |
| **Task center** | see Phase 3 | TaskStore |
| **Terminal** | see Phase 3 (cmd tasks) — read-only log view first, interactive pty later | bridge pty op (new, bridge repo task) |
| **Artifact panel** | pinned HTML artifact from the registry (Phase 2) | ArtifactStore |

Web Lite: dock exists but only panels whose backing works browser-side
(artifact panel, viewers for content already in memory). Feature-gate via
`core/runtime.ts` as usual — degrade by hiding panel kinds, never
half-rendering them.

## Phase 2 — HTML artifacts as a first-class contract

Today: `artifact` tool (`validate_html` / `create_html_artifact`) +
`HtmlArtifactPreview` render. What's missing is the **contract**:

- **System-prompt section, versioned**: one canonical block (generated from
  code, not hand-written prose in two places) that tells the model exactly
  how to author artifacts: self-contained single file, no external network
  (CSP mirrors what the preview iframe actually enforces), size budget,
  update-in-place rules ("same artifact id ⇒ replace, don't fork").
- **Artifact registry**: artifacts get stable ids + metadata
  (`/workspace/artifacts/html/<id>.html` + an index), so threads can
  reference, re-open, and *update* them instead of littering one-off files.
- **Validation is the gate**: `create_html_artifact` already validates; add
  a smoke render (load in the sandboxed iframe, catch console errors) so
  "it works in the app" is checked at creation time, and failures land in
  the error trail (`/workspace/logs/errors-*.jsonl`) with the artifact id.
- Artifacts open in the dock's artifact panel by default; fullscreen stays.

## Phase 3 — Background tasks as one framework

Insight: **image gen is already the template.** `ImageJobStore` has the
queue/active/history/persist/recover/cancel/retry lifecycle; `spawnTask` +
`agentTasks` are the beginnings of subagents. Generalize instead of growing
a third bespoke system:

- `Task` abstraction: `{ id, kind, title, threadId?, status:
  pending|running|done|failed|cancelled, progress?, results[], error?,
  createdAt/startedAt/completedAt, costUsd? }` — deliberately the ImageJob
  shape, promoted.
- `TaskKind` v1: `image` (adapt ImageJobStore behind it), `agent`
  (background subagent runs — the big one), `command` (a live-running shell
  command via the bridge exec/pty path; none exist yet, design for it now).
- One **TaskStore** owning the ledger + persistence + boot recovery (reuse
  the interrupted-job recovery pattern); per-kind runners plug in. Failures
  log structured payloads to the error trail like image dispatch now does.
- **Task center panel** in the dock: live list, progress, cancel/retry,
  cost, click-through to the producing thread. Replaces "scroll the chat to
  find the image card" as the way to see what's at work.
- Concurrency: per-kind caps (images serial as today; agents N=2?; commands
  user-approved individually — exec allowlist and path jail still apply).

Migration note: keep `ImageJobStore`'s public surface stable for the UI
during the refactor (it has 22 tests that should keep passing), introduce
TaskStore around it, then fold.

## Phase 4 — Fullscreen + window polish (small, do early)

- `fullscreen: false` in `tauri.conf.json` is only the initial state; there
  is currently **no** toggle wired. Add `F11` (Linux/Windows convention) via
  the existing shortcuts service → `getCurrentWindow().setFullscreen(!f)`.
- Discoverability: list it in the command palette ("Toggle fullscreen"),
  the keyboard-shortcuts help, and the What's New note.
- The existing `.html-artifact-fullscreen` (artifact maximize) is a
  different feature — keep the naming distinct in UI copy.

## Phase 5 — Updates that reach users (releases repo)

Today users must notice a new release and re-download. Fix with Tauri's
official updater against the **existing public releases repo**:

1. Add `tauri-plugin-updater` + `tauri-plugin-process`; generate a signing
   keypair (`npm run tauri signer generate`) — private key becomes a GitHub
   Actions secret, public key goes in `tauri.conf.json`. **The private key
   never enters either repo.**
2. Release workflow (`tauri-action` already builds on tag push) additionally
   emits per-platform signatures + a `latest.json` manifest and uploads them
   to `Calculator5329/GatesAI-Chat-releases`.
3. Updater endpoint:
   `https://github.com/Calculator5329/GatesAI-Chat-releases/releases/latest/download/latest.json`
   — works unauthenticated because the releases repo is public.
4. In-app UX: check on launch (+ every ~6h), non-blocking "v4.6 available —
   Restart to update" pill; download/install via the plugin; respect an
   opt-out setting. Linux: auto-update applies to the **AppImage** build
   (deb/rpm users get a "new version" notice + link instead — plugin
   limitation). Web Lite already updates itself by being a website.
5. Keep release asset names stable (hard rule) — `latest.json` is additive.

This is the cheapest phase with the highest user impact; it can ship
independently of the workbench.

## Sequencing & risks

Order: **5 (updater) → 4 (fullscreen) → 1 (dock) → 2 (artifacts) → 3
(tasks)**. Updater and fullscreen are contained wins; the dock unblocks the
other two; tasks is the deepest refactor and benefits from the dock existing
(task center panel) and the error-trail groundwork (2026-07-12).

Risks: dock + editor tempt dependency creep (decide CodeMirror once, in an
ADR); terminal/pty and `fs.list` need bridge-repo work (separate tasks per
the sibling-repo rule); task unification must not destabilize image gen
(strangler pattern, keep tests green throughout).
