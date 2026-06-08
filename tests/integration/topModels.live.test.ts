/**
 * Live integration checks for the default OpenRouter catalog. Each model gets
 * tiny real calls for text, thinking effort, strict tool schema, and tool-result
 * continuation behavior.
 *
 * These tests hit real provider APIs — they cost (a tiny amount of) money
 * and require network. Excluded from `npm run test`. Run on demand:
 *
 *   OPENROUTER_API_KEY=... npm run test:models
 *
 * Cases without their corresponding key set are skipped (not failed) so
 * partial runs are useful.
 */
import { describe, it, expect } from 'vitest';
import { LlmRouter } from '../../src/services/llm/router';
import type { LlmMessage, ProviderConfigs, ThinkingEffort, ToolCall, ToolDef } from '../../src/core/llm';
import type { Model } from '../../src/core/types';
import { DEFAULT_OPENROUTER_CATALOG_MODEL_IDS, MODELS } from '../../src/core/models';

const KEYS = {
  openrouter: process.env.OPENROUTER_API_KEY,
};

const CONFIGS: ProviderConfigs = {
  ...(KEYS.openrouter ? { openrouter: { apiKey: KEYS.openrouter } } : {}),
};

function registryOf(models: readonly Model[]) {
  return {
    all: [...models],
    findById: (id: string) => models.find(m => m.id === id),
  };
}

const DEFAULT_MODELS = DEFAULT_OPENROUTER_CATALOG_MODEL_IDS
  .map(id => MODELS.find(model => model.id === id))
  .filter((model): model is Model => Boolean(model));
const router = new LlmRouter(registryOf(MODELS), CONFIGS);
const THINKING_EFFORTS: ThinkingEffort[] = ['none', 'low', 'medium', 'high', 'xhigh'];

const COMPAT_TOOL: ToolDef = {
  name: 'compat_echo',
  description: 'Echo a tiny compatibility payload.',
  strict: true,
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string' },
    },
    required: ['message'],
    additionalProperties: false,
  },
};

interface ProbeOutput {
  text: string;
  toolCalls: ToolCall[];
  finishReason?: string;
  error?: string;
}

let lastFreeRouteStartedAt = 0;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function throttleFreeOpenRouterRoute(providerModelId: string): Promise<void> {
  if (!providerModelId.endsWith(':free')) return;
  const elapsed = Date.now() - lastFreeRouteStartedAt;
  if (elapsed < 4_000) await delay(4_000 - elapsed);
  lastFreeRouteStartedAt = Date.now();
}

async function fetchLiveOpenRouterIds(): Promise<Set<string>> {
  const res = await fetch('https://openrouter.ai/api/v1/models');
  expect(res.ok, `OpenRouter model catalog HTTP ${res.status}`).toBe(true);
  const body = await res.json() as { data?: Array<{ id?: unknown }> };
  return new Set((body.data ?? []).map(item => item.id).filter((id): id is string => typeof id === 'string'));
}

async function runProbe(
  model: Model,
  args: {
    messages: LlmMessage[];
    tools?: ToolDef[];
    thinkingEffort?: ThinkingEffort;
    maxTokens?: number;
    systemPrompt?: string;
  },
): Promise<ProbeOutput> {
  const { provider, providerModelId } = router.resolve(model.id);
  for (let attempt = 0; attempt < 2; attempt++) {
    await throttleFreeOpenRouterRoute(providerModelId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort('test timeout'), 60_000);
    let text = '';
    let finishReason: string | undefined;
    let error: string | undefined;
    const toolCalls: ToolCall[] = [];

    try {
      for await (const chunk of provider.stream(
        {
          modelId: providerModelId,
          messages: args.messages,
          maxTokens: args.maxTokens ?? 512,
          temperature: 0,
          tools: args.tools ?? [],
          ...(args.thinkingEffort ? { thinkingEffort: args.thinkingEffort } : {}),
          ...(args.systemPrompt ? { systemPrompt: args.systemPrompt } : {}),
        },
        controller.signal,
      )) {
        if (chunk.type === 'text') text += chunk.delta;
        if (chunk.type === 'tool_call') toolCalls.push(chunk.call);
        if (chunk.type === 'done') {
          finishReason = chunk.finishReason;
          error = chunk.error;
          break;
        }
      }
    } finally {
      clearTimeout(timer);
    }

    if (attempt === 0 && error?.includes('free-models-per-min')) {
      await delay(65_000);
      continue;
    }
    return { text, toolCalls, finishReason, error };
  }
  return { text: '', toolCalls: [], finishReason: 'error', error: 'free route retry exhausted' };
}

describe('top models — live smoke', () => {
  const skip = !KEYS.openrouter;

  (skip ? it.skip : it)('curated concrete model slugs exist in the live OpenRouter catalog', async () => {
    const liveIds = await fetchLiveOpenRouterIds();
    const missing = DEFAULT_MODELS
      .map(model => model.providerModelId)
      .filter(id => !id.startsWith('~'))
      .filter(id => !liveIds.has(id));

    expect(missing).toEqual([]);
  }, 30_000);

  for (const model of DEFAULT_MODELS) {
    for (const effort of THINKING_EFFORTS) {
      (skip ? it.skip : it)(`${model.name} streams text with thinking=${effort}`, async () => {
        const out = await runProbe(model, {
          thinkingEffort: effort,
          messages: [{ role: 'user', content: 'Reply with exactly the word: pong.' }],
        });

        expect(
          out.text.trim().length,
          `${model.providerModelId} effort=${effort} expected text; finish=${out.finishReason} error=${out.error}`,
        ).toBeGreaterThan(0);
      }, 150_000);
    }

    (skip ? it.skip : it)(`${model.name} calls a strict JSON-schema tool`, async () => {
      const out = await runProbe(model, {
        systemPrompt: [
          'This is a tool-calling conformance test.',
          'You must call compat_echo exactly once with {"message":"openrouter-live-ping"}.',
          'Do not answer in prose and do not finish without a tool call.',
        ].join(' '),
        messages: [{
          role: 'user',
          content: 'Required action: call compat_echo with message "openrouter-live-ping". Return no normal text.',
        }],
        maxTokens: 1024,
        tools: [COMPAT_TOOL],
      });
      const call = out.toolCalls[0];

      expect(
        call,
        `${model.providerModelId} expected tool call; text=${JSON.stringify(out.text.slice(0, 200))} finish=${out.finishReason} error=${out.error}`,
      ).toBeTruthy();
      expect(call.name).toBe('compat_echo');
      expect(call.arguments).toEqual({ message: 'openrouter-live-ping' });
      expect(call.argumentsError).toBeUndefined();
    }, 150_000);

    (skip ? it.skip : it)(`${model.name} continues after a tool result`, async () => {
      const toolCall: ToolCall = {
        id: 'compat-live-call',
        name: 'compat_echo',
        arguments: { message: 'openrouter-live-ping' },
      };
      const out = await runProbe(model, {
        messages: [
          { role: 'user', content: 'Call compat_echo, then use its result to answer done.' },
          { role: 'assistant', content: '', toolCalls: [toolCall] },
          { role: 'tool', toolCallId: toolCall.id, toolName: toolCall.name, content: 'openrouter-live-ping' },
          { role: 'user', content: 'Now reply with exactly: done.' },
        ],
      });

      expect(
        out.text.trim().length,
        `${model.providerModelId} expected continuation text; finish=${out.finishReason} error=${out.error}`,
      ).toBeGreaterThan(0);
    }, 150_000);
  }
});
