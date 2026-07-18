# Extend `inspect_file` to Document Formats (pdf, docx, xlsx) — Design

Status: design complete, ready to dispatch. Owner lease: `docs/plans/unblock-extend-inspect-file-to-document-formats--20260718/`.
Roadmap item (Later): `- [ ] Extend `inspect_file` to document formats (`pdf`, `docx`, `xlsx`)`.
Ethan's decision (verbatim): **APPROVED**.

This document is the execution plan. It does **not** change source — the source
changes are specified for a follow-up implementation task in `DISPATCH.md` in this
same folder.

## Goal

Let the assistant answer questions about `xlsx`, `docx`, and `pdf` files the same
way it already does for `csv`, `json`, and `txt`: compact `profile` / `preview` /
`search` / `extract` (and `aggregate` for tabular data) results, without dumping
whole documents into model context. The tool contract, result policy, and
artifact-first workflow stay identical; only the set of recognized formats grows.

## Constraints that shape the design

- **`inspect_file` is a client-side service** (`src/services/tools/inspectFile.ts`).
  It reads bytes via the bridge's `fs.read` RPC and does all parsing in TypeScript.
  Keeping parsing client-side preserves that architecture and — critically — keeps
  the tool working in **Web Lite**, which has no bridge/backend of its own for the
  parts that already work in-browser.
- **Both runtimes must be considered** (CLAUDE.md "Definition of done" #2). Web
  Lite must degrade gracefully, never half-work.
- **The dependency list is deliberately short** (CLAUDE.md hard rules). Every new
  package is a decision, so the design minimizes them: **one** small, zero-dep,
  well-audited library (`fflate`) covers both OOXML formats; `pdf` is deliberately
  split into its own phase because it is the only format that forces a heavy or
  out-of-repo dependency.
- **Reuse the existing engines.** The CSV engine (`parseCsv`, `renderCsvRows`,
  `searchCsv`, `extractCsv`, `aggregateCsv`, `profileCsvColumn`) and the text engine
  (`splitLines`, `renderNumberedLines`, `searchText`, line-range extract) already
  implement every action semantic we need. Document support should **materialize a
  document into the shapes those engines already consume** (`{headers, rows}` for a
  spreadsheet sheet; `string[]` lines for a document body) rather than re-implement
  action logic per format.

## How `fs.read` gives us the bytes

`fs.read` returns `{ path, content, encoding: 'utf8' | 'base64', size, mime }`.
Binary files come back **base64** (see `src/services/tools/fs.ts:54`). The RPC
response is **not truncated** — inspect_file issues its own `fs.read` with no
`max_chars`, so it receives the complete base64 payload. `textDecode.ts` already
has a private `base64ToBytes` helper; the implementation will expose a shared
`base64ToBytes` (or add `decodeFsReadBytes(resp): Uint8Array | { error }`) so the
document path can obtain raw `Uint8Array` bytes instead of decoded text.

Today `execute()` funnels every file through `decodeReadResponse` → text, and
rejects binary. Document formats need a **pre-branch**: detect the format from the
path/mime first; for a document format, take the raw-bytes path; otherwise keep the
existing text path unchanged.

## Format landscape (why pdf is separate)

| Format | Container | Parse cost in TS | Maps onto | Web Lite |
| --- | --- | --- | --- | --- |
| `xlsx` | ZIP of XML (OOXML) | low–moderate: unzip + walk `sheetData` | **CSV engine**, per sheet | ✅ works in-browser |
| `docx` | ZIP of XML (OOXML) | low: unzip + collect `<w:t>` text | **text engine** | ✅ works in-browser |
| `pdf`  | binary object graph, Flate-compressed content streams, font/CMap decoding | **high** — correct text extraction needs a real PDF engine | text engine | needs a heavy dep or bridge |

`xlsx` and `docx` are the same container (a ZIP of XML parts) and are cleanly
solvable with one tiny primitive. `pdf` is a fundamentally harder format: robust
text extraction means parsing the cross-reference table, decompressing content
streams, and decoding font glyph→unicode maps. Doing that by hand is a large, bug-
prone surface; the realistic options are a heavy client dependency (`pdfjs-dist`,
multi-MB) or a bridge-side Go extractor (desktop-only). Bundling those two very
different risk/spread profiles into one change would make the whole item un-
shippable behind the hardest third of it.

**Decision: phase the delivery.** Phase 1 ships `xlsx` + `docx` (one small dep,
both runtimes, high value). Phase 2 adds `pdf` behind its own dependency/runtime
decision. Both phases keep the exact same tool contract, so phase 2 is purely
additive.

---

## Phase 1 — `xlsx` + `docx` (client-side, one dependency)

### Dependency

Add **`fflate`** (MIT, zero-dependency, ~8 KB gzipped) to `dependencies`. It
provides `unzipSync(bytes: Uint8Array): Record<string, Uint8Array>`, which is all
we need to open an OOXML package synchronously in both Node (tests) and the
browser. This is the single dependency decision for the item; it is justified
because it unlocks two of the three target formats with a minimal, audited surface
and no transitive deps. (Rejected alternatives: `xlsx`/SheetJS — much larger, CSV
semantics we already own; `jszip` — larger and async-only ergonomics; `mammoth` —
docx-only and heavier than the ~40 lines of `<w:t>` extraction we actually need.)

### xlsx → CSV engine

New module `src/services/tools/documents/xlsx.ts` (kept out of `inspectFile.ts` to
respect its size and keep the OOXML details testable in isolation):

- `unzipSync` the bytes. Read `xl/workbook.xml` for the ordered sheet list
  (`<sheet name=… r:id=… sheetId=…>`), resolve `r:id` → target part via
  `xl/_rels/workbook.xml.rels`.
- Load `xl/sharedStrings.xml` once into a `string[]` (index → text, concatenating
  the `<t>` runs inside each `<si>`).
- For a requested sheet (default: first in workbook order; selectable via a new
  optional `sheet` param — by name or 1-based index), walk `sheetData` rows:
  - each `<c r="A1" t="s|str|inlineStr|b|…">` → resolve value: `t="s"` indexes
    shared strings; `t="inlineStr"` reads inline `<is><t>`; `t="b"` → `TRUE/FALSE`;
    numeric/date cells → the raw stored value as string (do **not** attempt full
    date-serial conversion in v1 — note it as a known limitation so behavior is
    deterministic and cheap; a follow-up can add number-format→date rendering).
  - honor the column letter in `r` so sparse rows land in the right column and
    ragged rows are detected the same way the CSV engine already reports them.
- First materialized row becomes `headers`; the rest become `CsvRow[]` — the exact
  `CsvTable` shape `inspectCsv` already consumes. Then **delegate to the existing
  CSV action handlers** (`inspectCsv(action, args, {...resp, content synthesized})`).
  Refactor `inspectCsv` so its action switch can be called with a pre-parsed
  `CsvTable` (extract the parse step), avoiding a fake round-trip through CSV text.
- `profile` for xlsx additionally lists **all sheets** with `name`, `rows`,
  `columns` so the model can pick a sheet before drilling in. Header line reports
  `format: xlsx`, `sheet: <name>`, `sheets: <n>`.
- `aggregate` works unchanged (it operates on `{headers, rows}`).

### docx → text engine

New module `src/services/tools/documents/docx.ts`:

- `unzipSync`; read `word/document.xml`.
- Collect text as **one line per paragraph** (`<w:p>`): concatenate the `<w:t>`
  runs inside the paragraph (respecting `<w:tab/>` → `\t`, `<w:br/>` → space);
  emit an empty line for empty paragraphs so preview/extract line numbers are
  stable. Flatten table cells (`<w:tc>`) to tab-joined text within their row's
  paragraph. Unescape XML entities.
- Return `string[]` lines and hand them to the **existing text handlers**
  (`profile` / `preview` / `search` / `extract`). Refactor `inspectText` the same
  way as `inspectCsv`: split "produce lines" from "run action on lines" so the docx
  path supplies pre-split lines.
- `profile` for docx reports `format: docx`, `paragraphs`, `words`, `characters`,
  and `headings` (paragraphs whose `<w:pStyle w:val="Heading…">` marks them) — a
  cheap, useful structural summary. `preview`/`search`/`extract` behave exactly like
  text.

### Wiring changes in `inspectFile.ts`

1. Widen `InspectFormat` and `detectFormat`:
   - `.xlsx` or mime `spreadsheetml`/`officedocument.spreadsheet` → `xlsx`.
   - `.docx` or mime `wordprocessingml`/`officedocument.word` → `docx`.
   - keep `csv`/`json`/`txt` unchanged. Legacy `.xls`/`.doc` (binary, non-OOXML)
     are **not** supported — return a clear error pointing at "save as .xlsx/.docx".
2. Extend the `format` param enum in the tool `def` and the `enum` in `parameters`
   to include `xlsx`, `docx` (and `pdf`, wired in phase 2). Add the optional
   `sheet` param (string). Update the tool `description` supported-formats line.
3. In `execute()`, branch **before** `decodeReadResponse`: if the detected format is
   a document format, decode base64 → bytes (guard `resp.encoding === 'base64'`;
   utf8 would only happen for a mis-typed file), enforce a **size guard**
   (`resp.size` over e.g. 15 MB → friendly "file too large to inspect inline" error
   rather than unzipping a huge payload), and route to `inspectXlsx` / `inspectDocx`.
   Wrap parsing in try/catch → `Error: could not parse <fmt> (<reason>)`.
4. Web Lite: xlsx/docx parsing is pure client TS, so it works wherever `fs.read`
   returns bytes. Web Lite's file access already governs whether `fs.read` is
   available; no new runtime gating is needed and no format silently half-works — if
   bytes are unavailable the existing bridge-guard error already fires.

### Result-policy / safety

- Reuse the existing `resultPolicy` (`maxChars: 16_000`, `summarizeLargeOutput`),
  `truncate`, cell/line caps — nothing changes; materialized rows/lines flow through
  the same bounded renderers, so a 100k-row sheet is as safe as a 100k-row CSV.
- `isReadOnly`/`hasSideEffects` stay `true`/`false`.
- Protected-path denial (`denyProtectedChatHistoryPath`) already runs before any
  read and is unchanged.

### Tests (extend `tests/services/inspectFileTool.test.ts`)

Use tiny **fixture byte buffers built in-test** (assemble a minimal OOXML ZIP with
`fflate.zipSync` from hand-written XML parts) so no binary blobs are committed and
the fixtures are self-documenting. Cover:

- xlsx `profile`: lists sheets + per-sheet row/column counts; first sheet columns
  match headers; does not dump the whole sheet.
- xlsx `preview`/`extract`/`aggregate`: row limits honored; `columns` selection;
  `sum`/`avg` over a numeric column; `group_by`.
- xlsx `sheet` selection by name and by index; unknown sheet → actionable error.
- xlsx shared-string vs inline-string vs numeric cells all resolve; sparse/ragged
  rows reported like CSV.
- docx `profile`: paragraph/word/heading counts; `preview` first N paragraphs;
  `search` finds a phrase with the right line number; `extract` line range.
- Corrupt/non-zip bytes with an `.xlsx`/`.docx` name → clean parse error, no throw.
- Size guard: oversized `resp.size` → friendly error, no unzip attempt.
- Format detection by mime as well as extension.
- Registry: `.xlsx`/`.docx` mentions still select `inspect_file` (existing
  selection test — confirm no regression).

Gate: `npm run ci` + `npm run test:e2e` green. No Rust or bridge change in phase 1.

---

## Phase 2 — `pdf` (separate follow-up, its own dependency decision)

PDF is intentionally deferred to keep phase 1 shippable. Two viable paths; **the
choice is an Ethan-level dependency/architecture decision** and is captured as a
second task spec in `DISPATCH.md` (Appendix) plus queued for Ethan:

- **Option A — bridge-side Go extractor (recommended for desktop).** Add a
  `doc.extract_text` (or `pdf.extract`) RPC to `../gatesai-bridge` backed by a
  mature Go PDF library; `inspect_file` calls it and feeds the returned text into
  the text engine. Pros: no heavy JS in the bundle, robust extraction, matches the
  "bridge moves/parses bytes" split. Cons: **desktop-only** — Web Lite has no
  bridge, so pdf `inspect_file` must **degrade gracefully** in Web Lite with an
  explicit "PDF inspection needs the desktop app" message (never half-work). This
  work lands in the **bridge repo**, so it is a separate, differently-scoped task.
- **Option B — client `pdfjs-dist`, lazy-loaded.** Pros: works in both runtimes,
  stays in this repo. Cons: multi-MB dependency that cuts against the "deliberately
  short list" rule; must be dynamically imported so it never enters the main bundle.

Recommendation: **Option A** for extraction quality and bundle discipline, with the
Web Lite degradation path specified up front. Regardless of option, the tool
contract is unchanged — `pdf` just becomes another `detectFormat` result that
produces `string[]` lines for the existing text handlers, with `profile` reporting
`pages` and per-page line offsets.

## Rollout / sequencing

1. Ship **Phase 1** (`DISPATCH.md`, this repo) — unblocks `xlsx` + `docx`, the
   high-value majority, in both runtimes with one small dep.
2. Route the **Phase 2** dependency/runtime decision to Ethan (queue item) and, once
   decided, dispatch the pdf task to the chosen repo.
3. When both land, tick the roadmap item. Until then the harvesting session ticks
   from this deliverable; the roadmap line can be split into "xlsx/docx (done)" and
   "pdf (next)" if partial completion should be reflected.

## Out of scope / known limitations (documented deliberately)

- Legacy binary `.xls`/`.doc` (pre-OOXML) — not supported; error points to re-save.
- xlsx date/number-format rendering — v1 returns stored cell values; format-aware
  date rendering is a follow-up.
- xlsx formulas — return the cached value (`<v>`), not the formula text.
- docx — text/structure only; images, comments, and tracked changes are ignored.
- Encrypted/password-protected documents — surfaced as a clean parse error.
