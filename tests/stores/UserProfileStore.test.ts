import { afterEach, describe, expect, it, vi } from 'vitest';
import { UserProfileStore } from '../../src/stores/UserProfileStore';

describe('UserProfileStore.composeSystemPrompt harness selection', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the bridge harness on desktop', () => {
    const store = new UserProfileStore();
    const prompt = store.composeSystemPrompt() ?? '';
    expect(prompt).toContain('Bridge workspace contract:');
    expect(prompt).not.toContain('Web Lite');
  });

  it('uses the browser-only harness in Web Lite and never claims local tools', () => {
    vi.stubEnv('VITE_GATESAI_WEB', '1');
    const store = new UserProfileStore();
    const prompt = store.composeSystemPrompt() ?? '';
    expect(prompt).toContain('Web Lite (browser-only)');
    expect(prompt).toContain('recommend downloading the desktop app');
    expect(prompt).not.toContain('Bridge workspace contract:');
  });
});
