# Semantic-memory baseline — 2026-07-19

Status: **COMPLETE**.

The publication-safe corpus was run against the already-installed local
`nomic-embed-text` model. No model was downloaded. The dense baseline reached
94.6% Recall@5 and 0.938 MRR@5, but failed the safety gate with 100% no-match
false injection and six forbidden hits. That evidence motivated the selected
hybrid policy recorded in the full retrieval report.

## Command

`npm run rag:eval -- --model nomic-embed-text --out docs/audits/semantic-memory-v2-retrieval-report.md`

The [full report](semantic-memory-v2-retrieval-report.md) records all five
ablations, category failures, Recall@5, MRR@5, false-injection, forbidden-source
violations, separate query-embedding/local-ranking p50/p95, and a 10,000-chunk
CPU scale check.
