import { describe, expect, it } from 'vitest';
import { buildRuntimeContext } from '../../../src/services/chat/runtimeContext';

describe('runtime context composition', () => {
  it('includes time, bridge, platform, version, and workspace semantics', () => {
    const context = buildRuntimeContext({
      bridge: { isOnline: true, platform: 'win32', version: '1.2.3' },
      now: new Date('2026-04-25T20:00:00.000Z'),
      timeZone: 'UTC',
    });

    expect(context).toContain('timezone: UTC');
    expect(context).toContain('iso: 2026-04-25T20:00:00.000Z');
    expect(context).toContain('bridge: online');
    expect(context).toContain('platform: win32');
    expect(context).toContain('bridge_version: 1.2.3');
    expect(context).toContain('/workspace/attachments');
    expect(context).toContain('terminal_cwd: bridge workspace root');
  });
});
