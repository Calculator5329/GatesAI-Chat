import { describe, expect, it } from 'vitest';
import { LlmRouter, NoProviderConfiguredError } from '../../src/services/llm';
import { ModelRegistry } from '../../src/stores/ModelRegistry';

const reg = () => new ModelRegistry();

describe('LlmRouter', () => {
  it('throws NoProviderConfiguredError when an OpenRouter model has no key', () => {
    const r = reg();
    const router = new LlmRouter(r, {});
    const orModel = r.all.find(m => m.providerId === 'openrouter')!;
    expect(() => router.resolve(orModel.id)).toThrow(NoProviderConfiguredError);
  });

  it('routes OpenRouter models once a key is supplied', () => {
    const r = reg();
    const router = new LlmRouter(r, { openrouter: { apiKey: 'sk-test' } });
    const orModel = r.all.find(m => m.providerId === 'openrouter')!;
    const { provider } = router.resolve(orModel.id);
    expect(provider.id).toBe('openrouter');
  });

  it('does not route local-image synthetic models through the LLM router', () => {
    const r = reg();
    const router = new LlmRouter(r, {});
    const imageModel = r.all.find(m => m.providerId === 'local-image')!;
    expect(() => router.resolve(imageModel.id)).toThrow(NoProviderConfiguredError);
  });

  it('updateConfigs hot-swaps providers without recreating the router', () => {
    const r = reg();
    const router = new LlmRouter(r, {});
    const orModel = r.all.find(m => m.providerId === 'openrouter')!;
    expect(() => router.resolve(orModel.id)).toThrow(NoProviderConfiguredError);
    router.updateConfigs({ openrouter: { apiKey: 'sk-x' } });
    expect(router.resolve(orModel.id).provider.id).toBe('openrouter');
  });

  it('throws NoProviderConfiguredError for an unknown model id', () => {
    const router = new LlmRouter(reg(), { openrouter: { apiKey: 'sk-x' } });
    expect(() => router.resolve('nope-9000')).toThrow(NoProviderConfiguredError);
  });

  describe('canRoute', () => {
    it('returns false with no configs (defaulted local does not count)', () => {
      const router = new LlmRouter(reg(), {});
      expect(router.canRoute()).toBe(false);
    });

    it('returns true once an api key is set', () => {
      const router = new LlmRouter(reg(), { openrouter: { apiKey: 'sk-x' } });
      expect(router.canRoute()).toBe(true);
    });

    it('does not treat a cached Ollama catalog as routeable until the runtime is online', () => {
      const r = reg();
      r.setDynamicForProvider('ollama', [{
        id: 'ollama-llama3',
        name: 'llama3',
        vendor: 'Ollama',
        providerId: 'ollama',
        providerModelId: 'llama3',
        dynamic: true,
      }]);
      const router = new LlmRouter(r, {});
      expect(router.canRoute()).toBe(false);
      router.updateConfigs({ ollama: { baseUrl: 'http://127.0.0.1:11434', available: true } });
      expect(router.canRoute()).toBe(true);
    });

    it('reflects updateConfigs', () => {
      const router = new LlmRouter(reg(), {});
      expect(router.canRoute()).toBe(false);
      router.updateConfigs({ openrouter: { apiKey: 'sk-a' } });
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
