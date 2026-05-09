# Performance Pass — May 2026

Goal: eliminate >50ms interactions. Order of execution = order of ROI. All file paths relative to repo root.

## Phase 1 — Streaming hot path

**Problem:** During assistant streaming, the entire react-markdown + rehype-highlight + rehype-katex tree re-parses on every ~48-char token flush. Auto-scroll fires every flush. Off-screen messages still paint.

**Tasks:**

1. **Memoize `MarkdownBody` by content** in `src/components/editorial/EditorialMessage.tsx`. Wrap the rendered markdown subtree in `React.memo` keyed on the content string. React Compiler may already help; verify with profiler before/after.
2. **Chunk markdown by paragraph boundaries** so only the trailing chunk re-parses while streaming. Split `message.content` on `\n\n` (preserving stable indices); render each chunk as a memoized `<MarkdownChunk content={chunk} />`. Closed chunks never re-render.
3. **Stop auto-scroll on every token** in `src/components/editorial/EditorialChat.tsx`. Replace the `messages.length`-triggered scroll with: scroll on new message arrival AND only when the user is within ~100px of the bottom (sticky-bottom behavior). Use a ref to track "user scrolled away" state.
4. **Add `content-visibility: auto`** + `contain: layout style paint` to message rows in the chat CSS. Off-screen messages skip render/paint.

**Acceptance:** Streaming a 2KB response shows visibly fewer paints in DevTools. Auto-scroll doesn't fight a user who scrolled up.

## Phase 2 — Keystroke cascade

**Problem:** Each keystroke in the composer fires `ui.setDraft` → ContextMeter observers → `chat.tokenUsage(draft)` (expensive: flattens messages, builds tool defs, composes system prompt). Inline style objects re-create on every render. Textarea autoresize does sync DOM read+write per char. User confirmed 120ms staleness on token count is fine.

**Tasks:**

1. **Decouple textarea visual value from store.** Use local `useState` for the textarea string; mirror to `ui.setDraft` via a 120ms debounce. Visual typing stays instant; observers fire at 8fps.
2. **Memoize `tokenUsage`** in `src/stores/ChatStore.ts` as a MobX `computed` keyed on (debounced draft, threadId, modelId). Keep the existing method but add a `computed` wrapper that ContextMeter consumes.
3. **Replace JS textarea autoresize with CSS `field-sizing: content`** in `EditorialComposer.tsx`. Fall back to a rAF-batched height update only if the browser doesn't support it (caniuse: 2024+ all majors).
4. **Hoist inline style objects** in `EditorialComposer.tsx` (the `labelStyle` etc.) and `ModelPopover.tsx` (`ModelRow` style props). Move to module-scope constants or CSS classes. Wrap `ModelRow` in `React.memo`.
5. **Replace direct DOM mutation in AttachButton** (`onMouseEnter` style.background) with CSS `:hover`.

**Acceptance:** Typing in composer shows no MobX reactions firing per keystroke in profiler — only every ~120ms. ModelPopover scroll is smooth at 60fps with full model list.

## Phase 3 — Storage & I/O

**Problem:** UiStore localStorage save runs on every pref mutation. Large snapshot writes block the main thread.

**Tasks:**

1. **Debounce `saveUiPrefs` autorun** in `src/services/uiPrefsStorage.ts` (or wherever the autorun lives) to 500ms trailing.
2. **Confirm ChatStore snapshot save** is already throttled to 250ms — if not, fix; if yes, leave alone.
3. **Async snapshot persistence:** wrap `localStorage.setItem` for the chat snapshot in a `queueMicrotask` or `setTimeout(0)` so the JSON.stringify + write doesn't block the streaming token flush that triggered it.
4. **Skip the redundant emergency-save fallback** unless the primary throws QuotaExceededError. Currently it appears unconditional; verify and tighten.

(No Web Worker — out of scope per user.)

**Acceptance:** No long tasks >50ms attributable to localStorage writes during streaming.

## Phase 4 — Bundle & lazy load

**Problem:** highlight.js (~120KB) and katex (~56KB) are imported eagerly even on first paint when no code/math is on screen.

**Tasks:**

1. **Dynamic-import `rehype-highlight`** in `EditorialMessage.tsx` / `MarkdownBody`. Render markdown without highlight on first pass; swap in highlight plugin once loaded. Use `React.lazy` or a top-level `import()` resolved into module state.
2. **Dynamic-import `rehype-katex` + katex CSS** the same way, only when math syntax is detected in content (cheap regex `\$[^$]+\$|\\\(`).
3. **Audit menu sections** in `src/components/menu/sections/` — lazy-load Local section (image gen UI) since it's not on the critical path.
4. **Verify Vite chunking:** add manual `rollupOptions.output.manualChunks` if the above produces awkward chunks. Confirm bundle analyzer (or `vite build --mode=analyze`) shows the split.

**Acceptance:** Initial JS payload drops by >150KB on a fresh load with no code blocks.

## Phase 5 — Perceived perf polish

**Tasks:**

1. **Skeleton bubble** for assistant messages: render an empty bubble with a shimmer/typing indicator the moment the user sends, before first token arrives.
2. **Optimistic user-message append:** the user's message appears in the thread *before* the network round-trip; if send fails, mark with retry affordance. (Confirm current behavior — likely already optimistic; if so, polish the visual transition only.)
3. **View Transitions API on thread switch:** wrap `RootStore.setActiveThread` (or its UI caller) in `document.startViewTransition(() => …)` if supported. Fade/slide between threads instead of hard swap.
4. **Subtle keystroke ack:** a 1px border-color shift on the composer wrapper when the textarea is focused + non-empty. Pure CSS, zero JS.

**Acceptance:** Subjective — sending feels instant; thread switch feels fluid.

## Out of scope (this pass)

- Chat list virtualization (Phase 6 in original brainstorm) — deferred, `content-visibility: auto` is enough for now.
- Web Worker for JSON/base64 — too much new infra.
- IndexedDB migration — deferred.

## Execution

Subagent-driven: one implementer per phase, two-stage review (spec then code quality) per phase, final review at end. Each phase commits independently so we can bisect regressions.
