import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeToolBatch } from '../../../src/services/chat/toolBatchExecutor';
import { toolRegistry } from '../../../src/services/tools/registry';
import type { ToolContext } from '../../../src/services/tools/types';

/** A bridge facade whose first health poll is still in flight. */
function settlingBridge(): { bridge: NonNullable<ToolContext['bridge']>; settle: () => void } {
  let resolveSettled: () => void = () => {};
  const settled = new Promise<void>(resolve => { resolveSettled = resolve; });
  const bridge = {
    isOnline: false,
    state: 'unknown' as string,
    client: { request: vi.fn(async () => ({})) },
    readAttachmentBase64: vi.fn(async () => null),
    whenSettled: () => settled,
  };
  return {
    bridge: bridge as unknown as NonNullable<ToolContext['bridge']>,
    settle: () => {
      bridge.state = 'online';
      bridge.isOnline = true;
      resolveSettled();
    },
  };
}

function deps(bridge: ToolContext['bridge']) {
  return {
    profile: {} as ToolContext['profile'],
    chat: {} as ToolContext['chat'],
    extras: { bridge } as never,
  };
}

const CALL = { id: 'call_1', name: 'image_generate', arguments: { prompt: 'a wax seal' } };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('executeToolBatch and the first bridge poll', () => {
  it('waits for a bridge still on its first poll before running the batch', async () => {
    const { bridge, settle } = settlingBridge();
    const seenOnline: boolean[] = [];
    vi.spyOn(toolRegistry, 'validateToolCall').mockReturnValue({ ok: true, toolName: CALL.name });
    vi.spyOn(toolRegistry, 'isReadOnlyCall').mockReturnValue(false);
    vi.spyOn(toolRegistry, 'execute').mockImplementation(async (_name, _args, ctx) => {
      seenOnline.push(ctx.bridge?.isOnline === true);
      return { content: 'queued', summary: 'queued', ok: true };
    });

    const pending = executeToolBatch([CALL], 't1', new AbortController().signal, deps(bridge));
    await Promise.resolve();
    expect(seenOnline).toEqual([]);

    settle();
    const results = await pending;

    expect(seenOnline).toEqual([true]);
    expect(results[0]?.content).toBe('queued');
  });

  it('does not wait when the bridge state is already known', async () => {
    const whenSettled = vi.fn(async () => undefined);
    const bridge = {
      isOnline: false,
      state: 'offline',
      client: { request: vi.fn(async () => ({})) },
      readAttachmentBase64: vi.fn(async () => null),
      whenSettled,
    } as unknown as NonNullable<ToolContext['bridge']>;
    vi.spyOn(toolRegistry, 'validateToolCall').mockReturnValue({ ok: true, toolName: CALL.name });
    vi.spyOn(toolRegistry, 'isReadOnlyCall').mockReturnValue(false);
    vi.spyOn(toolRegistry, 'execute').mockResolvedValue({ content: 'Error: bridge is offline.', summary: 'offline', ok: false });

    const results = await executeToolBatch([CALL], 't1', new AbortController().signal, deps(bridge));

    expect(whenSettled).not.toHaveBeenCalled();
    expect(results[0]?.content).toMatch(/bridge is offline/);
  });
});
