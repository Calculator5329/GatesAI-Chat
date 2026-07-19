# Qwen local Ollama failure repro — 2026-07-19

## Failure observed
Qwen local sessions (`qwen2.5:7b`, `qwen2.5-coder:14b`) were failing when the request body looked like a normal generic Ollama chat payload.

### Repro request (current codepath before this change)
- `POST /api/chat`
- `model`: `qwen2.5:7b`
- `stream`: `true`
- `messages`: `[{ "role": "user", "content": "hello" }]`
- `tools`: forwarded tool list (non-empty)
- `options`: not present (no `num_ctx`, no Qwen stop token)

A matching variant with `model: "qwen2.5-coder:14b"` and the same payload shape reproduced the same failure pattern.

## Root-cause hypothesis
- Qwen chat models in Ollama require the same local-profile shaping as other chat-template-sensitive models:
  - explicit `num_ctx`
  - Qwen stop token alignment
  - avoid forwarding tool schema by default for stable chat sessions

## Fix applied
- Added a Qwen model format profile in `src/services/llm/modelFormatProfiles.ts`:
  - `id`: `qwen-ollama-chat`
  - `match`: Qwen2.5/coder local tags
  - `ollama.numCtx`: `32768`
  - `ollama.stop`: `["<|im_end|>"]`
  - `ollama.disableTools`: `true`
- Wired that profile in `src/services/llm/ollama.ts`:
  - resolves by `modelId`
  - adds profile `options` to `/api/chat`
  - suppresses `tools` for matching Qwen local models

## Evidence in code/tests
- Added unit coverage in `tests/services/llm/ollama.test.ts` for the Qwen request shape.
- Added regression assertion in `tests/services/openRouterCompatibility.test.ts` that `resolveModelFormatProfile('qwen2.5:7b')` returns `qwen-ollama-chat`.
