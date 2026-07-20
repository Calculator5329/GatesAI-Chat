# Model compatibility auto-runner — 2026-07-19

## Outcome

The free live-catalog audit passed on 2026-07-20 at 04:09 UTC. It selected 72
active OpenRouter chat routes:

| Policy group | Routes |
| --- | ---: |
| Every Claude released since Sonnet 4 | 14 |
| Every Gemini 2.x or newer chat route | 11 |
| Every OpenAI GPT-5 family chat route | 29 |
| Three newest Meta, Grok, Kimi K2, GLM, Nemotron, and DeepSeek routes | 18 |

The preflight estimate for a full live run was $1.0366 using the runner's
320-input/160-output-token allowance per request, below the default $2 run
budget. No paid probes were made because this environment had no
`OPENROUTER_API_KEY`.

## What is automated

- `.github/workflows/model-compat.yml` runs the free catalog audit daily.
- A weekly or manual live job exercises GatesAI's production OpenRouter
  streaming adapter with text, supported low reasoning, strict tool-call, and
  tool-result continuation probes.
- The live job fails closed if its secret is absent, estimates the whole run
  before spending, stops starting new models after reported spend reaches its
  budget, runs serially, and uploads JSON + Markdown evidence.
- Manual live runs can use `--family <policy-id>` to isolate a regression.
- Image, guard, moderation, embedding, rerank, expired, alias, and duplicate
  free routes are excluded because they are not distinct chat surfaces.

## Cursor boundary

Cursor's in-house Composer models are not OpenRouter-addressable chat model
IDs. The runner reports that boundary rather than recording a false pass.
Adding direct Cursor support would introduce a fourth product route and
contradict the current OpenRouter/Ollama/ComfyUI routing floor.

## Verification

- `npm run model-compat:catalog` — pass, 72 routes.
- `env -u NODE_ENV npm run ci` — pass, 159 files and 1,165 tests plus
  typecheck and lint.
- `git diff --check` — pass.

The catalog policy follows OpenRouter's documented public Models API and its
`supported_parameters` capability metadata:

- <https://openrouter.ai/docs/guides/overview/models>
- <https://openrouter.ai/docs/guides/features/tool-calling>
- <https://openrouter.ai/docs/cookbook/coding-agents/cursor-integration>
