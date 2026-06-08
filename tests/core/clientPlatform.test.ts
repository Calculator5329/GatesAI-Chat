import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __resetClientPlatformForTests,
  clientArch,
  detectClientOs,
  primeClientPlatform,
} from '../../src/core/clientPlatform';

/** Replace the navigator global for one test; cleared in afterEach. */
function stubNavigator(fields: { userAgentData?: unknown; platform?: string; userAgent?: string }): void {
  vi.stubGlobal('navigator', fields);
}

afterEach(() => {
  __resetClientPlatformForTests();
  vi.unstubAllGlobals();
});

describe('detectClientOs', () => {
  it('detects Windows from Client Hints platform', () => {
    stubNavigator({ userAgentData: { platform: 'Windows' }, platform: '', userAgent: '' });
    expect(detectClientOs()).toBe('windows');
  });

  it('detects macOS and Linux from the legacy platform string', () => {
    stubNavigator({ userAgentData: undefined, platform: 'MacIntel', userAgent: '' });
    expect(detectClientOs()).toBe('macos');
    stubNavigator({ userAgentData: undefined, platform: 'Linux x86_64', userAgent: '' });
    expect(detectClientOs()).toBe('linux');
  });

  it('treats mobile user agents as other (we only ship desktop builds)', () => {
    stubNavigator({ userAgentData: undefined, platform: '', userAgent: 'iPhone' });
    expect(detectClientOs()).toBe('other');
  });
});

describe('clientArch', () => {
  it('assumes x64 on Windows before priming resolves', () => {
    stubNavigator({ userAgentData: undefined, platform: 'Win32', userAgent: '' });
    expect(clientArch()).toBe('x64');
  });

  it('resolves arm64 from high-entropy Client Hints', async () => {
    stubNavigator({
      userAgentData: {
        platform: 'Windows',
        getHighEntropyValues: async () => ({ architecture: 'arm', bitness: '64' }),
      },
      platform: 'Win32',
      userAgent: '',
    });
    await primeClientPlatform();
    expect(clientArch()).toBe('arm64');
  });

  it('maps x86/64-bit Client Hints to x64', async () => {
    stubNavigator({
      userAgentData: {
        platform: 'Windows',
        getHighEntropyValues: async () => ({ architecture: 'x86', bitness: '64' }),
      },
      platform: 'Win32',
      userAgent: '',
    });
    await primeClientPlatform();
    expect(clientArch()).toBe('x64');
  });

  it('never throws when Client Hints are unavailable', async () => {
    stubNavigator({ userAgentData: undefined, platform: 'MacIntel', userAgent: '' });
    await expect(primeClientPlatform()).resolves.toBeUndefined();
    expect(clientArch()).toBe('unknown'); // macOS has no default assumption
  });
});
