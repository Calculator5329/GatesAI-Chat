// Pure thread-level selectors shared by stores and UI.
// Depends only on core types; no MobX, no services. The single source of
// truth for spend math and sidebar search matching (previously duplicated
// between ChatStore's getter and module-level helpers).
import type { Thread } from './types';

/** Total OpenRouter spend (USD) recorded on a thread's assistant messages. */
export function threadLlmSpendUsd(thread: Thread | null): number {
  if (!thread) return 0;
  return thread.messages.reduce((sum, message) => {
    if (message.role !== 'assistant') return sum;
    return sum + (message.usage ?? []).reduce((inner, usage) => (
      usage.providerId === 'openrouter' && typeof usage.costUsd === 'number' && Number.isFinite(usage.costUsd)
        ? inner + usage.costUsd
        : inner
    ), 0);
  }, 0);
}

/**
 * Whether a thread matches the sidebar search query. Scans the title, the
 * (legacy) subtitle, and every message body so search reaches conversation
 * content, not just titles. `normalizedQuery` must already be lowercased and
 * trimmed by the caller.
 */
export function threadMatchesSearch(thread: Thread, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  if (`${thread.title} ${thread.subtitle}`.toLowerCase().includes(normalizedQuery)) return true;
  return thread.messages.some(message => message.content.toLowerCase().includes(normalizedQuery));
}
