# Product taste — gatesai-chat

## Tool activity

- Lead with the goal in plain English: “Checking the project tests,” not raw
  tool syntax such as `terminal npm test` or `fs.read`.
- Let the model supply a short present-progress phrase when it calls a tool,
  but keep a deterministic label as the fallback. Model-authored UI copy is
  display metadata, never an execution argument or a claim of success.
- Keep raw commands, paths, output, and diagnostics available in the existing
  expandable detail layer rather than making them the default chat surface.
