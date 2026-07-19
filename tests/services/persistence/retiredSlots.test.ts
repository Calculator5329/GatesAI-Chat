import { beforeEach, describe, expect, it } from 'vitest';
import { purgeRetiredLocalSlots, RETIRED_LOCAL_SLOTS, RETIRED_SECRET_NAMES } from '../../../src/services/persistence/retiredSlots';

describe('purgeRetiredLocalSlots', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('removes every retired slot while leaving live slots untouched', () => {
    for (const key of RETIRED_LOCAL_SLOTS) {
      localStorage.setItem(key, JSON.stringify({ stale: true }));
    }
    localStorage.setItem('gatesai.state.v1', JSON.stringify({ threads: [] }));
    localStorage.setItem('gatesai.providers.v1', JSON.stringify({ openrouter: { apiKey: 'sk' } }));

    purgeRetiredLocalSlots();

    for (const key of RETIRED_LOCAL_SLOTS) {
      expect(localStorage.getItem(key)).toBeNull();
    }
    expect(localStorage.getItem('gatesai.state.v1')).not.toBeNull();
    expect(localStorage.getItem('gatesai.providers.v1')).not.toBeNull();
  });

  it('is idempotent and safe when nothing is present', () => {
    expect(() => purgeRetiredLocalSlots()).not.toThrow();
    expect(() => purgeRetiredLocalSlots()).not.toThrow();
  });

  it('lists the removed custom-endpoint secret for retirement', () => {
    expect(RETIRED_SECRET_NAMES).toContain('openai-compat.api-key');
  });
});
