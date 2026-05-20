# Import And Bundle Cleanup Notes

## Operating Decisions

- Analyzer tooling is required before bundle/import cleanup. The repo now has `npm run analyze`, which runs `vite build --mode analyze --sourcemap` and emits `dist/bundle-analysis.html` plus `dist/bundle-analysis.json`.
- Normal builds do not emit visualizer reports. Visualizer plugins are enabled only when Vite mode is `analyze`.
- UI barrel removal is intentionally skipped for this pass. `src/components/ui/index.ts` re-exports side-effect-free ESM UI modules, and current call sites import named symbols. Vite/Rollup should tree-shake this pattern; changing call sites would add noise without measured savings.
- Utility consolidation is not automatically valuable. Two behaviorally safe candidates were tested and reverted because measured bundle output did not improve:
  - `formatSize`: sharing moved code into a common module, slightly reduced `Workspace` but increased the main chunk.
  - `truncate`: sharing introduced a new tool helper module and slightly increased the main chunk.
- Non-equivalent utility lookalikes remain local by design:
  - `formatBytes` differs in invalid-value handling, spacing, and rounding.
  - Slugging helpers differ in separator, allowed characters, max length, and fallback.
  - `formatResult` helpers differ in command framing and output stream formatting.

## Baseline Bundle Findings

Captured with `npm run analyze`.

- Main chunk: about 588 KB raw, about 178 KB gzip.
- `MarkdownChunk`: about 9.93 KB raw, about 3.94 KB gzip.
- `ActivityMarkdown`: about 0.40 KB raw, about 0.31 KB gzip.
- `rehype-highlight`: about 163 KB raw, about 51 KB gzip. This is already lazy-loaded.
- `katex`: about 257 KB raw, about 76 KB gzip. This is already lazy-loaded.
- Mermaid-related chunks dominate lazy payload size, including parser/Cytoscape chunks. Mermaid is already dynamically imported from `MermaidDiagram`.
- `@tauri-apps/api/core` contributed about 76 rendered bytes to the main chunk in the analyzed build. The bigger client-reachable costs are app/tool modules around it, not the package import itself.

## Markdown Investigation

- `ActivityMarkdown` independently imports `react-markdown` and `remark-gfm`, but analyzer output shows the activity wrapper chunk is tiny.
- The real markdown cost is already concentrated in shared chunks and the lazy `MarkdownChunk` path.
- Consolidating `ActivityMarkdown` into `MarkdownChunk` would likely remove only a tiny wrapper while changing renderer behavior for activity details. Deferred unless a future profiler or bundle report shows activity markdown is a meaningful hotspot.
- Do not lazy-load `react-markdown` deeper inside `MarkdownChunk` without measuring first. Assistant messages need markdown on normal render, and the existing component is already code-split from the main app.

## Tauri Adapter Split Investigation

- Static client paths to Tauri-adjacent code still exist through stores and tools, but measured `@tauri-apps/api/core` footprint is tiny.
- `sourceWorkspace` and `sourceBuild` service implementations are already dynamically imported by their tool wrappers.
- A broad adapter split would touch dirty high-blast-radius store and service files. Deferred until there is a measured target and a clean base.
- Preferred future strategies, in order:
  - Move desktop-only execution bodies behind dynamic imports while keeping type-only imports in shared modules.
  - Keep tool definitions in the main graph only when the model needs their schemas up front; move desktop execution implementations out of the main graph.
  - Consider separate desktop/web-lite entrypoints only if dynamic imports fail to produce measurable chunk reductions.

## Deferred Items

- Investigate `OpenRouterCompatibilityStore`: analyzer previously warned that `openRouterCompatibility.ts` was both dynamically and statically imported, making the dynamic import ineffective. Current local changes already appear to separate targets/types, so review after that work lands.
- Review Mermaid payload only if diagram rendering becomes a priority. The payload is large, but already lazy and only paid for mermaid code fences.
- Keep utility lookalikes local unless a domain-language pass explicitly decides to normalize behavior.

## Validation Notes

- `npm run analyze` succeeded after analyzer setup.
- Full typecheck was not used as the analyzer gate because the working tree already had unrelated TypeScript errors in `src/services/persistence.ts` during the initial strict attempt. Do not treat analyzer success as typecheck success.
- Future cleanup commits should include per-chunk before/after raw and gzip deltas from `dist/bundle-analysis.json`.
