import { describe, expect, it, vi } from 'vitest';
import type { LlmProvider, LlmRequest } from '../../src/core/llm';
import { MODELS as CURATED_MODELS } from '../../src/core/models';
import type { Model } from '../../src/core/types';
import {
  runOpenRouterCompatibility,
  selectOpenRouterCompatibilityTargets,
} from '../../src/services/compat/openRouterCompatibility';
import { openAiCompatBodyExtras, resolveModelFormatProfile } from '../../src/services/llm/modelFormatProfiles';

const MODELS: Model[] = [
  { id: 'or-a', name: 'A', vendor: 'Vendor A', providerId: 'openrouter', providerModelId: 'vendor/a' },
  { id: 'or-b', name: 'B', vendor: 'Vendor B', providerId: 'openrouter', providerModelId: 'vendor/b' },
  { id: 'ollama-c', name: 'C', vendor: 'Local', providerId: 'ollama', providerModelId: 'c' },
];

describe('OpenRouter compatibility harness', () => {
  it('selects only OpenRouter targets', () => {
    expect(selectOpenRouterCompatibilityTargets(MODELS, 'all').map(model => model.id))
      .toEqual(['or-a', 'or-b']);
  });

  it('centralizes model-specific OpenRouter body extras', () => {
    expect(resolveModelFormatProfile('google/gemini-3-flash').id).toBe('gemini-3-reasoning-budget');
    expect(resolveModelFormatProfile('qwen2.5:7b').id).toBe('qwen-ollama-chat');
    expect(openAiCompatBodyExtras({
      modelId: 'google/gemini-3-flash',
      messages: [],
      maxTokens: 400,
    })).toEqual({ max_tokens: 400 });

    expect(openAiCompatBodyExtras({
      modelId: 'google/gemini-3-flash',
      messages: [],
    })).toEqual({});
  });

  it('does not add default output caps for curated OpenRouter chat models', () => {
    const openRouterModels = CURATED_MODELS.filter(model => model.providerId === 'openrouter');

    expect(openRouterModels.length).toBeGreaterThan(0);
    for (const model of openRouterModels) {
      expect(openAiCompatBodyExtras({
        modelId: model.providerModelId,
        messages: [],
      })).not.toHaveProperty('max_tokens');
    }
  });

  it('maps explicit thinking effort to OpenRouter reasoning payloads', () => {
    expect(openAiCompatBodyExtras({
      modelId: 'openai/gpt-5.5',
      messages: [],
      maxTokens: 400,
      thinkingEffort: 'xhigh',
    })).toEqual({
      max_tokens: 400,
      reasoning: { effort: 'xhigh', exclude: true },
    });
  });

  it('omits reasoning when thinking effort is none', () => {
    expect(openAiCompatBodyExtras({
      modelId: 'openai/gpt-5.5-pro',
      messages: [],
      maxTokens: 400,
      thinkingEffort: 'none',
    })).toEqual({ max_tokens: 400 });
  });

  it('runs text and tool probes and writes markdown/jsonl logs', async () => {
    const writes: Array<{ op: string; data: unknown }> = [];
    const bridge = {
      request: vi.fn(async <T,>(op: string, data: unknown): Promise<T> => {
        writes.push({ op, data });
        return {} as T;
      }),
    };
    const provider: LlmProvider = {
      id: 'openrouter',
      ready: () => true,
      async *stream(req: LlmRequest) {
        if (req.tools?.length) {
          yield {
            type: 'tool_call',
            call: {
              id: 'tc-1',
              name: 'compat_echo',
              arguments: { message: 'openrouter-compat-ping' },
            },
          };
        } else {
          yield { type: 'text', delta: 'GATESAI_COMPAT_OK' };
        }
        yield { type: 'done', finishReason: 'stop' };
      },
    };
    const router = {
      resolve: (id: string) => ({
        provider,
        providerModelId: MODELS.find(model => model.id === id)?.providerModelId ?? id,
      }),
    };

    const run = await runOpenRouterCompatibility({
      mode: 'all',
      models: MODELS,
      router: router as never,
      bridge: bridge as never,
    });

    expect(run.passed).toBe(2);
    expect(run.reportPath).toContain('/workspace/artifacts/reports/openrouter-compat/');
    expect(run.jsonlPath).toContain('/workspace/artifacts/data/openrouter-compat/');
    expect(writes.some(write => write.op === 'fs.append')).toBe(false);
    expect(writes.some(write => (
      write.op === 'fs.write'
      && JSON.stringify(write.data).includes('compat_echo')
      && JSON.stringify(write.data).includes('"append":true')
    ))).toBe(true);
  });
});
