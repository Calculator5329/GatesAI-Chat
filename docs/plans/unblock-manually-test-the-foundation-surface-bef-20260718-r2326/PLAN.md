# Foundation surface manual acceptance plan

Status: ready for outside-sandbox execution; **not yet manually accepted**

Decision: **RE-DISPATCH**

Roadmap source: `Manually test the foundation surface before rebuilding optional integrations`

## Outcome

Run a real-app regression acceptance of the deliberately small foundation
defined in `docs/plans/2026-05-08-foundation-trim.md`:

- OpenRouter cloud chat;
- Ollama local chat;
- ComfyUI local image generation;
- memory, notes, thread context/management, summaries, and custom system prompt;
- the jailed bridge workspace tools: `workspace`, `fs`, `inspect_file`,
  `terminal`, `python_inline`, `sqlite_query`, `query_script`, and `git`.

The historical ordering is stale: optional integrations have already shipped.
Do not roll them back and do not expand this test into an audit of them. Test
the list above as a regression slice in the current app, with Offline Library,
MCP, skills, schedules, sub-agents, source self-improvement, and updater flows
disabled or left untouched. Their presence must not prevent a foundation flow,
but their behavior is out of scope.

This roadmap item is complete only after the manual run described below has a
durable report, all required cases pass on a real Tauri build, and the
repository gates pass. This planning lane does not itself satisfy that bar.

## Why the previous lane landed nothing

The prior task did not reach repository work:

1. `codex-...-20260718093950-561bce02` remained recorded as `running` and kept
   the original plan-directory lease.
2. Two later Codex attempts and two Claude attempts were rejected immediately
   by that ownership conflict, so they changed zero files.
3. The final Claude attempt selected unavailable model `gpt-5.6-terra`, exited
   after about two seconds, and also changed zero files.

This re-dispatch avoids the same failure mode with the fresh `-r2326` task id,
a disjoint owned directory, and an available Codex model. The evidence comes
from the prior task/run/report/handoff records under the main checkout's
`.orc/` directory.

## Current automated baseline

At base `7c44187b33c537b3d5258176632ac390d9f768ae` on 2026-07-18:

- The dispatched shell inherited `NODE_ENV=production`. A literal
  `npm run ci` therefore loaded React's production bundle, where `react.act`
  is unavailable, and reported 190 component-test failures. This is an
  ambient test-mode mismatch, not foundation product evidence.
- `NODE_ENV=test npm run ci` passed: 184 Vitest files / 1,388 tests, followed
  by typecheck and lint.
- A literal Rust test command first stopped during Tauri configuration because
  the unbundled worktree has no Linux sidecar binary. Re-running with the same
  external-binary override used by CI passed: 45 Rust tests, 0 failed, 2 live
  Offline Library tests ignored. Two existing unused-import warnings appeared
  in `local_runtime.rs` test code.
- Playwright and a live Tauri launch were not run in this lane. Both require
  local listeners, which the Codex sandbox cannot bind. They require
  outside-sandbox verification; the test harness must not be weakened to fit
  this lane.

The manual operator must record the exact tested commit and build version.
Results from another commit do not close this item.

## Safety and evidence rules

1. Use a disposable test profile and a dedicated workspace folder named
   `foundation-acceptance-<date>`. Do not point testing at Ethan's everyday
   profile or existing workspace files.
2. Preserve any pre-existing app profile by copying it to a durable backup.
   Never permanently delete it. Exercise only recoverable thread removal and
   synthetic files created by this run.
3. Never paste credentials, bearer headers, home-directory paths, or private
   chat content into screenshots, logs, or the report. Credential evidence is
   only “accepted”, “rejected”, or a redacted suffix.
4. Use one cheap, bounded cloud prompt. Record that a live OpenRouter request
   occurred, not the key or raw request headers. Do not run the live model
   compatibility suite.
5. Set the image backend explicitly to local ComfyUI for the image cases.
   A local failure must not silently spend cloud credits.
6. Capture evidence under a durable repository path, never a cache or temp
   directory. Keep one report, a sanitized environment manifest, and only the
   screenshots/log excerpts needed to prove pass or failure.
7. Do not repair defects during the acceptance run. Record a minimal
   reproduction and dispatch a separately owned fix so the tested build stays
   identifiable.

## Test environments

| Environment | Required state | Purpose |
| --- | --- | --- |
| Real desktop | Current Linux Tauri build, bundled/matching bridge, disposable profile | Release-critical foundation, OS keychain, bridge, local runtimes, relaunch |
| Desktop local-only | Same build, OpenRouter unavailable, Ollama and ComfyUI online | Prove local paths are first class and never fall back remotely |
| Desktop degraded | Same build with bridge, Ollama, and ComfyUI stopped one at a time | Prove honest gating and recoverable errors |
| Web Lite | Current browser build in a fresh browser profile | Cloud chat and explicit desktop-only degradation |

Linux is the required real-shell platform because it is the primary checkout
and includes the NVIDIA/Wayland launch risk. Windows is useful release
evidence but is not required to close this historical item; do not substitute
`desktop-mocked` Playwright for the real Tauri run.

## Manual test protocol

Record `pass`, `fail`, or `blocked` for every ID. A screenshot alone never
proves persistence, a tool effect, or lack of network fallback.

### A. Boot, onboarding, and navigation

| ID | Steps | Expected result |
| --- | --- | --- |
| FND-BOOT-01 | Start the real Tauri app with the disposable empty profile; inspect the window and app log. | One usable window appears without a white/blank frame, crash, unhandled error, or secret in logs. Build/version and bridge version are visible in evidence. |
| FND-BOOT-02 | With no provider ready, inspect first-run, model picker, Settings, Models, Local, Workspace, Gallery, and Agent. | The composer cannot send; cloud and local setup paths are honest; every route renders and returns to chat; optional integrations do not interrupt the flow. |
| FND-BOOT-03 | Resize from 1280px desktop width to the narrow/mobile breakpoint and use keyboard navigation through the composer, picker, and menu. | Primary controls remain reachable, focus is visible, no horizontal clipping hides required actions, and Escape closes transient surfaces. |

### B. OpenRouter cloud chat

| ID | Steps | Expected result |
| --- | --- | --- |
| FND-CLOUD-01 | Enter a valid OpenRouter key through the real desktop UI, refresh the catalog, select a supported text model, and send `Reply with exactly: foundation cloud ok`. | The key is accepted without appearing in ordinary app storage/logs; one user message and one streamed assistant reply render in the active thread. |
| FND-CLOUD-02 | Start a longer bounded reply, press Stop after visible output, then send a fresh prompt. | Stop is visible only while streaming; partial content is retained and marked coherently; the next turn succeeds without duplicated or late tokens. |
| FND-CLOUD-03 | Replace the credential with an obviously invalid synthetic value, attempt one request, then restore the valid credential. | A concise, actionable provider error appears only on the affected thread; no retry loop or frozen composer occurs; recovery succeeds. |

### C. Threads, context, memory, notes, and persistence

| ID | Steps | Expected result |
| --- | --- | --- |
| FND-STATE-01 | Create two threads; type distinct unsent drafts; switch between them; rename one; change its model/context controls. | Drafts, active thread, titles, and per-thread controls remain scoped correctly with no cross-thread error or stream leakage. |
| FND-STATE-02 | Add a unique synthetic profile fact and custom instruction. Ask the model to list/add/update a synthetic note, then inspect the Agent surface. | The fact/instruction affect the request; `memory` and `notes` actions are visible in the activity trail and their resulting state is accurate. No destructive note action is required. |
| FND-STATE-03 | Complete enough turns for summary eligibility, leave that thread idle, and continue in the other thread. | Any generated summary attaches to the correct non-streaming thread and never changes a manually chosen title. If timing makes this blocked, record timestamps and validate it in a dedicated follow-up rather than waiting unboundedly. |
| FND-STATE-04 | Fully quit and relaunch the desktop app. Reopen both threads and the Agent surface. | Messages, tool results, drafts, titles, selected model/context, fact, note, and readable workspace chat mirror survive; the OpenRouter secret remains usable without plaintext exposure. |

### D. Ollama local-only chat

| ID | Steps | Expected result |
| --- | --- | --- |
| FND-LOCAL-01 | Make OpenRouter unavailable, start/detect Ollama, refresh its catalog, and select an installed chat model. | Local shows online with the real installed catalog; the picker offers Local; no cloud credential is required. |
| FND-LOCAL-02 | Send `Reply with exactly: foundation local ok`, then repeat the stop/recovery flow from FND-CLOUD-02. | Native Ollama streaming and stop/recovery work; usage is labeled local/free; network observation shows no OpenRouter request. |
| FND-LOCAL-03 | Stop Ollama, try to send, then restart and refresh. | The unavailable model is gated with a Local route and clear recovery; there is no automatic cloud/model fallback; the same thread works after recovery. |

### E. ComfyUI local image path

| ID | Steps | Expected result |
| --- | --- | --- |
| FND-IMAGE-01 | With ComfyUI healthy and the backend explicitly local, request one small bounded test image through the supported local image choice/tool. | One job card appears immediately, progresses in place, completes in that card, and does not append detached success prose. |
| FND-IMAGE-02 | Open the result and Gallery; verify the referenced workspace file exists; quit and relaunch. | Thumbnail and lightbox render non-black, dimensions/path are coherent, Gallery and the chat reference survive relaunch, and the file stays inside the acceptance workspace. |
| FND-IMAGE-03 | Stop ComfyUI and make one local image request. | The local path is unavailable or fails clearly and recoverably; no OpenRouter image request or cloud charge occurs; restarting ComfyUI restores the path. |

### F. Bridge workspace tool chain and jail

All writes stay inside `/workspace/foundation-acceptance-<date>/`.

| ID | Steps | Expected result |
| --- | --- | --- |
| FND-WS-01 | Inspect Workspace status; create/read/update a UTF-8 text file with `workspace`/`fs`; inspect it with `inspect_file`. | UI and activity trail show the same jailed root and effects; readback matches; no host-absolute path is exposed to the model. |
| FND-WS-02 | Run a short allowlisted terminal command and `python_inline` that each create a distinct synthetic result file. | Commands finish, tails remain subordinate to the conversation, and both files are readable through `fs`. |
| FND-WS-03 | Create a tiny SQLite fixture, query it read-only with `sqlite_query`, and run a `query_script` that writes a JSON artifact. | Results match the fixture, the database is unmodified by the read query, and the script/output remain inside the acceptance folder. |
| FND-WS-04 | Initialize a git repo in the acceptance folder, create one tracked synthetic file, and request status/diff through the `git` tool. | Status/diff are scoped to that repo; the app does not auto-commit or touch the GatesAI source checkout. |
| FND-WS-05 | Attach two different files with the same basename and inspect both. | They receive distinct workspace paths and distinct rendered/read content; neither overwrites the other. |
| FND-SEC-01 | Request an `fs` read outside the workspace jail and a tool read of protected `.gatesai/chat` or `chat-history`. | Both are refused with clear policy errors, no content leaks, and subsequent valid tool calls still work. |
| FND-WS-06 | Stop the bridge, attempt a workspace action, then restore the matching bridge. | Desktop shows an honest offline state, hides/refuses unavailable tools, keeps chat usable, and recovers without app restart or duplicated action. |

### G. Web Lite partition

| ID | Steps | Expected result |
| --- | --- | --- |
| FND-WEB-01 | Open the current Web Lite build in a fresh profile, add a test OpenRouter credential, select a supported model, and send one bounded prompt. | Cloud chat streams and persists after reload; Web Lite identity is visible; no bridge or Tauri command is attempted. |
| FND-WEB-02 | Visit Local and Workspace and inspect attachment/image affordances. | Each desktop-only capability is hidden or replaced by an explicit desktop explanation; no unhandled promise rejection or localhost integration request occurs. |

## Acceptance and defect policy

The run passes only when:

- every case except the explicitly time-dependent summary case is `pass`;
- the summary case is either `pass` or has a separately dispatched bounded
  follow-up with captured timing evidence;
- there is no data loss, secret exposure, workspace-jail escape, protected
  chat-history access, silent cloud fallback, unexpected external request,
  blank window, or unrecoverable local-runtime/bridge state;
- `NODE_ENV=test npm run ci`, the full `npm run test:e2e`, and the CI-equivalent
  `TAURI_CONFIG='{"bundle":{"externalBin":[],"resources":[]}}' cargo test
  --manifest-path src-tauri/Cargo.toml` pass on the tested commit;
- the report labels Playwright evidence `desktop-mocked` and does not use it
  as a substitute for the real Tauri cases; and
- each failure has exact build/environment facts, minimal reproduction,
  sanitized evidence, severity, and a separately owned repair task.

Any security, secret, data-loss, silent-spend, or blank-window failure blocks
the whole acceptance. Other failures also keep the roadmap item open; do not
convert them into a prose waiver merely because automated tests are green.

## Required durable report

Create `docs/acceptance/foundation-surface-<date>/REPORT.md` with:

1. tested commit, package version, OS/session type, Tauri/WebKit versions,
   bridge version, Ollama version/model, and ComfyUI version/workflow;
2. the exact automated commands and results;
3. one row per case ID with verdict, observation, and evidence link;
4. a redacted network ledger for OpenRouter/Ollama/ComfyUI/bridge calls;
5. defect task IDs and blocking severity;
6. a final `PASS` or `FAIL` statement against the acceptance policy above.

Store screenshots and sanitized excerpts beside the report. The harvesting
session may tick the roadmap item only from a `PASS` report, not from this plan
or a green mocked-browser suite.

## Dispatch boundary

[DISPATCH.md](./DISPATCH.md) is the exact outside-sandbox manual acceptance
task. It makes no source changes. If the run finds a defect, create a new
source-change task with only the affected paths and the narrow reproduction
plus the relevant repository gates; do not broaden the manual QA lease to fix
it in place.
