# DISPATCH — CB-2 source lane

Follow-up implementation task spec for the design in `design.md` (this folder).
The design lane owns only planning; this dispatch implements the source change.

---

**title:** CB-2 impl: local-aware stream status copy (no "provider" framing for Ollama turns)

**goal:**
Give locally-run (Ollama) turns their own stall/idle/connect copy instead of the
remote-provider-framed strings, per `docs/plans/unblock-cb-2-local-models-deserve-their-own-stat-20260718/design.md`.
Concretely:

1. Create `src/core/streamStatusCopy.ts` (pure, no React/MobX) exporting:
   - `isLocalProviderId(providerId?: string): boolean` — `true` only for `'ollama'`.
   - `streamFooterLabel({ phase, providerId, providerModelId, elapsedMs })` — the
     composer footer label; remote branch returns today's exact strings
     (`connecting → "waiting for provider..."`, `stalled → "provider stalled"`,
     `tooling → "running tools..."`, `streaming → "streaming..."`), local branch
     returns curated copy (cold-start cycling through the 3 lines in design §3.3,
     interpolating a trimmed `providerModelId`, falling back to `"the local model"`).
   - `streamStallReason({ idleSeconds, providerId, providerModelId, coldStart })` —
     the stall abort sentence; remote branch byte-identical to today's
     `"No provider data arrived for {n}s, so GatesAI stopped the stalled stream."`,
     local branch uses the cold-start vs mid-stream sentences in design §3.3 and
     never contains the word "provider".
2. `src/components/editorial/composer/ComposerMeta.tsx` — remove the inline
   `streamFooterLabel` (lines ~202-210), import from `core/streamStatusCopy`, pass
   `phase/providerId/providerModelId/elapsedMs` off `streamActivity`. Add a minimal
   `useElapsedNow` 1 Hz tick active ONLY while
   `streaming && !hasText && isLocalProviderId(streamActivity?.providerId)`, torn
   down on unmount; feed `elapsedMs = now - streamActivity.startedAt`.
3. `src/services/chat/streamingRoundExecutor.ts` — replace the inline stall
   template (line ~214) with
   `streamStallReason({ idleSeconds, providerId: options.providerId,
   providerModelId: options.providerModelId, coldStart: !state.receivedContent })`.
4. `src/components/editorial/ImageJobCard.tsx` — VERIFY ONLY that no `local-comfy`
   job reaches the `"Waiting on provider..."` overlay (it is gated behind
   `remote = job.backend === 'openrouter-image'`). Optional cosmetic: change the
   remote overlay label to `"waiting on {backendLabel}…"`. Do NOT alter the
   ComfyUI/local branch. If in doubt, leave ImageJobCard untouched.
5. Add `src/core/streamStatusCopy.test.ts` per design §6 (Vitest), including the
   regression guard that "provider" never appears in any local output and that
   remote strings are unchanged. Extend/add a `ComposerMeta` test for the local
   vs remote footer if a component test harness already exists there.

Do NOT: change `StreamActivity` shape, add persistence/schema/migrations, add a
dependency, weaken eslint layer rules, or touch the security surface. `core/`
must not import from `stores/`, `services/`, or `components/`.

**owns:**
- `src/core/streamStatusCopy.ts` (new)
- `src/core/streamStatusCopy.test.ts` (new)
- `src/components/editorial/composer/ComposerMeta.tsx`
- `src/services/chat/streamingRoundExecutor.ts`
- `src/components/editorial/ImageJobCard.tsx` (verify-only / optional cosmetic)

**test-cmd:** `npm run ci && npm run test:e2e`

**acceptance:**
- A local (Ollama) turn never renders "provider"-framed copy in the composer
  footer or the stall message; verified by unit tests asserting "provider" is
  absent from every local output.
- Cold-start (`connecting` / `!receivedContent`) copy differs from mid-stream
  idle copy.
- All status strings sourced from `src/core/streamStatusCopy.ts`; the two inline
  strings are deleted, not duplicated.
- Remote copy is byte-identical to pre-change (regression test).
- `npm run ci` and `npm run test:e2e` green. Desktop + Web Lite both fine (pure
  copy selection, no runtime gating needed).
- `docs/changelog.md` entry appended; CB-2 roadmap checkbox ticked by the
  harvesting session from this deliverable (do not hand-edit the roadmap in the
  design lane).

**model tier:** smart · **est. size:** small (one new pure module + 3 edits + tests)
