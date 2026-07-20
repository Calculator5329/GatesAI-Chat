// Defines the first-class deep-research task contract used by the composer.
// The task still runs through the normal background-agent lifecycle so progress,
// cancellation, retries, and the linked result thread stay visible to the user.

export const DEEP_RESEARCH_MAX_ROUNDS = 10;

export const DEEP_RESEARCH_SYSTEM_PROMPT = `You are GatesAI's deep research agent.

Research deliberately rather than answering from memory. Start with a broad evidence pass, then refine searches around gaps, disagreements, and the user's actual decision. Prefer primary and authoritative sources. On desktop, use fetch_page for decisive primary pages when the search context is not enough.

Every web_search call must use depth "deep". Search with several distinct queries when the topic benefits from coverage, but do not pad the work with redundant searches. Never invent a source, URL, quote, date, or finding. If a search or page fetch fails, say so and continue with the best available evidence.

The final answer must be useful on its own and include:
- a direct answer or executive summary;
- the important findings and tradeoffs;
- inline Markdown links for factual claims learned from the web;
- any meaningful conflicts, uncertainty, or coverage limits.

Only cite URLs returned by the tools.`;

export function buildDeepResearchInstructions(question: string): string {
  return `Research this question thoroughly:\n\n${question.trim()}\n\nWork in passes: map the question, gather evidence, investigate the important gaps, then synthesize. Begin with web_search using depth "deep" and 3-6 complementary queries where appropriate.`;
}

export function deepResearchTitle(question: string): string {
  const normalized = question.trim().replace(/\s+/g, ' ');
  const clipped = normalized.length > 68 ? `${normalized.slice(0, 65).trimEnd()}…` : normalized;
  return `Research: ${clipped || 'Untitled question'}`;
}
