# Bridge protocol doc + version handshake (fail loud on mismatch)

**Task:** `unblock-bridge-protocol-doc-version-handshake-fa-20260718`
**Roadmap item:** Architecture → "Bridge protocol doc + version handshake (fail loud on mismatch)" (`docs/roadmap.md:662`)
**Ethan's decision:** APPROVED
**Audited against:** `ffb07a97023c9b7624e2c60327dfb831da7deeec` (branch tip in this worktree)
**Status of this plan:** audit complete — doc + implementation already shipped; one concrete gap remains (test coverage). A ready-to-run follow-up is specified in [`DISPATCH.md`](./DISPATCH.md).

---

## 1. What this item asks for

Three things, read literally from the title:

1. **Bridge protocol doc** — a written wire contract between the app and the `gatesai-bridge` sidecar.
2. **Version handshake** — the app and bridge exchange protocol versions on connect.
3. **Fail loud on mismatch** — a version mismatch must surface a clear, user-visible error instead of degrading silently or hanging.

This item overlaps two already-checked roadmap items, so the audit below establishes *exactly* what is done and what is not, rather than re-implementing shipped work:

- `docs/roadmap.md:376` — **Bridge protocol version handshake** *(done 2026-07-10)*: "App sends/expects a protocol version on WebSocket connect; mismatch surfaces a clear BridgeStore error state instead of quiet failures." Its acceptance was: *"unit tests for the app-side handshake; graceful degraded message on mismatch."*
- `docs/roadmap.md:695` — **Bridge protocol spec in docs/** *(done 2026-07-16)*: `docs/bridge-protocol.md` audited/completed against code.

## 2. Audit — current state at the audited SHA

### 2.1 Protocol doc — DONE

`docs/bridge-protocol.md` (320 lines) is a complete v2 spec. It covers discovery/transport, framing and the inbound size limit, the **version handshake** (§"Version handshake"), a **compatibility matrix**, the envelope/message types, the `privileged` flag, every operation, client timeouts, and explicit **versioning rules**. It is cross-linked to the implementing source files and to the test sources.

Verdict: the "doc" leg of this item is satisfied. No doc rewrite is required. (One small freshness nit is noted in §4.)

### 2.2 Version handshake — DONE

App-side, in `src/services/bridge/client.ts`:

- `BRIDGE_PROTOCOL_VERSION = 2` is the app's pin; `LEGACY_BRIDGE_PROTOCOL_VERSION = 0` classifies pre-hello bridges (`client.ts:20-21`).
- `negotiateProtocol(graceMs = 500)` sends `{ type: 'hello', protocolVersion: 2 }` immediately after the socket opens and resolves with the peer's advertised version (`client.ts:172-195`).
- Inbound hello frames are recognized by `type === 'hello'` with an **integer** `protocolVersion` and routed to the handshake waiter (`client.ts:268-271`). A non-integer or missing `protocolVersion` is *not* treated as a hello.
- Silent (pre-hello) bridges resolve to `v0` after the grace timeout; a socket close during the wait also resolves to `v0` (`client.ts:184`, `client.ts:135-144`).

Verdict: the handshake exists and matches the spec's compatibility matrix.

### 2.3 Fail loud on mismatch — DONE

In `src/stores/BridgeStore.ts`:

- `poll()` calls `client.connect()` then `client.negotiateProtocol()`. If the returned version `!== BRIDGE_PROTOCOL_VERSION`, it throws `BridgeProtocolMismatchError` (`BridgeStore.ts:238-241`).
- `BridgeProtocolMismatchError` carries both versions and a plain-language message: `"Bridge speaks v<bridge>, app needs v2 — update the bridge."` (`BridgeStore.ts:26-36`).
- On mismatch the store **disconnects the socket**, sets `state = 'incompatible'`, records `lastError`, keeps `isOnline` false (so bridge-backed tools stay unavailable), and emits a `"Bridge update required"` activity event (`BridgeStore.ts:256-269`). `'incompatible'` is a first-class value of `BridgeConnectionState` (`src/core/workspace.ts:17`).

The "loud" surfaces are wired in the UI:

- `src/components/editorial/BridgeStatusPill.tsx:37-44` — red dot, label **"bridge update required"**, tooltip = the mismatch message + "Click to re-poll after updating."
- `src/components/menu/sections/Workspace.tsx:214-216` — Workspace menu shows **"Bridge update required"** with the danger dot.

Verdict: a mismatch fails loud in three places (status pill, workspace menu, activity feed) and blocks tool use. This leg is satisfied at the runtime level.

### 2.4 The gap — the handshake/mismatch path is UNTESTED

Item 376's acceptance explicitly required **"unit tests for the app-side handshake; graceful degraded message on mismatch."** That coverage does not exist at the audited SHA:

- `tests/services/bridge/client.test.ts` covers `connect()`, `request()`, timeouts, event/error routing, socket-close rejection, `privileged`, and malformed frames — but **contains no test that calls `negotiateProtocol()`** (0 references to `negotiateProtocol` / `hello` / `protocolVersion` in the file).
- `tests/stores/BridgeStore.test.ts` has 7 tests, all on the attachment / read / list facades. **None exercises `poll()`**, the `'incompatible'` transition, or `BridgeProtocolMismatchError`.
- The only place a hello is exercised is the **e2e desktop mock** (`tests/e2e/fixtures/harness.ts:216-219`), and it only sends the **compatible** `protocolVersion: 2`. The mismatch/legacy/silent branches — the entire point of "fail loud on mismatch" — are never driven by any test.

So the failure mode the item exists to prevent (a silent or wrong degradation on version skew) has **zero regression protection**. A refactor of `negotiateProtocol` or the `poll()` error branch could regress the fail-loud behavior and every gate would stay green.

## 3. Decision

- **No production-source changes are needed.** The doc, the handshake, and the fail-loud surfaces are all shipped and correct. Re-implementing them would be churn.
- **The item is not done** until the acceptance-required tests exist. Closing the coverage gap is the whole remaining delta, and it is source work (new/edited test files) that falls **outside this task's lease** (`docs/plans/unblock-bridge-protocol-doc-version-handshake-fa-20260718/` only).
- Therefore this task's deliverable is: this audit + an **exact, executable follow-up task spec** ([`DISPATCH.md`](./DISPATCH.md)) that adds the missing unit tests. That follow-up is small, self-contained, and uses the existing `FakeWebSocket` harness and mocking patterns already in the repo — no new test infrastructure.

Rationale for treating this as "add tests" rather than "already done, just tick it": the sibling item (376) named the tests as acceptance, and the roadmap owner keeps item 662 open specifically because the doc-only completion (695) did not add them. Ticking 662 without the tests would leave the fail-loud behavior undefended and misrepresent acceptance.

## 4. Optional follow-up nits (not blocking; not in the DISPATCH)

These are deliberately **excluded** from the required follow-up to keep it minimal. File to `docs/IDEAS.md` if wanted later:

- **Doc freshness.** `docs/bridge-protocol.md:311-317` ("Verification sources") points at `tests/services/bridge/client.test.ts` for "app-side envelope behavior" — accurate — but does not mention handshake unit coverage (because none exists yet). Once the DISPATCH lands, add a line noting the new handshake/mismatch unit tests so the "Verification sources" section stays true.
- **Health `protocol_version` is informational only.** The app reads `protocol_version` from `/health` and `bridge.info` but does not gate on it (`docs/bridge-protocol.md:36-40`, `:269-271`); only the WS hello is authoritative. This is a deliberate, documented choice (health is discovery-only). No change proposed — noted so a future reader does not "fix" it into a second gate.
- **No downgrade/range negotiation.** A version bump is a hard cut by design (`docs/bridge-protocol.md:298`). If multi-version support is ever wanted, that is a new roadmap item with its own ADR, not part of this one.

## 5. Acceptance for closing roadmap item 662

The harvesting session may tick `docs/roadmap.md:662` once the follow-up in `DISPATCH.md` lands and:

1. `tests/services/bridge/client.test.ts` has a `negotiateProtocol()` describe block covering: compatible v2, mismatched integer (e.g. v1/v3), silent-bridge → v0 after grace, socket-close-during-wait → v0, non-integer/missing `protocolVersion` ignored, and reject-when-not-open.
2. `tests/stores/BridgeStore.test.ts` has a `poll()` block covering: negotiate → v2 ⇒ `state === 'online'`; negotiate → mismatched version ⇒ `state === 'incompatible'`, `lastError` = the mismatch message, `isOnline === false`, socket disconnected, `"Bridge update required"` activity emitted; and legacy `v0` ⇒ `incompatible`.
3. `npm run ci` is green (the new tests included).

No changes to `src/` production files, `docs/bridge-protocol.md`, or `docs/roadmap.md` are required for closure — the doc and the fail-loud implementation are already in place.
