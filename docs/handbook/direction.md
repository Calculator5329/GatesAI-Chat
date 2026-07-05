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
   memory, sub-agents, schedules — all offline. The generic OpenAI-compatible endpoint slot
   exists so LM Studio / llama.cpp / vLLM users aren't turned away, but it stays deliberately
   minimal.
3. **Bring-your-own cloud, pay-as-you-go.** OpenRouter is the one cloud gateway. We will not
   chase per-vendor cloud integrations, and we will never insert ourselves into billing.
4. **All data local.** localStorage + IndexedDB + the workspace folder + OS keychain. Cloud
   sync, if it ever exists, is opt-in, E2E-encrypted, to storage the USER owns. (A Firestore
   backend was designed in early 2026 and deliberately parked for violating this.)
5. **Quiet power.** The editorial aesthetic — serif prose, dark charcoal + emerald, ambient
   activity timeline — is identity, not decoration. Power stays hidden until wanted; tool
   noise never dominates the conversation.

## The long game

- **Self-improvement as the differentiator.** The app ships with its own source; the
  assistant edits a controlled copy, the user reviews per-file diffs in-app, builds, and
  chooses whether to install the new exe. The loop closed in July 2026; deepening it (better
  diffs, test-run integration, one-click safe install) is the flagship long-term thread —
  a transparent workshop, never magic in the walls.
- **An agent platform, quietly.** Sub-agents, schedules, skills, MCP (HTTP + stdio), semantic
  memory, and web reading compose: "every morning, a background agent with my reviewer skill
  reads the new files and leaves me a summary" already works. The direction is composition —
  making these primitives multiply — not adding disconnected features.
- **Audience:** AI power users who want control without assembling infrastructure. Not
  beginners-with-training-wheels, not enterprise fleets. The product should feel like: *you
  know enough to want control; here it is, assembled.*

## How we decide (heuristics that have served well)

- **Simpler is better.** One generic mechanism (OpenAI-compat slot, one skills format, one
  availability-gating path) beats N special cases. If a feature needs a settings page to
  explain itself, reconsider the feature.
- **The code is the spec; docs follow reality.** When they disagree, fix the docs or fix the
  code — never let them drift silently.
- **Honest surfaces.** If something only works while the app is open (schedules), or needs a
  key (all OpenRouter routes), or is degraded (Web Lite), the UI says so plainly.
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
