import { describe, expect, it } from 'vitest';
import type { LlmChunk, LlmProvider, LlmRequest, ProviderId } from '../../../src/core/llm';
import type { Thread } from '../../../src/core/types';
import { ChatStore } from '../../../src/stores/ChatStore';
import { ModelRegistry } from '../../../src/stores/ModelRegistry';
import { ProviderStore } from '../../../src/stores/ProviderStore';
import { UserProfileStore } from '../../../src/stores/UserProfileStore';
import {
  AutoNamer,
  type AutoNameHost,
  type AutoNameRouter,
} from '../../../src/services/chat/autoNamer';
import { installMockProvider } from '../../helpers/mockProvider';
import { clearAppStorage } from '../../helpers/storage';

class OneShotProvider implements LlmProvider {
  readonly id: ProviderId = 'openrouter';
  readonly calls: LlmRequest[] = [];

  constructor(private readonly chunks: LlmChunk[]) {}

  ready(): boolean { return true; }

  async *stream(req: LlmRequest): AsyncIterable<LlmChunk> {
    this.calls.push(req);
    for (const chunk of this.chunks) {
      await Promise.resolve();
      yield chunk;
    }
  }
}

class GatedProvider implements LlmProvider {
  readonly id: ProviderId = 'openrouter';
  release: () => void = () => {};
  private readonly gate = new Promise<void>(resolve => { this.release = resolve; });

  ready(): boolean { return true; }

  async *stream(): AsyncIterable<LlmChunk> {
    await this.gate;
    yield { type: 'text', delta: 'Generated Title' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class FakeHost implements AutoNameHost {
  constructor(private readonly thread: Thread) {}

  getThread(threadId: string): Thread | undefined {
    return threadId === this.thread.id ? this.thread : undefined;
  }

  getModelCandidates(fallbackModelId: string): string[] {
    return [fallbackModelId];
  }

  setThreadNaming(threadId: string, naming: boolean): void {
    const thread = this.getThread(threadId);
    if (thread) thread.naming = naming;
  }

  applyThreadTitle(threadId: string, title: string): void {
    const thread = this.getThread(threadId);
    if (!thread || thread.autoNamed || thread.deletedAt != null) return;
    thread.title = title;
    thread.autoNamed = true;
  }
}

function makeThread(): Thread {
  return {
    id: 'thread-1',
    title: 'New conversation',
    subtitle: '',
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
    modelId: 'or-gemini-3-flash',
    messages: [
      { id: 'u1', role: 'user', content: 'help me refactor auth', createdAt: 2 },
      { id: 'a1', role: 'assistant', content: 'We can split the auth service.', createdAt: 3 },
    ],
  };
}

function router(provider: LlmProvider): AutoNameRouter {
  return {
    canRoute: () => true,
    resolve: () => ({ provider, providerModelId: 'google/gemini-3-flash' }),
  };
}

async function flush(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('AutoNamer', () => {
  it('sets the transient naming flag and applies a generated title', async () => {
    const thread = makeThread();
    const provider = new OneShotProvider([
      { type: 'text', delta: 'Refactoring Auth Layer.' },
      { type: 'done', finishReason: 'stop' },
    ]);
    const namer = new AutoNamer({ host: new FakeHost(thread), router: router(provider) });
    const assistant = thread.messages[1];
    if (assistant.role !== 'assistant') throw new Error('expected assistant');

    namer.maybeAutoName(thread.id, assistant);
    expect(thread.naming).toBe(true);
    await flush();

    expect(thread.naming).toBe(false);
    expect(thread.title).toBe('Refactoring Auth Layer');
    expect(thread.autoNamed).toBe(true);
    expect(provider.calls[0].systemPrompt).toContain('name conversations');
  });

  it('does not overwrite a manual title while the namer is in flight', async () => {
    const thread = makeThread();
    const provider = new GatedProvider();
    const namer = new AutoNamer({ host: new FakeHost(thread), router: router(provider) });
    const assistant = thread.messages[1];
    if (assistant.role !== 'assistant') throw new Error('expected assistant');

    namer.maybeAutoName(thread.id, assistant);
    expect(thread.naming).toBe(true);
    thread.title = 'Manual Title';
    thread.autoNamed = true;
    provider.release();
    await flush();

    expect(thread.naming).toBe(false);
    expect(thread.title).toBe('Manual Title');
  });

  it('does not rename a thread soft-deleted while the namer is in flight', async () => {
    const thread = makeThread();
    const provider = new GatedProvider();
    const namer = new AutoNamer({ host: new FakeHost(thread), router: router(provider) });
    const assistant = thread.messages[1];
    if (assistant.role !== 'assistant') throw new Error('expected assistant');

    namer.maybeAutoName(thread.id, assistant);
    thread.deletedAt = 10;
    provider.release();
    await flush();

    expect(thread.naming).toBe(false);
    expect(thread.title).toBe('New conversation');
    expect(thread.autoNamed).toBeUndefined();
  });

  it('uses a local model for naming when keyless Ollama is online', async () => {
    clearAppStorage();
    const registry = new ModelRegistry();
    registry.setDynamicForProvider('ollama', [{
      id: 'ollama-llama3.2:3b',
      name: 'llama3.2:3b',
      vendor: 'Ollama',
      providerId: 'ollama',
      providerModelId: 'llama3.2:3b',
      dynamic: true,
      contextLength: 32_000,
    }]);
    const providers = new ProviderStore(registry, () => ({
      ollama: { baseUrl: 'http://127.0.0.1:11434', available: true, toolsEnabled: true },
    }));
    const provider = new OneShotProvider([
      { type: 'text', delta: 'Local Naming' },
      { type: 'done', finishReason: 'stop' },
    ]);
    installMockProvider(providers, provider);
    const chat = new ChatStore(providers, registry, new UserProfileStore());

    chat.sendMessage('name this locally');
    await flush(60);

    expect(chat.activeThread?.modelId).toBe('ollama-llama3.2:3b');
    expect(provider.calls.at(-1)?.modelId).toBe('ollama-llama3.2:3b');
    chat.dispose();
    providers.dispose();
    clearAppStorage();
  });
});
