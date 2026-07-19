# IDB background compaction; storage stats in Usage panel

**Roadmap item:** `docs/roadmap.md` → *Future ideas backlog → Performance* →
"IDB background compaction; storage stats in Usage panel".
**Ethan's decision (verbatim):** APPROVED.
**Lane:** `unblock-idb-background-compaction-storage-stats--20260718` (Claude).
**Deliverable type:** design + execution plan (this doc) plus an exact
implementation follow-up spec (`DISPATCH.md`). No source is changed in this
lane — the lease covers only `docs/plans/<task-id>/`.

---

## 1. Problem statement

Two independent-but-related gaps in the persistence tier:

### 1a. IndexedDB archive never gets compacted (the bug this fixes)

The archive tier keeps the newest `HOT_THREAD_LIMIT = 20` threads "hot" in the
localStorage snapshot and pushes the rest into IndexedDB as full copies, leaving
lightweight **stubs** (`messages: []`, `archived: true`) behind in localStorage
(`src/services/persistence.ts:219-251`). Hydration reads a full thread back from
IDB on demand (`loadArchivedThread`, `persistence.ts:350-366`;
`ChatStore.hydrateThread`).

The store interface already has a `deleteThread(id)` method
(`src/services/persistence/idb.ts:11,44-51`) — **but grep confirms it is never
called anywhere in `src/`.** Consequently the IDB `threads` object store only
ever grows. It accumulates orphaned records in every one of these ordinary
flows:

- **Hydrate-back-to-hot.** When an archived thread is touched it is swapped from
  a stub to a full hot thread in localStorage (`prepareSnapshotForArchiveTier`
  keeps it hot; `ChatStore` hydrates it). The localStorage copy is now
  canonical, but the IDB copy is left behind as a stale duplicate.
- **Thread deletion.** Trashing or permanently deleting a thread removes it from
  the snapshot, but if it had been archived its full copy stays in IDB forever.
- **Import/replace.** A versioned import that replaces app data drops old thread
  ids from the snapshot; their IDB records are never reclaimed.

Nothing corrupts today — hydration is keyed by id and orphans are simply never
read — but IDB usage grows unbounded, which is exactly the disk-cost problem a
"background compaction" pass is meant to bound. There is **no scheduler** for any
of this today: archiving happens inline-on-save (microtask-deferred via
`scheduleSaveSnapshot`); there is no `requestIdleCallback`, no periodic pass, no
GC.

### 1b. No storage visibility for the user

There is **no code anywhere** that queries `navigator.storage.estimate()`,
`StorageManager`, or IDB size (repo-wide grep over `src/` + `tests/` is empty).
The Usage panel (`src/components/menu/sections/Usage.tsx`) shows LLM
spend/tokens per model and per day, but a user on a device that is filling up has
no way to see how much space GatesAI is using, how close it is to the browser
quota, or how many threads are hot vs archived. The proactive-archive threshold
breach only writes a one-time `logger.warn` (`persistence.ts:190-197`); it never
surfaces to the user.

## 2. Goal / definition of done

1. **Background compaction:** a debounced, idle-scheduled pass reconciles the IDB
   `threads` store against the live snapshot and deletes orphaned/duplicated
   archive records, bounding IDB growth. Off the critical path; race-safe against
   in-flight tiered saves; never deletes a record that is still the canonical
   copy of a live archived stub.
2. **Storage stats in Usage:** a new "Storage" block in the Usage panel showing
   estimated bytes used / quota (from `navigator.storage.estimate()`), a
   percentage/bar, and hot-vs-archived thread counts. Degrades gracefully where
   the API is unavailable (older browsers / headless).
3. Both runtimes considered — desktop **and** Web Lite (IDB and
   `navigator.storage` behave identically; the only branch is the
   feature-absent guard). No `console.*`, no raw `localStorage` in
   stores/components, layer boundaries respected.
4. Tests at the right layer; `npm run ci` + `npm run test:e2e` green. No Rust
   change (this is entirely browser-storage; `cargo test` not required).

## 3. Design

### 3.1 IDB store: add enumeration + keep `deleteThread`

`ThreadArchiveStore` (`src/services/persistence/idb.ts:8-12`) gains one method:

```ts
export interface ThreadArchiveStore {
  getThread(id: string): Promise<Thread | null>;
  putThread(thread: Thread): Promise<void>;
  deleteThread(id: string): Promise<void>;
  listThreadIds(): Promise<string[]>;   // NEW — IDBObjectStore.getAllKeys()
}
```

`listThreadIds` uses `store.getAllKeys()` in a `readonly` transaction and maps
the results to `string[]`. No DB-version bump is needed (the object store shape
is unchanged; `getAllKeys` reads existing keys). The in-memory test double
implements it over its backing `Map`.

Optionally (nice-to-have, see 3.4) add `estimateArchiveBytes(): Promise<number>`
that sums serialized record sizes; the simpler `listThreadIds().length` is enough
for the count shown in the panel, so keep the byte-estimate optional and prefer
`navigator.storage.estimate()` for the headline number.

### 3.2 Compaction pass in `persistence.ts`

Add an exported async function:

```ts
export async function compactThreadArchive(snapshot: ChatSnapshot): Promise<CompactionResult>
```

Algorithm (reconcile-to-live-stubs, the race-safe rule):

1. If no archive store is available (`getThreadArchiveStore()` → null), return a
   no-op result.
2. Compute `liveArchivedIds = new Set(snapshot.threads.filter(t => t.archived).map(t => t.id))`
   — the exact set of ids whose canonical full copy *should* live in IDB.
3. `const storedIds = await store.listThreadIds();`
4. For every `id` in `storedIds` **not** in `liveArchivedIds`, call
   `store.deleteThread(id)`. These are orphans: either the thread is gone from
   the snapshot entirely, or it is present as a **hot** (non-archived) thread
   whose full data is canonical in localStorage. Deleting the IDB copy is
   lossless in both cases.
5. Return `{ scanned, deleted, remaining }` for logging/telemetry.

**Why this rule is race-safe:** a hot thread's messages are fully present in
localStorage, so deleting its stale IDB duplicate can never lose data even if a
save is concurrently re-archiving it — the worst case is the next tiered save
re-writes a fresh IDB record via `putThread`. We only ever delete records whose
data is *not* the live source of truth. We do **not** delete records backing a
live archived stub. Guard the pass so it does not run while a tiered save is
in flight (reuse the `pendingArchiveSaves` set: skip/await if non-empty), and
snapshot `saveGeneration` at entry so a stale pass is a no-op if a newer save
started (mirrors `saveTieredSnapshot`'s generation guard at
`persistence.ts:215`).

### 3.3 Scheduling: idle + debounced, driven from the coordinator

Compaction is a maintenance task, not a save path, so it belongs on the idle
scheduler, driven from `ChatPersistenceCoordinator`
(`src/stores/chatPersistenceCoordinator.ts`) which already owns the autosave
lifecycle:

- Add a small idle scheduler helper `scheduleIdle(cb)` using
  `requestIdleCallback` when present, falling back to `setTimeout(cb, 0)`
  (jsdom/headless/Safari). Keep it tiny and injectable for tests.
- In the coordinator, after a save settles, arm a **debounced** idle compaction
  (e.g. coalesce to at most once per ~30 s and only when the snapshot actually
  archived something / thread count changed). Cancel any pending idle callback on
  `dispose()`. Do **not** compact on every keystroke-triggered save.
- Also run one compaction pass shortly after startup (once hydration settles) to
  reclaim orphans left by a previous session's deletions.
- Respect `paused` (multi-tab follower): a follower tab must not mutate IDB.
  Only the leader/active writer compacts. (The coordinator already suppresses
  writes when `paused`; gate compaction on the same flag.)

Emit a single `logger.info('persistence', 'compacted thread archive', result)`
per pass (never `console.*`).

### 3.4 Storage stats service

New pure-ish service `src/services/persistence/storageStats.ts`:

```ts
export interface StorageStats {
  usageBytes: number | null;    // navigator.storage.estimate().usage
  quotaBytes: number | null;    // navigator.storage.estimate().quota
  snapshotBytes: number;        // localStorage chat snapshot length (UTF-16→bytes est.)
  archivedThreadCount: number;  // await store.listThreadIds().length
  supported: boolean;           // navigator.storage?.estimate present
}

export async function readStorageStats(): Promise<StorageStats>
```

- Guard `navigator?.storage?.estimate` — return `{ supported: false, usageBytes:
  null, quotaBytes: null, ... }` where absent (older browser, headless). Never
  throw.
- `snapshotBytes` is read via the persistence layer, not by touching
  `localStorage` directly from a component (respect the "no raw localStorage in
  stores/components" rule — expose a `chatSnapshotByteSize()` from
  `persistence.ts` that reads `CHAT_SNAPSHOT_STORAGE_KEY` through the existing
  `KeyValuePersistence` provider).
- `archivedThreadCount` from the archive store's new `listThreadIds()`.

### 3.5 Usage panel surface

`src/components/menu/sections/Usage.tsx` gains a "Storage" section below the
existing usage tables. Because the stats are async, drive them through a small
store/hook rather than calling the service inline in render:

- Add a lightweight observable (either a new `StorageStatsStore` or a field on an
  existing store facade — prefer a minimal `useStorageStats()` hook that loads
  once on mount and exposes `{ stats, loading, refresh }`). Keep it in the store
  layer so the component stays view-only, consistent with `useChatStore()` /
  `useModelRegistry()` usage in the panel.
- Render:
  - "Storage used **X of Y** (Z%)" with a thin progress bar, when
    `usageBytes`/`quotaBytes` are present.
  - "Chat snapshot **X**" (localStorage hot tier) and "Archived threads **N**".
  - A graceful "Storage estimate unavailable in this browser" line when
    `supported === false` (Web Lite on old browsers / headless) — never a broken
    or empty widget.
  - Optional manual "Compact now" affordance is **out of scope for v1** (keep the
    surface read-only; compaction runs automatically). Note it as a follow-up.
- Add a `formatBytes(n: number): string` helper to `src/core/usage.ts` beside
  `formatUsd`/`formatTokenCount` (KB/MB/GB, 1 decimal). Unit-test it.

Registration is unchanged — `menuSectionMeta.ts` already lists `usage` as
`supported: true` in both runtimes.

### 3.6 What is deliberately NOT in scope

- No new Rust/Tauri command — everything is browser storage.
- No schema/migration bump — the IDB object-store shape and the localStorage
  snapshot shape are unchanged (`schemaVersion` stays 3; IDB DB version stays 1).
  Adding `getAllKeys`-based enumeration reads existing keys.
- No "Compact now" button, no per-thread storage breakdown, no eviction of hot
  threads for space (the archive tier already handles hot/cold sizing).
- No change to hydration or the archive-write path beyond adding the delete
  reconciliation.

## 4. Testing plan

Follow the existing pattern: pure logic + injected in-memory store, tests under
`tests/`, no `fake-indexeddb` (the repo uses a hand-rolled `ThreadArchiveStore`
double via `setThreadArchiveStoreForTests`, `persistence.ts:51-55`).

- **`tests/services/persistence.test.ts`** (extend `memoryThreadArchiveStore`
  with `listThreadIds`):
  - compaction deletes an orphan whose id is absent from the snapshot;
  - compaction deletes the IDB record for a thread now present as a **hot**
    (non-archived) thread (hydrate-back case);
  - compaction **keeps** the record for a live archived stub;
  - no-op when the store is `null` / unavailable;
  - generation guard: a stale pass does not delete records written by a newer
    save (assert via ordering with `flushThreadArchiveSavesForTests`);
  - respects `paused` when driven through the coordinator (see below).
- **`tests/services/persistence/storageStats.test.ts`** (new): stub
  `navigator.storage.estimate` (present → returns usage/quota; absent →
  `supported:false`); assert `snapshotBytes`/`archivedThreadCount` wiring and the
  no-throw guard.
- **`tests/core/usage.test.ts`**: `formatBytes` boundaries (0, <1KB, MB, GB,
  non-finite → safe).
- **`tests/stores/chatPersistenceCoordinator.test.ts`** (or the existing
  coordinator/ChatStore test): compaction is scheduled after a save, debounced
  (not once-per-save), cancelled on `dispose`, and suppressed while `paused`.
  Inject the idle scheduler so the test can flush it synchronously.
- A minimal render assertion for the Usage "Storage" block if a section render
  harness exists; otherwise cover via the `useStorageStats` hook/selector unit
  test (the repo's convention is to test pure selectors/hooks rather than JSX for
  menu sections).

E2E: the existing Usage e2e coverage should stay green; add nothing heavy —
`navigator.storage.estimate` is available in Chromium/Playwright, so the Storage
block will render, but avoid asserting exact byte values (assert the block and
labels exist).

## 5. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Deleting an IDB record that a concurrent save is re-archiving | Only delete records **not** backing a live archived stub; hot-thread data is canonical in localStorage, so re-write is lossless. Generation guard + skip while `pendingArchiveSaves` non-empty. |
| Follower tab mutating IDB | Gate compaction on the coordinator `paused` flag (Web Locks follower is already paused). |
| `navigator.storage.estimate()` absent/older browsers | `supported:false` path renders an explainer, never throws. |
| Idle callback never fires (jsdom/headless) | `setTimeout(0)` fallback; tests inject a synchronous scheduler. |
| Estimate is coarse/inflated (browsers pad quota) | Present as an estimate ("~"), never as an exact guarantee; primary value is trend/awareness. |

## 6. Acceptance checklist (for the implementation lane)

- [ ] `listThreadIds()` added to `ThreadArchiveStore` + IDB impl + in-memory test
      double.
- [ ] `compactThreadArchive(snapshot)` reconciles IDB against live archived stub
      ids; deletes orphans + hydrated-back duplicates; keeps live stubs; no-ops
      when store unavailable; generation/pending-save guarded.
- [ ] Idle+debounced scheduling from `ChatPersistenceCoordinator`; respects
      `paused`; cancelled on `dispose`; one startup pass.
- [ ] `storageStats.ts` service with graceful unavailable path;
      `chatSnapshotByteSize()` exposed from `persistence.ts` (no raw localStorage
      in the component).
- [ ] Usage panel "Storage" block (used/quota + %, snapshot size, archived
      count, unavailable explainer); `formatBytes` in `core/usage.ts`.
- [ ] Tests at each layer per §4; `npm run ci` + `npm run test:e2e` green.
- [ ] `docs/architecture.md` note on the compaction rule + threshold; changelog
      entry; roadmap checkbox ticked by the harvesting session.
- [ ] No `console.*`, no raw `localStorage`/`fetch` in stores/components; layer
      lint clean.

## 7. Follow-up dispatch

The exact implementation task spec is in
[`DISPATCH.md`](./DISPATCH.md) in this folder.
