import { describe, expect, it, vi } from 'vitest';
import { UpdateStore } from '../../src/stores/UpdateStore';
import type { AvailableUpdate } from '../../src/services/updates/appUpdater';

function fakeUpdate(overrides: Partial<AvailableUpdate> = {}): AvailableUpdate {
  return {
    version: '9.9.9',
    currentVersion: '4.5.0',
    notes: 'big fixes',
    install: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('UpdateStore', () => {
  it('stays idle and invisible when no update exists', async () => {
    const store = new UpdateStore({ check: async () => null });
    await store.checkNow();
    expect(store.phase).toBe('idle');
    expect(store.visible).toBe(false);
  });

  it('exposes an available update and installs it to ready', async () => {
    const update = fakeUpdate();
    const store = new UpdateStore({ check: async () => update });
    await store.checkNow();
    expect(store.phase).toBe('available');
    expect(store.version).toBe('9.9.9');
    expect(store.visible).toBe(true);

    await store.install();
    expect(update.install).toHaveBeenCalledTimes(1);
    expect(store.phase).toBe('ready');
    expect(store.progress).toBe(1);
  });

  it('tracks download progress fraction', async () => {
    const update = fakeUpdate({
      install: async (onProgress) => {
        onProgress?.(50, 200);
        onProgress?.(200, 200);
      },
    });
    const store = new UpdateStore({ check: async () => update });
    await store.checkNow();
    const install = store.install();
    await install;
    expect(store.progress).toBe(1);
  });

  it('surfaces install failure as a retryable error phase', async () => {
    const update = fakeUpdate({ install: vi.fn(async () => { throw new Error('disk full'); }) });
    const store = new UpdateStore({ check: async () => update });
    await store.checkNow();
    await store.install();
    expect(store.phase).toBe('error');
    expect(store.error).toBe('disk full');
    expect(store.visible).toBe(true);

    // Retry path: install() again from error.
    (update.install as ReturnType<typeof vi.fn>).mockImplementation(async () => undefined);
    await store.install();
    expect(store.phase).toBe('ready');
  });

  it('does not clobber a staged update on re-check and restarts only when ready', async () => {
    const relaunch = vi.fn(async () => undefined);
    const update = fakeUpdate();
    const store = new UpdateStore({ check: async () => update, relaunch });

    await store.restart();
    expect(relaunch).not.toHaveBeenCalled();

    await store.checkNow();
    await store.install();
    await store.checkNow(); // must not reset 'ready'
    expect(store.phase).toBe('ready');

    await store.restart();
    expect(relaunch).toHaveBeenCalledTimes(1);
  });

  it('dismiss hides the pill until a later check finds an update again', async () => {
    const store = new UpdateStore({ check: async () => fakeUpdate() });
    await store.checkNow();
    store.dismiss();
    expect(store.visible).toBe(false);
    await store.checkNow();
    expect(store.visible).toBe(true);
  });
});
