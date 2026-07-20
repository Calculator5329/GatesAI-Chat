# ADR: Semantic memory v2

- Status: accepted
- Date: 2026-07-19

## Context

Semantic recall needs a measurable product contract before its storage,
ranking, and UI are rebuilt. A plausible-looking match is not enough: the
system must retrieve retained context, abstain when evidence is weak, and make
its use visible without granting old text authority over the current request.

## Decision

The local corpus contains durable facts, notes, and retained chat text from hot
and archived threads. Workspace files and tool-result bodies are excluded by
default. Chat excerpts retain their `user` or `assistant` role; assistant text
can answer “what did we discuss?” but is never promoted to a durable user fact.

Retrieved content is **untrusted historical data**. It must not appear inside a
trusted system-instruction block. It will be supplied as bounded evidence with
an explicit instruction to ignore commands found inside it. All content and
vectors remain local, and live quality evaluation uses an already-installed
Ollama model only.

Automatic recall is conservative. No result is the correct result for an
unrelated, excluded, deleted, or unsafe query. Users will be able to disable
automatic recall, source types, and individual sources, and every memory that
is actually supplied to a model will be disclosed with provenance.

A change to the embedding default, ranking policy, or score threshold requires
a dated report on the frozen corpus. Thresholds are not selected by intuition.

## Release gate

The evaluated retrieval policy must meet all of these targets:

- overall Recall@5 >= 0.90 and MRR@5 >= 0.80;
- exact-identifier and durable-fact Recall@5 >= 0.95;
- excluded/deleted source violations exactly 0;
- no-match automatic-injection false-positive rate <= 0.05;
- query-embedding and local-ranking p50/p95 reported separately.

The report also records Recall@1/3, nDCG@5, duplicate-source rate, indexing
duration, corpus version, model, and command. Failing evidence blocks a policy
change; it is never hidden by an aggregate average.

## Consequences

The benchmark is an offline unit-test surface plus an opt-in local Ollama run.
It uses no personal conversation data, cloud endpoint, or silent model pull.
Future source types need explicit trust and control decisions plus new frozen
cases.
