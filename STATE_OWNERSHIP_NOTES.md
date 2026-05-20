# State Ownership Notes

## Decisions

- Cluster 4 starts with runtime status as the authority for Ollama availability. `OllamaStore.online` should derive from `LocalRuntimeStore.runtimes.ollama.status`, not from catalog refresh success or failure.
- A cached Ollama catalog is model metadata, not proof the runtime is currently reachable. Provider routing should require the runtime to be online.

## Deferred Items

- Persistence cleanup should be batched separately: workspace/localStorage authority, persistence trust-boundary parsing, and dead-code cleanup all touch `src/services/persistence.ts` and should share one design.
- Draft ownership is a product decision. Keep current global draft behavior until app-global versus per-thread drafts is decided.
- Route ownership (`URL` versus `activeThreadId`) is high risk and should get a dedicated test-first pass.

## Out-of-Scope Findings

- The full test suite passes but emits repeated MobX strict-mode warnings for `RouterStore.route` mutations in tests. This is residue for the route ownership/test hygiene pass, not part of Cluster 4.
- `src/stores/RootStore.ts` had unrelated dirty hunks while Cluster 4 was in progress. Stage only the Ollama availability line for this pass.
