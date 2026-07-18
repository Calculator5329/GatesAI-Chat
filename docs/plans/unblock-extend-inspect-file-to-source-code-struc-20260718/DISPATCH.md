# DISPATCH: implement inspect_file source-code structure (py, js, ts, go)

Follow-up implementation task for the approved roadmap item
"Extend `inspect_file` to source-code structure (`py`, `js`, `ts`, `go`)".
Design is final in `design.md` (same folder) — implement it as specified;
do not re-open the approach (heuristic pure-TS outliner, zero new deps).

## Task spec

- **title:** Implement inspect_file source-code outlines (py, js, ts, go) per approved design
- **goal:** Implement docs/plans/unblock-extend-inspect-file-to-source-code-struc-20260718/design.md exactly:
  1. NEW `src/services/tools/codeOutline.ts` — pure parser module exporting
     `CodeLang`, `CodeSymbol`, `parseCodeOutline(content, lang)`, and
     `findSymbolRange(symbols, query)`; no bridge/store imports.
  2. EXTEND `src/services/tools/inspectFile.ts` — add `py|js|ts|go` to
     `InspectFormat`, `detectFormat` (extensions + mime hints per design
     table), the `format` enum in the tool def, a new optional `symbol`
     string parameter, and an `inspectCode` dispatcher implementing
     profile (outline + counts, 200-symbol cap), preview/search (reuse text
     helpers), extract (line-range reuse + symbol mode with ambiguous /
     not-found actionable errors), aggregate → explicit not-supported error.
     Update the tool description text per design.
  3. Prompt-surface one-liners: update "CSV/JSON/text" phrasing to include
     source files in `src/stores/UserProfileStore.ts` (~line 203),
     `src/core/attachments.ts` (~line 74), `src/services/tools/workspace.ts`
     (~line 48), `src/services/tools/fs.ts` (~line 214),
     `src/services/bridge/defaultWorkspaceGuide.ts` (~line 159/178).
  4. Tests: NEW `tests/services/codeOutline.test.ts` (design testing-plan
     cases 1–5) and extend `tests/services/inspectFileTool.test.ts`
     (cases 6–12) using its existing `makeCtx` fake bridge.
  5. Docs truth: `docs/architecture.md` inspect_file row,
     `docs/changelog.md` session entry, tick the `docs/roadmap.md` Later
     checkbox "Extend `inspect_file` to source-code structure" with a dated
     note.
  No registry changes, no meta changes (stays read-only, no side effects),
  no new dependencies, no bridge/Rust changes, no schema/persistence
  changes. Web Lite behavior unchanged (tool remains bridge-gated).
- **owns:**
  - `src/services/tools/codeOutline.ts`
  - `src/services/tools/inspectFile.ts`
  - `src/stores/UserProfileStore.ts`
  - `src/core/attachments.ts`
  - `src/services/tools/workspace.ts`
  - `src/services/tools/fs.ts`
  - `src/services/bridge/defaultWorkspaceGuide.ts`
  - `tests/services/codeOutline.test.ts`
  - `tests/services/inspectFileTool.test.ts`
  - `docs/architecture.md`
  - `docs/changelog.md`
  - `docs/roadmap.md`
- **test-cmd:** `npm run ci`
  (vitest 995+ / typecheck / lint — the repo's mandatory gate; no Rust
  touched so no cargo test. `npm run test:e2e` may additionally be run but
  carries a pre-existing, already-filed `artifactContract` failure —
  commit c8778b2 — which must not be attributed to this change.)
- **model tier:** smart (multi-language parser + edge cases)
- **suggested cap:** ~$25 (complex multi-file per spend norms)

## Acceptance criteria

- `inspect_file` `profile` on a `.py`/`.ts`/`.go` fixture returns an outline
  with line numbers and never the full file body.
- `extract` with `symbol` returns exactly the symbol's numbered line range;
  unknown symbol returns an error listing available symbols.
- `aggregate` on source files returns the explicit not-supported error.
- All new behavior covered by the 12 test cases in design.md; `npm run ci`
  green.
- Docs updated (architecture row, changelog entry, roadmap checkbox ticked).
