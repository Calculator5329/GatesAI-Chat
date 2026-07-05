import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SchedulesStore } from '../../src/stores/SchedulesStore';
import { ChatStore } from '../../src/stores/ChatStore';
import { ModelRegistry } from '../../src/stores/ModelRegistry';
import { ProviderStore } from '../../src/stores/ProviderStore';
import { UserProfileStore } from '../../src/stores/UserProfileStore';
import { createSchedulesPersistenceProvider } from '../../src/services/schedulesStorage';
import { MAX_CONCURRENT_AGENT_TASKS } from '../../src/services/chat/agentTasks';
import type { Thread } from '../../src/core/types';
import type { LlmChunk, LlmProvider, LlmRequest } from '../../src/core/llm';
import type { KeyValuePersistence } from '../../src/services/storage/persistenceProvider';
import { installMockProvider, flush } from '../helpers/mockProvider';
import { clearAppStorage } from '../helpers/storage';

class FakeClock {
  value: number;
  constructor(start: number) {
    this.value = start;
  }
  now(): number {
    return this.value;
  }
  advance(ms: number): void {
    this.value += ms;
  }
}

class MemoryStorage implements KeyValuePersistence {
  values = new Map<string, string>();
  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class ScheduleProvider implements LlmProvider {
  readonly id = 'ollama' as const;
  readonly calls: LlmRequest[] = [];

  ready(): boolean { return true; }

  async *stream(req: LlmRequest): AsyncIterable<LlmChunk> {
    this.calls.push(req);
    yield { type: 'text', delta: 'Scheduled local summary.' };
    yield { type: 'done', finishReason: 'stop' };
  }
}

class FakeChat {
  threads: Thread[] = [{
    id: 'origin',
    title: 'Origin',
    subtitle: '',
    modelId: 'or-gemini-3-flash',
    messages: [],
    createdAt: 0,
    updatedAt: 0,
    pinned: false,
  }];
  activeThreadId: string | null = 'origin';
  calls: Array<{ title: string; instructions: string; model?: string; originThreadId: string }> = [];

  createThread(): string {
    const id = `origin-${this.threads.length}`;
    this.threads.unshift({
      id,
      title: 'New conversation',
      subtitle: '',
      modelId: 'or-gemini-3-flash',
      messages: [],
      createdAt: 0,
      updatedAt: 0,
      pinned: false,
    });
    this.activeThreadId = id;
    return id;
  }

  runningAgentTaskCount(): number {
    return this.threads.filter(thread => thread.agentTask && thread.agentTaskStatus === 'running').length;
  }

  isThreadStreaming(): boolean {
    return false;
  }

  spawnTask(input: { title: string; instructions: string; model?: string }, originThreadId: string) {
    this.calls.push({ ...input, originThreadId });
    const threadId = `agent-${this.calls.length}`;
    this.threads.unshift({
      id: threadId,
      title: `Agent: ${input.title}`,
      subtitle: '',
      modelId: input.model ?? 'or-gemini-3-flash',
      messages: [{ id: `m-${threadId}`, role: 'user', content: input.instructions, createdAt: 0 }],
      createdAt: 0,
      updatedAt: 0,
      pinned: false,
      agentTask: true,
      agentTaskOriginThreadId: originThreadId,
      agentTaskStatus: 'running',
    });
    return { ok: true, message: `Task ${input.title} started.`, threadId };
  }

  finish(threadId: string): void {
    const thread = this.threads.find(item => item.id === threadId);
    if (thread) thread.agentTaskStatus = 'done';
  }
}

function makeStore(start = Date.parse('2026-01-01T00:00:00Z'), storage = new MemoryStorage()) {
  const clock = new FakeClock(start);
  const chat = new FakeChat();
  const persistence = createSchedulesPersistenceProvider(storage);
  const store = new SchedulesStore(chat, { clock, persistence, autoPersist: false });
  return { store, chat, clock, persistence, storage };
}

describe('SchedulesStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    clearAppStorage();
  });

  it('defers while disabled and recomputes next run when re-enabled', () => {
    const { store, chat, clock } = makeStore();
    const schedule = store.create({
      title: 'Disabled',
      instructions: 'Do work.',
      cadence: { kind: 'interval', hours: 1 },
      enabled: false,
    });

    clock.advance(60 * 60_000);
    store.tick();

    expect(chat.calls).toHaveLength(0);
    store.setEnabled(schedule.id, true);
    store.tick();
    expect(chat.calls).toHaveLength(0);
    expect(store.nextRunAt(schedule.id)).toBeGreaterThan(clock.now());
  });

  it('defers when all agent-task slots are full and starts on a later tick', () => {
    const { store, chat, clock } = makeStore();
    store.create({ title: 'Due', instructions: 'Run.', cadence: { kind: 'interval', hours: 1 } });
    for (let i = 0; i < MAX_CONCURRENT_AGENT_TASKS; i += 1) {
      chat.spawnTask({ title: `Busy ${i}`, instructions: 'Hold.' }, 'origin');
    }
    clock.advance(60 * 60_000);

    store.tick();
    expect(chat.calls).toHaveLength(MAX_CONCURRENT_AGENT_TASKS);

    for (const thread of chat.threads) {
      if (thread.agentTask) thread.agentTaskStatus = 'done';
    }
    store.tick();

    expect(chat.calls).toHaveLength(MAX_CONCURRENT_AGENT_TASKS + 1);
    expect(chat.calls.at(-1)?.title).toBe('Scheduled: Due');
  });

  it('fires one catch-up run on boot for missed schedules', () => {
    const storage = new MemoryStorage();
    const persistence = createSchedulesPersistenceProvider(storage);
    persistence.save({
      schedules: [{
        id: 's-catch',
        title: 'Catch up',
        instructions: 'Run once.',
        cadence: { kind: 'interval', hours: 1 },
        enabled: true,
        catchUp: true,
        createdAt: Date.parse('2026-01-01T00:00:00Z'),
      }],
    });
    const { store, chat, clock } = makeStore(Date.parse('2026-01-01T03:00:00Z'), storage);

    store.start();
    expect(chat.calls).toHaveLength(1);
    const firstThreadId = store.findById('s-catch')?.lastResultThreadId;
    expect(firstThreadId).toBe('agent-1');

    chat.finish(firstThreadId!);
    store.tick();
    expect(chat.calls).toHaveLength(1);
    expect(store.nextRunAt('s-catch')).toBe(Date.parse('2026-01-01T04:00:00Z'));

    clock.advance(60 * 60_000);
    store.tick();
    expect(chat.calls).toHaveLength(2);
    store.dispose();
  });

  it('skips missed closed-app runs when catch-up is disabled', () => {
    const storage = new MemoryStorage();
    createSchedulesPersistenceProvider(storage).save({
      schedules: [{
        id: 's-skip',
        title: 'Skip missed',
        instructions: 'Run later.',
        cadence: { kind: 'daily', hour: 1, minute: 0 },
        enabled: true,
        catchUp: false,
        createdAt: Date.parse('2026-01-01T00:00:00Z'),
      }],
    });
    const { store, chat } = makeStore(Date.parse('2026-01-02T03:00:00Z'), storage);

    store.start();

    expect(chat.calls).toHaveLength(0);
    const next = store.nextRunAt('s-skip')!;
    expect(next).toBeGreaterThan(Date.parse('2026-01-02T03:00:00Z'));
    expect(new Date(next).getHours()).toBe(1);
    store.dispose();
  });

  it('round-trips schedules through the storage slot', () => {
    const storage = new MemoryStorage();
    const first = makeStore(Date.parse('2026-01-01T00:00:00Z'), storage);
    first.store.create({
      title: 'Persisted',
      instructions: 'Remember this.',
      cadence: { kind: 'daily', hour: 9, minute: 15 },
      catchUp: true,
      model: 'or-gpt-5.4-mini',
    });
    first.persistence.save(first.store.snapshot);

    const second = makeStore(Date.parse('2026-01-01T00:00:00Z'), storage);

    expect(second.store.sorted).toHaveLength(1);
    expect(second.store.sorted[0]).toMatchObject({
      title: 'Persisted',
      catchUp: true,
      model: 'or-gpt-5.4-mini',
      cadence: { kind: 'daily', hour: 9, minute: 15 },
    });
  });

  it('does not fire a duplicate while the previous result task is still running', () => {
    const { store, chat, clock } = makeStore();
    const schedule = store.create({ title: 'No duplicate', instructions: 'Run.', cadence: { kind: 'interval', hours: 1 } });

    clock.advance(60 * 60_000);
    store.tick();
    expect(chat.calls).toHaveLength(1);

    clock.advance(60 * 60_000);
    store.tick();
    expect(chat.calls).toHaveLength(1);

    chat.finish(store.findById(schedule.id)!.lastResultThreadId!);
    store.tick();
    expect(chat.calls).toHaveLength(2);
  });

  it('runNow records last run and result thread when a slot is available', () => {
    const { store, chat } = makeStore();
    const schedule = store.create({
      title: 'Manual',
      instructions: 'Run manually.',
      cadence: { kind: 'interval', hours: 24 },
    });

    const result = store.runNow(schedule.id);

    expect(result.ok).toBe(true);
    expect(result.threadId).toBe('agent-1');
    expect(store.findById(schedule.id)?.lastResultThreadId).toBe('agent-1');
    expect(chat.calls[0]).toMatchObject({
      title: 'Scheduled: Manual',
      instructions: 'Run manually.',
      originThreadId: 'origin',
    });
  });

  it('runs scheduled tasks on a local model when keyless Ollama is online', async () => {
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
    const provider = new ScheduleProvider();
    installMockProvider(providers, provider);
    const chat = new ChatStore(providers, registry, new UserProfileStore());
    const store = new SchedulesStore(chat, {
      clock: new FakeClock(Date.parse('2026-01-01T00:00:00Z')),
      persistence: createSchedulesPersistenceProvider(new MemoryStorage()),
      autoPersist: false,
    });
    const schedule = store.create({
      title: 'Local',
      instructions: 'Run locally.',
      cadence: { kind: 'interval', hours: 24 },
    });

    const result = store.runNow(schedule.id);
    await flush(80);

    const agent = chat.threads.find(thread => thread.id === result.threadId)!;
    expect(result.ok).toBe(true);
    expect(agent.modelId).toBe('ollama-llama3.2:3b');
    expect(provider.calls.find(call => call.threadId === agent.id)?.modelId).toBe('ollama-llama3.2:3b');
    store.dispose();
    chat.dispose();
    providers.dispose();
  });
});
