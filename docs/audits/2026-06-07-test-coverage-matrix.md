# Audit Batch A–E — Test Coverage Matrix

**Date:** 2026-06-07 (updated after gap-fill pass)  
**Source:** Section 9 of [`2026-06-07-comprehensive-audit.md`](./2026-06-07-comprehensive-audit.md)  
**Scope:** Vitest (`tests/`) and Playwright (`tests/e2e/`). Status reflects what exists in the repo today, not aspirational coverage.

**Status legend**

| Status | Meaning |
|--------|---------|
| **covered** | Tests directly assert the batch behavior |
| **partial** | Adjacent or helper-level tests only; UI wiring or edge paths untested |
| **gap** | No meaningful automated test for this item |

---

## Batch A — Safety first

| Item | Implementation | Tests | Status |
|------|----------------|-------|--------|
| Chat-history protection across all tool paths | `src/services/tools/protectedWorkspacePaths.ts`; guards in `fs.ts`, `inspectFile.ts`, `terminal.ts`, `pythonInline.ts`, `sqliteQuery.ts` | `tests/services/tools/protectedWorkspacePaths.test.ts`; `tests/services/tools.test.ts` (fs, inspect, terminal, python, sqlite denials) | **covered** (app-side tools only; bridge bypass remains untested) |
| Multi-tab overwrite warning | `src/services/storage/persistenceProvider.ts`; `src/stores/ChatStore.ts`; `src/components/editorial/EditorialComposer.tsx` | `tests/services/storage/persistenceProvider.test.ts`; `tests/stores/ChatStore.test.ts` (pause + reload); `tests/services/persistence.test.ts` (last-write-wins doc); `tests/components/editorial/EditorialComposer.test.ts` — `renders persistence conflict and compaction notices` | **partial** (banner + pause + reload covered; no BroadcastChannel merge, no Playwright multi-tab e2e) |
| Image cancel runner lock | `src/stores/ImageJobStore.ts` | `tests/stores/ImageJobStore.test.ts` — cancel-chain serialization | **covered** |
| Stale turn finalization guard | `src/stores/ChatStore.ts` (`ownsStreamingTurn`) | `tests/stores/ChatStore.test.ts` — abandoned finalize guards | **covered** |

---

## Batch B — Conversation correctness

| Item | Implementation | Tests | Status |
|------|----------------|-------|--------|
| Per-thread draft | `src/stores/UiStore.ts` (`bindDraftThread`); `src/stores/RootStore.ts` | `tests/stores/UiStore.test.ts`; `tests/e2e/desktop.spec.ts` | **covered** |
| Per-thread lastError | `src/stores/ChatStore.ts` (`lastErrorByThread`) | `tests/stores/ChatStore.test.ts`; `tests/e2e/desktop.spec.ts` | **covered** |
| Manual rename protection | `src/stores/ChatStore.ts` | `tests/stores/ChatStore.test.ts` — `manual rename prevents auto-naming…` | **covered** |
| Soft-delete streaming annotation | `src/stores/ChatStore.ts` (`softDeleteThread` → `interruptThread`) | `tests/stores/ChatStore.test.ts` — `softDeleteThread while streaming annotates the partial assistant reply` | **covered** |
| Summary scheduler ignores any streaming thread and excludes deleted threads | `src/stores/SummaryStore.ts` | `tests/stores/SummaryStore.test.ts` | **covered** |

---

## Batch C — User clarity

| Item | Implementation | Tests | Status |
|------|----------------|-------|--------|
| Rename "API" copy to "Models" | Composer, menu, settings; `src/services/router.ts` | `tests/components/editorial/EditorialComposer.test.ts`; `tests/components/menu/GatesMenu.test.ts`; `tests/services/router.test.ts`; e2e banner copy | **covered** |
| Context-aware provider banners | `src/components/editorial/EditorialComposer.tsx` | `tests/components/editorial/EditorialComposer.test.ts` — OpenRouter key, Ollama offline (`Start Ollama…`), Comfy direct-image gating; conflict/compaction `NoticeBanner` | **covered** |
| First-run setup checklist | `src/components/editorial/EditorialChat.tsx` (`ChatEmptyState`) | `tests/components/editorial/EditorialChat.test.ts` — empty-state checklist with undone/done steps | **covered** |
| Model picker as a real button | `src/components/editorial/EditorialComposer.tsx` | `tests/components/editorial/EditorialComposer.test.ts` — `exposes the model picker as an accessible button`; e2e loads composer | **covered** |
| Desktop menu/gear affordance | `src/components/editorial/EditorialComposer.tsx` (`composer-menu-btn`) | `tests/components/editorial/EditorialComposer.test.ts` — `exposes the desktop menu button with an accessible label`; e2e menu navigation | **covered** |

---

## Batch D — Image polish

| Item | Implementation | Tests | Status |
|------|----------------|-------|--------|
| Show image job cards expanded or outside collapsed activity rows | `src/components/editorial/activity/ActivityRow.tsx` | `tests/components/editorial/ActivityRow.test.ts` — `activity-row__image-jobs` placement; tool rows stay collapsible | **covered** |
| Show partial failed/cancelled results | `src/components/editorial/ImageJobCard.tsx` | `tests/components/editorial/ImageJobCard.test.ts` — `shows partial thumbnails and cancel copy when a job was cancelled mid-batch` | **covered** |
| Better batch tracking (`prompt_file` returns `{ content, artifacts[] }`) | `src/services/tools/imageGenerate.ts` | `tests/services/tools/imageGenerate.test.ts` | **covered** |
| Missing-artifact failed state | `src/components/editorial/ImageJobCard.tsx` (`BigImage` via `useImageDataUrl`) | `tests/components/editorial/ImageJobCard.test.ts` — `shows Image file missing when the workspace artifact cannot be loaded` | **covered** |

---

## Batch E — Storage durability

| Item | Implementation | Tests | Status |
|------|----------------|-------|--------|
| User-visible quota/compaction notice | `src/services/persistence.ts`; `src/stores/ChatStore.ts`; `src/components/editorial/EditorialComposer.tsx` | `tests/services/persistence.test.ts` (handler); `tests/components/editorial/EditorialComposer.test.ts` (banner wiring) | **covered** |
| Quarantine corrupt notes | `src/stores/NotesStore.ts`; `src/services/storage/notesStorage.ts` | `tests/stores/NotesStore.test.ts` — quarantine recovery | **covered** |
| Notes size limits | `src/core/notes.ts`; `src/stores/NotesStore.ts` | `tests/stores/NotesStore.test.ts` — `truncates oversized titles and bodies on create and update` | **covered** |
| Web Lite clear-data flow that refreshes or resets stores | `src/services/storage/webLiteLocalData.ts`; `src/components/menu/sections/Settings.tsx` | `tests/services/storage/webLiteLocalData.test.ts` — credential-preserving wipe only | **partial** (no Playwright test for post-clear page reload) |

---

## Summary

| Batch | Covered | Partial | Gap |
|-------|---------|---------|-----|
| A | 3 | 1 | 0 |
| B | 5 | 0 | 0 |
| C | 5 | 0 | 0 |
| D | 4 | 0 | 0 |
| E | 3 | 1 | 0 |
| **Total** | **20** | **2** | **0** |

**Remaining partial items (documented, not blocking):** multi-tab merge beyond banner/pause/reload (A2); Web Lite clear-data full reload UX (E4).

**Related (not in section 9):** background-stream `recordActivityEvent` routing — `ChatStore.test.ts` — `recordActivityEvent attaches to a background streaming thread when active thread differs`.
