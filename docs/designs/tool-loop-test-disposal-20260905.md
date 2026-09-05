# Tool loop test store disposal (2026-09-05)

Scope: `tests/stores/toolLoop.test.ts` only. No production change.

## What the file did

`setupScripted` (the file's only `ChatStore` construction site) built a store per
call and returned it; nothing ever called `dispose()`. Parent source inspection found one construction site inside `setupScripted`
and no existing disposal call — there are no standalone
store fixtures elsewhere in the file. Every test in the
`Tool loop — scripted` block goes through `setupScripted`, so every store the
file created outlived its test.

## Lifetimes the constructor opens (source facts)

Read from source, not measured:

- `ChatStore` constructor calls `this.persistence.start()`
  (`src/stores/ChatStore.ts`). `ChatPersistenceCoordinator.start()
  (src/stores/chatPersistenceCoordinator.ts:126-175)` installs a MobX
  `autorun` over the deep snapshot with a `setTimeout`-based throttle
  scheduler, and — when `window` is defined, which it is under the jsdom test
  environment — adds `pagehide` and `beforeunload` listeners. Its `cleanup`
  (invoked by `dispose()`) is what stops the autorun and removes both
  listeners.
- The constructor also installs a second `autorun` for user system-prompt
  settings (`stopUserSystemPromptPersistence`), released only in `dispose()`.
- `dispose()` additionally aborts in-flight streams (`turnEngine.abortAllStreams()`),
  clears `streamingByThread`, clears agent-task timers, and drops the
  leader-election subscription.

Because those handles are only released by `dispose()`, an undisposed store
keeps a live reaction and two window listeners registered for the remainder of
the test file's module lifetime.

## Change

Adopted the pattern already in `tests/stores/ChatStore.test.ts`: a module-level
`activeChats` array, `trackChat()` on construction, and `disposeActiveChats()`
draining it. `setupScripted` now wraps its `new ChatStore(...)` in `trackChat`,
and the existing `afterEach` in the `Tool loop — scripted` block calls
`disposeActiveChats()` **before** `clearAppStorage()`, before resetting the shared synthetic storage. One existing hook, no new hook, no new
export, no new dependency, no framework addition. All original test titles and
assertions are unchanged.

The `UserProfileStore` block in the same file constructs no `ChatStore`, so its
hooks are untouched.

## What this does not claim

No memory or CPU measurement was taken, and no cross-test pollution was
reproduced. The claim here is narrower and checkable from source: resources
that only `dispose()` releases are now released. Whether any current assertion
depended on them staying open is a question for the verification pass.

## Verification

Parent verification on2026-09-05: an AST comparison confirmed all23original
test bodies/assertions unchanged and the sole constructor tracked. `npm run ci`
passed1385tests, typecheck and lint; `npm run test:e2e` passed146cases in1.6minutes.
No unexpected tracked files changed during verification. Logs and source-review
receipt: `/home/ethan/.cache/tmp/claude-expiry-tool-loop-disposal-20260905/`.
