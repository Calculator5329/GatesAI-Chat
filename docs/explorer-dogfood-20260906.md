# Explorer desktop dogfood — 2026-09-06

The autonomous project campaign uses the real desktop-mode React app with the
existing fictional dev scenarios. It never uses a live provider or a user's
chat store. The driver refuses unmatched network traffic outside its dev-server
origin and checks the scenario sentinel before acting.

Run a dedicated Vite server, then:

```sh
APP_EXPLORER_ROOT=/absolute/path/to/app-explorer PORT=8860 node scripts/explorer/dogfood.mjs
```

Do not share a server with another drive session or edit app source during the
run: Vite HMR can reseed a scenario. Evidence goes into a new retained
`.explorer/dogfood/<timestamp>/` directory with `report.json`, `review.html`,
per-action receipts, actual capture timings, target crops, and frame bursts.
Provider mock calls are retained separately; they are fixture observations,
not Playwright network measurements.

Six goals cover progressive completion, cancellation with unchanged late text,
thread switching without response leakage, edit/resend, HTTP provider-error
recovery, and offline fetch rejection followed by recovery. The completion
expectation uses Explorer's bounded temporal engine: the composer returns to
its disabled idle state, stays there for 300ms, and the assistant `.md-body`
content (excluding elapsed UI timers) must make progress within 3 seconds while waiting (40-second total bound).

A seeded negative case holds the response after its first chunk:

```sh
APP_EXPLORER_ROOT=/absolute/path/to/app-explorer PORT=8860 \
  EXPLORER_CASE=stream-completion EXPLORER_STALL=1 node scripts/explorer/dogfood.mjs
```

Its expected result is a failed completion goal with a recorded progress-stall
reason. This is a seeded detection measurement, not a broken app or a verified
repair delivery.

## Fix and verification

Dogfooding exposed a fixture fidelity defect: active mocked response bodies
continued yielding after AbortSignal, and signals passed in Request objects
were ignored. The fixture now respects Request signals and pipes response
bodies through the native abortable stream boundary. Two focused interruption
diagnostics supplement the unchanged repo gates; the active-reader diagnostic
failed before the fix and passes after it. No production UI defect was
established by these six probes.

## Explorer opportunities demonstrated by this pass

- Hash routes must be retained: pathname-only snapshots cannot distinguish
  Chat conversations. The campaign observer now records the complete route.
- A stream needs progress and stable completion, not only one text sample.
  Whole-message progress missed the seeded stall because the elapsed timer
  kept changing; content-scoped progress was added upstream from this case.
- In-page mocks do not emit browser network requests. Keep mock call evidence
  explicitly attributed; never infer a dead handler from missing requests.
- Source/HMR changes during a run reset fixtures and invalidate diagnosis.
  Source revision stability should become a reusable run precondition.
- Concurrent browser contexts are not sufficient isolation if they share a
  single Handles command server. Each run needs its own server/session scope.

## Intent capture

- Closed: reusable six-goal fictional Explorer driver and abort-faithful dev
  stream fixture; machine receipts are linked from the campaign report.
- Named, not built: real Tauri native command / live provider testing remains
  outside this fictional browser pass, and no release or deployment is made.
- Found, unresolved: source-stability and fixture-call adapters are upstream
  Explorer opportunities, with this retained run as evidence.
