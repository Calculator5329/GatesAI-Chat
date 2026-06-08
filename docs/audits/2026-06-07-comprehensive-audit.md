# GatesAI Chat — Comprehensive Audit & User-Story Reference

**Date:** 2026-06-07
**Type:** Read-only audit (no code changed)
**Method:** Six parallel deep-dive code walkthroughs (chat, models/providers,
tools/bridge, image generation, persistence/memory, UX), then manual
verification of the Critical findings against source.

This document doubles as a **user-story / use-case reference** for future work.

---

## 1. Executive summary (plain English)

The app is well-built: clean layered architecture, a thoughtfully designed
chat engine, and strong test coverage. Most findings are not "it's broken" —
they are sharp edges a real user could hit.

- **4 Critical**, ~**11 High**, plus many Medium/Low issues.
- Biggest themes: (a) state that leaks across the wrong conversation,
  (b) a security boundary that isn't fully enforced, (c) silent data-loss
  paths, and (d) a weak first-run experience.
- The bones are strong; the Criticals are the only items that are genuinely
  worrying.

---

## 2. User stories / use cases (documented for future reference)

Each was traced through the real code.

### Setup / new user
- First launch with no API key set.
- Adding an OpenRouter key; refreshing the live model catalog; catalog fetch fails.
- Picking a model: favorites, recents, search, source filter.
- Local-first user who only wants Ollama and never the cloud default.

### Chatting
- Send message: empty, whitespace-only, attachments-only, while already streaming.
- Stream a turn: tool-execution loop, `MAX_TOOL_ROUNDS` (16), abort, provider
  throws mid-stream, `finishReason: 'error'`.
- Stop a stream: interrupt annotation, stop before any token, stop then resend.
- Switch threads mid-stream (streams intentionally survive switches).
- Regenerate in place, branch thread, edit-and-resend, soft-delete + undo.
- Auto-naming after the first successful turn.

### Agent tooling + bridge
- Bridge offline: model calls `fs`/`terminal`; error clarity + recovery.
- `toolDefsForTurn` selection heuristic (omitting/including the right tools).
- Concurrent read-only tool execution; result ordering.
- Path jail / allowlist trust boundary (loopback, no auth).
- Tool result budgeting / truncation.
- `web_search` (no Brave key), `describe_image` (no vision model), `sqlite_query`
  rejections.

### Images
- `image_generate`: single, multi-count (1–10 clamp), `prompt_file` batch (≤500).
- Direct `local-image` model selected in the picker (ChatStore short-circuit).
- ComfyUI offline / not configured.
- Cancel in-flight job; cancel mid multi-image loop.
- Job fails partway (partial results).
- App closed mid-render (pending/running not persisted).
- Gallery (cap 200), lightbox, missing/deleted artifact files.
- Progress WebSocket lifecycle; seed + dimension/aspect resolution.

### Memory & persistence
- Memory tool: add / remove / update / list facts; dedup; index vs substring.
- Cross-thread summaries: 15s scheduler, eligibility, model fallback cascade.
- Notes CRUD.
- localStorage quota exceeded (emergency compaction).
- Corrupt / old localStorage on load (migration robustness).
- Workspace chat-history mirror (desktop): write failures, protected JSON scope.
- Multi-tab: two app tabs writing the same keys.
- Web Lite (browser) degraded mode.

---

## 3. Critical findings (verified by hand)

### C1 — Two browser tabs corrupt each other's data
No cross-tab coordination exists. Whichever tab saves last silently wipes the
other's chats, memories, and notes. No warning, no merge.
**Evidence:** no `storage`/`StorageEvent` listener in `src/`; each store loads
once and overwrites (`ChatStore.ts:305-318`, `UserProfileStore.ts:22-26`,
`NotesStore.ts:28-32`).

### C2 — Cancelling an image job can break the next job's cancel
`cancel()` nulls the active job and immediately calls `runNext()`, starting the
next job. The cancelled job's `finally` then sets `this.inflight = null`,
clobbering the **new** job's abort controller — so the next job can become
un-cancellable, and two ComfyUI renders can overlap.
**Evidence:** `ImageJobStore.ts:124-131` (cancel → runNext), `:226-227` (new
controller), `:239-241` (`finally` nulls it). Verified manually.

### C3 — Model can read private chat history through a side door
Chat-state files are hidden from `fs`/`inspect_file`, but the protection (a)
only covers `.gatesai/chat`, **not** the readable `/workspace/chat-history`
HTML/Markdown mirror, and (b) is **not** enforced in `terminal`,
`python_inline`, or `sqlite_query`. An allowlisted `type`/`cat`/`python` reads
everything.
**Evidence:** `protectedWorkspacePaths.ts:8-11`; guards present in `fs.ts:316-330`
and `inspectFile.ts:106-108`, absent in `terminal.ts`, `pythonInline.ts`,
`sqliteQuery.ts`. Verified manually. (Low real-world risk on single-user
desktop, but it defeats an intended boundary.)

### C4 — A stopped reply can still "finish" and scramble titles/metadata
After interrupt-and-resend, the abandoned turn's post-stream finalize isn't
guarded. It can stamp a finish-reason on an already-`*[interrupted]*` message
and fire `maybeAutoName` from partial text, blocking proper naming by the real
reply.
**Evidence:** token write guarded (`ChatStore.ts:1118`), but finalize +
`maybeAutoName` unguarded at `:1155-1168`, `:1226-1242`.

---

## 4. High-impact findings

### Cross-conversation state leaks
- **Shared composer draft** — one global string; type in A, switch to B, send →
  posts to B. (`UiStore.ts:28-29`; no reset on thread switch.)
- **Global error banner** — error from A shows while viewing B; dismiss clears
  globally. (`ChatStore.ts` `lastError`; banner `EditorialComposer.tsx:292-296`.)
- **Background streams** — Stop button only controls the active thread
  (`stopStreaming` keys off `activeThreadId`, `ChatStore.ts:937-941`); bridge
  activity rows attach to the wrong message (`recordActivityEvent`, `:651-655`).

### Provider / model UX
- **Ollama offline shows "Add an API key"** — wrong advice; user needs to start
  Ollama. (`EditorialComposer.tsx:216-218`, `573-588`.)
- **Offline Ollama models look pickable** — only ComfyUI gets a disabled state.
  (`ModelPopover.tsx:752-755`.)

### Silent data loss
- **Quota exceeded** silently truncates tool results, or fails the save
  entirely, with no UI notice. (`persistence.ts:54-62`.)
- **Profile/notes/uiprefs quota errors swallowed** with no feedback or retry.
  (`persistenceProvider.ts:41-46`.)
- **Corrupt notes file wiped on boot** instead of quarantined like chats.
  (`NotesStore.ts:28-32`, `notesStorage.ts:4-8`.)

### Image UX
- **Image card hidden in a collapsed row** by default; assistant text hidden
  whenever an image job exists, so direct image generation can show only a gray
  chip. (`ActivityRow.tsx:14-31`, `EditorialMessage.tsx:96,252-257`.)
- **Partial results not shown** on failed/cancelled jobs though saved to disk.
  (`ImageJobCard.tsx:73-74,166-173`.)
- **`prompt_file` batches invisible in chat**: no artifacts, no per-job cards,
  and no completion follow-up. (`imageGenerate.ts:270-286`.)

### Summaries
- **Scheduler only checks the active thread for streaming**, so it can summarize
  a background thread while it is still being written, producing wrong summaries
  that later feed the system prompt. (`SummaryStore.ts:142-143`.)

### Naming
- **Auto-naming can overwrite a manual rename**. The comment claims manual
  titles are protected, but `renameThread` never sets the protection flag.
  (`ChatStore.ts:745-751`, guard at `:1443`.)

---

## 5. Medium / Low findings worth tracking

### Chat
- Soft-deleting a streaming thread aborts without the visible
  `*[interrupted]*` / `*[no response]*` annotation.
- In-flight work can continue writing into a soft-deleted thread, which can
  later reappear if the user hits undo.
- Edit-and-resend opens raw stored content, including attachment metadata.
- Send is allowed while uploads are still in flight, so fast Enter can send a
  partial attachment set.
- Duplicate error surfacing: composer banner, inline message text, and finish
  notice can all report the same provider error.
- Provisional sidebar titles can include attachment footer text.

### Models / providers
- OpenRouter models remain pickable without a key; send is blocked later.
- Persisted/favorited models that disappear from the catalog are silently
  hidden, while stale ids can linger until repair.
- Global Ollama "Tool calls" off is not reflected in model-picker badges.
- Live OpenRouter catalog entries are treated as tool-capable even if a model
  rejects tool schemas at runtime.
- Thinking-effort controls are shown for all OpenRouter models with no
  capability check.

### Tools / bridge
- `python_inline` and `sqlite_query` non-zero exits are formatted like success
  unless the model reads the exit code carefully.
- Bridge `isOnline` can be true before the WebSocket is actually ready, causing
  short-lived false failures after startup.
- `inspect_file` loads full file content before local output limits apply.
- `ToolMetadata.resultPolicy` exists but is not used by the compaction layer.
- Bridge tools may be offered while bridge is offline if the user's wording
  matches the heuristic.
- `time` is registered but not currently offered to the model.
- `describe_image` can be exposed without checking that a local vision runtime
  is actually usable.
- ExecStream terminal tails are not cancelled immediately on abort.

### Images
- Comfy cancel uses global `/interrupt`, which can stop unrelated ComfyUI work.
- Gallery tile "Remove" deletes the whole multi-image job, not just that tile.
- History cap of 200 can make old chat image cards say the job is lost.
- Comfy workflow failures can wait for a long timeout instead of failing fast.
- Missing/deleted artifact files can leave image UI stuck in loading states.
- Closing the app mid-render can leave ComfyUI server work orphaned.

### Persistence / memory
- Emergency compaction only trims tool payloads, not giant user/assistant prose.
- Invalid individual threads can be dropped silently during migration.
- Clearing Web Lite browser cache wipes localStorage but not in-memory MobX
  stores, so another mutation can re-save the supposedly cleared data.
- Memory `update` can create duplicate facts; substring remove/update can hit
  the wrong fact.
- Stale memory indexes are unsafe after facts are added/removed in the same
  conversation turn.
- Soft-deleted threads can still be summarized and injected into context.
- Notes have no size limit, so large notes can exhaust localStorage silently.

---

## 6. UX / intuitiveness review

### First-run experience
New users see a blank thread and the poetic copy "A blank page. Say something."
There is no welcome checklist explaining: add model/API key, pick model, send
message. `src/core/seed.ts` no longer exists, so there is no seed conversation.

The desktop menu is also hidden behind clicking the **GatesAI** wordmark; mobile
has a visible menu button, desktop does not. First-run users may not discover
where Models/API keys live.

### Terminology
One settings area has too many names:
- Menu tab: **Models**
- Error text: "Settings -> API"
- Button copy: "Open API settings"
- Image errors: "Menu -> API"
- Settings quick action: "API keys"

Recommendation: use **Models** everywhere.

### Discoverability
- Model picker looks like a text label, not a button, and is not
  keyboard-accessible.
- Drag/paste attachment support has little visible affordance.
- Thinking effort and local context modes use jargon with no short explanation.
- Tools, memory, notes, image generation, and Gallery are powerful but mostly
  implicit.
- Ctrl/Cmd-click copy is useful but still partly hidden.

### Accessibility basics
- Several clickable elements should be real buttons or keyboard-operable:
  model picker, New conversation, bridge pill, attachment remove.
- Toggles need accessible labels.
- Context meter should have an accessible label.
- Global focus styling should be more consistent.

### Things that feel good
- Calm editorial dark theme.
- Soft-delete with undo for threads.
- Rich model picker with favorites/recents/search.
- Streaming composer morph: send -> stop / interrupt.
- Strong Web Lite notices.
- Danger Zone copy explains exactly what will be deleted.
- Gallery and Agent empty states are clear.

---

## 7. What is already solid

- Per-thread streaming model generally avoids cross-thread text corruption.
- Interrupt-and-resend is mostly well designed.
- Tool-call ID normalization prevents wrong result pairing.
- Read-only tools run concurrently; side-effecting tools run sequentially.
- Invalid tool batches short-circuit safely.
- Context overflow preflight and compaction exist.
- Tool exceptions and `Error:` strings are normalized.
- Git restore actions require confirmation.
- Chat persistence has migration, corrupt snapshot quarantine, throttled saves,
  and unload flush.
- Web Lite mode has clear notices and correctly disables many desktop-only
  surfaces.
- Image jobs persist completed artifacts into the workspace so Gallery survives
  ComfyUI restarts.
- The three-layer architecture is well documented and mostly enforced by ESLint.

---

## 8. Recommended priority order

1. **Protect chat history everywhere**: include `/workspace/chat-history` in the
   protected scope and enforce it in `terminal`, `python_inline`, and
   `sqlite_query`, or push this protection into the bridge itself.
2. **Add multi-tab protection**: storage listener, BroadcastChannel, or at least
   a "another tab has newer data" banner that prevents blind overwrite.
3. **Fix image cancel serialization**: do not start the next job until the
   cancelled job's `runJob` promise fully settles, or use a single runner lock.
4. **Guard stale turn finalization**: every post-stream mutation, including
   `maybeAutoName`, should re-check stream ownership.
5. **Scope draft and errors per thread** so text/errors do not leak into the
   wrong conversation.
6. **Make provider errors context-aware**: Ollama offline should say "Start
   Ollama", OpenRouter missing key should say "Add a key in Models".
7. **Unify user-facing naming** around "Models".
8. **Improve first-run guidance**: welcome/checklist or richer empty state.
9. **Make model picker/menu discoverable and accessible** on desktop.
10. **Surface persistence failures** so users know when storage quota or corrupt
    data has affected durability.

---

## 9. Suggested implementation batches

> **Status (2026-06-07):** Batches A–E implemented in app code; see
> `docs/changelog.md` (2026-06-07 entries). Remaining gaps: bridge-level
> chat-history enforcement (app-side tools only), full multi-tab merge/reload
> coordination (banner + pause only — no BroadcastChannel merge).
>
> **Test coverage:** per-item implementation and test mapping in
> [`2026-06-07-test-coverage-matrix.md`](./2026-06-07-test-coverage-matrix.md);
> developer guide in
> [`2026-06-07-implementation-guide.md`](./2026-06-07-implementation-guide.md).
> **Diagnostics (2026-06-07):** logging, inline comments, and architecture docs
> updated for observability — see changelog “Diagnostics pass”.

### Batch A — Safety first
- [x] Chat-history protection across all tool paths.
- [x] Multi-tab overwrite warning.
- [x] Image cancel runner lock.
- [x] Stale turn finalization guard.

### Batch B — Conversation correctness
- [x] Per-thread draft.
- [x] Per-thread lastError.
- [x] Manual rename protection.
- [x] Soft-delete streaming annotation.
- [x] Summary scheduler ignores any streaming thread and excludes deleted threads.

### Batch C — User clarity
- [x] Rename "API" copy to "Models".
- [x] Context-aware provider banners.
- [x] First-run setup checklist.
- [x] Model picker as a real button.
- [x] Desktop menu/gear affordance.

### Batch D — Image polish
- [x] Show image job cards expanded or outside collapsed activity rows.
- [x] Show partial failed/cancelled results.
- [x] Better batch tracking (`prompt_file` returns `{ content, artifacts[] }`).
- [x] Missing-artifact failed state.

### Batch E — Storage durability
- [x] User-visible quota/compaction notice.
- [x] Quarantine corrupt notes.
- [x] Notes size limits.
- [x] Web Lite clear-data flow that refreshes or resets stores.

---

## 10. Notes for future reviewers

This audit was intentionally conservative. A finding was only elevated to
Critical/High if it could plausibly hurt user trust, corrupt state, hide real
work, or defeat an intended safety boundary. Many lower-severity items are
polish, but they point to the same themes: make state ownership explicit, make
errors point users to the right action, and avoid silent failure paths.

---

## 11. Resolution (2026-06-07)

All Critical/High findings and the tracked Medium/Low items above are resolved.
Each fix was re-verified against the source after a parallel agent's concurrent
edits, then baselined green: typecheck, lint, 683 unit tests, and the Playwright
e2e suite.

Key engineering decisions and their rationale:

- **Auto-naming ownership (C4):** ownership is now checked by the caller *before*
  `clearStreamingState`, and `maybeAutoName` no longer re-checks it (the check
  was always false post-clear, silently disabling naming). The async namer
  re-reads the `autoNamed` lock before writing so a manual/tool rename landing
  mid-flight is never clobbered. This keeps a single, explicit ownership point
  rather than scattering guards.
- **Fail loud over fail silent (S1/C1):** storage exhaustion and cross-tab write
  races now surface a notice / cancel queued saves rather than quietly diverging
  from disk — consistent with the audit's "no silent failure paths" theme.
- **Defense in depth for chat history (C3):** rather than guarding one tool, the
  protected-path check is enforced at every tool that can read the filesystem,
  with path canonicalization so `..` traversal and the readable mirror are both
  covered.
- **Filter, don't disable (P1 / deslop):** unusable models are filtered out of
  the picker by `isModelAvailable`, which let us delete the dead
  `disabledReasonForModel` branch entirely — fewer states, simpler component.