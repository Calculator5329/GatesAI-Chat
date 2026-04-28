/**
 * Synthetic provider for the "ComfyUI (direct)" model. The chat runner
 * detects the `'local-image'` provider id and short-circuits BEFORE
 * calling the provider — so the methods here should never actually fire
 * in production. They exist only to satisfy `Record<ProviderId, …>`
 * exhaustiveness in the router and registry.
 *
 * If something does dispatch through this provider, surfacing a clear
 * error is better than a silent no-op.
 */

import type { LlmChunk, LlmProvider, LlmRequest } from '../../core/llm';

export class LocalImageProvider implements LlmProvider {
  readonly id = 'local-image' as const;

  ready(): boolean {
    // Not "ready" as an LLM provider — the chat runner short-circuits
    // before checking this. Returning true would imply we can stream chat,
    // which we can't.
    return false;
  }

  stream(_request: LlmRequest, _signal: AbortSignal): AsyncIterable<LlmChunk> {
    return {
      [Symbol.asyncIterator](): AsyncIterator<LlmChunk> {
        return {
          next: async () => {
            throw new Error('local-image provider does not stream chat. Pick a real chat model, or the runner should short-circuit before calling stream().');
          },
        };
      },
    };
  }
}
