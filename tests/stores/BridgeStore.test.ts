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
