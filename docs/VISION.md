# GatesAI — Product Vision

> Captured verbatim-adjacent from Ethan, 2026-07-13 (post-audit review
> session). This is the steering document; docs/purpose.md and the roadmap
> should stay consistent with it.

## Identity & license (2026-07-14)

- **This repo (gatesai-chat) is THE GatesAI product** — the installable
  Tauri/Rust desktop app (with ollama + OpenRouter). The `gates-ai` repo is
  a **separate product**: a business website with a chatbot. Don't conflate.
- **License intent (Ethan's words): "I will be open source but if you take
  my code, so do you."** That is *copyleft* — Apache-2.0 does NOT do that
  (it's permissive). **RATIFIED 2026-07-16 (Ethan, audit review): the license
  is GPL-3.0.** Replace any AGPL-3.0/Apache references in docs/templates with
  GPL-3.0 and add the LICENSE file before first outside contribution.

## What it is

An **open-source desktop AI chat app** (Linux, Mac, Windows — all three
must work). Probably free; probably not a money-maker. Closer to
"Cowork-style" than plain chat: you give it access to its own folder and it
can act on your computer — files, terminal actions, its own code.

**"The Linux of chat interfaces."** Everything is customizable — including
by just *asking the app*: GatesAI can update itself (edit its own repo,
rebuild, produce an installer, hand it to you to install). Closing that
loop fully is a goal.

## Deliberately narrow provider policy

Scope was narrowed on purpose — build a great product around a specific
stack rather than integrate every API:

| Capability | Allowed providers |
|---|---|
| LLMs (API) | **OpenRouter only** — instant switching between any OpenRouter model, pay-as-you-go |
| LLMs (local) | **Ollama** — seamless toggle vs API, pay nothing |
| Images | **OpenRouter** or seamless **ComfyUI** integration (local) |
| Web | **Browser use is a huge part of the product.** Today: Brave Search API (free tier) |

Future *maybe*: a local server extension mechanism (e.g. download an
"OpenAI server" extension that bridges to a server on your machine). Not
now. No other API providers.

## Data principles

- All data on the user's machine, never in the cloud; the user knows where
  it's stored.
- The app has access to its own code and its own data, and *understands*
  both — self-knowledge is a feature that increases usefulness.

## Experience bar

- **Super performant.** UI/UX is the focus: the dream interface for
  "pick any model and instantly start chatting."
- Instant model switching; frictionless local↔API toggle.

## Plugins (future direction, not now)

- Downloadable datasets (pairs with the Offline Library).
- agent-orchestrator as a plugin once it's in a more mature state.
- Databases as plugins.
- **Method plugins** — discipline-not-knowledge scaffolds (plan/execute/judge loops) that make cheap OpenRouter/local models punch above their weight (cf. fable-method plugin results, 2026-07-14). On-brand: "pick any model, make the free ones good."

## Open items this vision implies (for roadmap triage)

- [ ] Audit current provider integrations against the OpenRouter+Ollama+ComfyUI policy; remove/park anything else.
- [ ] Self-update loop: define the safe path (edit own repo → rebuild → installer → user installs) and how far it can be closed.
- [ ] ComfyUI seamless integration (today requires `--enable-cors-header`).
- [ ] Browser-use deepening beyond Brave Search.
- [ ] Cross-platform release health: publish the macOS .dmg as a stable public asset (build is green as of v4.6.1; win+linux published).
