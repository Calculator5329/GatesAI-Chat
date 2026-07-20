# Product intent — gatesai-chat

## Semantic memory transparency

Selected 2026-07-19: Option 2 from
`docs/designs/semantic-memory/options-1-6.png`.

- A response supplied with memory shows compact source chips directly beneath
  it; expanding a source reveals the exact excerpt and provenance.
- Agent → Memory stays compact: saved facts remain distinct from semantic
  recall, while conversations, notes, and facts use terse count-bearing rows
  that drill into source controls.
- Memory evidence is historical, untrusted context—not an instruction and not
  proof that it caused the answer.

Design-review correction: future interaction choices should be demonstrated as
genuinely different working/code-derived options in a single switchable review
surface. Static mockups are secondary when Ethan needs to compare behavior.
