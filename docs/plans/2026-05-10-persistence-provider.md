# Persistence Provider Boundary

## Goal

Prepare the storage layer for future IndexedDB or Firestore work without
changing store APIs in the current foundation build.

## Implemented

- Added `services/storage/persistenceProvider.ts` with:
  - `KeyValuePersistence`
  - `PersistenceProvider<T>`
  - `createJsonPersistenceProvider(...)`
  - `browserLocalStorage()`
- Kept `services/storage/jsonSlot.ts` as a compatibility wrapper over the new
  provider factory.
- Exposed named provider instances from existing storage modules while
  preserving their old `loadX` / `saveX` function exports.
- Moved chat snapshot load/save/clear behind
  `ChatSnapshotPersistenceProvider`, including the existing migration and
  emergency-compaction behavior.
- Added tests for injected storage backends, malformed JSON fallback, swallowed
  backend failures, and chat snapshot emergency compaction.

## Follow-Ups

- Add async repository variants before Firestore or IndexedDB integration.
- Move store constructors to accept repository dependencies once the root
  composition cleanup starts.
- Keep localStorage as the default production adapter until sync/auth decisions
  are settled.
