# Semantic memory evaluation

- Generated: 2026-07-20T01:05:27.787Z
- Model: `nomic-embed-text`
- Corpus: v1, 40 cases
- Runtime: local Ollama (base URL redacted)

## Quality

| Metric | Result |
|---|---:|
| Recall@1 | 80.4% |
| Recall@3 | 87.5% |
| Recall@5 | 94.6% |
| MRR@5 | 0.909 |
| nDCG@5 | 0.903 |
| Exact-identifier Recall@5 | 100.0% |
| Durable-fact Recall@5 | 100.0% |
| No-match false-injection | 0.0% |
| Forbidden violations | 0 |
| Duplicate-source rate@5 | 0.0% |

## Ablations

| Configuration | Recall@5 | MRR@5 | False injection | Forbidden |
|---|---:|---:|---:|---:|
| dense | 94.6% | 0.938 | 100.0% | 6 |
| lexical | 85.7% | 0.750 | 91.7% | 4 |
| fusion | 94.6% | 0.909 | 100.0% | 3 |
| fusion+diversity | 94.6% | 0.909 | 100.0% | 3 |
| selected | 94.6% | 0.909 | 0.0% | 0 |

Selected policy: lexical-weighted reciprocal-rank fusion, source diversity, and conservative no-match calibration.

## Failed cases

- recent-05: missing [msg-api-new], forbidden [], false injection false.
- multi-04: missing [msg-api-old], forbidden [], false injection false.

## Latency

| Stage | p50 | p95 |
|---|---:|---:|
| Query embedding | 17.0 ms | 19.7 ms |
| Local ranking | 0.4 ms | 1.9 ms |
| Local ranking, 10,000 chunks | — | 19.7 ms |

Index duration: 95.8 ms.
