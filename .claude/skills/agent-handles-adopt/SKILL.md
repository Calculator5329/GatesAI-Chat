---
name: agent-handles-adopt
description: Hook this Vite app fully into agent-handles. Run npx agent-handles adopt, follow its tailored prompt, then finish with adopt verify.
---

One lifecycle, two phases. Start or resume with:

`npx agent-handles adopt`

Then read `.agent-handles/adoption-prompt.md`, which is tailored to this
project. The package prompts remain supporting references:

1. **Identity pass**: read and execute
   `node_modules/agent-handles/prompts/identity-pass.md`.
2. **Journey authoring**: read and execute
   `node_modules/agent-handles/prompts/journey-authoring.md`.

Do not start phase 2 until phase 1's measured checkpoint is clean. Finish with
`npx agent-handles adopt verify`; its receipt, not this skill or an agent's
claim, owns the verification verdict.
