# Naming Decisions

This document records canonical naming decisions for GatesAI Chat. Names here are intended to keep one product concept represented by one code term.

## Canonical Terms

| Concept | Canonical name | Notes |
| --- | --- | --- |
| A chat conversation in the sidebar | `thread` | Use for persisted conversations and user navigation. |
| The assistant work timeline under a message | `activity` | Use for tool calls, bridge events, image-job progress, and streaming state rows. |
| Local file/runtime companion process | `bridge` | Use for GatesAI Bridge connectivity, workspace file access, terminal execution, and attachment reads. |
| User-facing local file namespace | `workspace` | Use for `/workspace/...` paths exposed to the model and user. |
| AI model vendor/access layer | `provider` | Use for OpenRouter/Ollama/API key configuration. |
| Selectable model entry | `model` | Use for catalog entries and thread model choices. |
| Long-term facts about the user | `user memory` | The current code still uses `profile`/`bio` in places; future cleanup should migrate private code toward memory language without changing persisted fields casually. |
| Durable user/model notes | `notes` | Separate from user memory. |
| Image generation configuration | `image generation` | Prefer the full phrase for exported TypeScript types; `image_generate` remains the model-facing tool name. |
| Queued or completed image render | `image job` | Use for queue/history records and chat cards. |

## Applied Decisions

| Current name | Canonical name | Scope | Risk | Decision |
| --- | --- | --- | --- | --- |
| `CardVariant` | `ImageJobCardVariant` | `src/components/editorial/ImageJobCard.tsx` | Private exported test helper | Applied. The old name was generic outside its image-job card domain. |
| `pickCardVariant` | `pickImageJobCardVariant` | `src/components/editorial/ImageJobCard.tsx`, `tests/components/editorial/ImageJobCard.test.ts` | Private exported test helper | Applied. The old verb did not identify that it chooses an image-job card render state. |
| `ProviderInfo` | `ApiProviderCardInfo` | `src/components/menu/sections/api/ProviderCard.tsx` | Private UI export | Applied. The old name sounded like a domain-wide provider contract but only describes this API settings card. |

## Deferred Candidates

| Current name | Proposed direction | Reason deferred |
| --- | --- | --- |
| `UserProfileStore`, `ProfileFacade`, `profile*` | `UserMemoryStore`, `MemoryFacade`, `memory*` | Wider blast radius and includes persisted `bio` language. Needs its own commit sequence and migration review. |
| `bio` | `memoryText` or `userMemoryText` | Persisted localStorage field. Do not rename without an explicit compatibility migration. |
| `ImageGenStore`, `ImageGenConfig`, `imageGen*` | `ImageGenerationStore`, `ImageGenerationConfig`, `imageGeneration*` | Medium-sized private export cleanup. Safe candidate for a later batch, but not mixed into this commit. |
| `CompletedJob` | `CompletedImageJob` | Touches image job store/storage files that currently have unrelated worktree edits. Deferred to avoid mixing ownership. |
| `ImageJobInput` | `ImageJobRequest` | Touches image job store files that currently have unrelated worktree edits. Deferred to avoid mixing ownership. |
| `Editorial*`, `components/editorial` | `Chat*`, `components/chat` | Large component/file rename with high review cost. Needs a dedicated structural commit sequence. |
| `pinned`, `autoNamed`, `naming`, `dynamic` | Predicate-style names such as `isPinned`, `hasAutoName`, `isNaming`, `isDynamic` | Persisted thread/model fields. Needs compatibility handling, not a pure private rename. |
