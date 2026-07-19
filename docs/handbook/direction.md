# Direction — why this exists and where it's going

*Last revised 2026-07-06. Owner: Ethan. This page is the durable answer to "what is this
project trying to be?" — read it before proposing big changes.*

## The point

GatesAI Chat exists because the two best interaction models in AI don't ship in one product:
the **ChatGPT-simple chat surface** everyone already knows, and the **Claude Code / Codex
class of local agency** — an assistant that actually reads your files, runs commands, and
does work on your machine. Products with the first have no real local hands; products with
the second live in terminals. GatesAI is the bet that one calm desktop app can hold both,
**without a subscription, without an account, and without your data leaving your machine.**

## Non-negotiables (in priority order)

1. **Download the exe → chatting in under a minute.** No account, no config file. Every step
   between install and first useful answer is a defect.
2. **Local is a first-class citizen, not a fallback.** Ollama is THE local LLM runtime (one
   runtime, managed well — not five, managed poorly); ComfyUI for images; Ollama embeddings
   for memory. A keyless user with Ollama gets a complete product: chat, tools, semantic
   memory, and sub-agents — all offline. Routing is deliberately limited to three
   destinations (OpenRouter, Ollama, ComfyUI); there is no generic custom-endpoint slot.
3. **Bring-your-own cloud, pay-as-you-go.** OpenRouter is the one cloud gateway. We will not
   chase per-vendor cloud integrations, and we will never insert ourselves into billing.
4. **All data local.** localStorage + IndexedDB + the workspace folder + OS keychain. Cloud
   sync, if it ever exists, is opt-in, E2E-encrypted, to storage the USER owns. (A Firestore
   backend was designed in early 2026 and deliberately parked for violating this.)
5. **Quiet power.** The editorial aesthetic — serif prose, dark charcoal + emerald, ambient
   activity timeline — is identity, not decoration. Power stays hidden until wanted; tool
   noise never dominates the conversation.

## The long game

- **Depth over breadth (2026-07-19 reset).** The product is narrowing to what it can do
  exceedingly well — top-tier performance, UI/UX, and (eventually) customizability — rather
  than a feature checklist. Semantic memory done right and first-class search (basic + deep
  research) are the near-term headline threads.
- **An agent platform, quietly.** Sub-agents, skills, semantic memory, and web reading
  compose: "a background agent with my reviewer skill reads new files and leaves me a
  summary." The direction is composition — making a few primitives multiply — not adding
  disconnected features. Parked-but-planned extensions (schedules, MCP, in-app source
  self-improvement) return only when they can be first-class; see `docs/roadmap.md`.
- **Audience:** AI power users who want control without assembling infrastructure. Not
  beginners-with-training-wheels, not enterprise fleets. The product should feel like: *you
  know enough to want control; here it is, assembled.*

## How we decide (heuristics that have served well)

- **Simpler is better.** One generic mechanism (one skills format, one availability-gating
  path) beats N special cases. If a feature needs a settings page to explain itself,
  reconsider the feature.
- **The code is the spec; docs follow reality.** When they disagree, fix the docs or fix the
  code — never let them drift silently.
- **Honest surfaces.** If something needs a key (all OpenRouter routes), only works on
  desktop (bridge tools), or is degraded (Web Lite), the UI says so plainly.
- **Verification is not optional.** Nothing merges without the gate; user-facing claims get
  verified in a running app, not inferred from green tests.

## Explicit non-goals

Enterprise admin/SSO/fleet management · every-provider completeness · hosted accounts or
telemetry · beginner-guided SaaS onboarding · visual redesigns that trade identity for trend.

## Where the plans live

`docs/roadmap.md` (queues + the future-ideas backlog) · `docs/audits/` (dated findings, e.g.
the 2026-07-05 open-models audit) · `docs/handbook/` (product brief, journeys, stories,
capabilities, patterns, this page) · `docs/screens/` (regenerable screenshot corpus:
`npm run screens:tour`).
