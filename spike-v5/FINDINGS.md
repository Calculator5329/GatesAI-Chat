# v5 architecture spike — findings

One vertical slice of the `planning/incubator/gatesai-chat-v5` design, built
in `spike-v5/` against no existing application code, and measured against the
equivalent path in the shipping app.

**Recommendation: adapt.** The layering works and is cheaper than v4 on every
axis measured. The design's own framing — "extract the core, keep the 1,263
tests" — is the part that does not survive contact. Details below.

Measured on the worktree for `agent/claude/gatesai-d20-v5-architecture-spike-20260904`
at app version 4.7.0.

---

## 1. What was built

A single chat turn round-trip: user text in, streamed assistant reply out,
both messages persisted, all of it observable.

```
runtime/createChatRuntime.ts     composition root — the only file that knows all three layers exist
  │
  ├── domain/runTurn.ts          the use case: load → append → save → stream → stop → save
  │     domain/model.ts          immutable Conversation + pure transitions
  │     domain/ports.ts          ChatTransport, ConversationRepository, Clock, IdSource, TurnPlugin
  │     domain/events.ts         one closed TurnEvent union
  │
  ├── transport/openAiCompatTransport.ts   OpenAI-wire adapter over an injected fetch
  │     transport/sse.ts                   byte-boundary-safe SSE frame reader
  │
  └── persistence/keyValueRepository.ts    versioned JSON records + a v1→v2 migration
```

Dependency arrows all point inward. `domain/` imports nothing but itself;
adapters import the domain's ports; only the composition root imports both
adapters. Nothing in `spike-v5/src/` imports React, MobX, the DOM, or the
existing `src/` tree.

`spike-v5/tests/turnRoundTrip.test.ts` covers seven behaviors through the
public seam: a happy-path stream, deltas split across byte boundaries, an HTTP
429, mid-stream abort with the partial reply retained, an extension
decorating the outgoing request, a v1 record migrated on read and continued,
and a rejected concurrent turn.

Run it with:

```sh
npx vitest run --config spike-v5/vitest.config.ts
```

---

## 2. Measured comparison

The v4 "equivalent path" is the set of modules a plain text turn — no tools,
no RAG, no images — actually executes through, hand-identified from the call
chain `ChatStore.sendMessage` → `ChatTurnEngine` → `TurnRunner` →
`StreamingRoundExecutor` → `OpenAiCompatProvider` → `parseSse` →
`ChatPersistenceCoordinator`. It is a hand-picked list, not a transitive
import closure; the closure is larger, which strengthens rather than weakens
the comparison.

### Lines

| | v4 turn path | spike |
|---|---:|---:|
| Production files on the path | 25 | 9 |
| Production lines on those files | **6,733** | **1,050** |
| Test lines covering the path | 3,712 (5 specs) | 340 (1 spec + 1 support file) |
| Test cases on the path | 116 | 7 |

The 6,733 is not a like-for-like count and should not be read as one: those
25 modules also carry tools, images, RAG, agent tasks, compaction and export.
The point is the opposite — **there is no smaller number available**. You
cannot load a v4 turn without loading all of it, because the turn path and
the everything-else path are the same modules. The spike's 1,050 lines are
the turn and nothing else, and that is the property being tested.

Three individual files carry the weight: `ChatStore.ts` (1,373),
`turnRunner.ts` (846) and `persistence.ts` (1,082).

### Boundaries

Counting every interface member you must supply to run one turn:

| v4 seam | members |
|---|---:|
| `ChatTurnEngineHost` | 12 |
| `TurnHost` | 13 |
| `TurnRunnerDeps` loose functions (`createId`, `getToolStores`, `getRecentSummaries`, `getSemanticContext`, `getActiveSkill`, `getUserSystemPrompt`, `roundExecutor`) | 7 |
| `TurnProfile` (incl. `ProfileFacade`) | 8 |
| `ChatFacade` | 7 |
| `LlmProvider` | 3 |
| `ModelCatalog` | 2 |
| `TurnRouter` | 1 |
| **8 seams** | **53** |

| spike port | members |
|---|---:|
| `ChatTransport` | 2 |
| `ConversationRepository` | 2 |
| `TurnPlugin` | 3 |
| `Clock` | 1 |
| `IdSource` | 1 |
| `TurnListener` | 1 |
| **6 ports** | **10** |

(`KeyValueStore`, 2 more members, lives inside the persistence adapter and is
never visible to the domain. Counting it: 7 seams, 12 members.)

53 → 10 is the single biggest result in this spike. It is also the
explanation for the line counts: most of `ChatStore.ts` is the implementation
of those 53 members.

Internal imports per module tells the same story: `ChatStore.ts` has 44
relative imports and `turnRunner.ts` has 25, against 3 for `domain/runTurn.ts`
and 5 for the composition root.

### Test time

**Not measured in this lane, and I am not going to guess at it.** Every test
runner invocation — `npx vitest`, `node_modules/.bin/vitest`, `node --test`
— was refused by this run's command sandbox, so the spike suite has not been
executed here and I have no timing for either side. The command above is the
one to run.

What *is* measurable without executing anything, and is the more interesting
number anyway, is the setup cost per test:

- `tests/services/chat/turnRunner.test.ts` — nominally a service test —
  constructs two real MobX stores (`ModelRegistry`, `UserProfileStore`) and
  calls `clearAppStorage()` before it can run a turn. It needs browser
  storage to test a function that has nothing to do with browser storage.
- The root `vitest.config.ts` sets `environment: 'jsdom'` for the entire
  suite, so all ~1,329 tests pay for a DOM, including the pure ones.
- The spike's config sets `environment: 'node'`, and its test constructs a
  transport, a repository and a runtime — three objects, no globals, no
  storage, no DOM. A headless core whose tests need a DOM is not headless,
  and that is a checkable property rather than an opinion.

---

## 3. What the design got right

**The seam is real, and it is smaller than expected.** The concept document
asserts a headless core with "turn pipeline, provider routing, tool
execution, memory, and sub-agents". Built out, one turn needs two ports plus
three ambient ones. Provider routing turned out not to be a core concern at
all — it is model-id → transport selection, which belongs in the composition
root. That is the design being *more* right than it claimed.

**Persistence as an adapter earns its keep immediately.** Schema version and
the v1→v2 migration live entirely inside `keyValueRepository.ts`; the domain
has no `schemaVersion` field and no migration awareness. In v4,
`CURRENT_CHAT_SCHEMA_VERSION` is imported by `ChatStore.ts` itself. The
migration test in this spike reads a v1 record, continues the conversation,
and writes back v2, without the domain knowing anything happened.

**Defining the extension API against the core seam is the right call, and it
is now demonstrable rather than aspirational.** `TurnPlugin` has one write
hook (`decorateRequest`) and one read hook (`onEvent`), and the test drives
both. The audit note in `decisions.md` observes that v4 already has
`registerDynamicProvider()` with zero callers — a registration hook against
internal store state that nobody could use. The difference is that
`decorateRequest` receives a `CompletionRequest`, a type the domain owns and
exports, so the promise is checkable.

**Stable identities during a rebuild being nearly free** is untested here
(this slice has no UI) but nothing in the layering works against it.

## 4. What the design got wrong once real code met it

**"Extract the core, keep the 1,263 tests" is the wrong frame, and the open
question built on it is asking the wrong thing.** `open-questions.md` leads
with "what proportion of the tests survive the headless extraction
unchanged?" — and calls the answer decisive for whether option 2 is cheap.
It is not decisive, because a test cannot survive a change that alters the
shape it was written against. v4's turn tests assert against `Thread`,
`Message`, `parts[]`, `StreamActivity` phases and host-callback ordering. The
spike's equivalent asserts against an event union and a persisted record.
Neither could be ported without rewriting. The right question is not what
proportion of tests survive, but **what proportion of encoded *behavior*
survives** — the interruption semantics, the compaction rules, the pseudo-tool
rescue, the finish-reason mapping. That is a reading exercise per module, not
a `vitest run`, and it is much slower than the folder assumes. Answering the
question as written will produce a number that looks like a verdict and is
not one.

**"Extraction" is the wrong verb.** Nothing in the spike was extracted.
`domain/model.ts` is not a subset of `core/types.ts` — v4's `Message` has
`parts[]` for multimodal content, `ToolCall`/`ToolResult` payloads, and
mutation in place, and the spike's is immutable and text-only. To reuse v4's
types is to reuse the coupling. The realistic path is: **rewrite the domain,
port the adapters.** `streamCore.ts` (172 lines, tool-call delta accumulation
and finish-reason mapping) and `migrations.ts` (152 lines) are genuinely
reusable nearly as-is, because they were already adapter-shaped. `ChatStore`
and `turnRunner` are not reusable at all. Budget for that split rather than
for an extraction.

**The concept lists tool execution as a core concern, and one turn says
otherwise.** Tools are a loop *around* the turn, not a layer inside it, and
the moment they become a domain port the port count starts climbing back
toward 53. `toolBatchExecutor.ts` is 367 lines and `TurnRunner` grew to 846
mostly by absorbing the tool-round loop. If v5 lets tools back into the
domain the same way, the spike's numbers evaporate. The clean shape is a
tool round as a *decorator over* `runChatTurn`, not a branch inside it — the
next slice worth spiking, because this slice does not prove it.

**One thing was harder than expected, and the design does not mention it.**
Streaming plus persistence forces a durability decision the v4 code makes
implicitly. The spike saves twice — once after the user message and once
after the turn stops — so an interrupted turn never loses what the user
typed. v4 defers to a debounced autosave in `ChatPersistenceCoordinator`,
which is a different and unwritten answer. Any v5 plan needs that policy
written down; the incubator folder has no line about it.

**The folder's headline measurement is stale in a way that flatters it.**
`README.md` still argues from "289 source files, 995 vitest tests"; the
2026-08-24 audit entry in `decisions.md` already corrected the test count to
1,263, and the roadmap now shows 1,329. The argument is unchanged in kind,
but the README should stop quoting 995 — the number appears three times and
is the load-bearing figure in "why this, why now".

## 5. Recommendation: adapt

Adopt the layering. Drop the extraction premise.

Specifically:

1. **Keep** the three-ring shape exactly as built here: pure domain, ports
   owned by the domain, adapters outside, one composition root. The 53 → 10
   boundary reduction is the whole case for v5 and it is now measured rather
   than argued.
2. **Keep** `TurnPlugin` as the extension seam, and keep it this small.
   Growing it is easy later; shrinking a published one is not.
3. **Replace** the open question "what proportion of tests survive?" with
   "which behaviors must survive, and where is each one encoded?" Answer it
   by reading `turnRunner.ts`, `streamingRoundExecutor.ts`,
   `toolBatchExecutor.ts` and `contextModes.ts` and writing the list. That
   is the artifact the grilling session should produce for the engine, the
   same way it is meant to produce one for the UI.
4. **Re-plan the cost** on rewrite-domain/port-adapters rather than
   extract-and-keep. On the evidence here, the domain is a rewrite and
   `streamCore.ts` + `migrations.ts` + the SSE reader are the reusable part.
5. **Spike the tool round next, before committing.** It is the one part of
   the concept that this slice actively casts doubt on, and it is where v4's
   complexity actually accumulated.
6. **Do not** treat this directory as the start of v5. It is a measurement,
   it has no UI, no tools, no local provider and no Web Lite path, and it
   should be deleted or archived once the decision is recorded.

## 6. What this spike does not show

No UI, so nothing about the agent-handles claim. No tool execution, no RAG,
no attachments, no image generation, no Ollama transport, no Web Lite
runtime, no multi-tab persistence leadership, no abort-and-resend semantics.
No test was executed in this lane (see §2). The line and boundary counts are
of the turn path only, and a second slice through tools could move them a
long way.
