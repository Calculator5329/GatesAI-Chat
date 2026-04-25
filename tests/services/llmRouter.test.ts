import { describe, expect, it } from 'vitest';
import { LlmRouter } from '../../src/services/llm';
import { ModelRegistry } from '../../src/stores/ModelRegistry';

const reg = () => new ModelRegistry();

describe('LlmRouter', () => {
  it('falls back to fake when the model exists but its provider has no key', () => {
    const r = reg();
    const router = new LlmRouter(r, {});
    const anthropicModel = r.all.find(m => m.providerId === 'anthropic')!;
    const { provider, providerModelId } = router.resolve(anthropicModel.id);
    expect(provider.id).toBe('fake');
    expect(providerModelId).toBe(anthropicModel.providerModelId);
  });

  it('uses the real provider once a key is supplied', () => {
    const r = reg();
    const router = new LlmRouter(r, { anthropic: { apiKey: 'sk-test' } });
    const anthropicModel = r.all.find(m => m.providerId === 'anthropic')!;
    const { provider } = router.resolve(anthropicModel.id);
    expect(provider.id).toBe('anthropic');
  });

  it('local provider is always ready (no key required)', () => {
    const r = reg();
    const router = new LlmRouter(r, {});
    const localModel = r.all.find(m => m.providerId === 'local')!;
    const { provider } = router.resolve(localModel.id);
    expect(provider.id).toBe('local');
  });

  it('updateConfigs hot-swaps providers without recreating the router', () => {
    const r = reg();
    const router = new LlmRouter(r, {});
    const openaiModel = r.all.find(m => m.providerId === 'openai')!;
    expect(router.resolve(openaiModel.id).provider.id).toBe('fake');
    router.updateConfigs({ openai: { apiKey: 'sk-x' } });
    expect(router.resolve(openaiModel.id).provider.id).toBe('openai');
  });

  it('returns the fake provider for an unknown model id', () => {
    const router = new LlmRouter(reg(), { openai: { apiKey: 'sk-x' } });
    const { provider, providerModelId } = router.resolve('nope-9000');
    expect(provider.id).toBe('fake');
    expect(providerModelId).toBe('nope-9000');
  });

  it('routes a Claude model through OpenRouter when only the OR key is set', () => {
    const r = reg();
    r.setDynamicForProvider('openrouter', [{
      id: 'or-live-anthropic_claude-sonnet-4.6',
      name: 'Claude Sonnet 4.6 (OR)',
      vendor: 'Anthropic',
      providerId: 'openrouter',
      providerModelId: 'anthropic/claude-sonnet-4.6',
      dynamic: true,
    }]);
    const router = new LlmRouter(r, { openrouter: { apiKey: 'sk-or' } });
    const claude = r.all.find(m => m.providerId === 'anthropic' && m.providerModelId === 'claude-sonnet-4-6')!;
    const { provider, providerModelId } = router.resolve(claude.id);
    expect(provider.id).toBe('openrouter');
    expect(providerModelId).toBe('anthropic/claude-sonnet-4.6');
  });

  describe('canRoute', () => {
    it('returns false with no configs (defaulted local does not count)', () => {
      const router = new LlmRouter(reg(), {});
      expect(router.canRoute()).toBe(false);
    });

    it('returns true once an api key is set', () => {
      const router = new LlmRouter(reg(), { openai: { apiKey: 'sk-x' } });
      expect(router.canRoute()).toBe(true);
    });

    it('returns true when the user explicitly sets a local baseUrl', () => {
      const router = new LlmRouter(reg(), { local: { baseUrl: 'http://127.0.0.1:8080/v1' } });
      expect(router.canRoute()).toBe(true);
    });

    it('reflects updateConfigs', () => {
      const router = new LlmRouter(reg(), {});
      expect(router.canRoute()).toBe(false);
      router.updateConfigs({ anthropic: { apiKey: 'sk-a' } });
      expect(router.canRoute()).toBe(true);
    });
  });

  it('resolves a dynamic OpenRouter model added to the registry at runtime', () => {
    const r = reg();
    r.setDynamicForProvider('openrouter', [{
      id: 'or-live-test/cool-model',
      name: 'Cool Model',
      vendor: 'Test',
      providerId: 'openrouter',
      providerModelId: 'test/cool-model',
      dynamic: true,
    }]);
    const router = new LlmRouter(r, { openrouter: { apiKey: 'sk-or' } });
    const { provider, providerModelId } = router.resolve('or-live-test/cool-model');
    expect(provider.id).toBe('openrouter');
    expect(providerModelId).toBe('test/cool-model');
  });
});
