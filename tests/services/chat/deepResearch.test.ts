import { describe, expect, it } from 'vitest';
import {
  buildDeepResearchInstructions,
  DEEP_RESEARCH_MAX_ROUNDS,
  DEEP_RESEARCH_SYSTEM_PROMPT,
  deepResearchTitle,
} from '../../../src/services/chat/deepResearch';

describe('deep research task contract', () => {
  it('requires deep Brave searches, source integrity, and transparent limits', () => {
    expect(DEEP_RESEARCH_MAX_ROUNDS).toBe(10);
    expect(DEEP_RESEARCH_SYSTEM_PROMPT).toContain('depth "deep"');
    expect(DEEP_RESEARCH_SYSTEM_PROMPT).toContain('Prefer primary and authoritative sources');
    expect(DEEP_RESEARCH_SYSTEM_PROMPT).toContain('Never invent a source');
    expect(DEEP_RESEARCH_SYSTEM_PROMPT).toContain('coverage limits');
    expect(buildDeepResearchInstructions('  Compare A and B  ')).toContain('Compare A and B');
  });

  it('creates a concise, stable task title', () => {
    expect(deepResearchTitle('  Compare   A and B  ')).toBe('Research: Compare A and B');
    expect(deepResearchTitle('x'.repeat(100))).toMatch(/^Research: .{65}…$/);
  });
});
