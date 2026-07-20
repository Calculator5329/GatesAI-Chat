# Plan 003: Ship evaluated hybrid retrieval and calibrated context selection

> **Executor instructions**: Execute only after plans 001 and 002 are DONE.
> Compare every ranking change against the frozen corpus. Stop instead of adding
> an LLM stage or dependency to rescue a weak result without review. Update the
> status row in `plans/README.md` when complete.
>
> **Drift check (run first)**:
> `git diff --stat dee51c2..HEAD -- src/services/rag src/services/tools/recall.ts scripts/rag-eval tests/services/rag tests/scripts docs/audits`
> Expected drift from 001/002 is intentional; verify their plans are DONE and
> treat their live contracts, not the excerpts below, as the new baseline.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/001-measure-semantic-memory.md`, `plans/002-rebuild-index-lifecycle.md`
- **Category**: performance / correctness
- **Planned at**: commit `dee51c2`, 2026-07-19
- **Completed**: 2026-07-19

## Why this matters

Dense similarity alone is weak on exact identifiers, thresholds vary by model,
and top-k can contain several overlapping chunks from one source. The goal is
not a fashionable pipeline; it is the simplest local pipeline that clears the
frozen quality gate and remains fast. This plan adds lexical+dense candidate
fusion, source-aware diversification, explicit no-match behavior, and a dated
ablation report.

## Current state

At the planning commit:

- `src/services/rag/vectorStore.ts:78-87` scans every vector, sorts by dot
  product, and returns top-k.
- `src/services/rag/RagStore.ts:185-206` embeds raw query text and applies one
  global `0.55` cutoff only for automatic context.
- `src/services/rag/format.ts:10-19` formats score-ranked results but has no
  stable structured retrieval trace.
- `src/services/rag/indexer.ts:200-229` uses character chunks with overlap and
  no conversation-turn semantics.

Plan 002 should replace storage/lifecycle but intentionally should not choose a
ranking strategy. Follow its manifest and source metadata rather than recreating
parallel records.

Use these evidence-backed principles:

- BM25 is a robust heterogeneous baseline and complements dense retrieval:
  https://arxiv.org/abs/2104.08663
- MMR balances relevance with novelty to reduce redundant results:
  https://doi.org/10.3115/1119089.1119120
- Retrieval and generation quality must be evaluated separately:
  https://arxiv.org/abs/2309.15217

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Ranking tests | `npm test -- tests/services/rag tests/scripts/rag-eval.test.ts` | all pass |
| Benchmark | `npm run rag:eval -- --model nomic-embed-text --out docs/audits/semantic-memory-v2-retrieval-report.md` | exit 0; metrics and latency emitted |
| Full gate | `npm run ci` | exit 0 |
| E2E | `npm run test:e2e` | all projects pass |

## Scope

**In scope**:

- `src/services/rag/` (retrieval, lexical index, chunk policy, worker if needed)
- `src/services/tools/recall.ts` and its tool tests
- `scripts/rag-eval/` and `tests/scripts/rag-eval.test.ts`
- `tests/services/rag/`
- `tests/fixtures/rag-eval/` only to add genuinely missing categories; never
  weaken or relabel a failing old case without reviewer approval
- `docs/audits/semantic-memory-v2-retrieval-report.md` (new ablation/evidence report)
- `docs/architecture.md`
- `docs/changelog.md` (completion evidence only)

**Out of scope**:

- Prompt placement, assistant-message schema, UI disclosure, or settings (004).
- Cloud rerankers, cross-encoders, query-generation LLMs, HyDE, or multi-query.
- External vector/search databases or new packages unless a reviewer approves a
  measured failure of the dependency-free approach.
- Workspace files, tool outputs, attachments, web search, or Offline Library.

## Git workflow

- Branch: `codex/rag-003-hybrid-retrieval` unless dispatched elsewhere.
- Commit the pure ranking engine/tests before wiring automatic context.
- Example subject: `Improve semantic recall with evaluated hybrid ranking`.
- Do not push unless directed.

## Steps

### Step 1: Make conversation chunks useful and provenance-preserving

Replace arbitrary message-only chunks with source-aware documents:

- facts remain one atomic document;
- notes embed title plus bounded paragraph chunks and retain raw display text;
- conversations use turn windows (a user message plus the following assistant
  response, bounded by characters/tokens) with thread title and role metadata;
- short follow-ups may include a small adjacent-turn context window for the
  embedding text, while display excerpts remain exact and attributed;
- never include tool-result bodies, attachment bytes, activity events, or the
  current empty/streaming assistant placeholder.

Keep a chunk-policy version in the 002 manifest. Add tests for a short “yes, use
that one” follow-up, a long assistant answer, title-based lookup, role retention,
and deterministic stable IDs.

**Verify**: `npm test -- tests/services/rag/indexer.test.ts` passes with named
turn-window cases.

### Step 2: Add a pure lexical retriever over the same active generation

Implement dependency-free BM25 (or an equivalently documented sparse scorer)
using normalized tokens, document lengths, and IDF from the active corpus.
Preserve exact alphanumeric identifiers, model names, filenames, and hyphenated
terms rather than stemming them into oblivion. Build/update its state with the
same generation activation as vectors so lexical and dense candidates never
refer to different corpora.

If corpus scoring on the main UI thread misses the scale budget, move dense and
lexical scoring into a Vite Web Worker with typed messages. Do not add a worker
preemptively if a 10,000-chunk synthetic benchmark is comfortably below budget.

**Verify**: unit tests prove exact identifier/name retrieval, common-term IDF,
deleted-source absence, and lexical/dense generation consistency.

### Step 3: Fuse candidates and diversify by source

Define a typed `RagRetrievalRequest` and `RagRetrievalResult` rather than
returning formatted strings from the ranking engine. Request fields must include
query, purpose (`explicit_recall` or `automatic_context`), active thread ID,
limit, and source policy. Results must preserve dense rank/score, lexical
rank/score, fused rank/score, source/role metadata, and a stable reference.

Use rank-based fusion (such as reciprocal-rank fusion) so incomparable dense and
BM25 score scales do not require fragile normalization. Retrieve a wider
candidate pool, then apply MMR/source-level deduplication so automatic context
does not spend all slots on overlapping chunks from one thread/note.

Policy requirements:

- automatic context excludes the active thread because that conversation is
  already in the request; explicit recall may include it;
- excluded/deleted sources are filtered before ranking output;
- facts, notes, user text, and assistant text retain distinct provenance; do not
  silently boost assistant prose into “truth”;
- recency may be a bounded tie-breaker, not a multiplier capable of defeating a
  clearly more relevant older result;
- return zero used results when the calibrated no-match policy says so.

**Verify**: ranking tests cover exact+dense fusion, active-thread exclusion,
source diversity, conflicts across dates, forbidden sources, and no-match.

### Step 4: Calibrate with ablations, then freeze policy constants

Run the 001 corpus with at least these configurations:

1. current/002 dense baseline;
2. lexical only;
3. dense + lexical fusion;
4. fusion + source diversification;
5. fusion + diversification + candidate/no-match calibration.

For every already-installed embedding model, report global/category metrics and
latency. Select the simplest configuration that meets the ADR gate. Only change
the shipping embedding default if a compared installed model materially wins
quality without unacceptable download/latency cost; document the decision and
safe generation migration. Do not choose from a single aggregate score.

Tune automatic-context candidate count, used-result limit, and no-match policy
from the corpus. Remove the unconditional global `0.55` assumption. Store any
model-specific calibration beside the index policy/version, with a conservative
fallback for unknown models.

The report must explicitly state whether these targets passed:

- overall Recall@5 ≥ 0.90 and MRR@5 ≥ 0.80;
- exact-ID and durable-fact Recall@5 ≥ 0.95;
- forbidden violations = 0;
- no-match false-injection ≤ 0.05;
- ranking CPU p95 ≤ 100 ms at 10,000 chunks on the test machine; embedding
  latency reported separately.

If no configuration meets the gate, stop with the ablation evidence. Do not add
an LLM stage in this plan without a new reviewed proposal.

**Verify**: the dated report includes every configuration, category, metric,
latency percentile, selected constants, and failed cases.

### Step 5: Wire explicit recall to structured results

Keep the public `recall` tool name and arguments for model compatibility. Have
it format structured results with stable source reference, source type/role,
thread/note title, date, and bounded excerpt. Do not expose internal vector data
or claim similarity is confidence. No-match copy must be plain and definitive.

Automatic context should consume the same structured engine with purpose
`automatic_context`; prompt placement remains 004.

**Verify**: existing tool tests plus new provenance/no-match/limit tests pass.

### Step 6: Document and run the gate

Update architecture with the selected chunking, hybrid candidate/fusion flow,
diversification, no-match policy, and benchmark command/report link. Add a
concise top-of-file changelog entry; do not close the semantic-memory roadmap
epic until 004 ships the user contract.

**Verify**: `npm run ci && npm run test:e2e` exits 0.

## Test plan

- `indexer.test.ts`: turn windows, titles, roles, adjacent context, stable IDs.
- New pure lexical/ranking test files: tokenization, BM25 math, fusion order,
  MMR/source diversity, active-thread/source-policy filtering, no-match.
- `RagStore.test.ts`: explicit versus automatic purposes and calibrated limits.
- `tools.test.ts`: formatted structured provenance, stable limits, unavailable
  and no-match states.
- `rag-eval.test.ts`: ablation selection/report output and 10k synthetic scale
  benchmark harness (do not make wall-clock thresholds flaky in ordinary CI;
  keep the measured threshold in the explicit benchmark command).

## Done criteria

- [x] Same active corpus/generation powers dense and lexical retrieval.
- [x] Automatic recall excludes active thread and all excluded/deleted sources.
- [x] Structured results retain author role and all ranking/provenance fields.
- [x] Hybrid + diversification/no-match policy is selected by a dated ablation.
- [x] All ADR quality/safety targets pass, or the plan stops with honest evidence.
- [x] No cloud/LLM ranking stage or new dependency was introduced silently.
- [ ] `npm run ci` and `npm run test:e2e` pass (deferred to final integrated gate).
- [x] No files outside scope are modified.

## STOP conditions

- Plans 001 or 002 are not DONE or their contracts are missing.
- Meeting the quality gate appears to require an LLM rewrite/reranker, external
  database, new package, or cloud call.
- A fixture label seems wrong; do not change it without reviewer approval and a
  rationale in the report.
- Hybrid ranking cannot stay within the measured local latency/memory budget.
- Any result loses source/role identity between index and tool output.
- A verification fails twice after a reasonable correction.

## Maintenance notes

Do not compare raw BM25 scores with cosine values across models; fusion should
stay rank-based unless a future benchmark proves a calibrated alternative.
Reviewers should inspect no-match and conflicting-memory cases, not only average
recall. New embedding defaults require a fresh report and generation rebuild.
