# DISPATCH — implementation follow-up

This lane produced the design ([`PLAN.md`](./PLAN.md)) only. The following is an
exact spec for the implementation lane that makes the source changes.

---

**title:** IDB background compaction + storage stats in Usage panel (impl)

**goal:**
Implement the design in
`docs/plans/unblock-idb-background-compaction-storage-stats--20260718/PLAN.md`.
Two shippable pieces:

1. **Background IDB compaction.** The archive tier writes cold threads to
   IndexedDB but never deletes stale records (`deleteThread` exists at
   `src/services/persistence/idb.ts:44-51` but is called nowhere), so the store
   grows unbounded across hydrate-back, thread-delete, and import flows.
   - Add `listThreadIds(): Promise<string[]>` to the `ThreadArchiveStore`
     interface (`idb.ts:8-12`), implemented with `IDBObjectStore.getAllKeys()`
     in a readonly txn; implement it in the in-memory test double too. No DB
     version bump (`open(..., 1)` unchanged).
   - Add `compactThreadArchive(snapshot: ChatSnapshot)` to
     `src/services/persistence.ts`: compute the set of live **archived** stub
     ids from the snapshot, list stored IDB ids, and `deleteThread` every stored
     id not in that set (orphans + hydrated-back duplicates whose canonical copy
     is now in localStorage). No-op when `getThreadArchiveStore()` is null.
     Guard against races: snapshot `saveGeneration` at entry and bail if it
     advanced; skip while `pendingArchiveSaves` is non-empty. Return
     `{ scanned, deleted, remaining }`; `logger.info` once per pass.
   - Schedule it from `ChatPersistenceCoordinator`
     (`src/stores/chatPersistenceCoordinator.ts`): a debounced, idle-scheduled
     pass (`requestIdleCallback` with `setTimeout(cb,0)` fallback, injectable for
     tests), coalesced to ~once per 30s and only when archiving actually
     happened; one pass shortly after startup; cancelled on `dispose()`;
     suppressed while `paused` (Web Locks follower must not mutate IDB).

2. **Storage stats in the Usage panel.**
   - New `src/services/persistence/storageStats.ts` exporting
     `readStorageStats(): Promise<StorageStats>` (`usageBytes`, `quotaBytes`
     from `navigator.storage.estimate()`; `snapshotBytes`; `archivedThreadCount`
     from `listThreadIds()`; `supported`). Guard `navigator?.storage?.estimate`
     — return `supported:false` and never throw when absent.
   - Expose `chatSnapshotByteSize()` from `persistence.ts` (reads
     `CHAT_SNAPSHOT_STORAGE_KEY` via the existing `KeyValuePersistence` provider)
     so the component never touches `localStorage` directly.
   - Add `formatBytes(n)` to `src/core/usage.ts` beside `formatUsd`.
   - Add a "Storage" block to `src/components/menu/sections/Usage.tsx`: used/quota
     + percent bar, chat-snapshot size, archived-thread count, and a graceful
     "estimate unavailable" line when `supported:false`. Load stats via a
     minimal `useStorageStats()` hook/store (view stays observer-only) — do not
     call the async service directly in render. No "Compact now" button in v1.

   Both runtimes: desktop and Web Lite behave identically (IDB +
   `navigator.storage`); only the feature-absent guard differs. No Rust change.
   No schema/migration bump. No `console.*`; no raw `localStorage`/`fetch` in
   stores/components; respect UI→store→service layer lint.

**owns:**
- `src/services/persistence/idb.ts`
- `src/services/persistence.ts`
- `src/services/persistence/storageStats.ts` (new)
- `src/stores/chatPersistenceCoordinator.ts`
- `src/core/usage.ts`
- `src/components/menu/sections/Usage.tsx`
- store/hook wiring for `useStorageStats` (e.g. `src/stores/` + `src/stores/context.tsx` if a new store is added)
- `tests/services/persistence.test.ts`
- `tests/services/persistence/storageStats.test.ts` (new)
- `tests/core/usage.test.ts`
- `tests/stores/chatPersistenceCoordinator.test.ts` (or the existing coordinator/ChatStore test)
- `docs/architecture.md` (compaction rule note), `docs/changelog.md`

**test-cmd:** `npm run ci && npm run test:e2e`
(`cargo test` not required — no `src-tauri/` change.)

**acceptance:** the checklist in `PLAN.md` §6. Concretely:
- Unit tests prove compaction deletes orphans + hydrated-back duplicates, keeps
  live archived stubs, no-ops when the store is unavailable, and is
  generation/pending-save guarded.
- Coordinator test proves compaction is debounced (not once-per-save), cancelled
  on dispose, and suppressed while `paused`, using an injected idle scheduler.
- `storageStats` test covers present + absent `navigator.storage.estimate`.
- `formatBytes` unit test covers 0 / <1KB / MB / GB / non-finite.
- Usage panel renders the Storage block (and the unavailable explainer path).
- `npm run ci` + `npm run test:e2e` green; layer lint clean; changelog +
  architecture note added; roadmap checkbox
  ("IDB background compaction; storage stats in Usage panel") ticked.

**notes / anchors for the implementer:**
- Archive tier: `saveCleanedSnapshot` `persistence.ts:179-206`;
  `prepareSnapshotForArchiveTier` `:219-251`; stubs `createArchivedThreadStub`
  `:292-321`; `getThreadArchiveStore` `:323-327`; `loadArchivedThread` `:350-366`;
  `pendingArchiveSaves`/`flushThreadArchiveSavesForTests` `:335-348`; generation
  guard `saveGeneration` `:40,180,215`.
- Test double + injection: `setThreadArchiveStoreForTests` `:51-55`;
  `memoryThreadArchiveStore()` in `tests/services/persistence.test.ts` (~`:566`).
- Coordinator autosave/pause lifecycle:
  `src/stores/chatPersistenceCoordinator.ts` (`schedule`, `pause/resume`,
  `dispose`, `start`).
- Usage UI + selectors: `src/components/menu/sections/Usage.tsx`,
  `src/core/threadSelectors.ts:42-177`, `src/core/usage.ts` (`formatUsd`
  `:95-100`).
- Runtime guard reference: `src/core/runtime.ts` (`isHeadless`, `isWebLite`).

**adapter:** claude or codex (either — mechanical + well-scoped).
**model tier:** smart.
**est. size:** one focused session (~$15–25 cap).
