# Inspect File Tool Design

## Goal

Add one semantic file-inspection tool so the assistant can answer questions about large files without loading whole CSV, JSON, or text files into model context.

## Recommended Approach

Create a single `inspect_file` tool beside `fs`. `fs` remains the raw filesystem facade for reading and writing bytes; `inspect_file` becomes the higher-level parser facade for questions like "what columns are in this CSV?", "show records where status is failed", or "what keys exist in this JSON?".

Day one supports:
- `csv`: headers, row counts, sample rows, column summaries, filtering, and simple aggregation.
- `json`: top-level shape, object keys, array lengths, sample records, and path extraction.
- `txt`: metadata, preview, search, and line ranges.

Later phases add source-code structure for `py`, `js`, `ts`, and `go`, followed by document formats such as `pdf`, `docx`, and `xlsx` once bridge-side parsers are available.

## Architecture

`inspect_file` lives in the service layer under `src/services/tools/inspectFile.ts` and registers through `ToolRegistry`, matching the existing tool pattern. It depends only on `ToolContext.bridge` and calls the bridge's existing `fs.read` operation to get file content locally. The model receives compact summaries or selected slices, not raw full-file content.

The tool has no side effects. Its result policy should allow enough room for tables and schema summaries while still avoiding context floods.

## Actions

Initial actions:
- `profile`: detect format, return size, row/key/line counts, headers or shape.
- `preview`: return a bounded sample with configurable row/line limits.
- `search`: find text matches in CSV rows, JSON stringified values, or text lines.
- `extract`: return selected CSV columns, JSON paths, or text line ranges.
- `aggregate`: CSV-only simple count/sum/avg/min/max grouped by an optional column.

## Error Handling

Unsupported formats return a clear error with supported extensions. Invalid CSV columns, JSON paths, and line ranges return actionable messages. Binary files should be rejected unless they are later handled by a dedicated parser.

## Testing

Add focused unit tests for the tool using a fake bridge context:
- CSV profile avoids dumping entire files and reports headers/row count.
- CSV extract returns only requested columns and row limits.
- JSON profile summarizes nested shape and array lengths.
- Text extract returns requested line ranges.
- Registry includes `inspect_file` when file/data language appears in the user turn.
