# Roadmap

## Done
- [x] Clean up dead code, root HTML mockups, and unused assets
- [x] Convert codebase to TypeScript
- [x] Introduce MobX object model (ChatStore / UiStore / RootStore)
- [x] Split monolithic `chat-variant.jsx` and `gates-menu.jsx` into
      small, focused components
- [x] Document architecture, changelog, roadmap
- [x] **Phase 1**: extract `components/ui/` design-system primitives
- [x] **Phase 2**: `LlmProvider` interface + multi-provider router
      (OpenRouter, Anthropic, OpenAI, Gemini, Groq, Local OpenAI-compatible)
- [x] **Phase 3**: tiny hash router (`#/thread/<id>`, `#/menu/<section>`)
- [x] **Phase 4**: Vitest suite under top-level `tests/` + lint + typecheck CI
- [x] **Phase 5**: Live OpenRouter catalog (`ModelRegistry` + `OpenRouterStore`,
      registry-backed model picker with pricing, API panel refresh button)
- [x] Add minimalist Ctrl/Cmd-click copy gesture to chat messages
- [x] Local-only `git` tool for status, diff, add, commit, and branch work
- [x] Add hybrid markdown/code Appearance tweaker with persisted presets
- [x] Add `inspect_file` tool for compact CSV, JSON, and text inspection
- [x] Smooth active assistant streaming with batched text updates
- [x] Add Windows double-click launcher for chat + bridge
- [x] Inject artifact README files into every turn's system prompt context
- [x] Inject runtime time, timezone, and harness context into every turn
- [x] Make `inspect_file` encoding-tolerant and add artifact-first query workflows

## Near-term
- [ ] Persist UI preferences (theme keys) alongside chat snapshot
- [ ] Wire the API / Settings / Agent menu sections to real state
- [ ] Add basic unit tests around `ChatStore` (send, stream, switch, stop)

## Later
- [ ] Move appearance controls out of the floating Tweaks panel and into
      the Appearance menu section
- [ ] Multi-window / split-thread layouts
- [ ] File attachments
- [ ] Extend `inspect_file` to source-code structure (`py`, `js`, `ts`, `go`)
- [ ] Extend `inspect_file` to document formats (`pdf`, `docx`, `xlsx`)
