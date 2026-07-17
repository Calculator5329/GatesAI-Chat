# CLAUDE.md — GatesAI Chat

Local-first desktop AI workspace: React 19 + TypeScript + MobX + Vite in a
Tauri 2 (Rust) shell, with a companion Go bridge sidecar from the sibling repo
`../gatesai-bridge`. A browser-only "Web Lite" build ships to GitHub Pages.
Current version 4.6.1 (published 2026-07-14); branch `master`; releases publish to the separate
public repo `Calculator5329/GatesAI-Chat-releases`. The primary development
checkout is `~/projects/ai/gatesai-chat` on CachyOS Linux.

## Read first

1. `AGENTS.md` — pointer to the workspace-wide instructions that bind Codex.
2. `docs/architecture.md` — layers, store graph, turn pipeline, security
   model, commands, known limitations. The canonical technical reference.
3. `docs/handbook/README.md` — plain-English front door (direction, product
   brief, capabilities, patterns). Read `direction.md` before proposing big
   changes.
4. `docs/roadmap.md` — Now/Next/Later handoff plan at the top; history below.
5. `docs/IDEAS.md` — ranked expansion options.
6. `docs/changelog.md` — append a session entry when you ship something.

## Verify before any commit

All of these must pass locally. CI (`.github/workflows/ci.yml`) enforces the
first three on every push/PR; don't push red.

```sh
npm run ci          # = npm test (995 vitest) + npm run typecheck + npm run lint
npm run test:e2e    # Playwright, 20 tests (desktop-mocked + web-lite projects)
cargo test --manifest-path src-tauri/Cargo.toml   # required if you touched src-tauri/
```

Notes:
- `npm run test:models` is a LIVE OpenRouter suite — needs a key, costs money,
  never run it as a routine gate.
- Dev servers: `npm run dev` (Web Lite in browser), `npm run tauri:dev`
  (desktop; from `../gatesai-bridge`, run `go run ./cmd/gatesai-bridge` or
  use its prebuilt `bin/gatesai-bridge` binary). Windows builds used by the
  Jordy worker and user installs still use the prebuilt
  `bin/gatesai-bridge.exe` artifact.
- Desktop build: `npm run tauri:build`. Release = push tag `v*` (see
  "Commands quick reference" in `docs/architecture.md` for the full flow).

## Hard rules

- **Respect the layer boundaries** (UI → stores → services → core). ESLint
  enforces them — never weaken `eslint.config.js` to make an import work.
  New React↔store wiring goes through `stores/context.tsx` hooks.
- **No raw `console.*`** — use `src/services/diagnostics/logger.ts`. No raw
  `fetch()` in stores; no direct `localStorage` in stores/components (use the
  storage services / persistence slots).
- **Never commit secrets.** API keys live in the OS keychain
  (`secretStorage.ts`) at runtime and belong nowhere in code, docs, tests,
  fixtures, or commit messages. `.env` is untracked — keep it that way.
- **Don't touch sibling repos** (`../gatesai-bridge`, `../gates-ai*`,
  `../agent-v2`, ...) from a session scoped to this repo. Bridge-side changes
  are separate tasks in their own repo.
- **Protected workspace paths**: `.gatesai/chat/` and `chat-history/` are
  app-managed; generic tools must keep being blocked from them
  (`src/services/tools/protectedWorkspacePaths.ts` + its tests).
- **Don't degrade the security model** (path jail, exec allowlist, SSRF guards
  in `src-tauri/src/fetch_page.rs`, MCP stdio validation, secrets handling)
  without an explicit ADR in `docs/`.
- **Persistence schema changes** require a migration in
  `src/services/persistence/migrations.ts` + tests; bump `schemaVersion`.
- New tools: one file under `src/services/tools/` + one registry line + tests;
  set the read-only/side-effect metadata honestly (the batch executor relies
  on it).
- Adding a dependency is a decision, not a default — the dependency list is
  deliberately short.
- Version bumps touch **both** `package.json` and `src-tauri/tauri.conf.json`.
- Release asset names are stable and deep-linked from README/app — never
  rename them.

## Definition of done

A change is done when:

1. `npm run ci` and `npm run test:e2e` are green (plus `cargo test` if Rust
   changed); new behavior has tests at the right layer (see "Testing" in
   `docs/architecture.md`).
2. Both runtimes were considered: desktop **and** Web Lite (feature gating via
   `core/runtime.ts` — Web Lite degrades gracefully, never half-works).
3. Docs are true: `docs/architecture.md` for structural changes, `README.md`
   if user-facing claims changed, `docs/changelog.md` entry appended,
   roadmap checkbox updated if you completed a planned item.
4. No stray files (logs, scratch output) in the commit; no secrets anywhere.
5. Commit message says what and why; the working tree you leave behind is
   clean or its state is explicitly reported.
