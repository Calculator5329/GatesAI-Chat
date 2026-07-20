# Product taste — gatesai-chat

## Design comparisons

- When interaction or information architecture is the real question, build
  genuinely different code-derived options in one switchable preview. Do not
  present near-identical static mockups as if they were meaningful alternatives.
- Use image-generation comparisons for broad visual direction; use working
  comparisons for density, navigation, disclosure, and behavior feedback.

## Semantic memory

- Use Option 2's compact source chips beneath a response and terse source-list
  management under Agent → Memory. Keep details progressive and the ordinary
  chat canvas quiet.

## Local library

- Treat the knowledge library as part of memory, not a new top-level
  destination. One compact source list should be enough.
- Ask for explicit file approval, show the real workspace path and load state,
  and make disable/re-enable reversible. Do not revive marketplace, plugin,
  daemon, or dashboard furniture around a local indexing feature.
- Documents may join recall. Databases should reveal schema first; keep row
  access a separate bounded read-only action so “add to library” never implies
  “send all my data to the model.”

## Tool activity

- Lead with the goal in plain English: “Checking the project tests,” not raw
  tool syntax such as `terminal npm test` or `fs.read`.
- Let the model supply a short present-progress phrase when it calls a tool,
  but keep a deterministic label as the fallback. Model-authored UI copy is
  display metadata, never an execution argument or a claim of success.
- Keep raw commands, paths, output, and diagnostics available in the existing
  expandable detail layer rather than making them the default chat surface.
