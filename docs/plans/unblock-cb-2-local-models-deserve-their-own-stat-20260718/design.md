# CB-2: Local models deserve their own status copy, not "Waiting on provider…"

**Status:** design complete — ready to dispatch source lane
**Roadmap item:** `docs/roadmap.md` CB-2 (Visions / Copy & Behavior)
**Ethan's decision:** APPROVED (verbatim, authoritative)
**Owned lease path:** `docs/plans/unblock-cb-2-local-models-deserve-their-own-stat-20260718/`

---

## 1. Problem

The stall / idle / connect indicators shown while a turn is in flight are all
written from the assumption that a *remote provider* is on the other end of the
socket. When the model is an Ollama model running on the user's own machine,
that copy is simply wrong and slightly alarming:

- A cold Ollama model can take 10–120s to load its weights into RAM/VRAM before
  the first token. During that window the UI says **"waiting for provider…"** —
  there is no provider; the delay is a local memory load the user's own box is
  doing.
- If the 180s initial-stall timer fires, the turn is aborted with
  **"No provider data arrived for Ns, so GatesAI stopped the stalled stream."**
  For a big local model on a slow machine this is a false alarm framed as a
  remote failure.
- The composer footer shows **"provider stalled"** — again, no provider.

The roadmap asks: local-aware messaging keyed off `providerId === 'ollama'`
(and other local runtimes), curated/cycling rather than the single
remote-provider line, distinguishing cold-start from mid-stream idle, with the
copy living in **one place** and unit-tested on the local-vs-remote branch.

## 2. Where the provider-framed copy lives today

Ground truth from the current tree (all citations verified this session):

| # | Surface | Location | Current text | Local today? |
|---|---------|----------|--------------|--------------|
| A | Composer streaming footer | `src/components/editorial/composer/ComposerMeta.tsx:202` `streamFooterLabel()` | `connecting → "waiting for provider..."`, `stalled → "provider stalled"`, `streaming → "streaming..."` | Same string for local + remote |
| B | Text-turn stall abort reason | `src/services/chat/streamingRoundExecutor.ts:214` | `"No provider data arrived for {n}s, so GatesAI stopped the stalled stream."` | Same string for local + remote |
| C | Image job "waiting" overlay | `src/components/editorial/ImageJobCard.tsx:125` | `"Waiting on provider..."` | **Gated to remote only** — see §5 |

Key enabler already in place: **`StreamActivity` already carries `providerId`
and `providerModelId`** (`src/core/types.ts:219-228`), populated in
`ChatStore.applyRoundActivityUpdate` (`ChatStore.ts:1146`) from the executor's
`emitActivity` payload (`streamingRoundExecutor.ts:200-209`). So surface **A**
can branch on the provider with zero new plumbing. Surface **B** has
`options.providerId` in scope at the point the message is built.

Canonical local-model detection already exists: `isLocalChatModel(model)` in
`src/core/localModelRules.ts:33` keys off `providerId === 'ollama'`. There is no
`providerId`-only predicate yet — this design adds a tiny one so both the
Model-shaped and the activity-shaped call sites agree.

## 3. Design

### 3.1 One home for the copy — `src/core/streamStatusCopy.ts` (new)

All status strings move behind pure functions in a single new core module.
No React, no MobX — trivially unit-testable, importable from both the component
(A/C) and the service (B). Layer-legal: `core/` is the lowest layer.

```ts
// src/core/streamStatusCopy.ts
export type StreamStatusPhase = 'connecting' | 'streaming' | 'tooling' | 'stalled';

/** providerId-only local predicate. 'ollama' is definitively local. */
export function isLocalProviderId(providerId: string | undefined): boolean {
  return providerId === 'ollama';
}

/** Short footer label (surface A). `elapsedMs` lets the connecting/stalled
 *  copy cycle through curated lines; pass 0 for a stable first line. */
export function streamFooterLabel(args: {
  phase: StreamStatusPhase | undefined;
  providerId?: string;
  providerModelId?: string;
  elapsedMs?: number;
}): string { /* … */ }

/** Full stall/abort sentence (surface B). */
export function streamStallReason(args: {
  idleSeconds: number;
  providerId?: string;
  providerModelId?: string;
  coldStart: boolean;   // true = never received a token (initial connect timer)
}): string { /* … */ }
```

### 3.2 Cold-start vs mid-stream idle

The executor already distinguishes the two timers:
- `armStallTimer(this.initialStallMs)` is armed in the `connecting` phase
  before any chunk (`streamingRoundExecutor.ts:227`) → **cold start** (weights
  loading / first token).
- `armStallTimer(this.stallMs)` is re-armed after each streamed chunk
  (line 235) → **mid-stream idle** (already producing tokens, then went quiet).

`state.receivedContent` (line 190/232) is the exact signal. Thread it into the
stall reason: `coldStart = !state.receivedContent`. For the footer (surface A),
`phase === 'connecting'` **is** the cold-start window and `phase === 'stalled'`
after streaming is mid-stream idle — no extra state needed.

### 3.3 Curated / cycling copy

Local branch, keyed by `elapsedMs` bucket so a long cold load reassures rather
than repeats one line. Remote branch is unchanged (single line each).

**Footer (A), local, `connecting`** (cold start), cycled ~every 6s:
1. `loading {model} into memory…`
2. `running locally — first token can take a moment on a cold model`
3. `warming up the local runtime…`

**Footer (A), local, `stalled`:** `local model went quiet — still waiting…`
**Footer (A), local, `streaming`:** `streaming locally…`
**Footer (A), local, `tooling`:** `running tools locally…`

**Stall reason (B), local, cold start:**
`{model} took longer than {n}s to load and respond locally, so GatesAI stopped
waiting. Cold local models can be slow to load — try again, or pick a smaller
model.`

**Stall reason (B), local, mid-stream:**
`The local model went quiet for {n}s, so GatesAI stopped the stalled stream.`

Remote copy stays exactly as today (regression-guard the strings in tests).

`{model}` = a trimmed `providerModelId` (e.g. `llama3:8b`); fall back to
`"the local model"` when absent. No new name-formatting helper is required.

### 3.4 Cycling mechanism (surface A only)

The footer re-renders only on MobX activity updates, so it will not advance on
its own. Add a minimal `useElapsedNow(active)` hook (1 Hz `setInterval`, cleared
on unmount / when `active` is false) local to `ComposerMeta`, active only while
`streaming && !hasText && isLocalProviderId(streamActivity?.providerId)`. It
feeds `elapsedMs = now - streamActivity.startedAt` into `streamFooterLabel`.
Remote turns never start the interval → no behavior/perf change for cloud.

## 4. Call-site changes

1. **`ComposerMeta.tsx`** — delete the local `streamFooterLabel` (lines
   202-210), import it from `core/streamStatusCopy`, pass
   `{ phase, providerId, providerModelId, elapsedMs }` from `streamActivity`.
   Add the `useElapsedNow` tick gated on local + streaming + no typed text.
2. **`streamingRoundExecutor.ts`** — replace the inline template at line 214
   with `streamStallReason({ idleSeconds, providerId: options.providerId,
   providerModelId: options.providerModelId, coldStart: !state.receivedContent })`.
3. **`ImageJobCard.tsx`** — see §5; low-risk copy alignment only.

No type changes to `StreamActivity` are needed. No persistence/schema changes.
No new dependency.

## 5. Image job card (surface C) — scope note

`ImageJobCard.tsx` gates the literal **"Waiting on provider…"** behind
`remote = job.backend === 'openrouter-image'` (line 119-121); the local image
backend is `local-comfy`, which already renders `"generating · {pct}% ·
ComfyUI"` (line 146). So the *chat/text* path is the real CB-2 defect; the
image path already avoids "provider" copy for local renders. The dispatched
lane should still (a) confirm no local image state reaches the "Waiting on
provider…" branch, and (b) optionally soften the remote overlay label from
`"Waiting on provider..."` → `"waiting on {backendLabel}…"` for consistency, but
this is cosmetic and must not touch the ComfyUI/local branch behavior. Treat C
as verify-and-lightly-align, not a rewrite.

## 6. Testing

New unit test `src/core/streamStatusCopy.test.ts` (Vitest), covering:
- `isLocalProviderId`: `'ollama'` → true; `'openrouter'`, `'openai'`,
  `'openai-compat'`, `undefined` → false.
- `streamFooterLabel` **local** `connecting` cycles through all three curated
  lines across `elapsedMs` buckets and interpolates `providerModelId`.
- `streamFooterLabel` **remote** returns the exact current strings for every
  phase (regression guard).
- `streamStallReason` local cold-start vs local mid-stream vs remote — asserts
  the word "provider" never appears in any **local** output, and that the
  remote sentence is byte-identical to today's.
- Missing `providerModelId` falls back to `"the local model"`.

Component coverage: extend the existing `ComposerMeta` test (if present) or add
one asserting a local `streamActivity` yields a non-"provider" footer and a
remote one yields the unchanged label. Gate: `npm run ci` (vitest + typecheck +
lint) green; `npm run test:e2e` unaffected but must stay green.

## 7. Runtime parity (desktop + Web Lite)

Copy selection is pure and runtime-agnostic. Web Lite can still surface an
Ollama provider if the user points at a local endpoint, so the local branch is
correct in both runtimes; no `core/runtime.ts` gating required. Nothing
degrades in Web Lite because no new capability is introduced — only string
selection.

## 8. Acceptance (from roadmap, mapped)

- ✅ A local turn never shows "provider"-framed copy → surfaces A + B branch on
  `isLocalProviderId`; test asserts "provider" absent from all local outputs.
- ✅ Unit tests cover the local vs remote branch → `streamStatusCopy.test.ts`.
- ✅ Copy lives in one place → `src/core/streamStatusCopy.ts`, no scattered
  literals (the two inline strings are deleted and re-sourced).
- ✅ Cold-start vs mid-stream distinguished → `coldStart`/`phase` split.

## 9. Risk / rollback

Pure copy + one small UI interval; no schema, no protocol, no security surface.
Rollback = revert the lane commit. The only behavioral change beyond strings is
a 1 Hz interval that runs *only* during a local, no-text, streaming footer and
is torn down on unmount — negligible.

See `DISPATCH.md` in this folder for the exact follow-up task spec.
