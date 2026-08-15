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

## The transcript

- The transcript announces and hands off; it does not embed. A rich payload
  (an HTML artifact, a generated document) gets a compact card saying what it
  is, and a control that opens it somewhere with room — the dock on desktop,
  the full-screen modal everywhere. Never a fixed-height frame inline: it
  costs the same vertical wall on every mention, so naming a file twice builds
  two walls.
- Never paint a light surface into a dark thread. A `background: #fff` frame
  is a hole punched in the page. If a surface must render author-controlled
  HTML on white, it belongs in the dock or a modal, not between two paragraphs.
- Async affordances render disabled, not absent. A button that appears once a
  read lands shifts the layout under a reader who is already there.
- When a component grows a `variant` for a new context, wire every call site in
  the same change. A variant nothing passes is worse than no variant: the code
  and the commit message both claim a fix that never shipped.

## Controls

- Presentation belongs in CSS, not inline styles. Inline styles beat ordinary
  stylesheet rules, so a component that styles itself inline silently disables
  any state its stylesheet tries to add later — that is how `.ui-toggle`'s
  press animation sat dead in the sheet while the thumb ignored it.
- Disabled, focus, and hover come from the shared tokens and the global rules.
  A control that hardcodes its own disabled opacity or focus ring is the one
  control that looks wrong, and the local rule usually loses to the global
  `!important` anyway — dead code that reads like intent.
- Every `role="switch"` needs an accessible name on the control itself. A
  visible label in a sibling element is not associated with it and is not
  announced.

## Tool activity

- Lead with the goal in plain English: “Checking the project tests,” not raw
  tool syntax such as `terminal npm test` or `fs.read`.
- Let the model supply a short present-progress phrase when it calls a tool,
  but keep a deterministic label as the fallback. Model-authored UI copy is
  display metadata, never an execution argument or a claim of success.
- Keep raw commands, paths, output, and diagnostics available in the existing
  expandable detail layer rather than making them the default chat surface.
