# Audit Batches A–E — Developer Implementation Guide

**Date:** 2026-06-07  
**Companion docs:** [comprehensive audit](./2026-06-07-comprehensive-audit.md) · [test coverage matrix](./2026-06-07-test-coverage-matrix.md)

This guide explains what each batch changed, which invariants must hold, where to add tests when touching related code, and what is intentionally still open.

---

## Batch A — Safety first

### What & why

| Item | What changed | Why |
|------|--------------|-----|
| Chat-history protection | `protectedWorkspacePaths` now covers `.gatesai/chat` **and** `chat-history/`; `fs`, `inspect_file`, `terminal`, `python_inline`, and `sqlite_query` deny before execution | Models could read private transcripts via the HTML mirror or shell side doors (audit C3) |
| Multi-tab overwrite warning | `storage` listener sets `persistenceConflict`, pauses chat autosave, shows composer banner with Reload / Dismiss | Two tabs writing `gatesai.state.v1` last-write-wins silently (audit C1) |
| Image cancel runner lock | `ImageJobStore.cancel` no longer calls `runNext` immediately; `runJob` `finally` clears `inflight` only if it still owns the controller | Cancel clobbered the next job's `AbortController` (audit C2) |
| Stale turn finalization guard | Post-stream paths re-check `ownsStreamingTurn` before `finishReason` and `maybeAutoName` | Abandoned interrupt-and-resend turns could stamp metadata on the wrong message (audit C4) |

### Invariants

- Protected paths: use `protectedWorkspacePaths` helpers — do not duplicate path strings in individual tools.
- Multi-tab: never resume autosave after an external write without user Reload or explicit Dismiss.
- Image queue: at most one `inflight` `AbortController`; `finally` must compare `this.inflight === ac` before nulling.
- Streaming: any post-stream mutation on a thread must verify the turn still owns `streamingByThread[threadId]`.

### Where to add tests

| Area | Test home |
|------|-----------|
| New tool path that reads files or runs commands | `tests/services/tools.test.ts` or tool-specific file under `tests/services/tools/` |
| Protected scope changes | `tests/services/tools/protectedWorkspacePaths.test.ts` |
| Multi-tab / reload | `tests/stores/ChatStore.test.ts`, `tests/services/storage/persistenceProvider.test.ts` |
| Image cancel / queue | `tests/stores/ImageJobStore.test.ts` |
| Finalize / auto-name | `tests/stores/ChatStore.test.ts` (interrupt-resend scenarios) |

---

## Batch B — Conversation correctness

### What & why

| Item | What changed | Why |
|------|--------------|-----|
| Per-thread draft | `UiStore.bindDraftThread` snapshots draft text + attachments per `activeThreadId` | One global draft leaked across sidebar switches |
| Per-thread lastError | `lastErrorByThread` + computed `lastError` for the active thread only | Provider errors from thread A appeared while viewing B |
| Manual rename protection | `renameThread` sets `autoNamed: true`; `maybeAutoName` skips protected titles | Auto-naming could overwrite a user-chosen title |
| Soft-delete streaming annotation | `softDeleteThread` calls `interruptThread` when the thread is streaming | Deleted mid-stream threads showed silently truncated replies |
| Summary scheduler | `SummaryStore.tick` backs off when **any** thread streams; skips `deletedAt` threads | Background streams and deleted threads produced wrong summaries |

### Invariants

- Draft state keys off thread id — never store composer text in a single global string.
- `lastError` is always derived from `lastErrorByThread[activeThreadId]`, not a global field.
- `autoNamed: true` means "do not auto-name" (set by successful auto-name **or** manual rename).
- Soft-delete on a streaming thread must produce the same interrupt markers as explicit Stop.
- Summaries must never run for `deletedAt != null` threads or while any `streamingByThread` entry exists.

### Where to add tests

| Area | Test home |
|------|-----------|
| Draft / attachments | `tests/stores/UiStore.test.ts`, `tests/e2e/desktop.spec.ts` |
| Per-thread errors | `tests/stores/ChatStore.test.ts`, `tests/e2e/desktop.spec.ts` |
| Rename vs auto-name | `tests/stores/ChatStore.test.ts` |
| Soft-delete + stream | `tests/stores/ChatStore.test.ts` — `softDeleteThread while streaming annotates the partial assistant reply` |
| Summary eligibility | `tests/stores/SummaryStore.test.ts` |
| Background activity routing | `tests/stores/ChatStore.test.ts` — `recordActivityEvent attaches to a background streaming thread…` |

---

## Batch C — User clarity

### What & why

| Item | What changed | Why |
|------|--------------|-----|
| Rename "API" → "Models" | User-facing copy and legacy `#/menu/api` hash redirect | Inconsistent labels confused first-run users |
| Context-aware provider banners | Composer shows OpenRouter key, Ollama offline, or Comfy offline guidance based on active model/runtime | "Add an API key" was wrong advice for offline Ollama |
| First-run setup checklist | `ChatEmptyState` in `EditorialChat` shows three checkable steps | Blank "say something" gave no onboarding path |
| Model picker as real button | `<button>` with `aria-label`, `aria-haspopup`, `aria-expanded` | Picker looked like static text and was not keyboard-operable |
| Desktop menu affordance | `composer-menu-btn` ("Menu") beside the model picker | Desktop menu was only reachable via the wordmark |

### Invariants

- Provider banners are mutually exclusive and model/runtime-aware — one primary action per failure mode.
- All composer chrome controls (send, stop, model picker, menu) must be real `<button>` elements with accessible names.
- User-facing settings path is **Models**, not API/Settings/API keys.

### Where to add tests

| Area | Test home |
|------|-----------|
| Banner copy / visibility | `tests/components/editorial/EditorialComposer.test.ts` |
| Model picker gating | `tests/components/editorial/ModelPopover.test.ts` |
| Empty-state checklist | `tests/components/editorial/EditorialChat.test.ts` — first-run checklist with undone/done steps |
| Menu navigation | `tests/e2e/desktop.spec.ts`, `tests/components/menu/GatesMenu.test.ts` |
| Legacy routes | `tests/services/router.test.ts` |

---

## Batch D — Image polish

### What & why

| Item | What changed | Why |
|------|--------------|-----|
| Image cards outside collapsed rows | `ActivityRow` renders `ImageJobArtifacts` before the collapsible chip | Direct image gen hid behind a gray collapsed activity row |
| Partial failed/cancelled results | `FailedCard` / `CancelledCard` show saved `job.results` thumbnails | Partial renders on disk were invisible after failure |
| `prompt_file` batch tracking | Tool returns `{ content, artifacts: image-job[] }`; silent jobs except terminal notify on last batch entry | Batch prompts were invisible in chat |
| Missing-artifact failed state | `useImageDataUrl` failure shows "Image file missing" / "Missing" tiles | Deleted files left infinite loading placeholders |

### Invariants

- `image-job` artifacts render **outside** the collapsible `activity-row__button` — never only inside collapsed detail.
- Terminal jobs (`failed`, `cancelled`, `done`) must surface any `results[]` paths already persisted.
- `prompt_file` must validate the full batch before enqueueing; cap at 500 entries; return one artifact per job.
- Missing files must reach a terminal UI state — no indefinite spinner on a broken path.

### Where to add tests

| Area | Test home |
|------|-----------|
| Activity layout | `tests/components/editorial/ActivityRow.test.ts` |
| Card variants / partial UI | `tests/components/editorial/ImageJobCard.test.ts` — cancelled partial + missing-file render tests |
| `prompt_file` / artifacts | `tests/services/tools/imageGenerate.test.ts` |
| Queue / partial persistence | `tests/stores/ImageJobStore.test.ts` |

---

## Batch E — Storage durability

### What & why

| Item | What changed | Why |
|------|--------------|-----|
| Quota/compaction notice | Emergency compaction invokes `setCompactionNoticeHandler` → `ChatStore.compactionNotice` → composer banner | Quota failures were silent |
| Quarantine corrupt notes | Corrupt `gatesai.notes.v1` → recovery key + `loadError`; empty in-memory list | Corrupt notes were wiped to `[]` on boot |
| Notes size limits | `MAX_NOTE_*` constants; truncate on create/update in `NotesStore` | Unbounded notes could exhaust localStorage |
| Web Lite clear-data reload | `clearLocalDataExceptCredentials` wipes non-credential slots; Settings triggers `location.reload()` | In-memory MobX could re-save after a "clear" |

### Invariants

- Compaction must notify the user when emergency trimming runs — do not swallow quota recovery silently.
- Corrupt domain snapshots follow chat's quarantine pattern (recovery copy + visible error), not silent reset.
- Note title/body lengths are capped at store write time.
- Web Lite clear must reset both storage **and** in-memory state (reload is the current mechanism).

### Where to add tests

| Area | Test home |
|------|-----------|
| Compaction handler + banner | `tests/services/persistence.test.ts`; `tests/components/editorial/EditorialComposer.test.ts` |
| Notes quarantine | `tests/stores/NotesStore.test.ts` |
| Notes size limits | `tests/stores/NotesStore.test.ts` — `truncates oversized titles and bodies…` |
| Web Lite clear | `tests/services/storage/webLiteLocalData.test.ts` (credential preservation); reload UX still e2e **partial** |

---

## Remaining known gaps

These are **documented limitations**, not regressions:

1. **Bridge-level chat-history enforcement** — Protection is enforced in app-side tools only. The bridge process can still read protected paths if invoked outside the tool layer. Follow-up: enforce in the bridge or add a workspace read allowlist at the bridge boundary.

2. **Full multi-tab merge/reload coordination** — Current behavior: detect external `gatesai.state.v1` write → pause saves → banner with Reload (`reloadFromStorage`) or Dismiss. There is no BroadcastChannel merge, no automatic reload, and no conflict resolution across notes/profile keys.

---

## Quick reference — primary files

| Concern | Primary implementation |
|---------|------------------------|
| Protected paths | `src/services/tools/protectedWorkspacePaths.ts` |
| Multi-tab | `src/services/storage/persistenceProvider.ts`, `src/stores/ChatStore.ts` |
| Image queue | `src/stores/ImageJobStore.ts` |
| Streaming ownership | `src/stores/ChatStore.ts` |
| Per-thread UI state | `src/stores/UiStore.ts`, `src/stores/RootStore.ts` |
| Summaries | `src/stores/SummaryStore.ts` |
| Composer UX | `src/components/editorial/EditorialComposer.tsx`, `EditorialChat.tsx` |
| Image UI | `src/components/editorial/activity/ActivityRow.tsx`, `ImageJobCard.tsx` |
| Persistence / notes | `src/services/persistence.ts`, `src/stores/NotesStore.ts`, `src/services/storage/webLiteLocalData.ts` |
