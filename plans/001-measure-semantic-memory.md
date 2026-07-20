# Plan 001: Establish the semantic-memory contract and evaluation gate

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition occurs, report it instead of improvising. When done, update
> this plan's row in `plans/README.md`.
>
> **Drift check (run first)**:
> `git diff --stat dee51c2..HEAD -- src/services/rag tests/services/rag scripts package.json docs/adr docs/audits`
> If an in-scope contract changed, compare the excerpts below with the live code
> and stop on a material mismatch.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: tests / direction
- **Planned at**: commit `dee51c2`, 2026-07-19
- **Completed**: 2026-07-19; live local baseline completed during plan 003 calibration

## Why this matters

The current suite verifies storage, a fixed threshold, and dot-product ordering
with a hand-written three-dimensional fake embedder. It cannot answer whether a
real query retrieves the right past conversation, whether irrelevant text is
wrongly injected, or whether one embedding model is materially better than
another. This plan makes quality and latency explicit before architecture and UI
work begin.

Research supports that order: BEIR found BM25 to be a robust heterogeneous
baseline and reranking strongest but more expensive; RAGAS separates retrieval
quality from answer faithfulness; Ollama's embedding API exposes model-dependent
dimensions and truncation behavior. Treat those as reasons to measure this
corpus, not as permission to copy a generic RAG stack.

References:

- https://arxiv.org/abs/2104.08663
- https://arxiv.org/abs/2309.15217
- https://docs.ollama.com/capabilities/embeddings
- https://docs.ollama.com/api/embed

## Current state

- `tests/services/rag/helpers.ts:37-50` maps text containing `alpha`, `beta`, or
  `gamma` to orthogonal vectors. This proves plumbing only.
- `tests/services/rag/RagStore.test.ts:13-29` checks one above-threshold match
  and an auto-inject toggle; it has no false-positive/no-match corpus.
- `src/services/rag/RagStore.ts:31-33` hard-codes `0.55`, three injected chunks,
  and 2,000 characters without model-specific evidence.
- `src/services/rag/indexer.ts:200-229` chunks only by character and paragraph
  length; the benchmark must expose weak short follow-ups and exact identifiers.
- Repo verification uses `npm run ci` and `npm run test:e2e`; live model tests
  are never a routine CI gate (`CLAUDE.md`). Follow the same rule for live
  Ollama evaluation.

The fixture vocabulary must distinguish:

- **fact**: an explicit durable profile memory;
- **note**: a titled long-form user document;
- **conversation excerpt**: historical user or assistant text, with its role;
- **candidate**: a retrieved chunk before policy filtering;
- **used memory**: a candidate actually supplied to the model;
- **no match**: a query for which automatic recall should supply nothing.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Focused tests | `npm test -- tests/scripts/rag-eval.test.ts tests/services/rag` | exit 0; all named files pass |
| Full gate | `npm run ci` | tests, typecheck, and lint exit 0 |
| E2E regression | `npm run test:e2e` | all Playwright projects pass |
| Live local benchmark | `npm run rag:eval -- --model nomic-embed-text` | exit 0 and writes a redacted report; requires that model already installed |

## Scope

**In scope** (only these paths):

- `docs/adr/2026-07-19-semantic-memory-v2.md` (create)
- `scripts/rag-eval/` (create)
- `tests/fixtures/rag-eval/` (create)
- `tests/scripts/rag-eval.test.ts` (create)
- `package.json` (add one script only)
- `docs/audits/2026-07-19-rag-baseline.md` (create from a real local run)
- `docs/architecture.md` (link the ADR and evaluation command)
- `docs/changelog.md` (completion evidence only)

**Out of scope**:

- Production ranking, chunking, persistence, thresholds, defaults, or UI.
- Pulling an Ollama model without operator approval; never hide a large download
  inside the benchmark.
- Cloud APIs, paid model calls, user chat exports, or real personal data.
- Search, workspace-file indexing, Offline Library, or database plugins.

## Git workflow

- Use branch `codex/rag-001-evaluation` unless the dispatcher provides one.
- Match recent clear imperative commit subjects, e.g. `Add semantic memory quality gate`.
- Stage only the paths above. Do not push unless the operator directs it.

## Steps

### Step 1: Record the v2 product and trust contract

Create the ADR with these decisions:

1. The corpus is saved facts, notes, and retained chat text (hot plus archived),
   never workspace files or tool-result bodies by default.
2. Every chat excerpt retains `user`/`assistant` role. Assistant text may support
   “what did we discuss?” but must never be labeled as a durable fact.
3. Retrieved content is untrusted historical data. It must not be placed inside
   a trusted system instruction block; 004 will add a separate evidence message.
4. Automatic recall is conservative: returning nothing is correct for no-match
   and unsafe/adversarial fixtures.
5. All content and vectors stay local. Live evaluation uses Ollama only.
6. A model/default/threshold change requires a dated benchmark report; no
   threshold is selected by intuition.
7. The UX must disclose the used sources and let users disable automatic recall,
   source types, and individual sources.

Also record the success metrics that 003 must satisfy on the frozen fixture:

- overall `Recall@5 >= 0.90` and `MRR@5 >= 0.80`;
- exact-identifier and durable-fact `Recall@5 >= 0.95`;
- excluded/deleted source violations: exactly `0`;
- no-match automatic-injection false-positive rate `<= 0.05`;
- report p50/p95 separately for query embedding and local ranking; do not hide
  slow embedding latency inside an average.

**Verify**: `rg -n "Recall@5|untrusted historical data|excluded" docs/adr/2026-07-19-semantic-memory-v2.md`
must return each decision/metric.

### Step 2: Add a frozen, publication-safe evaluation corpus

Create 40–60 synthetic cases in a human-readable JSON format. Each case needs:

- stable `caseId`, category, query, relevant source IDs, forbidden source IDs,
  and whether automatic recall should return zero results;
- source records with stable ID, source type, author role where applicable,
  title, timestamp, and synthetic text;
- no names, paths, credentials, or phrases copied from Ethan's real history.

Cover at least five cases in every category: paraphrase, exact identifier,
recency/conflict, elliptical follow-up, multi-source, no-match, deleted/excluded,
and adversarial instruction text. Include hard negatives that share vocabulary
but are not relevant. Add a fixture README explaining how to extend the corpus
without weakening old labels.

**Verify**: the new unit test parses the corpus, asserts unique IDs, valid
references, no empty labels, at least 40 cases, and required category coverage.
`npm test -- tests/scripts/rag-eval.test.ts` must pass.

### Step 3: Implement a dependency-free evaluation runner

Under `scripts/rag-eval/`, add pure metric modules plus a CLI adapter. Reuse the
production `OllamaEmbeddingClient` and production chunk/search entry points where
possible; do not fork the retrieval algorithm into the script. Compute:

- Recall@1/3/5, MRR@5, and nDCG@5;
- no-match false-injection rate;
- forbidden/deleted/excluded violations;
- duplicate-source rate in top 5;
- index duration, query-embedding p50/p95, and ranking p50/p95.

The CLI accepts `--model`, `--base-url` (default from the existing local runtime
convention), `--out`, and `--json`. It must never accept or send an OpenRouter
key. It must fail clearly if Ollama/model is unavailable. Add `rag:eval` to
`package.json` using the repo's existing TypeScript script execution approach;
do not add a dependency merely to run one file.

Unit-test all metrics with fixed rankings, including ties, no relevant items,
no-match, and forbidden hits. Tests must not require Ollama or network access.

**Verify**: `npm test -- tests/scripts/rag-eval.test.ts` passes and
`npm run rag:eval -- --help` exits 0 without contacting Ollama.

### Step 4: Capture the honest baseline

Run against each embedding model already installed locally. At minimum record
the current default `nomic-embed-text` if present. If `embeddinggemma` or
`qwen3-embedding:0.6b` is already installed, include them as comparison rows;
do not pull them silently. Write the dated report with environment facts,
per-category metrics, latency distributions, failures, and exact command.

Do not change the shipping default in this plan. If no embedding model is
installed, write the harness and mark the baseline report `BLOCKED: local model
run required`; do not fabricate numbers.

**Verify**: `rg -n "Command|Recall@5|MRR@5|false-injection|p95" docs/audits/2026-07-19-rag-baseline.md`
returns the recorded evidence, and no fixture/report contains a home-directory
path or secret-like token.

### Step 5: Document and run repository gates

Add the offline/live distinction and command to `docs/architecture.md`. Run the
focused suite, full CI, and Playwright. Add a concise top-of-file changelog entry
for the completed evaluation milestone. Do not close the roadmap's semantic
memory epic; plans 002–004 are still required.

**Verify**: `npm run ci && npm run test:e2e` exits 0.

## Test plan

- `tests/scripts/rag-eval.test.ts`: fixture schema/category validation; metric
  correctness for perfect, partial, tie, empty, forbidden, and no-match results;
  redaction/report formatting; `--help` is offline.
- Use `tests/services/rag/helpers.ts` only as a structural test-double pattern;
  do not treat its fake vectors as quality evidence.
- The live benchmark is a manual local gate, not a CI test.

## Done criteria

- [x] ADR contains corpus, trust-boundary, control, and numeric quality decisions.
- [x] Frozen corpus has at least 40 valid cases across all named categories.
- [x] Metric tests and CLI help pass without Ollama/network.
- [x] A real baseline report exists, or the plan status explicitly identifies
      the one owner-machine run still required without invented values.
- [ ] `npm run ci` and `npm run test:e2e` pass (deferred to final integrated gate).
- [x] No production retrieval behavior or shipping model default changed.
- [x] Only in-scope files are modified.

## STOP conditions

- Any proposed fixture contains real user data, secrets, local paths, or copied
  conversation text.
- Production retrieval cannot be invoked without duplicating it in the runner;
  report the boundary problem before creating a second algorithm.
- Running the live benchmark would require a model download or cloud call that
  the operator did not authorize.
- An in-scope production contract changed since `dee51c2` enough to invalidate
  the metric adapter.
- A verification step fails twice after a reasonable correction.

## Maintenance notes

Keep old fixture cases forever unless their label is proven wrong; otherwise a
ranking change can improve its own test by deleting hard examples. New source
types and embedding defaults require new cases and a dated baseline. Reviewers
should reject aggregate-only reports that hide a bad no-match or exact-ID slice.
