import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildRuntimeContext } from '../../../src/services/chat/runtimeContext';

describe('runtime context composition', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('includes time, bridge, platform, version, and workspace semantics (desktop)', () => {
    const context = buildRuntimeContext({
      bridge: { isOnline: true, platform: 'win32', version: '1.2.3' },
      now: new Date('2026-04-25T20:00:00.000Z'),
      timeZone: 'UTC',
    });

    expect(context).toContain('timezone: UTC');
    expect(context).toContain('iso: 2026-04-25T20:00:00.000Z');
    expect(context).toContain('runtime_mode: desktop');
    expect(context).toContain('bridge: online');
    expect(context).toContain('platform: win32');
    expect(context).toContain('bridge_version: 1.2.3');
    expect(context).toContain('/workspace/attachments');
    expect(context).toContain('terminal_cwd: bridge workspace root');
  });

  it('injects source workspace state only when prepared', () => {
    const off = buildRuntimeContext({
      bridge: { isOnline: true },
      sourceWorkspace: null,
      now: new Date('2026-04-25T20:00:00.000Z'),
      timeZone: 'UTC',
    });
    const on = buildRuntimeContext({
      bridge: { isOnline: true },
      sourceWorkspace: {
        prepared: true,
        changedFileCount: 3,
        lastBuildStatus: 'succeeded',
        lastBuildFinishedAtUnix: 1_777_136_400,
        lastTestStatus: 'succeeded',
        lastTestFinishedAtUnix: 1_777_147_200,
      },
      now: new Date('2026-04-25T20:00:00.000Z'),
      timeZone: 'UTC',
    });

    expect(off).not.toContain('source_workspace:');
    expect(on).toContain('source_workspace: prepared; changed_files: 3');
    expect(on).toContain('tests: passed 0s ago');
    expect(on).toContain('source_build: succeeded at 2026-04-25T17:00:00.000Z');
    expect(on).toContain('user must approve any installer/update');
  });

  it('emits download facts and omits bridge/workspace lines in Web Lite', () => {
    vi.stubEnv('VITE_GATESAI_WEB', '1');
    const context = buildRuntimeContext({
      now: new Date('2026-04-25T20:00:00.000Z'),
      timeZone: 'UTC',
    });

    expect(context).toContain('runtime_mode: web-lite');
    expect(context).toContain('client_os:');
    expect(context).toContain('recommended_download:');
    expect(context).toContain('download_runs_on:');
    expect(context).toContain('repo_fallback:');
    // Bridge/workspace semantics must not leak into the browser-only runtime.
    expect(context).not.toContain('terminal_cwd');
    expect(context).not.toContain('/workspace/attachments');
  });
});
