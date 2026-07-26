# Contributing to GatesAI Chat

Thanks for helping improve GatesAI Chat. This guide covers the three development layers,
the checks enforced by CI, and the architectural rules that keep the desktop and Web Lite
builds maintainable.

## Prerequisites

- Git
- Node.js 22 and npm (matching the main CI workflow)
- Rust stable with Cargo, plus the [Tauri 2 platform prerequisites](https://v2.tauri.app/start/prerequisites/)
  for your operating system
- Go 1.24 or newer when running or building the companion bridge from source
- Chromium for the Playwright suite (`npx playwright install chromium`; on Linux CI-like
  environments, use `npx playwright install --with-deps chromium`)

The Go bridge is a separate sibling repository. Clone it beside this repository so the
directories are `GatesAI-Chat/` and `gatesai-bridge/` under the same parent. Do not put API
keys or other secrets in either checkout, test fixtures, logs, documentation, or commits.

## Set up the Node app

From the GatesAI Chat repository root:

```bash
npm ci
npm run ci
```

`npm ci` installs exactly the versions in `package-lock.json`. `npm run ci` runs the unit and
component tests, TypeScript checks, and ESLint. For browser development, run:

```bash
npm run dev
```

That serves Web Lite, which intentionally disables bridge- and Tauri-backed capabilities.

## Set up the Rust desktop layer

Install the Tauri prerequisites linked above, then verify the Rust command layer from the
chat repository root:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

To launch the desktop shell, first make the bridge available as described below, then run:

```bash
npm run tauri:dev
```

Create an installer with `npm run tauri:build`. The build expects a bridge sidecar with the
Tauri target-triple filename under `src-tauri/binaries/`; the release workflows show the
canonical Windows and Linux build paths.

## Set up the Go bridge

From the sibling `gatesai-bridge` checkout:

```bash
go test ./...
go run ./cmd/gatesai-bridge
```

Keep the bridge running in a separate terminal while using `npm run tauri:dev`. To build a
sidecar directly, use the same package entry point as the release workflow:

```bash
go build -trimpath -ldflags "-s -w" -o /path/to/sidecar ./cmd/gatesai-bridge
```

On Linux, `bash scripts/prepare-linux-sidecar.sh` in the chat repository builds from
`../gatesai-bridge` and writes
`src-tauri/binaries/gatesai-bridge-x86_64-unknown-linux-gnu`. You may instead set
`GATESAI_BRIDGE_BIN` to an existing Linux bridge binary. Bridge changes belong in the bridge
repository and should be proposed separately from chat-app changes.

## Quality gates

Run the same checks as `.github/workflows/ci.yml` before opening a pull request:

```bash
npm run ci
npm run test:e2e
cargo test --manifest-path src-tauri/Cargo.toml
```

The commands expand to these gates:

| Command | What it checks |
| --- | --- |
| `npm test` | Vitest unit, service, store, and component tests |
| `npm run typecheck` | Application and test TypeScript projects |
| `npm run lint` | ESLint rules, including architecture boundaries |
| `npm run ci` | `npm test`, typecheck, and lint in sequence |
| `npm run test:e2e` | Playwright's `desktop-mocked` and `web-lite` projects |
| `cargo test --manifest-path src-tauri/Cargo.toml` | Rust command-layer tests |

Install Playwright's Chromium browser before the first e2e run. `npm run test:models` is a
live OpenRouter compatibility suite: it requires an API key and can cost money, so it is not
a routine quality gate.

Add or update tests at the layer affected by your change. Consider both desktop and Web Lite;
desktop-only behavior must be gated cleanly, and Web Lite must degrade explicitly instead of
half-working.

### Green is not the same as covered

Three separate defects shipped past a fully green suite on 2026-07-26, all with the same
shape: a check existed, passed, and could not have failed. Before trusting a gate, confirm
it can fail.

- **Watch a regression test fail before you keep it.** Revert the fix, run the test, see red,
  restore. A test you have never seen fail is a guess about what it covers. The
  `setTheme` binding fix was verified this way; the first version of another test in the same
  session re-implemented the logic it was meant to check inside the spec, so it would have
  passed with the component completely broken.
- **A generic fallback can satisfy an "everything is covered" assertion.** A test asserted
  that every registered tool had an activity label. It passed while three tools rendered
  their raw registry names, because `registry.register` falls back to `defaultToolUi`, whose
  generic branch supplies a label too. Assert the *quality* of the value, not its presence.
- **Check which Playwright project actually runs your spec.** A test named "... and are absent
  on Web Lite" lived in a file that `playwright.config.ts` only runs under `desktop-mocked`,
  so the Web Lite half was never executed. A test title is a claim; make sure something runs it.
- **Adding a prop is not wiring it.** A component gained a `variant` prop and no call site
  passed it; typecheck, lint and the full suite stayed green while the old behavior shipped.
  Exercise the change through the running app, not only through the compiler.

## Architecture rules

The canonical reference is [`docs/architecture.md`](docs/architecture.md). Dependencies flow
one way: UI → stores → services → core. ESLint enforces these boundaries.

| Layer | May import from | Rules |
| --- | --- | --- |
| `core/` | Nothing else | Pure types and calculations; no React, MobX, network, or Tauri code. |
| `services/` | `core/`, other services | Put I/O and integrations here; accept narrow dependencies instead of importing stores or UI. |
| `stores/` | `core/`, `services/` | MobX state and orchestration; no React/UI imports, raw `fetch()`, or direct browser storage. |
| `components/ui/` | `core/` | Stateless, feature-agnostic primitives. |
| `components/media/` | `core/`, `stores/`, `components/ui/` | Shared media UI used by multiple features. |
| `components/<feature>/` | `core/`, `stores/`, `components/ui/`, `components/media/` | Use store hooks; do not import services or sibling feature folders. |
| `app/` | All layers | Composition root and top-level wiring. |
| `tests/` | Any `src/` layer | Keep tests outside application build inputs. |

Use `src/stores/context.tsx` hooks for React-to-store wiring. Route diagnostics through
`src/services/diagnostics/logger.ts`, persistence through storage services, and store network
calls through services. Do not weaken the ESLint rules to make an import pass.

When adding common extension points:

- Tool: add one module under `src/services/tools/`, register it in
  `src/services/tools/registry.ts`, declare read-only/side-effect metadata accurately, and add
  service/tool tests.
- Store: add a MobX object model under `src/stores/`, construct and wire it in `RootStore`, and
  expose UI access through a hook in `src/stores/context.tsx`. Prefer narrow provider/facade
  injection so the store graph remains acyclic.
- Component: reuse `components/ui/` primitives, keep feature UI in its feature directory, use
  `observer()` when reading observable state, and move genuinely cross-feature media UI to
  `components/media/`.

Persistence schema changes require a migration and tests. Security-sensitive changes to path
jailing, command allowlists, SSRF protection, MCP stdio validation, or secret handling require
an explicit architecture decision record under `docs/`.

## Pull request expectations

Keep each pull request focused and explain both what changed and why. Include:

- tests added or updated, plus the exact verification commands and results;
- desktop and Web Lite behavior, including any deliberate runtime gating;
- documentation updates for changed user-facing claims or architecture;
- migration notes for persistent data changes;
- screenshots or a short recording for visible UI changes;
- linked issues or roadmap items when applicable.

Do not include generated logs, scratch files, secrets, unrelated refactors, or dependency changes
without a clear reason. Preserve stable release asset names. Update both `package.json` and
`src-tauri/tauri.conf.json` for a version bump.

## License

The project is licensed under [AGPL-3.0-only](LICENSE). By submitting a contribution, you agree
that it may be distributed under the same license and that you have the right to contribute it.
