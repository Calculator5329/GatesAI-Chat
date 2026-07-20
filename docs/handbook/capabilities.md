# Capabilities

This page describes what the assistant can do in the current app and what each
capability needs to be available.

## What Works In Web Lite

Web Lite runs in the browser without the desktop bridge or Tauri commands.

- Chat with configured cloud models through OpenRouter.
- Remember profile facts with `memory`.
- Manage conversation metadata with `thread`.
- Search and read bounded conversation history with `chat_history`.
- Read app logs from the in-memory log ring with `logs`.
- Work with notes through `notes`.
- Start background agent tasks with `spawn_task` when a connected model is
  available.
- Use Brave web search with `web_search` after a Brave API key is configured.
- View usage totals derived from saved message usage.

Browser storage is local to that browser profile. API keys are stored in browser
localStorage in Web Lite.

## What Requires Desktop

Desktop features need the installed Tauri app. Many also need the local bridge
to be online.

- Read, write, list, move, copy, delete, and search workspace files with `fs`.
- Create HTML or file artifacts with `artifact`.
- Inspect structured files with `inspect_file`.
- Run allowlisted terminal commands with `terminal`.
- Run inline Python with `python_inline`.
- Query SQLite files with `sqlite_query`.
- Run git commands with `git`.
- Use `workspace` helpers for workspace status and paths.
- Attach and read local files through the workspace attachment flow.
- Generate images with local ComfyUI.
- Describe uploaded/workspace images with `describe_image`.
- Fetch a web page through the desktop `fetch_page` proxy.
- Use semantic recall over retained conversations, notes, and facts after a
  local Ollama embedding model has built a complete index.
- Store provider/search/Ollama secrets in the OS keychain.
- Mirror chat state into `/workspace/.gatesai/chat/` and readable
  `/workspace/chat-history/`.

The bridge must be online for workspace files, shell commands, artifacts,
attachments, local image output writes, and most desktop tool calls.

## Local Runtime Requirements

- Ollama chat needs the Ollama runtime reachable and at least one pulled model.
  GatesAI can manage the process on desktop when an install path is configured.
- Ollama tool calling can be toggled in local model settings.
- Ollama model pulls/deletes require the Ollama runtime to be online.
- RAG/semantic recall needs Ollama online with an embeddings model available.
  Agent → Memory shows local status, source controls, preview, and rebuild
  actions. Recalled answers expose the exact sources supplied to the model.
- Local image generation needs ComfyUI configured and healthy.
- OpenRouter image generation needs an OpenRouter key with image access and the
  bridge online so finished images can be written to workspace artifacts.

## Toolbelt

Static tools currently registered by the app:

- `memory`: add, update, remove, and list durable profile facts.
- `recall`: search semantic memory from indexed chats, notes, and facts.
- `time`: answer current date/time questions.
- `logs`: read recent app diagnostics.
- `notes`: create, update, delete, list, and search notes.
- `thread`: rename/select threads and set thread context.
- `chat_history`: bounded recent/search/read access to conversation history.
- `workspace`: report workspace/bridge status.
- `fs`: read and write files inside the bridge workspace.
- `inspect_file`: inspect files and artifact folders with safer summaries.
- `artifact`: create user-facing workspace artifacts, especially HTML.
- `terminal`: run allowlisted workspace commands.
- `python_inline`: run short Python snippets in the workspace.
- `sqlite_query`: query SQLite databases through Python.
- `query_script`: generate and run reusable query scripts.
- `git`: run scoped git operations in the workspace.
- `image_generate`: queue image generation jobs.
- `describe_image`: describe image files or attachments.
- `web_search`: search the web through Brave's LLM context endpoint.
- `fetch_page`: fetch and extract a specific web page.
- `spawn_task`: start a separate background agent thread.

## Honest Gates

- No bridge means no workspace filesystem, shell, artifacts, attachments, or
  local image file writes.
- No provider key or local model means chat cannot send.
- No Brave key means `web_search` is hidden.
- No ComfyUI or OpenRouter image credential means `image_generate` is hidden.
- No active RAG index means `recall` is hidden.
- Web Lite keeps always-supplied saved facts but does not expose semantic-index
  controls that require desktop Ollama.
- No desktop app means Tauri local-runtime commands are unavailable.
