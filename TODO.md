# TODO

Long-running list of things we want to do but aren't doing right now.
Living doc — when something starts, move it into `docs/roadmap.md`.

---

## LLM providers

### v1 (this refactor)
- [x] OpenRouter (with live model catalog)
- [x] Anthropic (Claude)
- [x] OpenAI (GPT-4/5, o-series)
- [x] Google (Gemini)
- [x] Groq (fast Llama / Mixtral inference)
- [x] Local OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, llama.cpp server)

### Future providers
- [ ] Mistral (direct API)
- [ ] Cohere (Command R+)
- [ ] xAI (Grok)
- [ ] DeepSeek
- [ ] Perplexity (Sonar)
- [ ] Together AI
- [ ] Fireworks
- [ ] Replicate
- [ ] Hugging Face Inference API
- [ ] AWS Bedrock
- [ ] Azure OpenAI
- [ ] Google Vertex AI (enterprise Gemini)
- [ ] Cerebras (fast inference)
- [ ] SambaNova
- [ ] OpenRouter custom routes / fallbacks per model

### Provider features
- [x] Per-provider streaming via Server-Sent Events
- [x] Tool / function calling (unified shape across providers)
- [ ] Vision input (image attachments)
- [ ] Audio input (Whisper-style transcription)
- [ ] Audio output (TTS)
- [ ] Embeddings (for memory / RAG)
- [ ] Structured output (JSON mode)
- [x] Per-model context-window awareness (shown for OpenRouter live entries; need to wire counting + display per provider for the curated set too)
- [x] Token counting / context-window estimation per request
- [ ] Live catalog refresh for the direct providers (Anthropic / OpenAI / Gemini / Groq) — today only OpenRouter has a fetcher
- [ ] Cost tracking per request (real numbers, not the mocked Usage panel)
- [ ] Provider health checks + automatic fallback
- [ ] Rate-limit handling with backoff

---

## Backend / persistence

> **Heads-up (apr 2026):** considering moving from localStorage to a real
> backend. Capturing the shape here so future decisions stay consistent.

- [ ] **Firestore** for thread + message storage (multi-device sync)
  - Collection design: `users/{uid}/threads/{threadId}/messages/{messageId}`
  - Real-time listeners on the active thread, paginated load for sidebar
  - Offline persistence via Firestore SDK
  - Migration: read existing `gatesai.state.v1` snapshot once, write to Firestore, then drop localStorage
- [ ] **Google Cloud Storage** for attachments (images, audio, files)
  - Signed-URL upload flow
  - Reference URLs stored on the message, blobs in GCS
- [ ] Firebase Auth (email + Google sign-in) — prerequisite for the above
- [ ] Security rules: users can only read/write their own threads
- [ ] Export / import (.zip of JSON + attachments) — same format works for
      localStorage and Firestore

---

## Architecture

- [x] Promote `services/persistence.ts` to a `PersistenceProvider` interface
      so we can swap localStorage ↔ Firestore without touching `ChatStore`
- [ ] Per-thread `MessageStore` once histories get big (>500 messages)
- [ ] IndexedDB fallback for very large local-only setups
- [ ] Web Worker for token counting / markdown rendering of huge messages
- [ ] Code-splitting: lazy-load `GatesMenu` and `react-markdown` plugins

---

## UI / UX

- [ ] Move appearance controls (accent, bg, header) out of the floating
      Tweaks panel and into the Appearance menu section
- [ ] Real keyboard shortcuts (⌘K palette, ⌘N new thread, ⌘, menu, ⌘L composer)
- [ ] Thread search / filter in the sidebar
- [ ] Rename + delete threads (right-click or hover affordance)
- [ ] Pin / unpin threads (data is there, UI isn't)
- [ ] Drag-to-reorder pinned threads
- [ ] Message actions: copy, regenerate, edit-and-resend, branch
- [ ] Code block: copy button, language label, line numbers toggle
- [x] File attachments in the composer (paperclip + drag-drop into `/workspace/attachments/`)
- [ ] Inline attachment previews (image thumbnails, PDF first-page peek)
- [ ] Per-thread rename UX in the sidebar (right-click → rename; today only the auto-namer + `thread` tool can rename)
- [ ] Persistent `Thread.naming` flag (so closing the tab mid-name doesn't strand a thread on the fallback "first 40 chars" title forever)
- [ ] Voice input (Web Speech API)
- [ ] Multi-window / split-thread layouts
- [ ] Mobile / responsive layout pass

---

## Bridge / workspace

- [x] Companion bridge process in Go (`../gatesai-bridge/`)
- [x] `fs.*` ops with path jail to `~/GatesAI/workspace/`
- [x] `exec.run` with allowlist + streaming + `exec.kill`
- [x] Workspace settings panel under `#/menu/workspace`
- [x] Bridge status pill in the sidebar
- [x] Live exec tail beneath running `terminal` calls
- [ ] Auto-launch bridge from chat (today: must be started manually)
- [ ] Bridge installer / one-click "Install GatesAI bridge" download
- [ ] Bridge GUI tray-icon companion (start/stop, edit allowlist, open workspace)
- [ ] Workspace settings: open-in-OS-file-explorer button, drag-drop into the panel
- [ ] Per-job timeouts surfaced in `terminal` UI (today: silent until the bridge kills it)
- [ ] `exec.run` stdin streaming (today: stdin is one-shot)
- [ ] Auth header for non-loopback deployments (when we eventually want bridge on a remote host)
- [ ] `fs.search` regex mode (today: substring only)
- [ ] Diff-aware `fs.write` (e.g. `apply_patch`) so big files don't round-trip

## Auto-naming

- [x] Cascade across cheap models with thread-model fallback
- [x] Sidebar typewriter animation
- [ ] Allow the user to disable auto-naming (Settings toggle)
- [ ] Re-name a thread on demand (right-click → "Re-name with AI")

## Quality

- [x] Vitest suite under `tests/` (Phase 4 of current refactor)
- [x] ESLint + TypeScript CI scripts
- [ ] Playwright smoke test (send a message, switch threads, open menu)
- [ ] GitHub Actions CI: typecheck + lint + test on PR
- [ ] Bundle-size budget + report in CI

---

## Wired-up menu sections

The menu currently shows good-looking placeholder UI. Make these real:
- [ ] **Profile** — actual user identity (post-auth)
- [ ] **Agent** — system prompt, default model, temperature persisted
- [ ] **Settings** — language, timezone, retention all wired
- [ ] **Usage** — real cost numbers from provider responses
- [x] **API** — connect / rotate / remove keys; OpenRouter card shows live catalog refresh + count + last-refreshed timestamp
- [ ] **Appearance** — see UI/UX section above
