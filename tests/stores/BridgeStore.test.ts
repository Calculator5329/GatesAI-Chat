import { describe, expect, it, vi } from 'vitest';
import { BridgeStore } from '../../src/stores/BridgeStore';

describe('BridgeStore attachment facade', () => {
  it('uploads files through the bridge client and returns draft attachment metadata', async () => {
    const bridge = new BridgeStore();
    bridge.state = 'online';
    const request = vi
      .spyOn(bridge.client, 'request')
      .mockResolvedValue({ path: '/workspace/attachments/plan.csv', bytes_written: 5 });

    const attachment = await bridge.uploadAttachment(new File(['hello'], 'plan.csv', { type: 'text/csv' }));

    expect(request).toHaveBeenCalledWith('fs.write', expect.objectContaining({
      path: '/workspace/attachments/plan.csv',
      encoding: 'base64',
      append: false,
    }));
    expect(attachment).toMatchObject({
      filename: 'plan.csv',
      path: '/workspace/attachments/plan.csv',
      size: 5,
      mime: 'text/csv',
    });
  });
});

describe('BridgeStore.readAttachmentBase64', () => {
  it('requests fs.read with base64 encoding and returns bytes + mime', async () => {
    const bridge = new BridgeStore();
    bridge.state = 'online';
    const request = vi.spyOn(bridge.client, 'request').mockResolvedValue({
      path: '/workspace/attachments/shot.png',
      content: 'aGVsbG8=',
      encoding: 'base64',
      size: 5,
      mime: 'image/png',
    });

    const result = await bridge.readAttachmentBase64('/workspace/attachments/shot.png');

    expect(request).toHaveBeenCalledWith('fs.read', {
      path: '/workspace/attachments/shot.png',
      encoding: 'base64',
    });
    expect(result).toEqual({ base64: 'aGVsbG8=', mime: 'image/png', size: 5 });
  });

  it('returns null when the bridge is offline instead of throwing', async () => {
    const bridge = new BridgeStore();
    bridge.state = 'offline';
    const request = vi.spyOn(bridge.client, 'request');

    const result = await bridge.readAttachmentBase64('/workspace/attachments/shot.png');

    expect(request).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('returns null when the bridge unexpectedly sends utf8 instead of base64', async () => {
    const bridge = new BridgeStore();
    bridge.state = 'online';
    vi.spyOn(bridge.client, 'request').mockResolvedValue({
      path: '/workspace/attachments/shot.png',
      content: 'hello',
      encoding: 'utf8',
      size: 5,
      mime: 'image/png',
    });

    const result = await bridge.readAttachmentBase64('/workspace/attachments/shot.png');
    expect(result).toBeNull();
  });

  it('returns null and swallows non-offline errors', async () => {
    const bridge = new BridgeStore();
    bridge.state = 'online';
    vi.spyOn(bridge.client, 'request').mockRejectedValue(new Error('boom'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await bridge.readAttachmentBase64('/workspace/attachments/shot.png');

    expect(result).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
