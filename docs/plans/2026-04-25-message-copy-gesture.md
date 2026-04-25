# Message Copy Gesture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a minimalist copy interaction for rendered chat messages without adding visible per-message chrome.

**Architecture:** Keep the behavior in the UI layer. `EditorialMessage` owns the gesture and feedback because both user and assistant turns render there; stores and services remain unchanged.

**Tech Stack:** React 19, TypeScript, Vitest, jsdom, browser Clipboard API.

---

### Task 1: Gesture Helper

**Files:**
- Create: `src/components/editorial/messageCopy.ts`
- Test: `tests/components/editorial/messageCopy.test.ts`

**Steps:**
1. Write a failing Vitest suite for copy eligibility.
2. Implement a small helper that accepts `{ metaKey, ctrlKey, button, hasSelection }`.
3. Require a primary-button click plus `ctrl` or `meta`.
4. Reject clicks while text is selected.
5. Run the focused test.

### Task 2: Message UI

**Files:**
- Modify: `src/components/editorial/EditorialMessage.tsx`
- Modify: `src/index.css`

**Steps:**
1. Wire `EditorialMessage` to copy `message.content` on eligible clicks.
2. Add a one-time hover/focus hint explaining `Ctrl/Cmd + click to copy`.
3. Show brief `Copied` / `Copy failed` feedback in the existing kicker row.
4. Keep the interaction accessible with `title`, `aria-label`, and keyboard-like focus behavior where practical.

### Task 3: Docs And Verification

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `docs/changelog.md`

**Steps:**
1. Mark the message copy gesture as completed in the roadmap.
2. Add a changelog entry describing the new minimalist gesture.
3. Run focused tests, typecheck, lint, and lints for edited files.
