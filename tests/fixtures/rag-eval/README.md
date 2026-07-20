# Semantic-memory evaluation fixture

`corpus.json` is synthetic, publication-safe, and frozen. Add cases; do not
delete or relabel a difficult case merely to improve a score. Every source and
case ID must stay stable. New source types or ranking policies need new cases,
including hard negatives and a conservative no-match example.

The corpus intentionally includes historical assistant text and adversarial
instructions. They test retrieval and filtering; they are never trusted system
instructions or durable user facts.
