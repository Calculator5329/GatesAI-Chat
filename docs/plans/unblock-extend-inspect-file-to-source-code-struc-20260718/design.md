# Design: Extend `inspect_file` to source-code structure (py, js, ts, go)

- **Roadmap item:** `docs/roadmap.md` › Later › "Extend `inspect_file` to
  source-code structure (`py`, `js`, `ts`, `go`)" (approved by Ethan, verbatim:
  APPROVED)
- **Task:** unblock-extend-inspect-file-to-source-code-struc-20260718
- **Status:** design complete; implementation dispatched via `DISPATCH.md` in
  this folder (this lane's lease covers only `docs/plans/<task-id>/`, so no
  source files were touched here).
- **Prior art:** `docs/plans/2026-04-25-inspect-file-design.md` explicitly
  scoped this as the planned "later phase": *"Later phases add source-code
  structure for `py`, `js`, `ts`, and `go`"*. This doc is that phase's design.

## Goal

When the user asks about a source file ("what's in `main.py`?", "which
functions does this module export?", "show me the `handleTurn` function"),
the assistant should get a compact structural outline — imports, functions,
classes/methods, types, exports, with line numbers — instead of dumping the
whole file into context via `fs.read`. Then it can `extract` exactly the line
range or symbol it needs.

## Approach: heuristic line-based outliner, zero new dependencies

Add a pure-TypeScript outline parser, not an AST. Rationale:

- **Dependency policy.** CLAUDE.md: "Adding a dependency is a decision, not a
  default." Real parsers (tree-sitter WASM, @babel/parser, go AST via bridge)
  are heavy, and the payoff is small: the consumer is an LLM that tolerates
  imperfect outlines fine — it only needs names + line numbers good enough to
  aim a follow-up `extract`.
- **Consistency.** The existing CSV/JSON/text inspectors in
  `src/services/tools/inspectFile.ts` are deterministic hand-rolled parsers in
  the service layer with no bridge-side changes. This extension follows the
  same shape: `fs.read` the file, parse locally, return a compact answer.
- **Both runtimes.** Pure TS works identically on desktop and Web Lite; the
  tool stays bridge-gated exactly as today (`requireBridge`), so no
  `core/runtime.ts` gating changes are needed.

Known limitation (documented in the tool description and accepted): the
outliner is regex/line/brace-depth based. Minified bundles, deeply unusual
formatting, or code-in-strings can produce missing or spurious entries. That
degrades to "outline is incomplete — model falls back to preview/search/
extract", never to a crash or a wrong-file read. Nothing security-relevant
consumes the outline.

## File layout

| File | Change |
| --- | --- |
| `src/services/tools/codeOutline.ts` | **New.** Pure functions: `parseCodeOutline(content, lang)` → `CodeSymbol[]`, plus `findSymbolRange(...)`. No imports from stores/bridge — service-layer leaf, unit-testable without a fake bridge. |
| `src/services/tools/inspectFile.ts` | Extend `InspectFormat`, `detectFormat`, add `inspectCode(...)` dispatcher + `symbol` parameter; update tool description. |
| `tests/services/codeOutline.test.ts` | **New.** Per-language parser unit tests (pure, no bridge). |
| `tests/services/inspectFileTool.test.ts` | Extend with end-to-end cases through the fake-bridge `makeCtx` helper. |
| `src/stores/UserProfileStore.ts`, `src/core/attachments.ts`, `src/services/tools/workspace.ts`, `src/services/bridge/defaultWorkspaceGuide.ts`, `src/services/tools/fs.ts` | One-line prompt-text updates: "CSV/JSON/text" → mention source files too, so the model actually routes code files here instead of `fs.read`. |
| `docs/architecture.md`, `docs/changelog.md`, `docs/roadmap.md` | Docs truth: tool table row, session changelog entry, tick the Later checkbox. |

## Data model

```ts
export type CodeLang = 'py' | 'js' | 'ts' | 'go';

export interface CodeSymbol {
  kind: 'import' | 'function' | 'class' | 'method' | 'interface'
      | 'type' | 'enum' | 'struct' | 'const' | 'var' | 'package';
  name: string;          // e.g. "handleTurn", "UserStore.load"
  line: number;          // 1-based start line
  endLine: number;       // 1-based inclusive end line (best effort)
  signature: string;     // first declaration line, truncated to MAX_LINE_CHARS
  exported: boolean;     // ts/js: export kw; go: capitalized; py: not _-prefixed
  parent?: string;       // enclosing class/struct name for methods
  doc?: string;          // first line of docstring / doc comment, truncated
}
```

## Detection

Extend `detectFormat` (explicit `format` arg keeps priority):

| Format | Extensions | Mime hints |
| --- | --- | --- |
| `py` | `.py`, `.pyi` | `text/x-python`, `python` |
| `js` | `.js`, `.mjs`, `.cjs`, `.jsx` | `javascript` |
| `ts` | `.ts`, `.tsx`, `.mts`, `.cts` | `typescript` |
| `go` | `.go` | `text/x-go`, `golang` |

The `format` enum in the tool def parameters grows to
`['csv','json','txt','py','js','ts','go']`. Unknown extensions keep today's
behavior (error listing supported formats — now including the four new ones).
Files that fail `decodeFsRead` (binary) keep today's rejection.

## Parsing rules per language

All parsers share a pre-pass that classifies each line's code content with
strings and comments stripped for *structure detection only* (never for
output), tracking block-comment / triple-quote state across lines.

**Python** (indentation-based):
- `import x`, `from x import y` → `import` (name = module).
- `def name(` / `async def name(` at indent 0 → `function`; at deeper indent
  inside a `class` block → `method` with `parent`. Decorator lines directly
  above attach to the symbol's start line (so `extract symbol:` includes them).
- `class Name(` → `class`.
- `endLine` = last line more indented than the def/class line (blank lines
  skipped); `doc` = first line of an immediately-following triple-quoted
  string.
- `exported` = name does not start with `_`.

**JS/TS** (brace-based; ts adds type declarations):
- `import ...` / `export ... from` / top-level `require(` → `import`.
- `function name(`, `async function name(`, `const|let|var name = (...) =>`
  or `= function` → `function`; `export` / `export default` prefix sets
  `exported`.
- `class Name` → `class`; identifier-followed-by-`(` members at class brace
  depth (excluding `if|for|while|switch|catch|return|new`) → `method`.
- ts only: `interface Name` → `interface`, `type Name =` → `type`,
  `enum Name` → `enum`.
- Top-level `export const NAME =` without arrow/function → `const`.
- `endLine` via brace matching on the stripped text; unbalanced braces fall
  back to `endLine = line` (outline stays useful, range extract degrades to
  the signature line).
- `doc` = last line of a `/** ... */` or `//` block immediately above.

**Go** (brace-based):
- `package x` → `package`; `import (...)` block or single `import` → `import`
  entries.
- `func Name(` → `function`; `func (r *Recv) Name(` → `method` with
  `parent = Recv`.
- `type Name struct` → `struct`; `type Name interface` → `interface`;
  other `type Name ...` → `type`.
- Top-level `const` / `var` (incl. `(...)` blocks) → `const` / `var`.
- `exported` = first rune uppercase. `doc` = `//` comment block directly above.

## Action mapping for code formats

Reuses today's five actions — **no new action names**, one new optional
parameter `symbol` (string):

- **`profile`** — the headline feature. Header (`path`, `format`,
  `detected_encoding`, `size`, `lines`) + counts line
  (`imports: N, functions: N, classes: N, methods: N, exported: N`) + outline
  listing, one line per symbol:
  `  12-48  function handleTurn(ctx, msg) [exported] — doc first line`
  Methods render indented under their parent. Outline capped at 200 entries
  with an explicit `truncated: true (showing 200 of N symbols)` marker;
  existing `resultPolicy.maxChars: 16_000` stays the hard backstop.
- **`preview`** — numbered first-N lines, identical to text handling (reuse
  `renderNumberedLines`).
- **`search`** — text-line search with line numbers (reuse `searchText`).
- **`extract`** — two modes:
  - `start_line`/`end_line`: exactly the text behavior (reuse).
  - `symbol: "name"` or `"Parent.name"`: locate via the outline
    (case-sensitive first, case-insensitive fallback; ambiguous match →
    error listing candidates with lines; not found → error listing nearest
    names). Returns the symbol's numbered `line..endLine` range, still capped
    by `limit`-independent `MAX` guards (a >400-line body returns the first
    400 lines + truncation marker telling the model to page with
    `start_line`).
- **`aggregate`** — explicit error: `action "aggregate" is not supported for
  source files.` (mirrors the JSON pattern).

Tool description updates from
"Supported day-one formats: csv, json, txt. Later: py/js/ts/go structure,
then pdf/docx/xlsx." to
"Supported formats: csv, json, txt, and source structure for py/js/ts/go
(profile returns an outline of imports/functions/classes with line numbers;
extract accepts `symbol`). Later: pdf/docx/xlsx." The `symbol` parameter gets
a one-line description in the schema.

## Registry / selection

No change. `inspect_file` is already selected for every bridge-online turn
(`registry.ts` `toolDefsForTurn`), and the tool stays read-only /
no-side-effects, so `meta` is untouched. The batch executor contract is
unaffected.

## Error handling

- Unsupported format error message now lists the seven formats.
- `symbol` with no match / ambiguous match → actionable retryable error (list
  available or candidate symbols).
- Parser never throws on weird input: every per-line rule is optional-match;
  a file with zero detected symbols returns a profile that says
  `symbols: 0` plus the line/size stats (same info as txt profile), not an
  error.
- Protected-path denial (`denyProtectedChatHistoryPath`) applies unchanged.

## Testing plan

`tests/services/codeOutline.test.ts` (pure unit, no bridge):
1. Python: imports, top-level function, class with two methods + docstrings,
   decorated async def, `_private` not exported, indentation end-lines.
2. TS: default-export function, arrow-const function, interface/type/enum,
   class with methods, `export` detection, brace end-lines, `/** doc */`.
3. JS: CommonJS `require` + `module.exports`, function/const forms.
4. Go: package/import block, plain func, receiver method with parent,
   struct/interface types, const block, capitalization-exported.
5. Degradation: minified single-line JS → no crash, ≤ small symbol count;
   triple-quoted Python string containing `def fake():` not outlined; string
   containing braces doesn't break Go/TS end-line matching.

`tests/services/inspectFileTool.test.ts` additions (fake-bridge e2e):
6. `.py` profile returns outline + counts and does **not** contain full file
   body.
7. `.ts` extract with `symbol` returns only that function's numbered lines.
8. `.go` profile marks exported vs unexported.
9. `aggregate` on a `.py` file returns the not-supported error.
10. `format: 'py'` override wins over a `.txt` extension.
11. Unknown-symbol extract returns the actionable error listing symbols.
12. Outline cap: file with >200 symbols shows truncation marker.

Verify: `npm run ci` (vitest + typecheck + lint — the mandatory gate).
`npm run test:e2e` should stay at its current baseline (note: a pre-existing
`artifactContract` e2e failure is already filed — see changelog commit
c8778b2; it is not related to this change). No Rust touched → no `cargo test`.

## Docs updates (same lane as implementation)

- `docs/architecture.md`: tool-catalog row for `inspect_file` gains the four
  formats + `symbol` extract.
- `docs/changelog.md`: session entry on top.
- `docs/roadmap.md`: tick the Later checkbox with a dated note.
- Prompt surfaces listed in File layout: change "CSV/JSON/text" phrasing to
  "CSV/JSON/text/source (py, js, ts, go)" so routing prompts stay true.

## Explicitly out of scope

- `pdf`/`docx`/`xlsx` (the next roadmap checkbox; needs bridge-side parsers).
- Bridge/Go-side AST endpoints; any new npm dependency.
- Cross-file analysis (call graphs, references) — `query_script`/`terminal`
  territory.
- Languages beyond the four named (rs, java, c…) — the parser table makes
  adding one cheap later, but the roadmap item names exactly four.
