import { afterEach, describe, expect, it } from 'vitest';
import { configureLogSink, logger } from '../../../src/services/diagnostics/logger';

interface WriteCall { path: string; content: string; append: boolean }

function makeSink(online = true) {
  const writes: WriteCall[] = [];
  const sink = {
    isOnline: online,
    client: {
      request: async <T,>(_op: string, data: unknown): Promise<T> => {
        writes.push(data as WriteCall);
        return {} as T;
      },
    },
  };
  return { sink, writes };
}

const flushMicrotasks = () => new Promise<void>((r) => setTimeout(r, 0));

afterEach(() => {
  configureLogSink(null);
});

describe('logger file sinks', () => {
  it('writes info entries to the daily app log only', async () => {
    const { sink, writes } = makeSink();
    configureLogSink(sink);
    logger.info('test-scope', 'routine event');
    await flushMicrotasks();
    const paths = writes.map(w => w.path);
    expect(paths.some(p => /^\/workspace\/logs\/app-\d{4}-\d{2}-\d{2}\.log$/.test(p))).toBe(true);
    expect(paths.some(p => p.includes('/errors-'))).toBe(false);
  });

  it('duplicates warn and error entries into the daily error trail with their data payload', async () => {
    const { sink, writes } = makeSink();
    configureLogSink(sink);
    logger.error('image-jobs', 'dispatch imgjob-x failed: Load failed', {
      jobId: 'imgjob-x',
      backend: 'local-comfy',
    });
    logger.warn('bridge', 'went offline');
    await flushMicrotasks();
    const errorWrites = writes.filter(w => /^\/workspace\/logs\/errors-\d{4}-\d{2}-\d{2}\.jsonl$/.test(w.path));
    expect(errorWrites).toHaveLength(2);
    expect(errorWrites.every(w => w.append)).toBe(true);
    const parsed = JSON.parse(errorWrites[0].content);
    expect(parsed.level).toBe('error');
    expect(parsed.scope).toBe('image-jobs');
    expect(parsed.data).toEqual({ jobId: 'imgjob-x', backend: 'local-comfy' });
    expect(parsed.t).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('writes nothing when the sink is offline', async () => {
    const { sink, writes } = makeSink(false);
    configureLogSink(sink);
    logger.error('test-scope', 'boom');
    await flushMicrotasks();
    expect(writes).toHaveLength(0);
  });
});
