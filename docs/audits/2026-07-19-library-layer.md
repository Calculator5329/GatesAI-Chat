# Local knowledge library — implementation evidence

Date: 2026-07-19

## Outcome

The replacement database/library layer is a native, deliberately small part of
Agent → Memory. It does not restore the retired `.gatesdb` plugin platform,
loopback Offline Library service, marketplace, daemon, or dedicated knowledge
mode.

Users explicitly add supported files from the active GatesAI workspace.
Document content is kept in memory and participates in the existing local RAG
pipeline; only source registrations are persisted and exported. Registered
SQLite files contribute schema definitions. Models can request bounded rows
only through the existing separate read-only `sqlite_query` tool.

## Safety and control

- Native picker results are accepted only when contained by the active bridge
  workspace, with case-sensitive comparison on Unix and case-insensitive
  comparison on Windows.
- Documents are limited to 2 MB and supported text-like formats.
- SQLite opens with `mode=ro`; schema inspection queries `sqlite_master`, caps
  output to 300 objects, and never selects application rows.
- Disabling a source immediately removes its in-memory RAG contribution.
  Re-enabling reloads it. There is intentionally no destructive remove action.
- Import rejects escaping or unsupported paths and keeps valid registrations
  when another saved entry is stale.
- Web Lite shows the desktop requirement and performs no local file operation.

## Verification

Focused tests cover workspace containment, document bounds, schema-only SQLite,
source persistence and reversible controls, safe export/import, library RAG
provenance, read-only tool behavior, registry availability, and Agent UI state.

- `env -u NODE_ENV npm run ci`: **pass** — 162 files, 1,174 tests,
  TypeScript, and ESLint.
- `env -u NODE_ENV npm run test:e2e`: **pass** — 28 desktop-mocked and
  Web Lite browser tests.
