# Fresh-install UX Design

**Status:** approved, ready for implementation plan
**Date:** 2026-04-25

## Goal

Remove the demo-mode feel from a fresh install. Users land in a clean, empty state with one obvious next step (add an API key) instead of a populated-but-fake-looking app. Replace the placeholder Tauri icon with the existing brand icon at the same time.

## Context

After the Tauri desktop-app shipped (commits 9475c08 → 1619ede), running the installer for the first time produces a working window but two surprises:

1. The chat shows **eleven seed threads** (`src/core/seed.ts`) including one with a canned "OpenRouter gateway design" conversation pre-loaded. Looks fake.
2. Sending any message without a configured provider hits **`FakeProvider`** (`src/services/llm/fake.ts`) which streams one of four canned responses. Looks like demo mode.
3. The installer ships with **placeholder Tauri icons** (the default Tauri-generated set) instead of the existing brand artwork at `assets/icon-source.png`.

All three are first-impression issues for any new install. None of them are real users today (still pre-release), but every change after this carries them forward.

## Scope

Three product changes plus the icon swap, in one shippable plan.

### Change 1: Delete the seed-threads pathway

Remove `src/core/seed.ts` and the call sites that hydrate `ChatStore` with seed threads on empty-state init.

**New empty-state behavior:** when `ChatStore` boots and there are no persisted threads in localStorage, it auto-creates **one empty untitled thread** via the same code path the existing "+ New chat" button uses. The user lands in a thread, ready to type.

This is option (b) from brainstorming Q2. Zero-thread sidebars feel broken; one empty thread + a disabled composer + a banner is the cleanest landing state.

### Change 2: Delete the FakeProvider fallback

Remove `src/services/llm/fake.ts` and its registration in `src/services/llm/router.ts` / `src/services/llm/index.ts` (and any other call sites — `grep -rn "FakeProvider\|'fake'" src/`).

The router gains a single new exit branch: when no provider is usable (no API key on any registered provider AND Local has no base URL), it does NOT fall back to fake. Instead it should be **unreachable in normal use**, because Change 3 disables the send button before any message reaches the router. If it's reached anyway (defensive), throw a `NoProviderConfiguredError` and surface it as a toast or non-fatal error in the UI.

This is option (a) from brainstorming Q3. YAGNI — if a "demo mode" toggle is wanted later, it's a 30-line file to recreate.

### Change 3: Disabled-composer + persistent banner

Add a derived boolean to `ProviderStore` named `hasUsableProvider` (matching the existing pattern of `BridgeStore.isOnline`). It is true iff at least one registered provider is usable — has a non-empty API key, OR for `local`, has a non-empty `baseUrl`.

**Recommendation:** delegate the "is this provider usable?" check to the router. Have `RouterStore` (or `services/llm/router.ts`) export a `canRoute(): boolean` so the answer is computed in one place. `ProviderStore.hasUsableProvider` is then a thin wrapper. Avoids the bug class where the banner state and the router's actual routing decision drift apart.

**UI behavior:**

- When `hasUsableProvider === false`:
  - The composer's **send button is disabled**.
  - The textarea remains editable (user can type while finding their key).
  - A **persistent banner sits above the composer**:
    > "Add an API key to start chatting" — \[Open API settings\]
  - The button opens the existing API menu section (`src/components/menu/sections/Api.tsx`) — same target the in-menu API entry already routes to.
- When `hasUsableProvider === true`: banner unmounts, send button enables.

No banner animation, no toast. State change is instant when a key is added in settings.

This is option (a) from brainstorming Q1. Disabling the send button prevents the broken-feeling send-into-void of the inline-prompt approaches and avoids modal complexity.

### Change 4: Replace Tauri placeholder icons with brand artwork

User confirmed the source PNG already exists at `assets/icon-source.png` (1024×1024, RGBA, transparent corners outside the rounded square, content fills canvas with a small margin). It's the same file that's been feeding `npx tauri icon` already during prior icon experiments.

**Plan step:** run `npx tauri icon assets/icon-source.png` to regenerate the full icon set under `src-tauri/icons/` (PNG sizes + `.ico` for Windows + `.icns` for macOS). Commit the regenerated files. Rebuild the installer (`npm run tauri:build`) and visually confirm the icon appears in title bar / taskbar / Start menu.

For reproducibility, the build script that produces the source PNG from raw art lives at `scripts/build-icon.py` — re-run with `python scripts/build-icon.py && npx tauri icon assets/icon-source.png` if the source ever needs regenerating.

## Non-goals (explicitly excluded)

- **No first-run welcome screen** or onboarding tour. The empty thread + banner is the entire onboarding.
- **No localStorage migration** for users with existing seed threads. Only the developer's dev profile is affected; clear manually with `localStorage.clear()` in DevTools after the change lands. (Brainstorming Q4 option a.)
- **No demo-mode toggle** for screenshots / shareable demos. Defer until actually needed.
- **No multi-provider auto-suggest** ("we recommend OpenRouter"). The existing API settings panel already lists providers — that's the right place for that copy if it's wanted later.
- **No telemetry / analytics** on first-run conversion. Out of scope.

## Architecture summary

```
ProviderStore.hasUsableProvider  (derived getter)
  └─ delegates to RouterStore.canRoute() / services/llm/router.ts
       └─ true iff any registered provider has key OR local has baseUrl

EditorialComposer (or wherever the send button lives)
  └─ reads ProviderStore.hasUsableProvider via store context
       ├─ disables send button when false
       └─ renders <ApiKeyBanner /> above itself when false

ChatStore.init()
  └─ if no persisted threads: createUntitledThread() (one)
  └─ else: load persisted threads as before
  (no seed.ts import, no buildSeedThreads call)

services/llm/router.ts
  └─ FakeProvider import/registration removed
  └─ canRoute() exported
  └─ if !canRoute() and a request slips through: throw NoProviderConfiguredError
```

## Risks

1. **`canRoute()` correctness drift:** if the router's "do I have a usable provider?" logic and the banner's state ever disagree, the user sees an enabled send button that fails on send (or vice versa). Mitigation: single source of truth, one function, both consumers read from it.
2. **Stale UI assumptions:** ModelPopover, ModelRegistry, and other components currently assume a current model exists. Audit before merging — search for `currentModel`, `selectedProvider`, etc. and ensure null safety on the no-provider path.
3. **Test breakage:** if any test imports `FakeProvider` or `seed.ts`, it breaks at compile. Search and replace with test-local stubs (or delete the test if it was only validating demo behavior).
4. **Existing localStorage on developer machines:** post-merge, the developer (you) will still see the old seed threads until manually cleared. Plan should call this out as a verification step ("clear localStorage to confirm fresh-install behavior").

## Verification

After implementation:

1. Clear localStorage in the Tauri dev window (or run on a clean machine). Reload → see exactly one empty untitled thread in the sidebar, the composer area shows the banner above a disabled send button.
2. Click "Open API settings" in the banner → API menu opens.
3. Add a real API key (e.g. OpenRouter), close the menu → banner unmounts, send button enables.
4. Send a message → real provider response streams.
5. Confirm files removed: `git ls-files | grep -E "(fake|seed)\\.ts"` returns nothing.
6. Run `npm run ci` (typecheck + lint + test). Fix any breakages from removed imports.
7. Run `npx tauri icon assets/icon-source.png` → confirm `src-tauri/icons/` updated.
8. Build a fresh installer: `npm run tauri:build`. Install and launch. Confirm the brand icon appears in title bar, taskbar, and Start menu shortcut.

## Open questions

None. All Q1–Q5 resolved during brainstorming. Ready to convert to implementation plan.
