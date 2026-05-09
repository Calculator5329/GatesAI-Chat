# Model Menu Favorites Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a top Favorites section, cost labels, and clearer provider grouping to the model picker.

**Architecture:** Keep menu organization as pure catalog logic outside React so ordering is testable and the UI remains presentation-only. Curated OpenRouter models should expose their underlying model vendor while retaining `providerId: 'openrouter'` for routing.

**Tech Stack:** React 19, TypeScript, MobX registry, Vitest.

---

### Task 1: Model Menu Organization

**Files:**
- Create: `src/core/modelMenu.ts`
- Test: `tests/core/modelMenu.test.ts`

**Step 1: Write the failing tests**

Add tests that assert:
- Favorites appear first in this exact order: Gemini 3 Flash, DeepSeek V4 Flash, GPT-5.5, Claude Opus 4.7, Gemini 3.1 Pro, Normal image — Flux 2 Klein.
- Non-favorite OpenRouter catalog entries are grouped by their underlying provider, with top providers ordered before the remaining catalog.

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/core/modelMenu.test.ts`
Expected: FAIL because `src/core/modelMenu.ts` does not exist yet.

**Step 3: Write minimal implementation**

Create a pure helper that returns sections from a `Model[]`:
- `Favorites`
- top provider groups: `Google`, `Anthropic`, `OpenAI`, `DeepSeek`, `xAI`
- remaining curated/local/dynamic groups by vendor

**Step 4: Run tests to verify they pass**

Run: `npm run test -- tests/core/modelMenu.test.ts`
Expected: PASS.

### Task 2: Render Favorites and Cost Labels

**Files:**
- Modify: `src/components/editorial/ModelPopover.tsx`
- Modify: `src/core/models.ts`

**Step 1: Add metadata**

Add UI metadata for favorite cost labels:
- Gemini 3 Flash: `$`
- DeepSeek V4 Flash: `$`
- GPT-5.5: `$$`
- Claude Opus 4.7: `$$$`
- Gemini 3.1 Pro: `$$`
- Normal image — Flux 2 Klein: `LOCAL`

**Step 2: Render grouped sections**

Replace local grouping logic in `ModelPopover` with the pure helper. Favorites should render first with a star icon in the section header. Favorite rows should not be duplicated in later sections.

**Step 3: Verify**

Run: `npm run test -- tests/core/modelMenu.test.ts tests/services/modelCatalog.test.ts`
Expected: PASS.

### Task 3: Documentation

**Files:**
- Modify: `docs/changelog.md`
- Modify if needed: `docs/architecture.md`

**Step 1: Update docs**

Record that the model picker now has favorite picks, cost labels, and provider-based OpenRouter organization.

**Step 2: Final verification**

Run: `npm run typecheck` and focused tests.
Expected: PASS.
