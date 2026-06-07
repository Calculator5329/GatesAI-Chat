# Naming Cleanup Notes

## 2026-05-20 - Private UI Helper Names

### Decisions

- Renamed `CardVariant` to `ImageJobCardVariant` because the type describes render variants for `ImageJobCard`, not card variants across the design system.
- Renamed `pickCardVariant` to `pickImageJobCardVariant` because the helper reads an `ImageJob | CompletedJob | null` and returns an image-job card render state.
- Renamed `ProviderInfo` to `ApiProviderCardInfo` because the interface is local to the API settings card and should not imply a provider-domain contract.
- Kept persisted names and model-facing tool names unchanged. This pass is a private TypeScript naming cleanup with no behavior change.

### Refactor Method

- Used the TypeScript language service `findRenameLocations` to compute and apply code identifier renames.
- Manual edits were limited to test display text and documentation/audit files.

### Validation Baseline

- `npm test` passed before changes.
- `npm run build` passed before changes.
- Existing test output includes repeated MobX strict-mode warnings about `RouterStore.route` mutations. This pass did not investigate or change those warnings.
- Existing production build emits Vite large-chunk warnings. This pass did not investigate or change chunking.

### Post-change Validation

- `npm run build` passed after changes.
- `npm test -- tests/components/editorial/ImageJobCard.test.ts tests/components/menu/GatesMenu.test.ts` passed after changes.
- A full `npm test` run executed in parallel with the build returned exit code 1 while the visible output was dominated by existing warnings; rerunning the full suite with `npm test -- --reporter=dot` passed. I treated the first result as a validation flake caused by noisy parallel execution, not as product behavior evidence.

### Deferred

- `CompletedJob` and `ImageJobInput` are good names to tighten later, but their usages touch image job store/storage files already modified in the worktree.
- `UserProfileStore`/`profile`/`bio` should be treated as a memory-language migration. The `bio` field is persisted and should not be renamed without compatibility handling.
- `ImageGen*` should move toward `ImageGeneration*` in a separate commit.
- `Editorial*` names likely mean "chat surface" now, but component/file moves need their own high-blast-radius plan and validation.
