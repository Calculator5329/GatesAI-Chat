import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runInAction } from 'mobx';
import { ChatStore } from '../../src/stores/ChatStore';
import { ProviderStore } from '../../src/stores/ProviderStore';
import { ModelRegistry } from '../../src/stores/ModelRegistry';
import { UserProfileStore } from '../../src/stores/UserProfileStore';
import { SummaryStore } from '../../src/stores/SummaryStore';
import { MockProvider, flush, installMockProvider } from '../helpers/mockProvider';
import { clearAppStorage } from '../helpers/storage';
import type { LlmProvider, ProviderId } from '../../src/core/llm';

/**
 * SummaryStore picks a summarizer provider via `providers.router.get(id)` —
 * a different path than the chat-turn router.resolve we monkey-patch in the
 * other test file. Patch both seams here so the store can find a provider
 * regardless of which fast model it tries first.
 */
function installEverywhere(providers: ProviderStore, mock: MockProvider): void {
  installMockProvider(providers, mock);
  // Override get() to always return the mock and report ready.
  (providers.router as unknown as { get: (id: ProviderId) => LlmProvider }).get = () => mock;
}

function setup() {
  clearAppStorage();
  const registry = new ModelRegistry();
  const providers = new ProviderStore(registry);
  const profile = new UserProfileStore();
  const chat = new ChatStore(providers, registry, profile);
  return { registry, providers, profile, chat };
}

describe('SummaryStore', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => clearAppStorage());

  it('skips threads with too few messages', async () => {
    const { chat, providers, registry } = setup();
    const mock = new MockProvider([{ type: 'text', delta: 'A short summary.' }, { type: 'done', finishReason: 'stop' }]);
    installEverywhere(providers, mock);

    const t1 = chat.createThread();
    chat.sendMessage('hello'); // 1 message — not enough
    await flush(20);

    const summary = new SummaryStore(chat, providers, registry);
    // Bypass the idle gate by stubbing the timestamp.
    (summary as unknown as { lastActivityAt: number }).lastActivityAt = 0;
    await summary.tick();

    const t = chat.threads.find(x => x.id === t1)!;
    expect(t.summary).toBeUndefined();
  });

  it('summarizes idle threads with ≥ 4 messages and records the count', async () => {
    const { chat, providers, registry } = setup();
    const mock = new MockProvider([
      { type: 'text', delta: 'User and assistant discussed X and decided Y.' },
      { type: 'done', finishReason: 'stop' },
    ]);
    installEverywhere(providers, mock);

    // Thread to be summarized — fill it manually so we don't await stream.
    const tid = chat.createThread();
    const t = chat.threads.find(x => x.id === tid)!;
    runInAction(() => {
      t.messages.push(
        { id: 'm1', role: 'user',      content: 'about X?',          createdAt: 1 },
        { id: 'm2', role: 'assistant', content: 'X is …',             createdAt: 2 },
        { id: 'm3', role: 'user',      content: 'and Y?',             createdAt: 3 },
        { id: 'm4', role: 'assistant', content: 'Y because …',        createdAt: 4 },
      );
    });
    // Switch to a different active thread so this one is "not active".
    const other = chat.createThread();
    expect(chat.activeThreadId).toBe(other);

    const summary = new SummaryStore(chat, providers, registry);
    (summary as unknown as { lastActivityAt: number }).lastActivityAt = 0;
    await summary.tick();

    const fresh = chat.threads.find(x => x.id === tid)!;
    expect(fresh.summary).toContain('X');
    expect(fresh.summaryMessageCount).toBe(4);
    expect(fresh.summaryUpdatedAt).toBeGreaterThan(0);
  });

  it('skips re-summarizing if not enough new messages have arrived', async () => {
    const { chat, providers, registry } = setup();
    const mock = new MockProvider([
      { type: 'text', delta: 'first summary' },
      { type: 'done', finishReason: 'stop' },
    ]);
    installEverywhere(providers, mock);

    const tid = chat.createThread();
    const t = chat.threads.find(x => x.id === tid)!;
    runInAction(() => {
      for (let i = 0; i < 5; i++) {
        t.messages.push({ id: `m${i}`, role: 'user', content: `msg ${i}`, createdAt: i });
      }
    });
    chat.createThread(); // make the first thread inactive

    const summary = new SummaryStore(chat, providers, registry);
    (summary as unknown as { lastActivityAt: number }).lastActivityAt = 0;
    await summary.tick();
    expect(t.summary).toBe('first summary');
    expect(t.summaryMessageCount).toBe(5);

    // Add only 2 more messages — below the 4-message threshold for re-run.
    runInAction(() => {
      t.messages.push({ id: 'm5', role: 'user', content: '5', createdAt: 5 });
      t.messages.push({ id: 'm6', role: 'user', content: '6', createdAt: 6 });
    });
    mock.calls.length = 0;
    await summary.tick();
    expect(mock.calls).toHaveLength(0); // skipped
  });

  it('recentSummariesExcluding returns sorted, filtered "title: summary" lines', () => {
    const { chat, providers, registry } = setup();
    const summary = new SummaryStore(chat, providers, registry);
    const a = chat.createThread();
    const b = chat.createThread();
    const c = chat.createThread();
    const ta = chat.threads.find(x => x.id === a)!;
    const tb = chat.threads.find(x => x.id === b)!;
    const tc = chat.threads.find(x => x.id === c)!;
    runInAction(() => {
      ta.title = 'Auth';     ta.summary = 'Built JWT login';     ta.summaryUpdatedAt = 100;
      tb.title = 'Billing';  tb.summary = 'Picked Stripe';        tb.summaryUpdatedAt = 300;
      tc.title = 'No-summary'; // no summary — should be filtered out
    });

    const lines = summary.recentSummariesExcluding(c);
    expect(lines).toEqual([
      'Billing: Picked Stripe',
      'Auth: Built JWT login',
    ]);

    // Excluding the active thread itself.
    const excludeA = summary.recentSummariesExcluding(a);
    expect(excludeA).toEqual(['Billing: Picked Stripe']);
  });
});
