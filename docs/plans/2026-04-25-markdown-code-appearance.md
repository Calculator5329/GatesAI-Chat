# Markdown Code Appearance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a hybrid Appearance tweaker for assistant markdown and code output styles.

**Architecture:** Keep preference state in `UiStore`, persist it through `uiPrefsStorage`, and expose it as CSS classes/variables from the app root. `AppearanceSection` owns the controls and previews; markdown rendering remains in `EditorialMessage` and global `.md-body` styling.

**Tech Stack:** React 19, TypeScript, MobX, CSS variables/classes, Vitest.

---

### Task 1: Preference Model

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/services/uiPrefsStorage.ts`
- Modify: `src/stores/UiStore.ts`
- Test: `tests/services/uiPrefsStorage.test.ts`

**Steps:**
1. Add typed keys for `MarkdownStyleKey`, `CodeStyleKey`, `MarkdownDensityKey`, and `CodeSizeKey`.
2. Write failing persistence tests for defaults, saved values, and invalid fallback.
3. Extend `UiPrefsSnapshot`, validators, and `UiStore` setters.
4. Run the focused storage tests.

### Task 2: Runtime Styling

**Files:**
- Modify: `src/app/App.tsx`
- Modify: `src/index.css`

**Steps:**
1. Add app-root classes derived from the markdown/code preference keys.
2. Replace fixed `.md-body` spacing/code values with preset-aware selectors.
3. Keep existing `Editorial` defaults visually close to current behavior.

### Task 3: Appearance UI

**Files:**
- Modify: `src/components/menu/sections/Appearance.tsx`

**Steps:**
1. Add `Markdown` preset cards with live rendered-ish previews.
2. Add `Code blocks` preset cards with code previews.
3. Add compact advanced controls for markdown density and code size.
4. Keep the existing tool-call style picker intact.

### Task 4: Docs And Verification

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `docs/tech_spec.md`
- Modify: `docs/changelog.md`

**Steps:**
1. Mark the feature complete in the roadmap.
2. Document the new UI preference keys in the tech spec.
3. Add a changelog note.
4. Run focused tests, full tests, typecheck, lint, and lints for touched files.
