import { runInAction } from 'mobx';
import { describe, expect, it } from 'vitest';
import { StreamingTextBuffer } from '../../src/services/streaming/StreamingTextBuffer';
import { flattenForWire } from '../../src/services/llm/wireFormat';
import { bytesToBase64 } from '../../src/services/image/types';
import type { Message } from '../../src/core/types';
import { ChatStore } from '../../src/stores/ChatStore';
import { ProviderStore } from '../../src/stores/ProviderStore';
import { ModelRegistry } from '../../src/stores/ModelRegistry';
import { UserProfileStore } from '../../src/stores/UserProfileStore';
import { flushPendingSnapshot } from '../../src/services/persistence';
import { MockProvider, installMockProvider } from '../helpers/mockProvider';
import { clearAppStorage } from '../helpers/storage';

/**
 * Performance smoke tests. These don't aim to be precise benchmarks —
 * they're regression guards. The numbers are generous on purpose so a
 * busy CI runner doesn't flake; a real perf regression typically
 * blows the budget by an order of magnitude.
 */

const PERF_TOLERANCE = 4; // multiplier in CI-busy environments

function measure(label: string, fn: () => void): number {
  const t0 = performance.now();
  fn();
  const elapsed = performance.now() - t0;
  if (process.env.PERF_VERBOSE) console.log(`${label}: ${elapsed.toFixed(2)}ms`);
  return elapsed;
}

describe('StreamingTextBuffer throughput', () => {
  it('coalesces 10k single-char deltas with low overhead', () => {
    const flushed: string[] = [];
    const buffer = new StreamingTextBuffer((flush) => flush(), 1024);

    const elapsed = measure('10k deltas', () => {
      for (let i = 0; i < 10_000; i++) {
        buffer.enqueue('m', 'x', (text) => flushed.push(text));
      }
      buffer.flush('m');
    });

    // Reassembling all bytes is the correctness guard.
    const total = flushed.reduce((acc, s) => acc + s.length, 0);
    expect(total).toBe(10_000);
    // 10k enqueues + ~10 flushes (1024-char threshold) should complete in well
    // under 250ms on a modern dev box. Allow generous CI headroom.
    expect(elapsed).toBeLessThan(250 * PERF_TOLERANCE);
  });

  it('handles 1k independent stream keys without quadratic blow-up', () => {
    const flushed = new Map<string, number>();
    const scheduled: Array<() => void> = [];
    const buffer = new StreamingTextBuffer((flush) => scheduled.push(flush));

    const elapsed = measure('1k keys × 10 deltas', () => {
      for (let i = 0; i < 1_000; i++) {
        const key = `k-${i}`;
        for (let j = 0; j < 10; j++) {
          buffer.enqueue(key, 'abc', (text) => flushed.set(key, (flushed.get(key) ?? 0) + text.length));
        }
      }
      scheduled.forEach((f) => f());
    });

    expect(flushed.size).toBe(1_000);
    for (const len of flushed.values()) expect(len).toBe(30);
    expect(elapsed).toBeLessThan(500 * PERF_TOLERANCE);
  });
});

describe('flattenForWire scaling', () => {
  function buildMessages(turns: number): Message[] {
    const out: Message[] = [];
    for (let i = 0; i < turns; i++) {
      out.push({ id: `u-${i}`, role: 'user', content: `q-${i}`, createdAt: i });
      out.push({
        id: `a-${i}`,
        role: 'assistant',
        content: `prose ${i}`,
        createdAt: i,
        toolCalls: [
          { id: `c-${i}-1`, name: 'memory', arguments: { action: 'list' } },
          { id: `c-${i}-2`, name: 'time', arguments: {} },
        ],
        toolResults: [
          { toolCallId: `c-${i}-1`, toolName: 'memory', content: 'ok', ranAt: i },
          { toolCallId: `c-${i}-2`, toolName: 'time', content: '2026', ranAt: i },
        ],
      });
    }
    return out;
  }

  it('flattens a 100-turn thread within budget', () => {
    const messages = buildMessages(100);
    let result;
    const elapsed = measure('flatten 100 turns', () => {
      result = flattenForWire(messages);
    });

    // Each assistant turn with calls expands to 1 + 2 + 1 = 4 wire messages,
    // plus 1 user. So 100 turns × 5 = 500.
    expect(result!.length).toBe(500);
    expect(elapsed).toBeLessThan(50 * PERF_TOLERANCE);
  });

  it('flattens a 1000-turn thread without going superlinear', () => {
    const messages = buildMessages(1000);
    let result;
    const elapsed = measure('flatten 1000 turns', () => {
      result = flattenForWire(messages);
    });
    expect(result!.length).toBe(5_000);
    expect(elapsed).toBeLessThan(250 * PERF_TOLERANCE);
  });
});

describe('bytesToBase64 throughput', () => {
  it('encodes ~4 MB without blowing the call stack and within budget', () => {
    const size = 4 * 1024 * 1024;
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i & 0xff;

    let encoded = '';
    const elapsed = measure('encode 4MB', () => {
      encoded = bytesToBase64(bytes);
    });
    // base64 expands by ~4/3.
    expect(encoded.length).toBeGreaterThanOrEqual(Math.ceil(size / 3) * 4 - 4);
    expect(elapsed).toBeLessThan(2_000 * PERF_TOLERANCE);
  });
});

describe('ChatStore send path startup', () => {
  it('starts provider streaming quickly on a 1000-turn thread', async () => {
    clearAppStorage();
    const registry = new ModelRegistry();
    const providers = new ProviderStore(registry);
    const profile = new UserProfileStore();
    const mock = new MockProvider([{ type: 'text', delta: 'ok' }, { type: 'done', finishReason: 'stop' }]);
    installMockProvider(providers, mock);
    const chat = new ChatStore(providers, registry, profile);
    chat.createThread();
    const thread = chat.activeThread;
    if (!thread) throw new Error('missing active thread');

    runInAction(() => {
      thread.messages = Array.from({ length: 2_000 }, (_, index) => ({
        id: `m-${index}`,
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `historical message ${index}`,
        createdAt: index,
        ...(index % 2 === 1 ? { model: 'or-gpt-5.4-mini' } : {}),
      })) as Message[];
    });

    const t0 = performance.now();
    chat.sendMessage('continue');
    for (let i = 0; i < 20 && mock.calls.length === 0; i++) {
      await Promise.resolve();
    }
    const elapsed = performance.now() - t0;

    expect(mock.calls.length).toBe(1);
    expect(elapsed).toBeLessThan(250 * PERF_TOLERANCE);
    // dispose() drains the 250ms autosave throttle synchronously, so no timer
    // can write to localStorage after clearAppStorage() (previously a 260ms sleep).
    chat.dispose();
    flushPendingSnapshot();
    clearAppStorage();
  });
});
