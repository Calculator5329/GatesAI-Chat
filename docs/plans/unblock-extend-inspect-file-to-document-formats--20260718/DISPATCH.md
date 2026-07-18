# DISPATCH — Extend `inspect_file` to document formats

Two follow-up implementation tasks derived from
`2026-07-18-inspect-file-documents-design.md`. **Task 1 is immediately
dispatchable in-repo.** Task 2 (pdf) is gated on an Ethan dependency/runtime
decision and is scoped to a different repo — dispatch only after that decision.

---

## Task 1 — inspect_file: xlsx + docx (client-side)

**title:** `inspect_file: add xlsx + docx support (client-side OOXML)`

**goal:**
Extend the existing `inspect_file` tool to inspect `.xlsx` and `.docx` files with
the same `profile` / `preview` / `search` / `extract` / `aggregate` actions it
already supports for csv/json/txt, by unzipping the OOXML package client-side and
materializing it into the shapes the existing CSV and text engines already consume.
No bridge, Rust, or backend change. Works in both desktop and Web Lite (parsing is
pure client TS over `fs.read` bytes). Follow the design doc
`docs/plans/unblock-extend-inspect-file-to-document-formats--20260718/2026-07-18-inspect-file-documents-design.md`
(Phase 1) exactly.

Concretely:
1. Add dependency `fflate` (MIT, zero-dep) to `package.json` `dependencies` and
   install. This is the one sanctioned new dependency for this item.
2. New `src/services/tools/documents/xlsx.ts`: `unzipSync` → resolve sheets via
   `xl/workbook.xml` + rels, load `xl/sharedStrings.xml`, walk a sheet's
   `sheetData` into `{ headers, rows }` (`CsvTable` shape). Handle cell types
   `s`/`str`/`inlineStr`/`b`/numeric; honor column letters for sparse/ragged rows.
   Optional `sheet` selector (name or 1-based index; default first). Store stored
   values for numeric/date/formula cells (no date-serial conversion in v1).
3. New `src/services/tools/documents/docx.ts`: `unzipSync` → `word/document.xml`,
   one line per `<w:p>` (concatenate `<w:t>`, `<w:tab/>`→`\t`, `<w:br/>`→space,
   tables → tab-joined), unescape entities. Return `string[]`. Detect headings via
   `<w:pStyle w:val="Heading…">` for the profile.
4. Refactor `inspectFile.ts` so `inspectCsv` and `inspectText` split "parse/produce"
   from "run action", letting xlsx feed a pre-built `CsvTable` and docx feed
   pre-split lines through the existing action switches (reuse
   `renderCsvRows`/`searchCsv`/`extractCsv`/`aggregateCsv`/`profileCsvColumn` and
   `renderNumberedLines`/`searchText`/line-range extract — do not duplicate action
   logic).
5. Wire `detectFormat` (extension + mime for both formats; legacy `.xls`/`.doc`
   → clear "save as .xlsx/.docx" error), widen `InspectFormat`, the `def` supported-
   formats line, the `format` param enum, and add the optional `sheet` param.
6. In `execute()`, branch to the document path **before** `decodeReadResponse`:
   obtain raw bytes from the base64 `fs.read` response (expose a shared
   `base64ToBytes`/`decodeFsReadBytes` from `textDecode.ts`), enforce a ~15 MB
   `resp.size` guard, try/catch parse errors into friendly messages.
7. `profile` reports: xlsx → `sheets` list with per-sheet rows/columns + active
   sheet; docx → paragraphs/words/characters/headings. Reuse the existing
   `resultPolicy`, `truncate`, and cell/line caps unchanged.
8. Update `docs/architecture.md` (inspect_file supported formats), append a
   `docs/changelog.md` entry, and tick the roadmap item's xlsx/docx portion.

**owns (paths the task may edit):**
- `src/services/tools/inspectFile.ts`
- `src/services/tools/documents/` (new dir: `xlsx.ts`, `docx.ts`)
- `src/services/tools/textDecode.ts` (expose bytes helper only; do not change
  existing text-decode behavior)
- `tests/services/inspectFileTool.test.ts` (+ optional
  `tests/services/documents/*.test.ts`)
- `package.json` + `package-lock.json` (add `fflate`)
- `docs/architecture.md`, `docs/changelog.md`, `docs/roadmap.md`

**must NOT touch:** `src-tauri/`, `../gatesai-bridge`, the security model, the tool
contract semantics for existing formats, or `eslint.config.js` layer rules.

**test-cmd:** `npm run ci && npm run test:e2e`
(= `npm test` (vitest) + `npm run typecheck` + `npm run lint`, then Playwright.
No `cargo test` needed — no Rust change.)

**definition of done:**
- xlsx + docx pass all actions with fixtures assembled in-test via `fflate.zipSync`
  (no committed binary blobs).
- Both runtimes considered; Web Lite works for these formats (pure client parsing);
  bridge-guard error still fires when bytes are unavailable.
- Corrupt-bytes, unknown-sheet, oversized-file, and legacy `.xls`/`.doc` cases
  return clean actionable errors (no throws).
- Docs true (architecture + changelog + roadmap), tree clean, no secrets.

**model tier:** smart (multi-file, new parsing code + refactor).

---

## Task 2 — inspect_file: pdf (GATED — do not dispatch until Ethan decides)

**Blocked on decision (queue for Ethan):** client `pdfjs-dist` (heavy dep, both
runtimes, in-repo) **vs** bridge-side Go `doc.extract_text` RPC (desktop-only, Web
Lite degrades with an explicit message, lands in `../gatesai-bridge`). Design
recommends the bridge option for extraction quality and bundle discipline.

**title:** `inspect_file: add pdf support (<chosen option>)`

**goal:** Add `pdf` as a `detectFormat` result that yields `string[]` lines for the
existing text handlers; `profile` reports `pages` and per-page line offsets. Same
tool contract as csv/txt. If the bridge option is chosen, the parsing/RPC work is a
separate task in the `gatesai-bridge` repo and `inspect_file` calls that RPC with a
Web Lite graceful-degradation path ("PDF inspection needs the desktop app"); if the
pdfjs option is chosen, lazy/dynamic-import it so it never enters the main bundle.

**owns:** `src/services/tools/inspectFile.ts`, `src/services/tools/documents/pdf.ts`
(+ `../gatesai-bridge` RPC in a separate bridge-repo task if Option A), tests, docs.

**test-cmd:** `npm run ci && npm run test:e2e` (+ `cargo test`/bridge tests if the
bridge option is taken).

**model tier:** smart.

### Action items before Task 2
- File the pdf dependency/runtime decision to `planning/ETHAN-QUEUE.md` (Option A vs
  B), referencing this design doc.
- Once decided, dispatch Task 2 to the correct repo with the chosen option filled in.
