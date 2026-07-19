# Share thread as single-file HTML execution plan

## Scope

Lane path: `docs/plans/unblock-share-thread-as-single-file-html-20260718`

## Execution steps

1. Add a pure single-thread HTML renderer in chat services.
2. Add share action service API (copy/download fallback).
3. Wire the action from sidebar thread context and command palette.
4. Add tests for renderer + UI flow.
5. Run the verification command set.

## Step sequence

### Step 1 — Implement pure thread-share renderer

File to add:

- `src/services/chat/threadShare.ts`

Tasks:

- move/reuse thread and message formatting logic from
  `src/services/chat/libraryExport.ts` into a pure renderer tailored for sharing,
  keeping message parsing semantics identical.
- ensure generated HTML is standalone:
  no remote font/script/style links.
- provide deterministic filename/metadata helpers.

### Step 2 — Implement share action helpers

Files to update:

- `src/services/chat/threadShare.ts` (new file)
- `src/stores/ChatStore.ts` or `src/stores/RootStore.ts` depending on where thread
  selection is owned

Tasks:

- add a public method to serialize the active thread and invoke share output,
  returning a status object (`copied` vs `downloaded`).
- implement robust fallback when clipboard API is unavailable.

### Step 3 — Add user actions

Files to update:

- `src/components/editorial/EditorialSidebar.tsx`
- (optional) `src/components/palette/CommandPalette.tsx`

Tasks:

- add **Share as HTML** in thread row context.
- bind each action to the clicked thread row id.
- show success/failure status in the least disruptive surface channel used in the
  component style.
- add a corresponding command-palette action for discoverability.

### Step 4 — Tests and hardening

Files to update:

- `tests/services/chat/libraryExport.test.ts` if sharing helpers are colocated there,
  or `tests/services/chat/threadShare.test.ts` if new service file gets its own
  test suite.
- `tests/components/editorial/EditorialSidebar.test.ts`
- `tests/components/palette/CommandPalette.test.ts` (if optional palette action is
  added)

Tasks:

- assert generated HTML contains thread title and transcript markers.
- assert share action targets the intended thread.
- assert copy-vs-download branch behavior in a mocked browser environment.

### Step 5 — Verification

Run:

- `npm run test:e2e`
- `npx vitest run tests/services/chat/libraryExport.test.ts tests/services/workspaceChatPersistence.test.ts tests/services/chat/threadShare.test.ts tests/components/editorial/EditorialSidebar.test.ts tests/components/palette/CommandPalette.test.ts`

Note: `npm run test:e2e` requires outside-sandbox verification for port binding.

## Delivery gates

- Share action is present and target-specific.
- Exported HTML is single-file and standalone.
- Existing chat library persistence remains unchanged in behavior.
- No bridge dependency for share generation outside clipboard/download path.
- Tests cover both happy path and fallback behavior.
