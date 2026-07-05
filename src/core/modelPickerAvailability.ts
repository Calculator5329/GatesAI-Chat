// Pure runtime-availability rules for the model picker. Lives in core/ so the
// UI, stores, and tests share one definition of "which sources/models can the
// user actually use right now" without crossing layer boundaries.
//
// Invariant: side-effect free. Inputs are plain runtime flags; outputs are
// derived synchronously. Network/state lives in stores; this module only
// decides visibility.
import type { Model } from './types';
import type { ProviderId } from './llm';
import { DEFAULT_OPENROUTER_CATALOG_MODEL_IDS } from './models';

/** The four picker tabs. Canonical definition reused by storage + UI. */
export type ModelPickerSource = 'auto' | 'cloud' | 'local' | 'image';

/**
 * Snapshot of the runtime facts the picker needs to gate visibility.
 *
 * - `webLite`: browser-hosted build with no Tauri shell. No local backends can
 *   ever run here, so local/image are impossible regardless of cached state.
 * - `ollamaOnline`: the local Ollama runtime is reachable right now.
 * - `comfyReady`: ComfyUI is managed and online (matches
 *   `LocalRuntimeStore.comfyReady`).
 * - `openAiCompatAvailable`: the custom OpenAI-compatible endpoint's last
 *   `/models` probe succeeded.
 */
export interface RuntimeAvailability {
  webLite: boolean;
  ollamaOnline: boolean;
  comfyReady: boolean;
  openAiCompatAvailable?: boolean;
}

/** The live-tested OpenRouter matrix doubles as the "verified" set. */
const VERIFIED_MODEL_IDS = new Set<string>(DEFAULT_OPENROUTER_CATALOG_MODEL_IDS);

/** True when `id` is part of the curated, live-verified catalog. */
export function isVerifiedModelId(id: string): boolean {
  return VERIFIED_MODEL_IDS.has(id);
}

/**
 * Tabs that should be rendered for the current runtime. Cloud (OpenRouter) is
 * always the floor; local/image only appear on desktop once their backend is
 * actually usable.
 */
export function availableSources(flags: RuntimeAvailability): ModelPickerSource[] {
  const sources: ModelPickerSource[] = ['auto', 'cloud'];
  if ((!flags.webLite && flags.ollamaOnline) || flags.openAiCompatAvailable) sources.push('local');
  if (!flags.webLite && flags.comfyReady) sources.push('image');
  return sources;
}

/** Whether a provider can be routed to right now. */
export function isProviderAvailable(providerId: ProviderId, flags: RuntimeAvailability): boolean {
  switch (providerId) {
    case 'openrouter':
      return true;
    case 'openai-compat':
      return flags.openAiCompatAvailable === true;
    case 'ollama':
      return !flags.webLite && flags.ollamaOnline;
    case 'local-image':
      return !flags.webLite && flags.comfyReady;
    default:
      return false;
  }
}

/**
 * Whether a model should be offered in the picker. Unusable local/image models
 * are hidden entirely rather than shown disabled, so the menu only ever lists
 * things the user can actually pick and send.
 */
export function isModelAvailable(model: Pick<Model, 'providerId'>, flags: RuntimeAvailability): boolean {
  return isProviderAvailable(model.providerId, flags);
}
