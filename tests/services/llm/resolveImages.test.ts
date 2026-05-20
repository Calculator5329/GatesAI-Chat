import { describe, expect, it, vi } from 'vitest';
import { resolveWireImages } from '../../../src/services/llm/resolveImages';
import { flattenForWire } from '../../../src/services/llm/wireFormat';
import type { Message } from '../../../src/core/types';
import type { BridgeStore } from '../../../src/stores/BridgeStore';

function fakeBridge(reads: Record<string, { base64: string; mime: string; size: number } | null>): BridgeStore {
  return {
    readAttachmentBase64: vi.fn(async (path: string) => reads[path] ?? null),
  } as unknown as BridgeStore;
}

function throwingBridge(): BridgeStore {
  return {
    readAttachmentBase64: vi.fn(async () => {
      throw new Error('bridge read failed');
    }),
  } as unknown as BridgeStore;
}

describe('resolveWireImages', () => {
  it('populates images on the corresponding user wire entry for image mime types', async () => {
    const messages: Message[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'Look at these.',
        createdAt: 0,
        attachments: [
          { path: '/workspace/a.png', name: 'a.png', mime: 'image/png', size: 10 },
          { path: '/workspace/b.csv', name: 'b.csv', mime: 'text/csv', size: 20 },
        ],
      },
    ];
    const wire = flattenForWire(messages);
    const bridge = fakeBridge({
      '/workspace/a.png': { base64: 'AAA=', mime: 'image/png', size: 10 },
      '/workspace/b.csv': { base64: 'QkJC', mime: 'text/csv', size: 20 },
    });

    await resolveWireImages(wire, messages, bridge, true);

    expect(bridge.readAttachmentBase64).toHaveBeenCalledTimes(1);
    expect(bridge.readAttachmentBase64).toHaveBeenCalledWith('/workspace/a.png');
    expect(wire[0].images).toEqual([{ mime: 'image/png', base64: 'AAA=' }]);
  });

  it('skips entirely when the model does not support vision', async () => {
    const messages: Message[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'Ignored.',
        createdAt: 0,
        attachments: [{ path: '/workspace/a.png', name: 'a.png', mime: 'image/png', size: 10 }],
      },
    ];
    const wire = flattenForWire(messages);
    const bridge = fakeBridge({ '/workspace/a.png': { base64: 'AAA=', mime: 'image/png', size: 10 } });

    await resolveWireImages(wire, messages, bridge, false);

    expect(bridge.readAttachmentBase64).not.toHaveBeenCalled();
    expect(wire[0].images).toBeUndefined();
  });

  it('drops attachments whose bytes cannot be read instead of throwing', async () => {
    const messages: Message[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'Look.',
        createdAt: 0,
        attachments: [
          { path: '/workspace/good.png', name: 'good.png', mime: 'image/png', size: 10 },
          { path: '/workspace/missing.png', name: 'missing.png', mime: 'image/png', size: 10 },
        ],
      },
    ];
    const wire = flattenForWire(messages);
    const bridge = fakeBridge({
      '/workspace/good.png': { base64: 'AAA=', mime: 'image/png', size: 10 },
      '/workspace/missing.png': null,
    });

    await resolveWireImages(wire, messages, bridge, true);

    expect(wire[0].images).toEqual([{ mime: 'image/png', base64: 'AAA=' }]);
  });

  it('drops attachments whose bridge read rejects instead of failing the turn', async () => {
    const messages: Message[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'Look.',
        createdAt: 0,
        attachments: [{ path: '/workspace/bad.png', name: 'bad.png', mime: 'image/png', size: 10 }],
      },
    ];
    const wire = flattenForWire(messages);
    const bridge = throwingBridge();

    await expect(resolveWireImages(wire, messages, bridge, true)).resolves.toBe(wire);

    expect(wire[0].images).toBeUndefined();
  });

  it('zips user stored messages positionally across mixed turns', async () => {
    const messages: Message[] = [
      { id: 'u1', role: 'user', content: 'first', createdAt: 0 },
      { id: 'a1', role: 'assistant', content: 'hi', createdAt: 0 },
      {
        id: 'u2',
        role: 'user',
        content: 'second',
        createdAt: 0,
        attachments: [{ path: '/workspace/x.jpg', name: 'x.jpg', mime: 'image/jpeg', size: 5 }],
      },
    ];
    const wire = flattenForWire(messages);
    const bridge = fakeBridge({
      '/workspace/x.jpg': { base64: 'JJJ=', mime: 'image/jpeg', size: 5 },
    });

    await resolveWireImages(wire, messages, bridge, true);

    const secondUser = wire.filter(m => m.role === 'user')[1];
    expect(secondUser.images).toEqual([{ mime: 'image/jpeg', base64: 'JJJ=' }]);
  });

  it('aligns reduced-context wire messages with the latest stored user message', async () => {
    const messages: Message[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'first',
        createdAt: 0,
        attachments: [{ path: '/workspace/old.png', name: 'old.png', mime: 'image/png', size: 5 }],
      },
      { id: 'a1', role: 'assistant', content: 'hi', createdAt: 0 },
      {
        id: 'u2',
        role: 'user',
        content: 'second',
        createdAt: 0,
        attachments: [{ path: '/workspace/latest.png', name: 'latest.png', mime: 'image/png', size: 5 }],
      },
    ];
    const wire = flattenForWire([messages[2]]);
    const bridge = fakeBridge({
      '/workspace/old.png': { base64: 'OLD=', mime: 'image/png', size: 5 },
      '/workspace/latest.png': { base64: 'NEW=', mime: 'image/png', size: 5 },
    });

    await resolveWireImages(wire, messages, bridge, true);

    expect(bridge.readAttachmentBase64).toHaveBeenCalledTimes(1);
    expect(bridge.readAttachmentBase64).toHaveBeenCalledWith('/workspace/latest.png');
    expect(wire[0].images).toEqual([{ mime: 'image/png', base64: 'NEW=' }]);
  });

  it('no-ops when the bridge is absent', async () => {
    const messages: Message[] = [
      {
        id: 'u1',
        role: 'user',
        content: 'hi',
        createdAt: 0,
        attachments: [{ path: '/workspace/a.png', name: 'a.png', mime: 'image/png', size: 10 }],
      },
    ];
    const wire = flattenForWire(messages);

    await resolveWireImages(wire, messages, undefined, true);

    expect(wire[0].images).toBeUndefined();
  });
});
