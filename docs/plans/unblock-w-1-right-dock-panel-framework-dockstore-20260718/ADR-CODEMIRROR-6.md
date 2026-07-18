# ADR — direct CodeMirror 6 for the dock editor

Date: 2026-07-18  
Status: **Accepted for W-1 implementation**  
Decision authority: Ethan's W-1 decision, **APPROVED**

## Context

W-1 promised a simple editor for JavaScript, TypeScript, JSON, Markdown, and
HTML inside an already-shipped narrow dock cell. GatesAI currently has a
read-only highlighted renderer, but a contenteditable or textarea-based editor
would require the app to recreate selection, history, indentation, viewport,
syntax-tree, and keyboard behavior. A full IDE framework or third-party React
wrapper would add more API surface than the product needs.

CodeMirror 6 is modular, ESM-native, works with Vite, and documents an
imperative `EditorView` lifecycle suitable for a small React adapter. Its
official guide identifies state, view, commands, and language modules as the
system's composable core and explicitly supports choosing only the pieces an
editor needs:

- <https://codemirror.net/docs/guide/>
- <https://codemirror.net/examples/basic/>
- <https://codemirror.net/docs/ref/>

The official language packages provide the exact W-1 modes:

- <https://www.npmjs.com/package/@codemirror/lang-javascript>
- <https://www.npmjs.com/package/@codemirror/lang-json>
- <https://www.npmjs.com/package/@codemirror/lang-markdown>
- <https://www.npmjs.com/package/@codemirror/lang-html>

## Decision

Use CodeMirror 6 directly, without a React wrapper and without a third-party
theme. Treat the official `@codemirror/*` modules as one dependency family.

Install and lock these direct packages:

```sh
npm install @codemirror/state @codemirror/view @codemirror/commands \
  @codemirror/language @codemirror/lang-javascript \
  @codemirror/lang-json @codemirror/lang-markdown @codemirror/lang-html
```

Do not hand-select version numbers in advance. `npm install` resolves current
compatible releases, `package-lock.json` records the exact graph, and the
implementation gate verifies that resolved graph. All packages must remain on
the official CodeMirror lineage and MIT-licensed at install time.

`CodeEditorPanel` owns a small hook/component adapter:

- construct one `EditorState` and `EditorView` after the bridge load succeeds;
- attach it to a React-owned host element;
- use CodeMirror transactions/update listeners to report content changes;
- map extensions by file suffix, including TypeScript/JSX flags;
- bind Ctrl/Cmd+S to the panel's explicit save action;
- style the editor with GatesAI tokens through `EditorView.theme` and the
  existing `dock.css`, not a bundled imitation of another IDE;
- call `view.destroy()` and remove listeners on every cleanup.

The registry imports this panel through `React.lazy`. No CodeMirror package may
be statically imported by the app shell, store graph, core, or eagerly loaded
panel registry.

## Configuration boundary

Include only the normal text-editing affordances needed for v1: line numbers,
selection, history/undo, indentation, bracket matching, active-line treatment,
syntax highlighting, and standard keymaps. Local parser behavior is allowed;
LSPs, remote completion, formatters, lint engines, Vim bindings, minimaps,
debugging, and theme packages are not.

## Consequences

### Positive

- Correct editor behavior comes from a maintained editor core rather than
  bespoke contenteditable logic.
- Language parsers cover the exact W-1 formats and can stay out of the initial
  bundle behind a lazy panel chunk.
- The direct adapter avoids a second React abstraction, wrapper version skew,
  wrapper-specific state, and another dependency maintainer.
- The editor remains replaceable because bridge reads/writes and dock layout
  do not depend on CodeMirror types.

### Costs and risks

- Eight direct package entries are added, even though they form one official
  dependency family.
- Imperative lifecycle code needs Strict Mode and cleanup tests.
- Language parsers add bundle weight. The implementation must run
  `npm run build`, record the lazy chunk, and verify that the initial entry
  chunk does not import it. If the editor chunk exceeds 300 KiB gzip, stop and
  split language support before merge.
- CodeMirror does not make bridge writes atomic. Conflict handling remains a
  best-effort stat-before-write check and must be described honestly.

## Alternatives rejected

- **Plain textarea:** too little syntax/navigation support and pushes editor
  behavior into app code.
- **contenteditable + highlight.js:** duplicates selection, history, IME,
  cursor, and incremental-rendering problems; highlight.js remains a renderer,
  not an editor.
- **Monaco:** substantially heavier and more IDE-shaped than this one-cell
  editor; worker/assets integration is unnecessary for W-1.
- **Third-party React CodeMirror wrapper:** adds a second lifecycle/state API
  without reducing the small adapter GatesAI actually needs.
- **Remote/CDN editor assets:** violates offline completeness and the artifact
  network posture.

## Revisit triggers

Revisit only if CodeMirror cannot meet accessibility/IME requirements in the
Tauri WebView, the lazy chunk cannot meet the 300 KiB gzip limit after language
splitting, or future product direction explicitly promotes the dock editor into
a multi-file IDE. None of those is assumed by W-1.
