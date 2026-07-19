# Follow-up source dispatch — Share thread as single-file HTML

This roadmap item requires source changes. Execute the task below after reading
[DESIGN.md](./DESIGN.md) and [EXECUTION.md](./EXECUTION.md).

## Task spec

- **title:** Share thread as single-file HTML
- **model tier:** smart
- **goal:** |
  Implement approved thread-share export behavior so users can export a selected
  thread as a standalone HTML file. The exported file must be generated from a
  pure renderer (no external fetches), include complete transcript context and
  metadata, and be copy/download-able from thread actions in the sidebar (and
  optionally from command palette for discoverability). Preserve existing chat
  persistence (`/workspace/chat-history`) behavior.

  Success behavior:
  - clicking **Share as HTML** on a thread generates a valid single-file HTML
    document for that same thread.
  - with clipboard write available: HTML content is copied, and user gets a success
    signal.
  - without clipboard write: generated file is downloaded with filename pattern
    `gatesai-thread-<slug>-<thread-id>.html`.
  - exported HTML renders without requiring app JS/runtime or bridge calls.

- **depends on:** none
- **owns:**
  - `src/services/chat/threadShare.ts` (new)
  - `src/stores/ChatStore.ts` (or `src/stores/RootStore.ts`, whichever owns active thread orchestration)
  - `src/components/editorial/EditorialSidebar.tsx`
  - `src/components/palette/CommandPalette.tsx` (optional)
  - `tests/services/chat/threadShare.test.ts` (or `tests/services/chat/libraryExport.test.ts` if implemented there)
  - `tests/components/editorial/EditorialSidebar.test.ts`
  - `tests/components/palette/CommandPalette.test.ts`
- **test-cmd:**

  ```sh
  npm run ci && npx vitest run \
    tests/services/chat/libraryExport.test.ts \
    tests/services/workspaceChatPersistence.test.ts \
    tests/components/editorial/EditorialSidebar.test.ts \
    tests/components/palette/CommandPalette.test.ts
  ```

  plus `npm run test:e2e` with an outside-sandbox verifier (Playwright port
  binding requirement).

## Acceptance

- One explicit thread action generates and shares exactly the selected thread.
- Generated HTML is a single file and can be opened stand-alone.
- Clipboard copy and download fallback paths are both test-covered.
- No regression to chat-library persistence/rendering.
- No external network/font/script dependency is introduced in the generated
  export.
