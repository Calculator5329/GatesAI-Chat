# Inspect File Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build one read-only `inspect_file` tool that summarizes and queries CSV, JSON, and text files without sending full file contents into model context.

**Architecture:** Add a service-layer tool under `src/services/tools/inspectFile.ts`, register it in `ToolRegistry`, and keep raw file access inside the existing bridge `fs.read` boundary. The tool returns compact text summaries and selected slices for the model.

**Tech Stack:** TypeScript, existing `Tool` interface, bridge `fs.read`, Vitest.

---

### Task 1: Tool Tests

**Files:**
- Create: `tests/services/inspectFileTool.test.ts`

**Step 1: Write the failing tests**

Cover CSV profile, CSV extract, JSON profile, text line range extraction, and registry selection.

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/services/inspectFileTool.test.ts`

Expected: FAIL because `inspectFileTool` and registry wiring do not exist.

### Task 2: Minimal Tool Implementation

**Files:**
- Create: `src/services/tools/inspectFile.ts`
- Modify: `src/services/tools/types.ts`
- Modify: `src/services/tools/registry.ts`

**Step 1: Implement CSV, JSON, and text actions**

Add `profile`, `preview`, `search`, `extract`, and CSV `aggregate` with conservative defaults and row/line limits.

**Step 2: Register the tool**

Import and register `inspectFileTool`. Include it when the turn mentions files, CSV, JSON, text, data, attachments, or workspace.

**Step 3: Run focused tests**

Run: `npm run test -- tests/services/inspectFileTool.test.ts`

Expected: PASS.

### Task 3: Documentation

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `docs/tech_spec.md`
- Modify: `docs/changelog.md`

**Step 1: Update project docs**

Add `inspect_file` to the current tool catalog and mark the file-inspection capability as completed or in progress as appropriate.

**Step 2: Run verification**

Run: `npm run typecheck`
Run: `npm run test -- tests/services/inspectFileTool.test.ts`

Expected: both commands exit 0.
