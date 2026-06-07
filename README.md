# GatesAI Chat

A local-first AI chat workspace for Windows (with a browser "Web Lite" mode), built as a
React 19 + TypeScript single-page app wrapped in a Tauri 2 desktop shell. It pairs a
provider-agnostic LLM client with a sandboxed local **bridge** process so the assistant can
read and write real files, run allowlisted shell commands, query data, and generate images —
all on your own machine.

It is designed to feel like a quiet, editorial writing room and developer console rather than a
SaaS dashboard: dark theme, serif chat prose, compact operational controls, and an ambient
activity timeline for everything the model does.

---

## Highlights

- **Bring-your-own-model chat** — OpenRouter cloud catalog (live `/api/v1/models` refresh,
  pricing, favorites) plus local **Ollama** models, behind one streaming `LlmProvider` contract.
- **Threaded conversations** with per-thread streaming, interrupt-and-resend, branching,
  regenerate-in-place, soft-delete with undo, sidebar search, and AI auto-naming.
- **Durable autosave** — every conversation is throttled-saved to `localStorage`, survives quota
  limits via emergency compaction, and (on desktop) mirrors to a readable
  `/workspace/chat-history` HTML/Markdown library.
- **Agent tooling** — a registry of browser-side tools: `memory`, `notes`, `thread`,
  `chat_history`, `web_search` (Brave), `fs`, `terminal`, `inspect_file`, `python_inline`,
  `sqlite_query`, `git`, `image_generate`, `describe_image`, and more. Adding a tool is one file
  plus one registry line.
- **Companion bridge** (`../gatesai-bridge`, Go) — owns a `~/GatesAI/workspace/` folder behind a
  path jail and command allowlist, exposed over a single loopback WebSocket.
- **Local image generation** — background image-job queue driving ComfyUI (FLUX.2 Klein / SDXL
  Lightning) with live progress, a Gallery, and a lightbox.
- **Memory** — durable user facts plus lazy cross-thread summaries composed into the system
  prompt (no embeddings/RAG — the prompt is the delivery mechanism).
- **Multimodal input** — drop images into the composer; vision-capable models receive the pixels.

## Screenshots

| Chat | Model picker |
| --- | --- |
| ![Chat home](docs/user-guide-assets/chat-home.png) | ![Model picker](docs/user-guide-assets/model-picker.png) |

| Gallery | Workspace |
| --- | --- |
| ![Image gallery](docs/user-guide-assets/gallery.png) | ![Workspace bridge](docs/user-guide-assets/workspace.png) |

| Agent memory | Provider catalog |
| --- | --- |
| ![Agent memory](docs/user-guide-assets/agent-memory.png) | ![OpenRouter models](docs/user-guide-assets/models-openrouter.png) |

## Architecture

GatesAI Chat follows a strict, one-way layered architecture enforced by ESLint import rules:

```
UI (components/, app/)
      ▼
Stores (MobX object models)
      ▼
Services (persistence, llm/, tools/, image/, bridge, router)
      ▼
Core (types, theme, models, providers, runtime, llm contract)
```

| Layer | Responsibility | May import |
| --- | --- | --- |
| `core/` | Pure data, types, runtime detection | nothing else |
| `services/` | Stateless I/O: APIs, persistence, integrations | `core/` |
| `stores/` | Observable state + business logic (MobX) | `core/`, `services/` |
| `components/ui/` | Feature-agnostic primitives | `core/` |
| `components/<feature>/` | Feature UI (observers) | `core/`, `stores/`, `components/ui/`, `components/media/` |
| `app/` | Composition root | everything |

Deeper design notes live in [`docs/architecture.md`](docs/architecture.md) and
[`docs/tech_spec.md`](docs/tech_spec.md). Per-session history is in
[`docs/changelog.md`](docs/changelog.md).

## Tech stack

React 19 · TypeScript 6 · Vite 8 · MobX 6 · Tauri 2 (Rust host) · Go bridge ·
react-markdown / KaTeX / Mermaid / highlight.js · Vitest + jsdom · ESLint 9.

## Getting started (development)

Requirements:

- Node.js / npm for the chat app
- Rust + Tauri prerequisites for desktop builds
- Either Go 1.24+ or a prebuilt bridge binary at `..\gatesai-bridge\bin\gatesai-bridge.exe`

```powershell
npm install        # install dependencies
npm run dev        # Vite dev server (Web Lite mode in the browser)
npm run tauri dev  # desktop app against the dev server
```

Run the bridge from source during development:

```powershell
cd ..\gatesai-bridge
go run ./cmd/gatesai-bridge
```

## Quality gates

```powershell
npm run typecheck  # tsc project build + test project typecheck
npm run lint       # ESLint (includes the architecture-boundary import rules)
npm run test       # Vitest suite (600+ tests)
npm run ci         # all three, in order
```

## Building the desktop app

```powershell
npm run tauri build   # produces the NSIS installer; bundles the Go bridge automatically
```

### Linux AppImage builds

Tauri sidecars must be named with the target triple
(`src-tauri/binaries/gatesai-bridge-x86_64-unknown-linux-gnu`). From a Linux host with the
companion bridge repo checked out next to this one:

```bash
npm ci
bash scripts/prepare-linux-sidecar.sh        # or: GATESAI_BRIDGE_BIN=/path/to/bridge bash scripts/prepare-linux-sidecar.sh
npx tauri build --bundles appimage
```

The GitHub Actions workflow builds a real Linux bridge when `GATESAI_BRIDGE_REPOSITORY` is
configured. For end-user Arch Linux steps, open `docs/arch-linux-appimage-install.html`.

## Repository layout

```
src/
  app/          composition root
  components/   ui/ (primitives) · editorial/ (chat) · menu/ (settings) · media/ (shared image UI)
  stores/       MobX stores (Chat, Provider, Bridge, ImageJob, ... )
  services/     llm/, tools/, image/, bridge, storage, router
  core/         types, models, providers, theme, runtime
tests/          Vitest suite (kept out of the app build)
docs/           architecture, tech spec, roadmap, changelog, plans, notes
```
