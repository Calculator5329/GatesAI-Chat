import { describe, expect, it } from 'vitest';
import { LlmRouter, NoProviderConfiguredError } from '../../src/services/llm';
import { ModelRegistry } from '../../src/stores/ModelRegistry';

const reg = () => new ModelRegistry();

describe('LlmRouter', () => {
  it('throws NoProviderConfiguredError when the model exists but its provider has no key', () => {
    const r = reg();
    const router = new LlmRouter(r, {});
    const anthropicModel = r.all.find(m => m.providerId === 'anthropic')!;
    expect(() => router.resolve(anthropicModel.id)).toThrow(NoProviderConfiguredError);
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
    expect(() => router.resolve(openaiModel.id)).toThrow(NoProviderConfiguredError);
    router.updateConfigs({ openai: { apiKey: 'sk-x' } });
    expect(router.resolve(openaiModel.id).provider.id).toBe('openai');
  });

  it('throws NoProviderConfiguredError for an unknown model id', () => {
    const router = new LlmRouter(reg(), { openai: { apiKey: 'sk-x' } });
    expect(() => router.resolve('nope-9000')).toThrow(NoProviderConfiguredError);
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

  describe('resolveOpenRouterFallback', () => {
    it('returns null when no OpenRouter key is configured', () => {
      const r = reg();
      const router = new LlmRouter(r, { anthropic: { apiKey: 'sk-a' } });
      const claude = r.all.find(m => m.providerId === 'anthropic')!;
      expect(router.resolveOpenRouterFallback(claude.id)).toBeNull();
    });

    it('returns null for OpenRouter / local / ollama models (nothing to fall back to)', () => {
      const r = reg();
      const router = new LlmRouter(r, { openrouter: { apiKey: 'sk-or' } });
      const orModel = r.all.find(m => m.providerId === 'openrouter')!;
      const localModel = r.all.find(m => m.providerId === 'local')!;
      expect(router.resolveOpenRouterFallback(orModel.id)).toBeNull();
      expect(router.resolveOpenRouterFallback(localModel.id)).toBeNull();
    });

    it('prefers a curated or-* slug when present', () => {
      const r = reg();
      const router = new LlmRouter(r, {
        anthropic: { apiKey: 'sk-a' },
        openrouter: { apiKey: 'sk-or' },
      });
      // Curated catalog has `or-claude-sonnet-4.6` (= `anthropic/claude-sonnet-4.6`).
      const claude = r.all.find(m => m.providerId === 'anthropic' && m.providerModelId === 'claude-sonnet-4-6')!;
      const fb = router.resolveOpenRouterFallback(claude.id);
      expect(fb?.provider.id).toBe('openrouter');
      expect(fb?.providerModelId).toBe('anthropic/claude-sonnet-4.6');
    });

    it('constructs <vendor>/<providerModelId> when no curated or dynamic OR entry exists', () => {
      // claude-haiku-4.5 has no `or-*` mirror in the curated catalog. Without
      // a hydrated dynamic catalog, the fallback must still synthesize a slug
      // so the runtime retry through OR can be attempted.
      const r = reg();
      const router = new LlmRouter(r, {
        anthropic: { apiKey: 'sk-a' },
        openrouter: { apiKey: 'sk-or' },
      });
      const haiku = r.all.find(m => m.providerId === 'anthropic' && m.providerModelId === 'claude-haiku-4-5')!;
      const fb = router.resolveOpenRouterFallback(haiku.id);
      expect(fb?.provider.id).toBe('openrouter');
      expect(fb?.providerModelId).toBe('anthropic/claude-haiku-4-5');
    });

    it('constructs OpenAI fallback slugs for direct GPT models without curated mirrors', () => {
      const r = reg();
      const router = new LlmRouter(r, {
        openai: { apiKey: 'sk-o' },
        openrouter: { apiKey: 'sk-or' },
      });
      const gpt = r.all.find(m => m.providerId === 'openai' && m.providerModelId === 'gpt-5.4-nano')!;
      const fb = router.resolveOpenRouterFallback(gpt.id);
      expect(fb?.providerModelId).toBe('openai/gpt-5.4-nano');
    });

    it('constructs Gemini fallback slugs (google/ namespace)', () => {
      const r = reg();
      const router = new LlmRouter(r, {
        gemini: { apiKey: 'sk-g' },
        openrouter: { apiKey: 'sk-or' },
      });
      const gemini = r.all.find(m => m.providerId === 'gemini' && m.providerModelId === 'gemini-2.5-flash-lite')!;
      const fb = router.resolveOpenRouterFallback(gemini.id);
      expect(fb?.providerModelId).toBe('google/gemini-2.5-flash-lite');
    });

    it('prefers a dynamic catalog hit over the constructed slug', () => {
      const r = reg();
      // Pretend OR returned an explicit slug for haiku — fallback should
      // pick that up rather than synthesizing one.
      r.setDynamicForProvider('openrouter', [{
        id: 'or-live-anthropic/claude-haiku-4.5',
        name: 'Claude Haiku 4.5 (OR)',
        vendor: 'Anthropic',
        providerId: 'openrouter',
        providerModelId: 'anthropic/claude-haiku-4.5',
        dynamic: true,
      }]);
      const router = new LlmRouter(r, {
        anthropic: { apiKey: 'sk-a' },
        openrouter: { apiKey: 'sk-or' },
      });
      const haiku = r.all.find(m => m.providerId === 'anthropic' && m.providerModelId === 'claude-haiku-4-5')!;
      const fb = router.resolveOpenRouterFallback(haiku.id);
      expect(fb?.providerModelId).toBe('anthropic/claude-haiku-4.5');
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
