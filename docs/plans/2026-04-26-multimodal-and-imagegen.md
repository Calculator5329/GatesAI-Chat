# Multimodal + Image Generation Plan

> Owner: self. Status: Phase 1 complete (2026-04-26). Phase 2 next.
> Track in `docs/roadmap.md` under Near-term; update `docs/changelog.md` at each phase boundary.

## Goal

Add three capabilities, cloud and local alike, landing on the same foundation:

1. **Vision input** — user attaches an image, the model sees it. Cloud (Claude/GPT/Gemini) and local (Ollama vision models, LM Studio).
2. **Image generation** — FLUX 2.0 via fal.ai (first), optionally via a local ComfyUI or A1111/Forge backend.
3. **Local LLM polish** — model discovery / presets for Ollama & LM Studio, opportunistic.

## Design principles

- **Content parts live at the wire boundary, not in `Message`.** `Message.content` stays a string; image refs live alongside in a formalized `Message.attachments?: MessageAttachmentRef[]` field. Provider adapters stitch them into multimodal content just before send. This keeps every bit of markdown rendering, copy, compaction, and test code that currently does `m.content.trim()` untouched.
- **References, not bytes, in state.** Attachments reference workspace paths. Bytes are fetched on-demand at send time via `fs.read` with `encoding: base64`. Avoids megabytes of base64 in MobX + localStorage.
- **Capabilities gate UI, not protocol.** A `supportsVision` flag on `ModelInfo` decides whether the composer offers image attachments. When a vision-incapable model is selected, we fall back to the existing text-attachment footer behavior.
- **Same tool, swappable backend.** `image_generate` is one tool with a `backend` setting (`fal`, `bfl`, `local-comfy`, `local-a1111`). The model never sees the backend choice. This keeps local and cloud as a config toggle, not a second tool.
- **Vision first, image gen second.** Vision is lower-risk, higher-impact, and its content-parts plumbing is reused for inline rendering of generated images later.

---

## Phase 1 — Vision (cloud + local)

**Estimate:** 1–1.5 days.

### Phase 1 Task 1 — Formalize `Message.attachments`

Files:
- Modify `src/core/types.ts` — add structured attachment ref to `Message`.
- Modify `src/core/attachments.ts` — migrate readers off footer parsing where we own the data; keep `splitAttachmentFooter` for legacy/persisted messages.
- Modify `src/stores/ChatStore.ts` — populate `attachments` when sending.

Shape:

```ts
export interface MessageAttachmentRef {
  /** Workspace-relative path like `/workspace/attachments/img-xyz.png`. */
  path: string;
  /** Short display name, already split from the path. */
  name: string;
  /** MIME type reported by the bridge at upload. */
  mime: string;
  /** Bytes as reported by the bridge. */
  size: number;
}

interface Message {
  // ...existing fields...
  attachments?: MessageAttachmentRef[];
}
```

Acceptance: user messages with attachments now carry `attachments` alongside the existing footer; existing persisted threads still render correctly via `splitAttachmentFooter` fallback.

### Phase 1 Task 2 — `readAttachmentBytes` helper

Files:
- Create `src/services/bridge/readAttachmentBytes.ts` — reads `{ bytes, mime }` from a workspace path via `fs.read { encoding: 'base64' }`.
- Tests: `tests/services/readAttachmentBytes.test.ts` mocks bridge, asserts base64 round-trip.

Surface:

```ts
export async function readAttachmentBase64(
  bridge: BridgeStore,
  workspacePath: string,
): Promise<{ base64: string; mime: string } | null>;
```

Returns `null` on bridge-offline / missing file instead of throwing, so provider adapters can fall back to text-only gracefully.

### Phase 1 Task 3 — Content parts at the wire boundary

Files:
- Modify `src/core/llm.ts` — extend the internal provider message type to carry optional `images: ImagePart[]` alongside `content: string`.
- Modify `src/services/llm/openaiCompat.ts` — build OpenAI/GPT/OpenRouter/local multimodal content array.
- Modify `src/services/llm/anthropic.ts` — Claude `image` blocks (`source.type: "base64"`).
- Modify `src/services/llm/gemini.ts` — `inlineData` part.
- Add tests per adapter: snapshot the wire payload for `{text + one image}`.

Each adapter resolves images by calling `readAttachmentBase64(bridge, ref.path)` in the pre-send step. The base64 fetch happens per-turn, not per-message — only the current `LlmRequest.messages` list is resolved.

### Phase 1 Task 4 — `supportsVision` capability

Files:
- Modify `src/core/models.ts` — add `supportsVision?: boolean` to `ModelInfo`; mark known vision models.
- Modify `src/stores/ModelRegistry.ts` — surface the flag through the registry selector.
- Modify `src/components/editorial/EditorialComposer.tsx` — attach-image affordance is visible only when `supportsVision`.

Vision-capable today:
- Claude 3 family + 3.5 + 4.x (all).
- GPT-4o, GPT-4.1, GPT-5 family, o1/o3/o4.
- Gemini 1.5+, 2.x, 3.x (all non-TTS variants).
- Local: `llava`, `qwen2.5vl`, `minicpm-v`, `llama3.2-vision`, `internvl` — detected by name pattern since model discovery returns just ID.

### Phase 1 Task 5 — UI rendering

Files:
- Modify `src/components/editorial/EditorialMessage.tsx` — user message renders actual image thumbnails in attachment chips, not just MIME/size.
- Add `src/components/editorial/WorkspaceImage.tsx` — small component that fetches bytes once via `readAttachmentBase64` and renders a constrained `<img>`.
- Optional follow-on: assistant messages render image content parts inline once Phase 2 produces them.

Acceptance: drag an image into the composer → preview chip shows thumbnail → send → sent message shows same thumbnail → vision model responds referring to image content.

### Phase 1 Task 6 — Tests + docs

Files:
- `tests/core/messageAttachments.test.ts` — round-trip user message with attachments through serialization.
- `tests/services/llm/*Vision.test.ts` — per-provider wire format snapshot.
- Modify `docs/roadmap.md` — tick Phase 1.
- Modify `docs/changelog.md` — add entry.
- Modify `docs/tech_spec.md` — document the attachments field + capability flag.

---

## Phase 2 — Image generation via fal.ai (cloud, FLUX 2.0)

**Estimate:** 1 day.

### Phase 2 Task 1 — Settings

Files:
- Modify `src/components/menu/sections/Api.tsx` — new "Image generation" section with fal/BFL key fields.
- Modify `src/stores/ProviderStore.ts` (or a new `ImageGenStore`) to persist keys. Decide at implementation time based on whether image-gen is really "another provider" or stands apart.

### Phase 2 Task 2 — Service client

Files:
- Create `src/services/image/fluxClient.ts` — `generateImage({prompt, aspectRatio, seed?, variant}): Promise<{base64, mime}>`.
- Tests: mock fetch, verify request shape.

fal.ai endpoint (v1): `POST https://fal.run/fal-ai/flux-pro/v1.1` (or `/fal-ai/flux/v2` when available). Returns `{images: [{url}]}` synchronously for fast variants; for slower variants, a polling URL.

### Phase 2 Task 3 — `image_generate` tool

Files:
- Create `src/services/tools/imageGenerate.ts` — the tool.
- Register it alongside `inspect_file` in the tool registry. Only included in the harness when the user's turn looks image-generation-shaped ("draw", "generate image", "make a picture", etc.) OR when the user explicitly enables it.

Contract:

```ts
{
  name: 'image_generate',
  parameters: {
    prompt: string,
    aspect_ratio?: '1:1' | '3:2' | '2:3' | '16:9' | '9:16',
    variant?: 'flux-2-pro' | 'flux-2-flex' | 'flux-2-dev',
    filename?: string,
  }
}
```

Returns: `Saved: /workspace/artifacts/<filename>.png (<width>x<height>, seed=<n>)`.

Side effect: writes base64 bytes through `fs.write` so the artifact lands in the same workspace the bridge already manages. The clickable-path link from the previous session means the user can click the path to open it in a browser.

### Phase 2 Task 4 — Inline rendering

Files:
- Modify `EditorialMessage.tsx` — when a tool result looks like an image artifact (mime `image/*`, path under `/workspace/artifacts/`), render an inline preview below the tool line.

### Phase 2 Task 5 — Tests + docs

- Fake-fetch client test, tool contract test, integration smoke test (gated behind API key env var).
- Changelog + roadmap.

---

## Phase 3 — Local image generation

**Estimate:** 0.5–1 day.

Same `image_generate` tool; add backend implementations:

- `src/services/image/comfyClient.ts` — POST workflow JSON → poll `/history/<prompt_id>` → GET `/view`. Workflow JSON lives as a template with the prompt slotted in.
- `src/services/image/a1111Client.ts` — `POST /sdapi/v1/txt2img` → base64 images. Simpler, fewer knobs.

Settings panel gains a "Backend" dropdown: `fal` | `bfl` | `local-comfy` | `local-a1111`. The tool's schema doesn't change; the backend selector is a silent routing decision.

Fallback: if `local-*` fails (server offline, out of VRAM, model not loaded), auto-fall-back to the configured cloud backend with a small warning line in the tool result.

---

## Risks / open questions

- **Token budgeting for images.** Vision tokens are not currently counted by the compactor. Decision: either (a) add a fixed per-image cost in `core/tokens.ts` or (b) fetch the provider's reported usage from each response. Start with (a), revisit if inaccurate.
- **Persisted base64.** We must not persist image bytes into thread history; store refs only. Verify before merging Phase 1.
- **Local vision model detection.** Name pattern matching is brittle. Acceptable for v1; the /v1/models polish in the local-LLM side-track can later return capability metadata from Ollama's `/api/show`.
- **fal.ai cost controls.** Flux 2 pro is ~$0.06/image. Add a confirmation when daily count exceeds a small threshold (e.g. 10). Do this in Phase 2 Task 4.
- **Safety flags.** fal and BFL return NSFW / safety metadata. Surface as a quiet badge on the generated artifact; don't block by default.

## Verification checklist (per phase)

Phase 1:
- [x] `npm run typecheck` green.
- [x] `npm run test` green (201/201 — new `modelCapabilities`, `resolveImages`, `vision`, and extended `attachments`, `BridgeStore` suites).
- [ ] Manual: attach PNG → Claude describes it; same with GPT-4o, Gemini Flash, Ollama `llava:13b`. *(pending live-provider smoke test)*
- [x] Attachment of non-image file still works (legacy footer still rendered, structured ref still emitted, no vision bytes spent).

Phase 2:
- [x] Typecheck + tests green (211/211 — new `fluxClient` and `imageGenerate` suites).
- [ ] Manual: "draw a raccoon in a tuxedo" → artifact appears in `/workspace/artifacts/` → click opens in browser → inline preview below the tool line. *(pending live fal.ai smoke test with a real key)*
- [x] Rate-limit / error handling: `FluxClient` surfaces the fal response body + status code in the thrown `Error`; the `image_generate` tool catches it and returns a model-readable `Error generating image: fal 429 Too Many Requests: ...` string instead of throwing up the stack.

**Implementation notes:**
- `ImageGenStore` lives in `src/stores/ImageGenStore.ts`, backed by `src/services/imageGenStorage.ts` under `gatesai.imagegen.v1`.
- `FluxClient` in `src/services/image/fluxClient.ts` uses fal.ai's synchronous `fal.run/<model>` endpoints. Aspect ratios map to concrete `image_size` dims so variant slugs don't also have to carry geometry.
- Tool registered in `registry.ts` with intent-keyword gating (`draw`, `render`, `generate image`, `flux`, etc.) so the toolset for non-image-shaped turns stays small.
- Inline preview piggy-backs on `EditorialMessage`'s tool-result rendering — a regex extracts the `/workspace/artifacts/<file>.(png|jpg|webp|gif)` path and renders a `WorkspaceImage` thumbnail right below the `ToolResultView`.

Phase 3:
- [x] Typecheck + tests green (229/229 — new `a1111Client`, `comfyClient`, `imageBackend` suites).
- [ ] Manual: ComfyUI running locally → tool produces the same artifact shape. *(pending live smoke test)*
- [x] Offline fallback: dispatcher routes `local-*` failures to configured cloud fallback with a note; cloud primaries never auto-fall-back; double-failure reports both errors.

**Implementation notes:**
- Shared `ImageBackend` interface in `src/services/image/types.ts`. Three concrete implementations: `FluxClient` (existing, refactored to share helpers), `A1111Client`, `ComfyClient`.
- `dispatchImageGenerate` is the tool's only entry into the image layer — keeps the tool decoupled from which backends exist.
- ComfyUI workflows are user-replaceable via `{{PROMPT}}`/`{{WIDTH}}`/`{{HEIGHT}}`/`{{SEED}}` token substitution against a JSON template the user drops into `/workspace/` and points the setting at. Default = minimal SDXL base workflow (works with any `sd_xl_base_1.0.safetensors` install).
- Bundling: client bundles into the `.exe` trivially. Local Python + model weights (several GB each) do not — future work is a first-run installer that fetches ComfyUI into `~/GatesAI/comfyui/` and boots it as a sidecar alongside the bridge.

## Out of scope (this plan)

- Image editing (inpainting, instruct-pix2pix) — easy follow-on but separate tool.
- Audio in/out (whisper, TTS) — separate plan.
- Multi-image messages (>1 image per user turn) — trivially supported by the type shape, UI polish deferred.
