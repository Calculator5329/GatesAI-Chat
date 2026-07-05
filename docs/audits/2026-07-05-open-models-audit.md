# Open-models-first screen audit — 2026-07-05

Lens: **"What do I do if I'm running open/local models only?"** (no OpenRouter key, Ollama for
LLMs + embeddings, ComfyUI for images). Reviewed against the committed `docs/screens/` corpus
plus source. Direction confirmed with the product owner: **simpler is better — Ollama is THE
local LLM runtime** (no multi-runtime sprawl), ComfyUI for images, embeddings first-class.

## Verdict
The local plumbing is genuinely first-class (Local menu manage/start/logs, availability gating,
Ollama tool allowlists, local $0 usage, Ollama-powered semantic memory). The **framing and
defaults are API-first**: a keyless local user meets a cloud default model, an all-cloud picker
hierarchy, a Models menu that is 100% cloud config, dollar-led usage, and a local setup path
that dead-ends at "install Ollama" with no way to get a model without a terminal.

## Findings by screen

### 01 First-run onboarding
- ✅ Local path is present and equal in layout.
- ❌ F1: Composer shows **Gemini 3 Flash preselected** even with no key — the global default
  model is hardcoded cloud (`DEFAULT_MODEL_ID`). A local-only user's very first state is a
  model that cannot work.
- ❌ F2: When Ollama is missing, the local card is a dead end ("install… check again"). When
  Ollama is present but has no models, there is guidance text but no action — getting a model
  requires a terminal.
- ❌ F3: The local path never mentions the embedding model, so semantic memory silently stays
  off for exactly the users most likely to want local memory.

### 05 Model popover
- ❌ F4: Recommended/Verified sections are inherently OpenRouter; local models (when online)
  appear without curation, capability chips, or context-length badges. There is no "tested
  local picks" concept, though tool-support per local model is already known (allowlist).
- ❌ F5: The AUTO default entry is cloud; no local-aware auto choice.

### 09 Models menu
- ❌ F6: "Models" is 100% cloud configuration (OpenRouter key, compat suite, Brave). For a
  local user the section named "Models" contains nothing about their models. Needs reframing
  copy + a local-models summary row pointing at Local (keep ONE home for local config; don't
  duplicate).

### 10 Local menu
- ✅ Auto-detect / manage / logs / setup guides are strong.
- ❌ F7: "Auto-detect could not find…" renders in error-red; on a fresh machine this is the
  NORMAL state and should read as calm guidance, not failure.
- ❌ F8: No in-app model pulling. This is the single biggest local-UX gap: the app can start
  Ollama but cannot get models into it. Ollama's `/api/pull` streams progress — an in-app
  "recommended models" block (chat + embedding) with pull progress closes the loop.
- ❌ F9: Embedding model has no presence here; semantic-memory setup lives only in Agent.

### 13 Usage
- ❌ F10: Entirely dollar-led. Local usage records $0/tokens, but an all-local user sees a
  money dashboard about nothing. Lead with tokens/requests when spend is $0; add a local vs
  cloud split line.

### 02/03 Chat + composer
- ✅ Context meter, spend chip, tool gating all work for local.
- ⚠️ F11 (minor): thinking-effort control is OpenRouter-only; local reasoning models exist but
  Ollama's think support is uneven — acceptable to leave, revisit later.

### Cross-cutting (from source, not screens)
- ❌ F12: Auto-namer / summaries / background helpers use cheap-cloud-model cascades; verify
  and ensure they resolve to a local model when no cloud key exists (silent failures here make
  local threads keep fallback titles).
- 💡 F13 (recommended direction, owner invited): ONE generic **"OpenAI-compatible endpoint"**
  provider slot (base URL + optional key) makes LM Studio, llama.cpp server, vLLM, Jan, and
  LocalAI all work through the existing `openaiCompat` path — maximum reach for minimum
  complexity, no per-vendor integrations. Ollama remains the first-class managed runtime.

## Fix plan → Wave H
- t25 local-first defaults & picker: F1, F4, F5, F12
- t26 in-app model pulling + embedding surfacing: F2, F3, F8, F9
- t27 framing/copy + usage reframe + local-only screenshot state: F6, F7, F10 (+ tour capture)
- t28 OpenAI-compatible endpoint provider: F13
- Deferred: F11.
