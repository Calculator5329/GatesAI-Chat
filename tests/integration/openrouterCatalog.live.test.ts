import { describe, expect, it } from 'vitest';
import { MODELS } from '../../src/core/models';

const RUN_LIVE = process.env.OPENROUTER_CATALOG_LIVE === '1';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

describe.skipIf(!RUN_LIVE)('OpenRouter live catalog', () => {
  it('contains every curated OpenRouter provider model id, including latest aliases', async () => {
    const resp = await fetch(OPENROUTER_MODELS_URL);
    expect(resp.ok).toBe(true);
    const body = await resp.json() as { data?: Array<{ id?: unknown }> };
    const liveIds = new Set((body.data ?? [])
      .map(model => model.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0));
    const curatedIds = [...new Set(MODELS
      .filter(model => model.providerId === 'openrouter')
      .map(model => model.providerModelId))];
    const missing = curatedIds.filter(id => !liveIds.has(id));

    expect(missing).toEqual([]);
  }, 30_000);
});
