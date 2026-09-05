import { afterEach, expect, it, vi } from 'vitest';
import { runInAction } from 'mobx';
import { RootStore } from '../../src/stores/RootStore';
import { clearAppStorage } from '../helpers/storage';

let root: RootStore | undefined;
afterEach(() => { root?.dispose(); root = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); clearAppStorage(); });

it.each(['root', 'batched-authority'] as const)('coalesces %s while loading and does not busy-retry an unchanged failure', async change => {
  clearAppStorage();
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline synthetic fixture'); }));
  root = new RootStore({ runtime: 'desktop' });
  vi.spyOn(root.bridge, 'start').mockImplementation(() => {});
  vi.spyOn(root.summary, 'start').mockImplementation(() => {});
  vi.spyOn(root.rag, 'start').mockImplementation(() => {});
  vi.spyOn(root.localRuntime, 'init').mockResolvedValue(undefined);
  vi.spyOn(root.updates, 'startBackgroundChecks').mockImplementation(() => {});
  vi.spyOn(root.bridge.client, 'request').mockRejectedValue(new Error('offline synthetic fixture'));
  vi.spyOn(root.bridge.client, 'connect').mockResolvedValue(undefined);
  let settle: ((value: boolean) => void) | undefined;
  const hydration = vi.spyOn(root.chat, 'enableWorkspacePersistence').mockImplementationOnce(() => new Promise(resolve => { settle = resolve; })).mockResolvedValue(false);
  const election = root.chatLeaderElection as unknown as { transition(state: 'leader' | 'follower'): void };
  election.transition('leader');
  root.boot();
  runInAction(() => { root!.bridge.state = 'online'; root!.bridge.workspaceRoot = '/first'; });
  await vi.waitFor(() => expect(hydration).toHaveBeenCalledTimes(1));
  const oldContext = hydration.mock.calls[0][1]!;
  runInAction(() => {
    if (change === 'root') root!.bridge.workspaceRoot = '/second';
    else { election.transition('follower'); election.transition('leader'); }
  });
  expect(oldContext()).toBe(false);
  settle?.(false);
  await vi.waitFor(() => expect(hydration).toHaveBeenCalledTimes(2));
  await Promise.resolve(); await Promise.resolve();
  expect(hydration).toHaveBeenCalledTimes(2);
  expect(hydration.mock.calls[1][1]!()).toBe(true);
  root.dispose();
  expect(hydration.mock.calls[1][1]!()).toBe(false);
  root = undefined;
});
