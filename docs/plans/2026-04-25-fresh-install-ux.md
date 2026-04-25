# Fresh-install UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Remove the seed threads + FakeProvider fallback so a fresh install lands in one empty untitled thread with a disabled composer + "Add an API key" banner. Replace the placeholder Tauri icons with the real brand artwork at the same time.

**Architecture:** Add a single source of truth for "is any provider usable?" via `LlmRouter.canRoute()` and a `ProviderStore.hasUsableProvider` getter that delegates to it. Wire the composer to disable its send button and show a banner when that's false. Then delete `FakeProvider`, `seed.ts`, and the now-unreachable fallback paths. Finally regenerate icons from `assets/icon-source.png` via `npx tauri icon` and rebuild the installer.

**Tech Stack:** TypeScript / React 19 / MobX 6 stores, Vitest 3 (jsdom env). Existing chat code conventions: stores in `src/stores/`, services in `src/services/`, tests in `tests/` mirroring source paths.

**Design doc:** `docs/plans/2026-04-25-fresh-install-ux-design.md` — read it first if any decision needs context.

**Working tree note:** Before starting Task 1, working-tree should be clean modulo the user's in-progress icon/favicon work (see `git status`). The plan deliberately keeps Task 5 (icon swap) self-contained so it interleaves cleanly with that work.

---

### Task 1: Add `canRoute()` to LlmRouter + `hasUsableProvider` to ProviderStore

**Why:** Single source of truth for "is the app able to talk to a model?" Both the banner state (Task 2) and the eventual no-provider error path (Task 3) read from one function. Add the plumbing first; nothing observable changes yet.

**Files:**
- Modify: `src/services/llm/router.ts`
- Modify: `src/stores/ProviderStore.ts`
- Test: `tests/services/llmRouter.test.ts` (existing — add new cases)
- Test: `tests/stores/ProviderStore.test.ts` (create if absent — check first)

**Step 1: Read current state**

Read `src/services/llm/router.ts` and `src/stores/ProviderStore.ts` end-to-end. Note: `LlmRouter.providers` is `Record<ProviderId, LlmProvider>`, where every provider has a `ready(): boolean`. The `'fake'` provider always returns `true` from `ready()` — so a naive `Object.values(...).some(p => p.ready())` would always be true. The check must exclude `'fake'`.

**Step 2: Write failing test for `canRoute()`**

In `tests/services/llmRouter.test.ts`, add:

```ts
describe('LlmRouter.canRoute', () => {
  it('returns false when no provider has a key (only fake is ready)', () => {
    const router = new LlmRouter(makeRegistry(), {});
    expect(router.canRoute()).toBe(false);
  });

  it('returns true when openai has a key', () => {
    const router = new LlmRouter(makeRegistry(), { openai: { apiKey: 'sk-test' } });
    expect(router.canRoute()).toBe(true);
  });

  it('returns true when local has a base URL', () => {
    const router = new LlmRouter(makeRegistry(), { local: { baseUrl: 'http://localhost:11434/v1' } });
    expect(router.canRoute()).toBe(true);
  });

  it('flips reactively after updateConfigs', () => {
    const router = new LlmRouter(makeRegistry(), {});
    expect(router.canRoute()).toBe(false);
    router.updateConfigs({ anthropic: { apiKey: 'sk-ant-test' } });
    expect(router.canRoute()).toBe(true);
  });
});
```

`makeRegistry()` already exists at the top of this test file — reuse it. If it doesn't, factor a 5-line helper that returns a `ModelCatalog` with one model per provider.

**Step 3: Run test, expect failure**

```bash
npm run test -- tests/services/llmRouter.test.ts
```

Expected: 4 failures with "router.canRoute is not a function" or similar.

**Step 4: Implement `canRoute()` on LlmRouter**

In `src/services/llm/router.ts`, add a method on `LlmRouter`:

```ts
/**
 * Whether any non-fake provider is ready (has a key, or for `local`, a base
 * URL). When false, the UI must prevent sending — there's nothing real to
 * route to and we no longer fall back to the fake provider.
 */
canRoute(): boolean {
  for (const [id, provider] of Object.entries(this.providers)) {
    if (id === 'fake') continue;
    if (provider.ready()) return true;
  }
  return false;
}
```

**Step 5: Run test, expect pass**

```bash
npm run test -- tests/services/llmRouter.test.ts
```

Expected: all 4 new tests pass; existing tests unaffected.

**Step 6: Add `hasUsableProvider` getter on ProviderStore**

In `src/stores/ProviderStore.ts`, add a derived getter:

```ts
/** True iff the router can dispatch a request to a real provider. Drives
 *  the "Add an API key to start chatting" banner and the disabled send
 *  button. Reactive — flips as soon as the user pastes a key (autorun
 *  in the constructor calls `router.updateConfigs`, which is what
 *  `canRoute` reads from). */
get hasUsableProvider(): boolean {
  return this.router.canRoute();
}
```

MobX makes getters auto-observable via `makeAutoObservable`, so no extra wiring needed.

**Step 7: Add a quick reactive sanity test**

If `tests/stores/ProviderStore.test.ts` doesn't exist, create it. If it does, append. Add:

```ts
import { autorun } from 'mobx';
import { ProviderStore } from '../../src/stores/ProviderStore';
// import or build a minimal ModelRegistry stub

describe('ProviderStore.hasUsableProvider', () => {
  it('starts false and flips to true when a key is set', () => {
    const store = new ProviderStore(makeRegistryStub());
    const seen: boolean[] = [];
    const dispose = autorun(() => seen.push(store.hasUsableProvider));
    store.setKey('openai', 'sk-test');
    dispose();
    expect(seen[0]).toBe(false);
    expect(seen.at(-1)).toBe(true);
  });
});
```

`makeRegistryStub()`: simplest is `{ all: [], findById: () => undefined } as ModelRegistry` — `canRoute` doesn't need the registry contents.

**Step 8: Verify**

```bash
npm run typecheck
npm run test -- tests/services/llmRouter.test.ts tests/stores/ProviderStore.test.ts
```

Expected: typecheck clean, all tests pass.

**Step 9: Commit**

```bash
git add src/services/llm/router.ts src/stores/ProviderStore.ts tests/services/llmRouter.test.ts tests/stores/ProviderStore.test.ts
git commit -m "feat: add canRoute / hasUsableProvider for no-provider state"
```

---

### Task 2: Disabled send button + "Add an API key" banner in EditorialComposer

**Why:** Block the send-into-void path and surface the missing-key state inline.

**Files:**
- Modify: `src/components/editorial/EditorialComposer.tsx`
- Test: `tests/components/editorial/EditorialComposer.test.ts` (create if absent — quick check first)

**Step 1: Read current state**

Read `src/components/editorial/EditorialComposer.tsx` (the part starting at the `EditorialComposer` observer). Note:
- `chat`, `ui`, `bridge`, `registry` come from `useXxxStore()` hooks at the top (`useChatStore` etc. in `../../stores/context`).
- `canSend` (line ~112) is computed from text + attachments.
- The send button is the trailing `<div onClick={...}>` at ~line 263.

**Step 2: Pull in ProviderStore**

At the top of the component, alongside the other store hooks, add:

```tsx
const providers = useProviderStore();
```

If `useProviderStore` isn't already exported from `src/stores/context`, look at how `useChatStore` is exported and mirror it. (The store hooks file follows a clear pattern.)

**Step 3: Gate `canSend` on `hasUsableProvider`**

Replace:
```tsx
const canSend = hasText || hasAttachments;
```
with:
```tsx
const canSend = (hasText || hasAttachments) && providers.hasUsableProvider;
```

Also update the send-button `onClick`/visual disabled condition (lines ~263–274). The existing pattern uses `streaming || canSend` to decide cursor + opacity — that already covers the new disabled case because `canSend` now factors in `hasUsableProvider`.

**Step 4: Render the banner above the composer**

Inside the existing `<div style={{ width: 'min(750px, 70%)', ... }}>` wrapper at ~line 184, immediately before the `{hasAttachments && (...)}` block, add:

```tsx
{!providers.hasUsableProvider && (
  <ApiKeyBanner />
)}
```

Define `ApiKeyBanner` at the bottom of this file (or hoist to a sibling file if the component is already long — judgment call):

```tsx
const ApiKeyBanner = observer(function ApiKeyBanner() {
  const router = useRouterStore();
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12,
      padding: '8px 12px',
      marginBottom: 8,
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--panel)',
      color: 'var(--text-dim)',
      fontSize: 13,
      fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif',
    }}>
      <span>Add an API key to start chatting.</span>
      <button
        onClick={() => router.goMenu('api')}
        style={{
          padding: '4px 10px',
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'transparent',
          color: 'var(--accent)',
          cursor: 'pointer',
          fontSize: 12,
          fontFamily: 'inherit',
        }}
      >
        Open API settings
      </button>
    </div>
  );
});
```

The button calls `router.goMenu('api')` — `RouterStore.goMenu` already exists and accepts a `MenuSectionKey` (see `src/stores/RouterStore.ts:32`). Confirm `'api'` is a valid `MenuSectionKey` by reading `src/core/types.ts`; if the existing key is something different (e.g. `'apiKeys'`), use that string instead.

Add `useRouterStore` and `useProviderStore` imports alongside the existing store-hook imports at the top of the file.

**Step 5: Test the banner conditional**

Create `tests/components/editorial/EditorialComposer.test.ts` (or extend if it exists). Write a render test using the existing test patterns (look at `tests/components/editorial/EditorialMessage.test.ts` for the established style — it uses jsdom + the existing store-context pattern). At minimum:

```ts
it('shows the API-key banner when no provider is configured', () => {
  // build a RootStore (or just the stores Composer needs) with no provider keys
  // render <EditorialComposer ... /> within the store context
  // assert: banner text present
  // assert: send button shows disabled visual (opacity 0.45 or whatever the existing pattern uses)
});

it('hides the banner once a provider key is set', () => {
  // same, but call providerStore.setKey('openai', 'sk-test') after first render
  // re-flush mobx observers
  // assert: banner gone
  // assert: send button has full opacity
});
```

If the existing testing scaffold for this kind of multi-store component test doesn't exist, write a minimal fixture in the test file rather than building a full helper module.

**Step 6: Run tests + typecheck**

```bash
npm run typecheck
npm run test -- tests/components/editorial/EditorialComposer.test.ts
```

Expected: pass.

**Step 7: Manual verification (optional but recommended)**

```bash
npm run tauri:dev
```

Open DevTools → Application → Storage → clear `localStorage` → reload. Confirm:
- Banner visible above composer
- Send button greyed/disabled
- Click "Open API settings" → API menu opens
- Add a real key → close menu → banner disappears, send enables

If you skip manual verification, surface that in the report.

**Step 8: Commit**

```bash
git add src/components/editorial/EditorialComposer.tsx tests/components/editorial/EditorialComposer.test.ts
git commit -m "feat: disable send + show API-key banner when no provider configured"
```

---

### Task 3: Remove FakeProvider and the fake-fallback path

**Why:** Once Task 2 ships, `FakeProvider` is unreachable from the UI. Delete it so future contributors don't add new fallbacks to it. Per design: YAGNI.

**Files:**
- Delete: `src/services/llm/fake.ts`
- Modify: `src/services/llm/index.ts` (remove the `FakeProvider` export)
- Modify: `src/services/llm/router.ts` (remove `FakeProvider` import + registration + fallback logic)
- Modify: `src/core/llm.ts` (remove `'fake'` from `ProviderId`)
- Modify: `src/stores/ChatStore.ts` (remove the two `provider.id === 'fake'` checks)
- Delete: `tests/services/fakeProvider.test.ts`
- Modify: `tests/helpers/mockProvider.ts` (no longer use `'fake'` as its `ProviderId`)
- Modify: `tests/services/llmRouter.test.ts` (rewrite tests that asserted fake fallback behavior; the new `canRoute()` tests from Task 1 cover the no-provider case)
- Modify: `tests/services/tools.test.ts:146` (replace `modelId: 'fake'` with a real model id from `src/core/models.ts`)
- Modify: `tests/stores/toolLoop.test.ts:17` (the inline mock provider's `id`)

**Step 1: Identify all usages**

```bash
grep -rn "FakeProvider\|'fake'\|fake.ts" src tests --include='*.ts' --include='*.tsx'
```

Expected: a finite list. The plan above enumerates the call sites we know about. If grep finds more, surface them before making changes.

**Step 2: Delete `src/services/llm/fake.ts`**

```bash
git rm src/services/llm/fake.ts
```

**Step 3: Update `src/services/llm/index.ts`**

Remove the line `export { FakeProvider } from './fake';`.

**Step 4: Update `src/services/llm/router.ts`**

Remove:
- The `import { FakeProvider } from './fake';` line.
- The `fake: new FakeProvider(),` entry in `buildProviders` (line ~17).
- The `fallbackToFake` option on `RouterOptions` and the `if (fallbackToFake) { return { provider: this.providers.fake, ...` block in `resolve()` (lines ~78–82).
- The `model.providerId !== 'fake'` clause in the OR-fallback condition (line ~71).

`resolve()` becomes a function that may NOT have a viable provider. Two options:

(a) Throw `NoProviderConfiguredError` when no real provider is ready.
(b) Return a sentinel like `{ provider: null, providerModelId: '' }` and make callers check.

Pick **(a)** — it matches how `ChatStore.runTurn` already wraps `provider.stream` in `try/catch`. Define the error class in `src/services/llm/router.ts`:

```ts
export class NoProviderConfiguredError extends Error {
  constructor() {
    super('No API provider configured. Add an API key in Settings → API.');
    this.name = 'NoProviderConfiguredError';
  }
}
```

Throw from `resolve()` when neither the direct provider nor an OpenRouter slug is ready. The existing code path in `ChatStore.runTurn` will catch this and surface `lastError` — same as any other provider error.

Also: the `canRoute()` method from Task 1 must still work (`fake` is gone, so don't `continue` past it — just iterate). Update the loop:

```ts
canRoute(): boolean {
  return Object.values(this.providers).some(p => p.ready());
}
```

**Step 5: Update `src/core/llm.ts`**

Remove `'fake'` from the `ProviderId` union. The comment about "canned offline responses, used for dev / when no key is set" can go too.

**Step 6: Update `src/stores/ChatStore.ts`**

Remove the two `if (...provider.id === 'fake')` checks:
- Line ~552 in `compactToolResultWithModel`: the `fallbackToFake: false` option no longer exists; the corresponding null check is now "did `resolve()` throw?" — wrap it in try/catch and return null on `NoProviderConfiguredError`.
- Line ~611 in `maybeAutoName`: same treatment — wrap `resolve()` in try/catch, return early on error.

Also remove the `fallbackToFake: false` option in `pickCompactionModel` (line ~591) — it's no longer a valid option type.

**Step 7: Update tests**

- `tests/services/fakeProvider.test.ts`: `git rm` it.
- `tests/helpers/mockProvider.ts`: change `readonly id: ProviderId = 'fake'` → `readonly id: ProviderId = 'openai'` (it's just a stub, and the tests that use it inject it directly into stores — the id is essentially unused).
- `tests/services/llmRouter.test.ts`: any test that asserted `provider.id === 'fake'` after calling `resolve()` with no keys set should now assert `expect(() => router.resolve(...)).toThrow(NoProviderConfiguredError)`. Keep the `canRoute()` tests from Task 1.
- `tests/services/tools.test.ts:146`: change `modelId: 'fake'` to a real model id present in the test's registry. If the test set up its own registry, pick one from there; otherwise use `DEFAULT_MODEL_ID` from `src/core/models.ts`.
- `tests/stores/toolLoop.test.ts:17`: the inline mock provider's `id` — same treatment as `mockProvider.ts`. Use `'openai'` or whatever's already valid in that test's registry.

**Step 8: Run the full check**

```bash
npm run ci
```

Expected: typecheck + lint + tests all pass. If any test outside the enumerated list breaks, that test was relying on FakeProvider too — fix using the same patterns above.

**Step 9: Commit**

```bash
git add -A
git commit -m "feat: remove FakeProvider; route errors when no provider configured"
```

---

### Task 4: Remove seed.ts; ChatStore creates one empty thread on first run

**Why:** Last piece of the demo-mode feel. New installs land on one untitled thread (composer disabled per Task 2) instead of 11 fake threads.

**Files:**
- Delete: `src/core/seed.ts`
- Modify: `src/stores/ChatStore.ts` (constructor — replace `buildSeedThreads()` with `createThread()` semantics on cold start)
- Test: `tests/stores/ChatStore.test.ts` (existing — extend; if absent, the `tests/stores/` directory has the pattern)

**Step 1: Read current cold-start logic**

`ChatStore.ts:101–108`:
```ts
const snapshot = loadSnapshot();
if (snapshot) {
  this.threads = snapshot.threads;
  this.activeThreadId = snapshot.activeThreadId;
} else {
  this.threads = buildSeedThreads();
  this.activeThreadId = this.threads[0]?.id ?? null;
}
```

**Step 2: Write failing test**

In `tests/stores/ChatStore.test.ts`, add (or create the file with):

```ts
describe('ChatStore cold start', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('creates exactly one empty untitled thread when no snapshot exists', () => {
    const store = makeChatStore(); // existing helper or build a minimal one
    expect(store.threads).toHaveLength(1);
    expect(store.threads[0].messages).toEqual([]);
    expect(store.threads[0].title).toBe('New conversation');
    expect(store.activeThreadId).toBe(store.threads[0].id);
  });
});
```

`makeChatStore()`: if a helper already exists in this file or in `tests/helpers/`, reuse it. Otherwise build the minimum: `new ChatStore(providerStub, registryStub, profileStub)` — see `tests/services/tools.test.ts` or similar for the pattern. None of the stubs need to do anything for this test.

**Step 3: Run test, expect failure**

```bash
npm run test -- tests/stores/ChatStore.test.ts
```

Expected: fails with 11 threads (the seed threads) instead of 1.

**Step 4: Update `ChatStore` cold-start path**

Replace the `else` branch in the constructor:

```ts
} else {
  // First run / cleared storage: land in one empty untitled thread so the
  // user has somewhere to type. Composer is disabled by `hasUsableProvider`
  // until a key is configured.
  const now = Date.now();
  const id = newId('t');
  this.threads = [{
    id,
    title: 'New conversation',
    subtitle: '',
    createdAt: now,
    updatedAt: now,
    pinned: false,
    modelId: DEFAULT_MODEL_ID,
    messages: [],
  }];
  this.activeThreadId = id;
}
```

(We inline this rather than call `this.createThread()` because the constructor needs to set `threads` synchronously before `makeAutoObservable` runs. The shape is identical to what `createThread()` builds.)

Remove the import:
```ts
import { buildSeedThreads } from '../core/seed';
```

**Step 5: Delete the seed file**

```bash
git rm src/core/seed.ts
```

**Step 6: Run tests + typecheck**

```bash
npm run ci
```

Expected: clean pass. If anything else imported `seed.ts`, fix it (the grep from Task 3 step 1 already enumerated this — should be just ChatStore).

**Step 7: Manual verification**

```bash
npm run tauri:dev
```

DevTools → clear localStorage → reload. Confirm:
- Sidebar shows exactly one thread titled "New conversation"
- Main area shows empty thread + composer + banner
- Adding a key, then sending a message: thread auto-renames per existing logic (model-driven naming kicks in on first reply)

**Step 8: Commit**

```bash
git add -A
git commit -m "feat: start fresh with one empty thread instead of seed data"
```

---

### Task 5: Replace placeholder Tauri icons with brand artwork

**Why:** Installer currently ships with the default Tauri icons. User has the source PNG ready at `assets/icon-source.png`.

**Files:**
- Modify: every file under `src-tauri/icons/` (regenerated)

**Important:** The user already has uncommitted modifications to `src-tauri/icons/*` from prior icon experimentation. Confirm with the user before this task whether to:
- (a) Stage their existing modified icons as-is and skip the regen step (their work is already correct)
- (b) Re-run the regen from scratch (overwrites their work)

Default to **(a)** — don't overwrite their work. If after inspection the existing icons in the working tree match what `npx tauri icon assets/icon-source.png` would produce, just commit the existing tree.

**Step 1: Verify the source exists**

```bash
ls -la "C:/Users/et2bo/Desktop/Projects/GatesAI Chat/assets/icon-source.png"
```

Expected: file present, ~1024×1024 PNG.

**Step 2: Check working tree state**

```bash
git status --short -- src-tauri/icons/
```

If lots of icon files are already modified/untracked: those are the user's prior work. Inspect a couple visually (or check file sizes against typical Tauri-default sizes) to decide whether to keep them or regen.

**Step 3 (option A — keep existing): stage and verify**

```bash
git add -A src-tauri/icons/ assets/ scripts/build-icon.py public/favicon-*.png public/favicon.ico public/apple-touch-icon.png
```

Adjust the staged set to whatever the user actually has. Do NOT stage unrelated `index.html` / `src-tauri/Cargo.toml` modifications if they're present — those are out-of-scope and belong in a separate commit.

**Step 3 (option B — regen): run tauri icon**

```bash
cd "C:/Users/et2bo/Desktop/Projects/GatesAI Chat"
npx tauri icon assets/icon-source.png
git add -A src-tauri/icons/
```

This regenerates: `32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png`, all `Square*Logo.png`, `StoreLogo.png`, `icon.icns`, `icon.ico`, `icon.png`, plus `android/` and `ios/` subdirs.

**Step 4: Rebuild the installer + visually verify**

```bash
npm run tauri:build
```

Expected: build succeeds in ~2–3 min (cache warm). Output: `src-tauri/target/release/bundle/nsis/GatesAI Chat_0.1.0_x64-setup.exe`.

Open `src-tauri/target/release/gatesai-chat.exe` in File Explorer — preview pane should show the new icon. If still showing Tauri default: either the regen didn't update `icon.ico`, or Windows Explorer's icon cache is stale (run `ie4uinit.exe -show` or just trust the build and verify on the installed copy).

Run the installer. Confirm the Start menu shortcut and the running app's title bar both show the new icon.

**Step 5: Commit**

```bash
git commit -m "feat: replace placeholder Tauri icons with brand artwork"
```

If the user had unrelated favicon/asset work staged in the same commit, mention it in the commit body — those go together since they share the same source artwork.

---

### Task 6: Update changelog + final verification

**Files:**
- Modify: `docs/changelog.md`

**Step 1: Add changelog entry**

Read `docs/changelog.md` to match its format (see the existing 2026-04-25 desktop-app entry as a reference). Add an entry under today's date (or whatever the existing convention is):

```markdown
## 2026-04-25 — Fresh-install UX

Removed the demo-mode feel from a fresh install:
- No more 11 seed threads at first launch — users land in one empty
  untitled thread.
- No more fake responses when chatting without an API key — the
  composer is disabled and a banner above it links to the API
  settings panel until a real provider is configured.
- New installer ships with the brand icon instead of the Tauri
  placeholder.
```

**Step 2: Run full CI one more time**

```bash
npm run ci
```

Expected: clean.

**Step 3: Final manual smoke**

Install the latest installer on a clean profile (or clear localStorage). Walk through:
1. Open app → see one empty thread, banner, disabled send.
2. Click "Open API settings" → API menu opens.
3. Paste a real key → banner unmounts.
4. Send "hello" → real provider response streams.
5. Reload → state persists. Cold start created the thread once; subsequent runs use the saved snapshot.
6. Icons show correctly in title bar / taskbar / Start menu.

**Step 4: Commit**

```bash
git add docs/changelog.md
git commit -m "docs: log fresh-install UX changes"
```

---

## Verification gate before declaring done

- [ ] `npm run ci` clean (typecheck + lint + tests)
- [ ] Fresh-install behavior verified by clearing localStorage in dev mode AND by running the new installer
- [ ] No remaining references: `grep -rn "FakeProvider\|seed.ts\|buildSeedThreads" src tests` returns empty
- [ ] Brand icon visible in installer / Start menu / title bar
- [ ] Changelog updated
- [ ] All commits land cleanly on master (one per task)
