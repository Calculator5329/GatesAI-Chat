# Foundation Trim Notes

## Current foundation

The app is intentionally trimmed to a small manual-test surface:

- OpenRouter for cloud chat.
- Ollama for local chat.
- ComfyUI for local image generation and direct-image model choices.
- Memory, notes, thread management, summaries, custom system prompt.
- Bridge workspace tools: workspace, fs, inspect_file, terminal, python_inline,
  sqlite_query, query_script, and git.

## Removed for now

- Direct Anthropic, OpenAI, Gemini, Groq, and local OpenAI-compatible chat
  provider surfaces.
- Cloud image-generation clients and API settings.
- AUTOMATIC1111 image generation.
- Prompt-enhancement settings that were not wired into the image runner.
- Routing/spend-cap placeholders and non-persisted Agent model/tone controls.
- The unfinished HTML artifact tool path and dead theme/header/send variants.

These can be rebuilt later after the foundation passes manual testing.
