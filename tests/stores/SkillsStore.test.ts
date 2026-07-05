import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkillsStore } from '../../src/stores/SkillsStore';
import type { SkillsBridgeFacade } from '../../src/services/skills/skillsService';

describe('SkillsStore', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('refreshes to an empty list without bridge activity in Web Lite', async () => {
    vi.stubEnv('VITE_GATESAI_WEB', '1');
    const request = vi.fn(async () => ({}));
    const store = new SkillsStore({
      isOnline: true,
      client: { request },
    } as SkillsBridgeFacade, () => ['thread']);

    await store.refresh();

    expect(store.skills).toEqual([]);
    expect(request).not.toHaveBeenCalled();
  });
});
