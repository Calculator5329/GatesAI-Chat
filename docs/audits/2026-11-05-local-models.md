# Local models audit, 2026-11-05

Lane `lane/local-models`. Scope: QW-1 (a live harness against the real Ollama code
path), streaming Ollama thinking, SP-2 (a compact prompt below a 32k window), and fixes
for whatever the harness found. Labels: **measured** means seen in a live run, a raw
frame or a test. **Inferred** means read from code or worked out without a live run.

## Setup

- Ollama 0.40.4 on 127.0.0.1:11434, RTX 5070 Ti (16 GB). `whisper-server` (dictation)
  holds about 2.1 GB, so about 12.5 GB is free when no model is loaded (measured).
- gemma4-abliterated:26b: 17 GB on disk, Modelfile `num_ctx 16384`. Capabilities:
  completion, vision, tools, thinking.
- qwen3.8-abliterated:27b: 13 GB on disk, Modelfile `num_ctx 16384`, same capabilities.
- gemma4:12b has no `num_ctx` in its Modelfile, so it loads at Ollama's 4096 default
  (measured via `/api/ps`). gemma3-abliterated:12b-q4 cannot think; it accepts
  `think:false` (HTTP 200, measured).
- Harness: `tests/integration/ollamaLocal.live.test.ts`. It is opt-in, runs under
  `vitest.live.config.ts`, and is never part of `npm run ci` or `npm run test:models`.
  - It drives RootStore → ChatStore → TurnRunner → OllamaProvider.stream with the app's
    real system prompt and tools. The bridge is offline, so the bridge-offline tool set
    is used.
  - It refuses every non-Ollama fetch, any `/api/chat` for another model, and
    generate, pull, delete and embed.
  - It unloads the model at the end.
  - Three turns per model: a plain answer, a follow-up in the same thread, and a
    `thread` tool round-trip in a new thread.
  - Run:
    `GATESAI_OLLAMA_LIVE_MODELS=<tag> npx vitest run --config vitest.live.config.ts tests/integration/ollamaLocal.live.test.ts`.
    For qwen, wrap it in `gpu_room.py 14 -- …`.

## Measurements

### gemma4-abliterated:26b, final build (50e8959), measured

The model loads with its 16384 window, so the context tier is compact and mode stays
full. The system prompt is 1526 chars, with 6 tools (8 on the tool turn).

| Turn | prompt_eval_count / 16384 | App estimate | Thinking | First thinking in app | First visible text | Wall | Eval tokens |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1. Sky blue (cold load) | 1816 (11%) | 1797 | 2461 chars, shown as the live "Thinking" row | 18.2 s | 28.8 s | 29.4 s | 614 |
| 2. Sunsets follow-up | 1872 (11%) | 1860 | 970 chars, shown as the live "Thinking" row | 3.6 s | 7.3 s | 8.1 s | 251 |
| 3a. Tool call round | 2357 (14%) | 2322 | none | n/a | tool call at 3.5 s | | 31 |
| 3b. Tool result round | 2581 (16%) | 2410 | none | n/a | 3.8 s | 7.5 s total | 10 |
| Auto-title (namer) | 137 | 133 | off (`think:false`) | n/a | n/a | 1.6 s | 5 |

Tool round-trip: `thread {action:"list", display_text:"Retrieving your recent chat
threads."}` returned ok. The final answer was "There are 4 recent chat threads." Headroom
is at least 13.8k tokens on every request. The app's estimate lands within 7% of
Ollama's count, always slightly under.

### gemma4-abliterated:26b, before the namer fix (7a0a79c), measured

| Turn | prompt_eval_count | First visible text | Wall | Note |
| --- | --- | --- | --- | --- |
| 1 | 1816 | 21.6 s (17.2 s load) | | no thinking this run |
| 2 | 1873 | 30.3 s | 30.9 s | queued behind turn 1's title; 9.2 s of real work |
| 3 | 2357 → 2585 | | 16.1 s | queued behind a title; 3.6 s of real work |
| Auto-title | | | 12.5 s | thought for 585 eval tokens; the first attempt hit the namer's 15 s timeout (`done:false`) |

### qwen3.8-abliterated:27b: **not measured on the final build (blocked)**

- `gpu_room.py 14` refused the run: "only 12530 MiB free after evicting every resident,
  14336 MiB needed; running nothing". `whisper-server` (2162 MiB) stayed resident; it
  was not among the residents gpu_room evicted.
  - This audit does not stop someone else's process or lower the 14 GB ask, so no
    post-fix qwen numbers exist.
- The only qwen data is one request from an early harness run, before any fix. It loaded
  **outside gpu_room**, which broke the GPU rule; see Incidents. Measured, from the raw
  done frame at 2026-11-06T05:19Z:
  - micro mode at the then-assumed small window: system prompt 279 chars, 1 tool
  - `prompt_eval_count` 456, load 10.1 s, prompt eval 0.84 s
  - 83 eval tokens in 9.8 s (about 8.5 tok/s, slow enough to suggest partial CPU
    placement; inferred)
  - total 20.7 s
- qwen's capabilities, `num_ctx 16384` and its window handling come from the same code
  path as gemma4. That it behaves the same is **inferred**, not measured.

## Findings

### F1. The reconcile step pinned micro mode, and the composer showed something else (fixed, 853f596)

- Measured: before the fix, `ChatStore` reconcile wrote `contextMode = 'micro'` onto
  any thread on a small-window local model. Moving that thread to a 16k model kept it
  in micro, and the composer showed a mode the runtime wasn't using.
- Fix: the effective mode is derived (`ChatStore.activeLocalContext`) and never written
  back. The composer reads the same getter. When micro is forced, its tooltip names the
  loaded window.
- Red first: a RootStore.ollama test (a moved chat on a 16k model should be full) and an
  EditorialComposer test.

### F2. Budget used a family-table 8000 and ignored the Modelfile's 16384 (fixed, cf88076)

- Measured: `/api/show` returns `parameters: "num_ctx 16384"` for both big models. The
  app budgeted gemma4 at 8000 from its family table, and the slim/micro decision used
  the same number.
- Fix: OllamaStore reads `num_ctx` from `/api/show` once per digest and writes it to
  `contextLength`. A format-profile `numCtx` still wins, since the request sends it.
- Measured after the fix: the live catalog entry has `contextLength` 16384.
- Red first: an OllamaStore window test and localModelMeta tests.

### F3. Unconfigured models were budgeted above what Ollama loads (fixed, cf88076)

- Measured: a model with no `num_ctx` loads at 4096. The app budgeted gemma4:12b at
  its family size, so Ollama would silently cut the prompt.
- Fix: `OLLAMA_DEFAULT_CONTEXT_TOKENS = 4096` is the Ollama default.
  `replyReserveTokensFor(window) = min(4096, window/4)`, so a 4096 window no longer
  reserves the whole window for the reply and refuses even a bare prompt.
- Red first: a ChatStore bare-prompt reserve test.

### F4. Ollama `message.thinking` was dropped (fixed, 07f110a)

- Measured: Ollama streams `message.thinking` separately from `content`, and the
  provider ignored it.
- Fix: it now arrives as reasoning chunks, gated on `supportsThinking`, into the
  existing live "Thinking" activity row. No new UI.
- Measured live: the row read "Thinking: The…" 3.6 s into turn 2, 3.7 s before the
  first answer text.
- Red first: an OllamaProvider reasoning test and a ChatStore thinking-row test.
- Not persisted: the row is live-only (see Left).

### F5. Auto-titles thought on the chat model and queued the user's next turn (fixed, 50e8959)

Raw repro, measured at 7a0a79c. The namer's request:

```json
{"model":"gemma4-abliterated:26b","stream":true,"keep_alive":"5m",
 "messages":[{"role":"system","content":"<380-char title prompt>"},{"role":"user","content":"User asked: … Title:"}]}
```

There is no `think` field and no `num_predict`. Ollama thought for 585 eval tokens over
12.5 s. The first attempt ended with `done:false` at the namer's 15 s timeout. Ollama
serves one request at a time, so turn 2 waited: 30.9 s wall for 9.2 s of work.

- Fix: the namer sends `thinkingEffort: 'none'`.
  - OllamaProvider maps that to `think: false`.
  - On OpenRouter it is a no-op, because `modelFormatProfiles` adds reasoning only
    when the value is not `'none'`.
- After the fix (measured): the title takes 5 eval tokens and 1.6 s. Turn 2 wall dropped
  from 30.9 s to 8.1 s, and turn 3 from 16.1 s to 7.5 s.
- Red first: a threadNamer test (`thinkingEffort` was undefined) and an OllamaProvider
  test (`think` was undefined).

### F6. OllamaProvider never sent `maxTokens` (partly fixed, 50e8959)

- Inferred from code, confirmed by the measured request bodies: `options` carried only
  temperature, `num_ctx` and stop. Micro's 512 cap, compaction's cap and `llmComplete`'s
  240 never reached Ollama.
- Fix: `num_predict = maxTokens` is sent **only when thinking is off**. Ollama counts
  thinking tokens against `num_predict`, so a 512 cap on a thinking model could be spent
  entirely on thinking and leave no answer (inferred from Ollama's accounting, not
  measured).
- Red first: the OllamaProvider short-answer test, plus a guard test showing the cap is
  not sent while thinking is on.
- Left: compaction and `llmComplete` still leave thinking on, so their caps still don't
  reach Ollama (see Left).

### SP-2. Compact prompt below a 32k window (done, 7a0a79c)

- The tier comes from the effective loaded window (`localModelContextProfile`):
  - slim below 8000 forces micro
  - compact from 8000 to 32767 gives the compact harness prompt, compact tool schemas
    (the first sentences of each description, structure unchanged) and no recent-chat
    summaries
  - full at 32768 and above
- Unit test (measured): on the same fixture the compact request estimates under 0.6× the
  large-window request. Unfixed, both came to 8054 estimated tokens. Tool schemas stay
  structurally equal, and the large model's tools are unchanged.
- Live (measured): 1816 to 2581 prompt tokens against 16384.
- Documented in `docs/architecture.md`, "Local model window and prompt tiers".

## Incidents (GPU rules)

1. **qwen3.8 loaded outside gpu_room.** In an early harness run, before the model guard
   existed, the app's default model resolved to qwen3.8-abliterated:27b, and it was
   loaded without `gpu_room.py`. It loaded with no OOM and was unloaded. The harness now
   refuses any `/api/chat` for a model other than the one under test.
2. **nomic-embed-text loaded next to gemma4.** The app's semantic memory called
   `/api/embed` during a gemma4 run, so two models were resident at once. It was
   unloaded by hand, and the harness now blocks `/api/embed(dings)`. The same thing can
   happen in the real app (see Left).
3. `gpu_room.py 14` could not make room for the final qwen run (above). Nothing ran.

At the end of this lane `/api/ps` is `{"models":[]}` (measured).

## Left (follow-ups for the roadmap; this lane cannot edit it)

- [ ] QW-1b: run the harness on qwen3.8-abliterated:27b when gpu_room can make 14 GB
  free, or once gpu_room can evict whisper-server. Record the same table.
- [ ] Compaction (`turnRunner.compactToolResultWithModel`) and `ChatStore.llmComplete`
  should send `thinkingEffort: 'none'`. On Ollama that turns thinking off and lets their
  caps through as `num_predict`. Needs a red test each.
- [ ] Micro mode's 512 cap still doesn't reach Ollama on thinking models. Decide between
  turning thinking off in micro and sending a cap sized for thinking plus answer.
- [ ] Persist reasoning on the message so the Thinking row survives a reload. This needs
  a persistence schema change, a migration and a `schemaVersion` bump.
- [ ] Read `/api/ps` `context_length` (or `OLLAMA_CONTEXT_LENGTH`) so a server-wide
  default is honoured; today only the Modelfile `num_ctx` is.
- [ ] Semantic memory embeds with a second Ollama model while a chat model is loaded.
  On a 16 GB card that evicts or splits the chat model. Gate embedding on VRAM, or
  queue it.
- [ ] The default local model can resolve to qwen3.8 (the GPU-heavy one) over gemma4;
  prefer the lighter or user-picked model.
- [ ] The bridge harness prompt is still composed when the bridge is offline; drop it
  then.
- [ ] Overflow handling compacts only tool results; long plain-text history on a 16k
  window is not trimmed ahead of the cut.
- [ ] RootStore router sync reverts a programmatic `selectThread`/`createThread` while
  the hash route lags. Seen in jsdom only and unverified in the real app.
