# Plan 002: Make indexing complete, atomic, cancellable, and observable

> **Executor instructions**: Follow this plan step by step and run each gate.
> Stop on any listed condition; do not improvise around persistence. Update this
> plan's row in `plans/README.md` when complete.
>
> **Drift check (run first)**:
> `git diff --stat dee51c2..HEAD -- src/services/rag src/services/persistence src/stores/RootStore.ts tests/services/rag tests/services/persistence tests/stores/ChatStore.test.ts`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/001-measure-semantic-memory.md`
- **Category**: bug / performance / architecture
- **Planned at**: commit `dee51c2`, 2026-07-19
- **Completed**: 2026-07-19

## Why this matters

The current index silently forgets archived threads, performs one Ollama call
per source, and destroys the old index before a rebuild succeeds. That makes a
large real history both incomplete and fragile. This plan establishes a single
asynchronous source repository, generation-based IndexedDB schema, batched work
queue, cancellation, and progress/error state without changing ranking policy.

## Current state

- `src/services/persistence.ts:293-305` writes archived stubs with
  `messages: []`; full content lives in the thread archive store.
- `src/services/persistence/idb.ts:8-12` exposes only get/put/delete, so RAG
  cannot enumerate retained archived conversations.
- `src/services/rag/indexer.ts:161-175` reads only `snapshot.threads`, then
  `purgeMissingWatermarks()` removes any source absent from that snapshot.
- `src/services/rag/indexer.ts:79-107` embeds each source independently, deletes
  its old chunks before embedding, and saves watermarks once per source.
- `src/services/rag/indexer.ts:116-120` clears the entire index before rebuild.
- `src/services/rag/vectorStore.ts:95-165` stores all chunks in one v1 object
  store with no active-generation manifest.
- `src/services/rag/RagStore.ts:153-177` exposes only a boolean `indexing`; it
  logs tick failures but does not retain actionable status or cancel in-flight
  work when streaming begins.

Follow existing patterns:

- IndexedDB promise wrappers: `src/services/persistence/idb.ts`.
- Typed store dependencies and MobX state: `src/services/rag/RagStore.ts`.
- Error reporting: `src/services/diagnostics/logger.ts`; never add `console.*`.
- Persistence/interface fakes: `tests/services/rag/helpers.ts` and the
  `ThreadArchiveStore` fakes near `tests/stores/ChatStore.test.ts:140-181`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| RAG tests | `npm test -- tests/services/rag` | all RAG tests pass |
| Persistence tests | `npm test -- tests/services/persistence tests/stores/ChatStore.test.ts` | all named tests pass |
| Full gate | `npm run ci` | exit 0 |
| E2E | `npm run test:e2e` | all projects pass |

## Scope

**In scope**:

- `src/services/rag/` (including new source-repository/schema modules)
- `src/services/persistence/idb.ts`
- `src/services/persistence.ts` only for an exported archive enumeration facade
- `src/stores/RootStore.ts`
- `tests/services/rag/`
- `tests/services/persistence/`
- Test files/fakes that implement `ThreadArchiveStore`, including
  `tests/stores/ChatStore.test.ts`
- `docs/architecture.md`
- `docs/changelog.md` (completion evidence only)
- `docs/adr/2026-07-19-semantic-memory-v2.md` only if implementation reveals a
  necessary clarification, never to reverse the contract silently

**Out of scope**:

- Hybrid ranking, thresholds, query rewriting, or model-default changes (003).
- React UI, per-source exclusion controls, or persisted retrieval traces (004).
- Chat snapshot schema changes; RAG index data is derived and belongs in its own
  IndexedDB schema.
- Workspace files, tool result bodies, attachments, cloud embeddings, or a new
  database dependency.

## Git workflow

- Branch: `codex/rag-002-index-lifecycle` unless dispatched elsewhere.
- Prefer two commits: source repository/schema, then scheduler/observability.
- Example final subject: `Make semantic index rebuilds atomic and complete`.
- Do not push unless directed.

## Steps

### Step 1: Add one asynchronous source repository across hot and archived chat

Extend `ThreadArchiveStore` with a bounded/enumerable read (`listThreads()` or
an equivalent cursor API) and implement it without hydrating those threads into
`ChatStore`. Add a `RagSourceRepository` under `src/services/rag/` that:

- accepts the current hot/stub threads, notes, and facts;
- loads full archived threads from IndexedDB only for IDs represented by current
  archived stubs (orphaned archive records are not retained sources);
- de-duplicates by thread ID, preferring a current full thread over an archived
  copy;
- excludes soft-deleted threads;
- returns stable source records with source type, source ID, thread ID/title,
  author role, created/updated time, and raw text;
- never includes tool-result content, attachments, activity events, or empty
  assistant placeholders.

Change `RagIndexerDeps.getSources` to asynchronous repository access. RootStore
must inject the repository/facade; do not make the RAG service import a MobX
store or UI module.

Add characterization coverage showing 25 conversations where only the newest
10 are hot: a query/source scan sees all 25, and a deleted archived thread is
absent. Update every `ThreadArchiveStore` fake to implement enumeration.

**Verify**: `npm test -- tests/services/rag tests/services/persistence tests/stores/ChatStore.test.ts`
passes, including a test named for archived-thread corpus completeness.

### Step 2: Introduce a versioned generation manifest and exact vector contract

Upgrade the separate RAG IndexedDB schema. Store:

- an index manifest containing schema version, active generation ID, embedding
  model, vector dimensions, chunk-policy version, started/completed times, and
  source/chunk counts;
- chunks keyed by generation plus stable chunk ID;
- source fingerprints/checkpoints for the generation.

Reject or quarantine (as derived stale data) chunks whose model, dimensions, or
chunk-policy version differ from the active manifest. Dot product must require
equal vector lengths; replace the current `Math.min(a.length, b.length)` behavior
with validation, not partial comparison.

Migration rule: v1 vectors are derived cache. Leave them readable only long
enough to keep recall available while v2 builds; activate v2 only after a
complete successful build, then remove the superseded v1 cache through the
normal IndexedDB upgrade/cleanup path. Never clear the last good active
generation before its replacement is committed.

**Verify**: vector-store tests cover v1/no-manifest boot, dimension mismatch,
inactive partial generation, atomic activation, and cleanup after activation.

### Step 3: Batch chunks across sources and commit source replacements atomically

Refactor the indexer into prepare → batch embed → transactional write:

1. Collect/fingerprint changed sources without writing.
2. Produce stable chunks with source metadata.
3. Flatten chunks across sources into embedding batches (start with the existing
   client batch limit; keep it configurable in tests).
4. Validate one returned vector per input and consistent dimensions.
5. Write a source's new chunks and remove its old chunks in the same IndexedDB
   transaction only after all that source's embeddings succeeded.
6. Persist checkpoints in batches, not one localStorage write per message.

Stable chunk IDs must not depend on array position alone. Include source ID,
content fingerprint/chunk-policy version, and chunk ordinal so unchanged text
does not churn. Facts need identity derived from normalized content rather than
their current array index (`memory-${index}`).

**Verify**: tests prove 100 one-chunk sources use batched embed calls rather than
100 calls; a failed batch preserves the prior active generation/source chunks;
and reordered facts do not all reindex.

### Step 4: Make indexing yield to chat and resume safely

Give every run an `AbortController`. When any chat starts streaming, cancel the
current embedding request, retain the last good index, and checkpoint completed
sources. Resume after the existing quiet/debounce window. Prevent overlapping
tick/rebuild jobs with one explicit state machine rather than the current
`inFlight` boolean plus timer.

Expose observable state at least equivalent to:

- `phase: idle | scanning | embedding | committing | paused | failed`;
- sources/chunks completed and total;
- active generation timestamp/model;
- last successful completion and last error code/message;
- whether recall is serving a complete active generation.

Logs must use low-cardinality fields and never include source text.

**Verify**: fake-timer/abort tests start a rebuild, begin streaming during a
batch, assert abort and `paused`, end streaming, advance debounce, and assert a
successful resume with the prior generation available throughout.

### Step 5: Reconcile source deletion, import, and clear behavior

Source removal must purge the active index promptly after the recoverable app
mutation settles, including note/fact removal, soft-deleted threads, clear-all,
and imported replacement snapshots. Undo/restore must re-add the source. Do not
couple RAG directly to every mutation method; use the source digest/repository
change boundary and a high-priority purge queue.

`clearIndex()` clears only derived vectors/checkpoints and leaves all chats,
notes, and facts intact. Its next state must be explicit (`empty`, rebuild
available), not reported as an unexplained active index with zero chunks.

**Verify**: integration tests cover soft-delete → absent, undo → present,
clear-all → old sources absent, replace import → only imported sources, and
clear-index → primary data unchanged.

### Step 6: Document and run the full gate

Update the architecture RAG/persistence sections with the asynchronous source
repository, index generation manifest, batch/cancel lifecycle, and the fact that
archived threads remain recallable without opening them. Add a concise
top-of-file changelog entry; do not close the semantic-memory roadmap epic yet.

**Verify**: `npm run ci && npm run test:e2e` exits 0.

## Test plan

- Extend `tests/services/rag/indexer.test.ts` for archived sources, stable IDs,
  batch counts, checkpoint resume, failure atomicity, deletion, and undo source
  return.
- Extend `tests/services/rag/vectorStore.test.ts` for schema/generations,
  dimensions, transactions, active-generation reads, and migration.
- Extend `tests/services/rag/RagStore.test.ts` for state-machine phases,
  cancellation, retry, and complete-generation availability.
- Extend persistence tests for `ThreadArchiveStore` enumeration without changing
  normal ChatStore hydration behavior.
- Model asynchronous IDB fakes after existing archive/RAG persistence fakes;
  do not make unit tests require a browser server or Ollama.

## Done criteria

- [x] Hot plus archived retained threads are present exactly once in the source corpus.
- [x] Deleted sources are absent and restore/undo re-adds them.
- [x] Rebuild failure/cancellation never removes the last complete active index.
- [x] Embedding requests are cross-source batched and cancellable on chat start.
- [x] Vector dimensions and index policy/model metadata are exact and versioned.
- [x] Index progress, paused state, active generation, and last error are observable.
- [ ] `npm run ci` and `npm run test:e2e` pass (deferred to final integrated gate).
- [x] No files outside scope are modified.
- [x] No files outside scope (plus leased bookkeeping) are modified.

## STOP conditions

- Archived threads cannot be enumerated without changing the public chat snapshot
  or loading every thread into MobX memory.
- Atomic source replacement requires a cross-database transaction between the
  chat archive and RAG DB; report instead of pretending IndexedDB can provide it.
- The implementation would delete primary chat/note/fact data rather than only
  derived RAG cache.
- Adding a dependency or moving vectors to a sidecar appears necessary.
- An in-scope persistence contract drifted materially from `dee51c2`.
- A verification fails twice after a reasonable correction.

## Maintenance notes

Any future source type must implement stable identity, deletion, exclusion, and
role/provenance before it enters the repository. Reviewers should scrutinize
transaction boundaries and abort paths more than happy-path throughput. Keep
the previous active generation until the manifest switch is durable.
