# DISPATCH — AP-1 Item C1: database-plugin package schema + ADR

This is the exact, ready-to-run follow-up task spec for the **first executable
Item** of AP-1. It is self-contained (pure TypeScript core + ADR, no Tauri, no
UI, no store wiring), genuinely unblocked (no dependency on other AP Items), and
sized for one session. Downstream Items D1/D2/X1/D3 are sketched at the bottom
so the harvesting session can queue them once C1 merges; only C1 is dispatched
here.

---

## Task spec (dispatch this)

- **title:** AP-1 C1 — database-plugin package schema, bounds, and ADR (pure core)
- **adapter:** claude (smart tier)
- **owns:**
  - `docs/adr/2026-07-18-database-plugin-packages.md`
  - `src/core/databasePlugins.ts`
  - `tests/core/databasePlugins.test.ts`
- **test-cmd:** `npm run test -- databasePlugins && npm run typecheck && npm run lint`
- **max-cost-usd:** 15 (mechanical-to-moderate; pure parser + doc)

### Goal (verbatim for the lane)

Land the canonical, runtime-free package contract for downloadable database
plugins (`.gatesdb`), plus the ADR that records the transport and data-policy
threat model. This is the foundation every later AP-1 Item imports; it must be
pure (no Tauri `invoke`, no `fetch`, no `localStorage`, no store/UI imports) so
it runs under vitest and typechecks in both desktop and Web Lite builds.

Read first: root `CLAUDE.md`; `docs/plans/07-16-agentic-platform-design.md`
Story AP-1 (the accepted contract — do not re-open it); the sibling execution
plan `docs/plans/unblock-ap-1-downloadable-database-plugins-ship--20260718/execution-plan.md`;
and `src/core/offlineLibrary.ts` (the typed-result/error-kind/versioned-manifest
pattern to mirror). Do not touch sibling repos.

### Deliverable 1 — `src/core/databasePlugins.ts`

Export, as pure types + validators + constants:

1. **Constants:** `DATABASE_PLUGIN_SCHEMA_VERSION = 1`; the default bounds —
   `MAX_COMPRESSED_BYTES = 256 * 1024 * 1024`, `MAX_EXPANDED_BYTES = 1024**3`,
   `MAX_FILES = 100`, `MAX_RESULTS = 50`, `MAX_TRANSCRIPT_CHARS = 32_000`; the
   citation scheme prefix `gatesdb://`.
2. **Manifest types** for `plugin.json` schema 1: immutable `id`, semantic
   `version`, `min_host_version` / `min_schema_version`, publisher/provenance,
   `size_compressed` / `size_expanded`, `datasets[]`, `citation_namespace`,
   `content_license`, `update_url` / catalog identity, and
   `data_policy: 'local_only' | 'cloud_allowed'`. `capabilities` is the fixed
   enum `'catalog.read' | 'schema.read' | 'lookup.read' | 'search.read'`. A
   dataset declares named lookup/search **projections** and bounded scalar
   parameters; it declares **no** runtime SQL text.
3. **Typed result + error union** mirroring `OfflineLibraryResult<T>`:
   `DatabasePluginResult<T> = { ok: true; data: T } | { ok: false; error: DatabasePluginError }`
   with an error-kind union covering at least `web_lite`, `unavailable`,
   `incompatible`, `invalid_manifest`, `too_large`, `bad_path`, `digest_mismatch`,
   `decompression_limit`, `disabled`, `route_policy_block`, `unknown`.
4. **`parseManifest(input: unknown): DatabasePluginResult<DatabasePluginManifest>`**
   — total, throw-free, rejecting: wrong/absent `schema_version`, missing/blank
   `id` or `version`, non-semver `version`, unknown `capabilities`, unknown
   `data_policy`, sizes over bounds, `datasets` over `MAX_FILES`, absolute paths
   / `..` / duplicate dataset paths, and any declared runtime SQL. Host/schema
   incompatibility returns `incompatible`, never a throw.
5. **`buildCitation(pluginId, version, dataset, recordId)`** and its inverse
   `parseCitation(uri)` producing/consuming
   `gatesdb://<plugin-id>@<version>/<dataset>/<record-id>`; round-trip stable,
   opaque, and tolerant of record IDs containing slashes only via encoding
   (decide and test the encoding).
6. **`resolveDataPolicy(manifestPolicy, userPolicy)`** enforcing the ceiling
   rule: default local-only; user may tighten never loosen past the author's
   declaration; expose a pure predicate `isRouteAllowed(dataPolicy, route)` that
   a later X1 lane calls to **block `local_only` + cloud before context
   assembly**.

### Deliverable 2 — `tests/core/databasePlugins.test.ts`

Cover, at minimum: valid manifest round-trips; every rejection branch above with
a hostile fixture (oversize, too many files, traversal path, duplicate dataset,
non-semver, unknown capability/policy, runtime-SQL-present, wrong schema
version); citation build/parse round-trip incl. edge record IDs; data-policy
ceiling (user can tighten to local-only, cannot loosen a `local_only` manifest);
`isRouteAllowed` blocks `local_only`+cloud and allows `local_only`+local and
`cloud_allowed`+cloud. Keep hostile manifests inline in the test (fixtures on
disk are D1's archive concern).

### Deliverable 3 — `docs/adr/2026-07-18-database-plugin-packages.md`

Follow the format of `docs/adr/2026-07-12-offline-library-plugin.md`. Record:
the `.gatesdb` data-only package decision; the dedicated Tauri app-data
installer boundary (vs. the user-workspace jail) and why the generic
`sqlite_query` tool is not reused; the loopback/catalog transport + redirect-
rejection threat model; `data_policy` ceiling semantics and the cloud-route
block; signature **display-not-enforcement** for V1 with trust roots/revocation
deferred; the Web Lite no-invoke degradation; and the version-pinning rule for
in-flight tasks. State explicitly that this ADR governs schema 1 only and that
executable plugins / arbitrary SQL / mutations need their own ADR.

### Definition of done for C1

- `npm run test -- databasePlugins` green; `npm run typecheck` and
  `npm run lint` green. (Full `npm run ci` also fine but the three above are the
  gate.)
- `src/core/databasePlugins.ts` imports nothing from stores/services/components,
  no Tauri/`fetch`/`localStorage`; ESLint layer rules satisfied without weakening
  `eslint.config.js`.
- ADR committed; no changes outside the three `owns` paths; no secrets; no stray
  files.

---

## Downstream queue (NOT dispatched here — queue after C1 merges)

Full `owns` / verify per Item are in `execution-plan.md` section 3. Order:

- **D1** (`src-tauri/src/database_plugins.rs` + engine) and **D2**
  (`src/services/databasePlugins/` + `DatabasePluginStore`) — dispatch in
  parallel once C1 merges; disjoint `owns`. Verify: `cargo test ...` (D1),
  `npm run test -- databasePlugins DatabasePluginStore` (D2).
- **X1** (root-store / context / registry / contextModes / migrations wiring) —
  after D1+D2. **Coordinate schema-version bump and shared-file ordering with
  any concurrent AP-2/AP-3 wiring lane; not parallel-safe.** Verify: `npm run ci`.
- **D3** (model tools + Settings/dock UI) — after X1. Verify:
  `npm run ci && npm run test:e2e`.
- Platform-wide **X2** integration/e2e/truth-docs is reserved for after all four
  AP Stories land and is outside AP-1's lane scope.
