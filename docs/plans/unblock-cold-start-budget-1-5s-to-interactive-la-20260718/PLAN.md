# Cold-start budget (<1.5s to interactive)

**Roadmap item:** `Cold-start budget (<1.5s to interactive): lazy menu sections, idle-time catalog hydration, audit source-snapshot resource cost in installer`

**Decision:** APPROVED (Ethan, authoritative decision supplied with task)

**Plan baseline:** `66b56b77ce782ebfe665a15542b8bb8edfc618ed`, audited 2026-07-18

## Outcome

Ship a measured desktop cold start whose p95 time from process entry to a
painted, enabled primary interaction is below 1.5 seconds. Work that does not
make the first chat or deep-linked menu surface usable must not compete with
that path. Preserve the existing route-level menu splitting, repair the
adjacent dock import that currently makes the markdown stack eager, move
automatic live model-catalog refreshes behind the interactive milestone, and
put a durable size gate around the bundled source snapshot.

This is a performance change, not a visual redesign. No mockups are needed.

## Definition of “interactive”

The timing endpoint is the first animation frame after React has committed the
requested primary surface:

- a normal/thread route has the composer input and model/send controls enabled;
- a menu deep link has the requested section mounted, not merely the tab strip
  with a `Suspense` fallback; and
- pointer and keyboard handlers are attached.

Desktop timing starts at the first line of Tauri `run()`, before the WebKit
workaround and builder setup. Web timing starts at Navigation Timing
`navigationStart`. Bridge health, update checks, Offline Library discovery,
live provider catalogs, RAG indexing, and other background readiness are not
part of “interactive” and may complete afterward.

Acceptance is p95 **< 1,500 ms** across ten release-mode, process-cold launches
on the Linux reference machine, with no GatesAI process left running between
launches. Record the fresh-profile first launch separately. CI must enforce the
deterministic bundle/behavior budgets; it must not use a flaky wall-clock
assertion on shared runners. The durable acceptance record contains the ten
raw samples, p50, p95, maximum, build commit, binary/artifact, OS, CPU, storage,
and whether the profile was fresh or returning.

## Evidence from the current tree

### Frontend bundle

A production Vite build with a manifest was written outside the worktree and
its static import closure was traversed from `src/main.tsx`.

| Measure | Current baseline |
| --- | ---: |
| Eager JavaScript | 1,587,998 bytes |
| Eager JavaScript, gzip | 476,879 bytes |
| Main entry only | 914,164 bytes |
| Main entry only, gzip | 273,491 bytes |
| Eager markdown chunk | 597,255 bytes |
| Eager markdown chunk, gzip | 180,104 bytes |

The roadmap wording is older than the code: `App.tsx` already lazy-loads the
menu shell, and `menuSectionMeta.ts` already lazy-loads all seven routed menu
sections (`Settings`, `Usage`, `Agent`, `Models`, `Local`, `Workspace`, and
`Gallery`). The generated manifest confirms each section is a dynamic import.
Do not reimplement this.

The split is partly defeated elsewhere. `App.tsx` eagerly imports `DockPanel`;
`panelRegistry.tsx` eagerly imports every dock panel; `FileViewerPanel.tsx`
statically imports `MarkdownChunk.tsx`. Vite reports the editorial markdown
dynamic import as ineffective, placing the entire 180,104-byte gzip markdown
stack in the eager closure even when the dock is closed. Lazying registry panel
components should bring the current closure to roughly 297 KB gzip before any
other incidental savings.

### Boot work

`RootStore.boot()` renders without awaiting network work, but immediately
arms autoruns that call `OpenRouterStore.refresh()` after key hydration and
`OllamaStore.refresh()` when the local runtime becomes online. These fetch and
catalog-normalization tasks can overlap the first React commit. Manual refresh,
pull/delete follow-up refresh, and persisted catalog restoration are separate
semantics and must remain immediate.

Persisted catalog restoration stays synchronous in this item. It is needed to
resolve saved thread model ids and the local-first default without a transient
wrong model. The performance move applies to **automatic live refresh/hydration
at boot**, after cached state has made the app coherent. If measurements later
show local JSON parsing itself is material, splitting the Ollama config/catalog
storage is a separate persistence migration rather than a hidden behavior
change here.

### Bundled source snapshot

Running the real snapshot generator into a cache-only output produced:

| Measure | Current baseline |
| --- | ---: |
| Files | 824 |
| Raw payload | 19,103,989 bytes |
| gzip-tar proxy | 14,217,897 bytes |
| `docs/` | 8,838,458 bytes |
| `src-tauri/` | 4,539,465 bytes |
| `src/` | 2,192,489 bytes |
| `assets/` | 1,327,364 bytes |
| `tests/` | 1,213,157 bytes |

Raster images account for 11,525,443 bytes. Specifically, documentation
screenshots/mockups account for 7,342,173 bytes and Tauri icon variants not
named by the desktop bundle configuration account for 2,326,079 bytes. The two
largest plan mockups alone are 3,256,330 bytes. Removing only those two safe
classes yields an estimated 9,435,737-byte raw snapshot while retaining all
code, tests, lockfiles, text documentation, the desktop icons named in
`tauri.conf.json`, public runtime assets, and `assets/icon-source.png`.

The gzip-tar figure is diagnostic only; NSIS and AppImage use different
packing. Actual installer/AppImage sizes before and after must be recorded in
the acceptance evidence.

## Design

### 1. Make the milestone observable

Add a tiny startup coordinator under `src/services/startup/` and an idempotent
`RootStore.markInteractive()` action.

- A small `InteractiveSignal` component runs only after the primary route has
  committed. It waits one `requestAnimationFrame`, marks
  `gatesai:interactive`, and calls `RootStore.markInteractive()` once.
- For chat, mount the signal beside the committed `EditorialChat`.
- For menu routes, place it inside the same inner `Suspense` boundary as the
  active section, after `ActiveSection`, so a blank fallback cannot be counted.
- StrictMode double effects and route changes must not double-report startup.
- In Web Lite, store the Navigation Timing delta for browser/E2E diagnostics.
- In desktop mode, invoke a narrow Tauri command backed by an `Instant` created
  at the start of `run()`. The command returns/logs elapsed milliseconds in a
  machine-parseable form. It does not block rendering and failures are ignored
  after diagnostic logging.

Add `scripts/measure-cold-start.mjs` to launch an explicit release binary,
parse the one startup marker, close that launched process, and emit JSON with
all samples and aggregates. It must require an explicit binary path, default
to ten runs, refuse debug builds unless explicitly allowed, time out cleanly,
and never discover/kill unrelated processes.

### 2. Enforce lazy inactive surfaces

Keep the existing `App -> GatesMenu -> active section` lazy boundaries. Change
the dock panel registry so each registered panel component is a `React.lazy`
import and wrap the selected panel body in a local `Suspense` fallback. Panel
metadata (kind, title, icon, bridge requirement) remains synchronous, so dock
headers and persisted layout do not change.

Add `scripts/check-startup-bundle.mjs` and a package script that produces a
Vite manifest, traverses only static imports from the entry, and fails unless:

- all seven menu section source modules remain outside the eager closure and
  are dynamic entries;
- every dock panel implementation remains outside the eager closure;
- the markdown manual chunk remains outside the eager closure; and
- total eager JavaScript is at most **310 KiB gzip**.

The 310 KiB gate is derived from the current closure minus the accidental
markdown import, with a small allowance for the startup signal. Keep the gate
on the whole eager closure, not a hash-named main file.

### 3. Start automatic catalog work only after interactivity

Add an injected, cancellable idle scheduler with this policy:

- use `requestIdleCallback` when WebKit exposes it;
- use a timer fallback after the interactive paint when it does not;
- use a bounded timeout so refresh eventually happens on a continuously busy
  page; and
- return a cancel function for teardown and changing prerequisites.

`RootStore.boot()` may establish reactions immediately, but automatic
OpenRouter/Ollama `refresh()` calls may only be scheduled when
`markInteractive()` has fired. Preserve the current key/runtime/count/inflight
guards. A key or endpoint change cancels stale scheduled work and rearms one
task for the new identity. `dispose()` cancels every pending task. The manual
refresh buttons, Ollama pull/delete completion, and explicit API calls bypass
the idle scheduler.

Do not defer secret hydration, cached catalog restoration, local runtime
detection, or saved-thread model reconciliation in this slice.

### 4. Put the source resource on a budget

Extend the source-snapshot collector with explicit, tested exclusions for:

- raster documentation media below `docs/` (`png`, `jpg`, `jpeg`, `gif`, and
  `webp`); and
- Tauri icon variants not named by the desktop `bundle.icon` list (mobile
  Android/iOS trees, Store/Square variants, and other generated sizes).

Retain text/HTML/SVG documentation, all source and tests, package/Cargo
lockfiles, runtime `public/` assets, all five desktop icons named in
`tauri.conf.json`, and `assets/icon-source.png`. This preserves a buildable,
editable source workspace while removing review evidence and unused platform
outputs from every installer.

Add a read-only audit command that uses the same collector as the generator
and reports total files/bytes, bytes by root and extension, and largest files.
It fails above **10 MiB raw**. The collector, generator, and audit must share
one policy so the report cannot drift from the shipped resource.

Then create a fresh snapshot and verify:

1. manifest `fileCount`, `totalBytes`, and hash match the generated tree;
2. required desktop icons and build inputs exist;
3. excluded documentation raster and unused icon paths do not exist;
4. a cache-only copy of the snapshot can install from the lockfile and run the
   frontend build (plus Rust tests where the platform toolchain permits); and
5. before/after NSIS and AppImage sizes are recorded, without changing stable
   release asset names.

## Test matrix

| Area | Required proof |
| --- | --- |
| Interactive signal | Idempotent under StrictMode; chat waits for its commit; menu waits for active-section resolution; Web Lite has no Tauri invocation. |
| Idle scheduler | Native idle callback, timer fallback, timeout, cancel, and exception isolation under fake clocks. |
| Root boot | No automatic catalog refresh before interactive; one refresh after idle; stale prerequisite cancellation; cached count suppresses refresh; dispose cancels; manual refresh remains immediate. |
| Lazy UI | Existing menu walkthrough passes; every registry panel still resolves/renders; persisted open dock renders its fallback then panel. |
| Bundle | Manifest fixture tests plus a real production manifest; no menu/panel/markdown module eager; eager JS <=310 KiB gzip. |
| Snapshot | Shared policy unit tests, required-path tests, exact totals/hash, <=10 MiB raw, generated snapshot build smoke. |
| Desktop clock | Rust unit tests for one-shot report/state; release launch emits exactly one parseable marker. |
| Product runtimes | `npm run ci`, desktop-mocked and Web Lite E2E, and Rust suite all green. |

## Acceptance checklist

- [ ] Ten release-mode Linux process-cold samples have p95 <1,500 ms; the
      fresh-profile first launch is also recorded.
- [ ] The chat composer and every direct `#/menu/<section>` route are usable at
      the reported milestone.
- [ ] No automatic OpenRouter/Ollama live catalog request begins before that
      milestone; catalog refresh still eventually runs and manual actions do
      not wait for idle.
- [ ] All seven menu sections, all dock panels, and markdown remain outside the
      eager static closure; eager JS is <=310 KiB gzip.
- [ ] Source snapshot is <=10 MiB raw and remains buildable; the installer
      audit records actual NSIS/AppImage before/after sizes.
- [ ] Desktop and Web Lite behavior remain correct; no secrets, new dependency,
      persistence-schema change, release name change, or visual redesign.
- [ ] Architecture/changelog and durable acceptance evidence are updated. The
      harvesting session, not the implementation lane, updates the roadmap.

## Risks and rollback

- **A user opens Models before idle:** cached models are already restored and
  manual refresh remains immediate. Only automatic network freshness waits.
- **WebKit lacks `requestIdleCallback`:** the post-paint timer fallback and
  bounded timeout guarantee progress.
- **A persisted dock is open at startup:** synchronous metadata preserves its
  shell; a local loading fallback covers the component chunk.
- **Snapshot trimming breaks self-build:** required-path assertions and a build
  from the generated snapshot block integration. Restore a required path to
  the explicit allowlist; do not disable the size gate.
- **Reference timing is over budget:** use the Tauri/frontend markers and
  bundle report to identify the dominant stage. Do not claim completion or
  relax 1.5 seconds; keep the roadmap item open and dispatch a measured
  follow-up against the identified owner.

## Dispatch

One implementation task is sufficient because the changes share a single
startup milestone and one acceptance record. The exact task is in
`DISPATCH.md`.
