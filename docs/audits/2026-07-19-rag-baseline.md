# Semantic-memory baseline — 2026-07-19

Status: **BLOCKED: local model run required**.

The publication-safe corpus, metric implementation, and offline tests are in
place. This sandbox cannot connect to the local Ollama service, so no scores
have been invented and no model has been downloaded. Run the following on the
owner machine with an already-installed embedding model:

## Command

`npm run rag:eval -- --model nomic-embed-text --out docs/audits/2026-07-19-rag-baseline.md`

The generated report records Recall@5, MRR@5, no-match false-injection rate,
forbidden-source violations, and separate query-embedding and local-ranking
p50/p95 latency. Keep this blocked notice until that real local command replaces
it with measured evidence.
