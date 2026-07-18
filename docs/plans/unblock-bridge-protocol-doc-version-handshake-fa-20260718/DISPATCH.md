# DISPATCH — follow-up task spec

Ready-to-run source task that closes the one remaining gap for roadmap item
`docs/roadmap.md:662` ("Bridge protocol doc + version handshake (fail loud on
mismatch)"). See [`bridge-protocol-version-handshake.md`](./bridge-protocol-version-handshake.md)
for the full audit. The doc and the fail-loud implementation already exist; this
task adds the missing **unit tests** for the handshake and the mismatch →
`incompatible` transition (the acceptance the sibling item 376 named but never
delivered).

---

## Task spec

- **Title:** Bridge protocol handshake — unit tests for fail-loud version mismatch
- **Model tier:** smart (mechanical test authoring; existing harness)
- **Owns (lease these paths, edit only these):**
  - `tests/services/bridge/client.test.ts`
  - `tests/stores/BridgeStore.test.ts`
- **Do NOT touch:** any `src/**` production file, `docs/bridge-protocol.md`,
  `docs/roadmap.md`. No production behavior change — this is coverage only. If a
  test cannot be written without a production change, stop and report; that would
  mean the audit missed something.
- **Test command (must be green):** `npm run ci`
  (= `npm test` + `npm run typecheck` + `npm run lint`). The two edited files are
  covered by `npm test` (vitest). No e2e/cargo needed — no `src-tauri/`, UI, or
  Playwright surface changes.

### Goal

Add regression tests that pin the app-side protocol handshake and the fail-loud
mismatch path, so a future refactor of `negotiateProtocol()` or `BridgeStore.poll()`
cannot silently regress the "update the bridge" behavior.

All target code already exists and is unchanged by this task:
- `src/services/bridge/client.ts` — `negotiateProtocol()`, `BRIDGE_PROTOCOL_VERSION = 2`,
  `LEGACY_BRIDGE_PROTOCOL_VERSION = 0`, hello routing in `handleMessage`.
- `src/stores/BridgeStore.ts` — `poll()`, `BridgeProtocolMismatchError`, the
  `'incompatible'` transition, and the `"Bridge update required"` activity event.

### Part A — `tests/services/bridge/client.test.ts`

Add a `describe('negotiateProtocol()')` block. The file already has the harness
you need: `FakeWebSocket` (with `.open()`, `.message(data)`, `.serverClose()`,
`.sent`), the `connectedClient()` helper, `lastSocket()`, `parseFrame()`, and
`vi.useFakeTimers()` in `beforeEach`. Reuse them; do not add new infrastructure.

Cases (one `it` each):

1. **Sends the hello frame on negotiate.** After `connectedClient()`, call
   `negotiateProtocol()`. Assert the last entry in `ws.sent`, parsed, equals
   `{ type: 'hello', protocolVersion: 2 }` (no `id`, no `op`).
2. **Compatible v2.** Start negotiate, then `ws.message(JSON.stringify({ type: 'hello', protocolVersion: 2 }))`.
   The promise resolves to `2`.
3. **Mismatched integer resolves to that integer.** Same as (2) but the bridge
   replies `protocolVersion: 1` → resolves `1`; repeat/parametrize for `3`.
4. **Silent bridge → legacy v0 after grace.** Start negotiate with the default
   500 ms grace, send no hello, `vi.advanceTimersByTime(500)` → resolves `0`
   (`LEGACY_BRIDGE_PROTOCOL_VERSION`).
5. **Socket close during wait → v0 immediately.** Start negotiate, then
   `ws.serverClose()` before the grace elapses → resolves `0` (no need to advance
   timers).
6. **Non-integer / missing `protocolVersion` is not a hello.** Send
   `{ type: 'hello', protocolVersion: 'two' }` (and separately `{ type: 'hello' }`);
   the promise stays pending, then `vi.advanceTimersByTime(500)` → resolves `0`.
7. **Reject when the socket is not open.** On a fresh `new BridgeClient(url)` with
   no `connect()`, `negotiateProtocol()` rejects with `BridgeOfflineError`.
8. **(Optional) Send failure rejects.** If the socket throws on `send` (e.g. force
   `readyState` to non-OPEN after open, matching `FakeWebSocket.send`'s guard),
   `negotiateProtocol()` rejects with `BridgeOfflineError`. Include only if it
   fits the existing harness cleanly; do not add production hooks for it.

Notes for the implementer:
- Timers are faked; resolve promises by awaiting after `advanceTimersByTime`, or
  attach `.then`/assert via `await expect(promise).resolves.toBe(...)` after
  advancing. Match the await/timer style already used in the `request()` timeout
  tests in this same file.
- `negotiateProtocol` resolves the **first** hello it sees; a later frame is
  ignored (waiter is cleared). One assertion of that idempotence is nice-to-have,
  not required.

### Part B — `tests/stores/BridgeStore.test.ts`

Add a `describe('BridgeStore.poll() protocol handshake')` block. `poll()` depends
on three collaborators — mock them:

- `probeBridgeHealth` from `src/services/bridge/health` — mock the module so it
  resolves a minimal healthy payload, e.g.
  `{ version: '0.2.0', workspace_root: '/ws', platform: 'linux', allowlist: [] }`.
  Use `vi.mock('../../src/services/bridge/health', () => ({ probeBridgeHealth: vi.fn() }))`
  and set the resolved value per test.
- `bridge.client.connect` — `vi.spyOn(...).mockResolvedValue(undefined)`.
- `bridge.client.negotiateProtocol` — `vi.spyOn(...).mockResolvedValue(<version>)`
  per case.
- `bridge.client.disconnect` — `vi.spyOn(...)` to assert it is/ isn't called.

The online-success case additionally reaches `ensureDefaultWorkspaceGuide` and
`openUserGuideOnFirstInstall`; mock those two modules
(`src/services/bridge/defaultWorkspaceGuide`, `src/services/bridge/userGuideInstall`)
to resolve no-ops so the online path completes. The mismatch/legacy cases throw
**before** reaching them, so they need no interaction assertions there.

Cases (each: construct `new BridgeStore()`, wire mocks, `await bridge.poll()`):

1. **Compatible v2 → online.** `negotiateProtocol` resolves `2`. Assert
   `bridge.state === 'online'`, `bridge.isOnline === true`, `bridge.lastError`
   undefined, and an activity event with `verb: 'Workspace ready'`.
2. **Mismatched version → incompatible (fail loud).** `negotiateProtocol` resolves
   `1`. Assert: `bridge.state === 'incompatible'`; `bridge.isOnline === false`;
   `bridge.lastError === 'Bridge speaks v1, app needs v2 — update the bridge.'`;
   `client.disconnect` was called; an activity event exists with
   `verb: 'Bridge update required'` and `state: 'failed'`.
3. **Legacy silent bridge (v0) → incompatible.** `negotiateProtocol` resolves `0`.
   Assert `state === 'incompatible'` and
   `lastError === 'Bridge speaks v0, app needs v2 — update the bridge.'`.
4. **(Optional) Higher version (v3) → incompatible.** Symmetric to (2) with `3`,
   asserting the `v3` message — cheap extra guard against an accidental
   `bridge < app` style comparison replacing the strict `!==`.

Notes for the implementer:
- Follow the existing spy-on-`bridge.client` style already used at the top of
  `BridgeStore.test.ts` (e.g. the attachment tests spy on `bridge.client.request`).
- Do not call `bridge.start()` (it installs a 5 s interval); call `bridge.poll()`
  directly and, if any timer is created, clean it up / use fake timers to avoid
  open handles. The mismatch path creates no interval.
- `poll()` uses `Date.now()` for `lastSeenAt` and activity IDs; that is fine under
  real timers. If you introduce `vi.useFakeTimers()`, restore in `afterEach`.

### Definition of done

1. Both files edited; new tests added as specified; no `src/**` or docs changes.
2. `npm run ci` green.
3. Commit message notes: adds handshake + mismatch unit coverage; no behavior
   change; satisfies the outstanding acceptance for roadmap item 662 (and the
   originally-named acceptance of item 376).
4. Report back so the harvesting session can tick `docs/roadmap.md:662`.
