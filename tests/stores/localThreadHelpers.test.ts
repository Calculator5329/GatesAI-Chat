// A chat on a model that runs on this machine keeps its background helpers there too.
// 2026-11-05: the live qwen3.8 run showed the auto-title going to milo-e4b (a second
// local model that evicts the chat model from a 16 GB card), and with an OpenRouter
// key the title, the idle summary and tool-result compaction all went to cloud Gemini.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInAction } from 'mobx';
import { ChatStore } from '../../src/stores/ChatStore';
import { ProviderStore } from '../../src/stores/ProviderStore';
import { ModelRegistry } from '../../src/stores/ModelRegistry';
import { UserProfileStore } from '../../src/stores/UserProfileStore';
import { SummaryStore } from '../../src/stores/SummaryStore';
import { flush } from '../helpers/mockProvider';
import { clearAppStorage } from '../helpers/storage';
import type { LlmChunk, LlmProvider, LlmRequest, ProviderId } from '../../src/core/llm';
import type { LlmRouter } from '../../src/services/llm/router';
import type { Model } from '../../src/core/types';

const CHAT_MODEL = 'ollama-gemma4:26b';
const SMALL_MODEL = 'ollama-milo-e4b:4b';

function ollamaModel(id: string, providerModelId: string, parameterBillions: number): Model {
  return {
    id,
    name: providerModelId,
    vendor: 'Ollama',
    providerId: 'ollama',
    providerModelId,
    dynamic: true,
    supportsTools: true,
    parameterBillions,
    contextLength: 16_384,
  } as Model;
}

/** Records every request with the catalog id it was routed as. */
class Recorder implements LlmProvider {
  readonly id: ProviderId = 'ollama';
  readonly calls: { routedAs: string; request: LlmRequest }[] = [];
  routedAs = '';
  ready(): boolean { return true; }
  async *stream(request: LlmRequest): AsyncIterable<LlmChunk> {
    this.calls.push({ routedAs: this.routedAs, request });
    const prompt = request.systemPrompt ?? '';
    if (prompt.includes('name conversations')) yield { type: 'text', delta: 'Local Title' };
    else if (prompt.startsWith('Summarize')) yield { type: 'text', delta: 'They talked about a local topic.' };
    else yield { type: 'text', delta: 'a reply long enough to name a thread from' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

function setup(withOpenRouterKey: boolean) {
  clearAppStorage();
  const registry = new ModelRegistry();
  registry.setDynamicForProvider('ollama', [
    ollamaModel(CHAT_MODEL, 'gemma4:26b', 25.2),
    ollamaModel(SMALL_MODEL, 'milo-e4b:4b', 4),
  ]);
  const providers = new ProviderStore(registry, () => ({
    ollama: { baseUrl: 'http://127.0.0.1:11434', available: true, toolsEnabled: true },
  }));
  if (withOpenRouterKey) providers.setKey('openrouter', 'test-key');
  const recorder = new Recorder();
  const router = providers.router as LlmRouter & {
    resolve: (modelId: string) => { provider: LlmProvider; providerModelId: string };
    get: (id: ProviderId) => LlmProvider;
    canRoute: () => boolean;
  };
  router.resolve = (modelId: string) => {
    recorder.routedAs = modelId;
    return { provider: recorder, providerModelId: registry.findById(modelId)?.providerModelId ?? modelId };
  };
  router.get = () => recorder;
  router.canRoute = () => true;
  const chat = new ChatStore(providers, registry, new UserProfileStore());
  return { registry, providers, chat, recorder };
}

describe('background helpers for a chat on a local model', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => clearAppStorage());

  it.each([
    ['with an OpenRouter key', true],
    ['without an OpenRouter key', false],
  ])('auto-titles on the chat model itself %s', async (_label, withKey) => {
    const { chat, recorder } = setup(withKey);
    const threadId = chat.createThread();
    chat.setThreadModel(threadId, CHAT_MODEL);
    chat.sendMessage('what is a good name for a cat');
    await flush(60);

    const titleCalls = recorder.calls.filter(c => (c.request.systemPrompt ?? '').includes('name conversations'));
    expect(titleCalls.map(c => c.routedAs)).toEqual([CHAT_MODEL]);
    expect(chat.threads.find(t => t.id === threadId)?.title).toBe('Local Title');
    chat.dispose();
  });

  it('auto-titles a cloud chat on the cheap cloud model as before', async () => {
    const { chat, recorder } = setup(true);
    const threadId = chat.createThread();
    chat.setThreadModel(threadId, 'or-claude-haiku-4.5');
    chat.sendMessage('what is a good name for a dog');
    await flush(60);

    const titleCalls = recorder.calls.filter(c => (c.request.systemPrompt ?? '').includes('name conversations'));
    expect(titleCalls.map(c => c.routedAs)).toEqual(['or-gemini-3.1-flash-lite']);
    chat.dispose();
  });

  it.each([
    ['with an OpenRouter key', true],
    ['without an OpenRouter key', false],
  ])('summarizes an idle local chat on its own model with thinking off %s', async (_label, withKey) => {
    const { chat, providers, registry, recorder } = setup(withKey);
    const localId = chat.createThread();
    chat.setThreadModel(localId, CHAT_MODEL);
    const local = chat.threads.find(t => t.id === localId)!;
    runInAction(() => {
      local.messages.push(
        { id: 'm1', role: 'user', content: 'private question one', createdAt: 1 },
        { id: 'm2', role: 'assistant', content: 'answer one', createdAt: 2 },
        { id: 'm3', role: 'user', content: 'private question two', createdAt: 3 },
        { id: 'm4', role: 'assistant', content: 'answer two', createdAt: 4 },
      );
    });
    chat.createThread();

    const summary = new SummaryStore(chat, providers, registry);
    (summary as unknown as { lastActivityAt: number }).lastActivityAt = 0;
    await summary.tick();

    const summaryCalls = recorder.calls.filter(c => (c.request.systemPrompt ?? '').startsWith('Summarize'));
    expect(summaryCalls).toHaveLength(1);
    expect(summaryCalls[0].request.modelId).toBe('gemma4:26b');
    expect(summaryCalls[0].request.thinkingEffort).toBe('none');
    expect(local.summary).toContain('local topic');
    summary.stop();
    chat.dispose();
  });

  it('never sends a local chat\'s oversized tool result to a cloud compactor', async () => {
    const { chat, recorder } = setup(true);
    const threadId = chat.createThread();
    chat.setThreadModel(threadId, CHAT_MODEL);
    runInAction(() => {
      chat.activeThread!.messages.push({
        id: 'u-local-compact',
        role: 'user',
        content: 'Read my private notes.',
        createdAt: Date.now(),
      });
      chat.activeThread!.messages.push({
        id: 'a-local-compact',
        role: 'assistant',
        content: 'Read them.',
        createdAt: Date.now(),
        toolCalls: [{ id: 'call-local', name: 'fs', arguments: { action: 'read', path: '/workspace/notes/private.md' } }],
        toolResults: [{
          toolCallId: 'call-local',
          toolName: 'fs',
          content: 'path: /workspace/notes/private.md\n' + 'p'.repeat(1_000_000),
          ranAt: Date.now(),
        }],
      });
    });

    chat.sendMessage('continue');
    await flush(100);

    expect(recorder.calls.map(c => c.routedAs).filter(id => id.startsWith('or-'))).toEqual([]);
    const compacted = chat.activeThread!.messages.find(m => m.id === 'a-local-compact');
    if (compacted?.role !== 'assistant') throw new Error('expected assistant');
    expect(compacted.toolResults?.[0].content.length).toBeLessThan(1_000_000);
    chat.dispose();
  });
});
