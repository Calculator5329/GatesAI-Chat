import { expect, it } from 'vitest';
import { ChatPersistenceCoordinator } from '../../src/stores/chatPersistenceCoordinator';

it('A54: an in-flight completion cannot publish queued follower state', async () => {
  const saved: Array<string | null> = [];
  let release = (): void => {};
  const firstFinished = new Promise<void>(resolve => { release = resolve; });
  const coordinator = new ChatPersistenceCoordinator(() => ({ threads: [], activeThreadId: 'initial' }));
  coordinator.attachWorkspacePersistence({
    load: async () => ({ kind: 'missing' }),
    backupMalformed: async () => 'unused',
    save: async snapshot => {
      saved.push(snapshot.activeThreadId);
      if (saved.length === 1) await firstFinished;
    },
  });
  coordinator.schedule({ threads: [], activeThreadId: 'stale-queued' });
  coordinator.pause();
  release();
  await firstFinished;
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  expect(saved).toEqual(['initial']);
  coordinator.resume();
  coordinator.schedule({ threads: [], activeThreadId: 'fresh-approved' });
  expect(saved).toEqual(['initial', 'fresh-approved']);
  coordinator.dispose();
});
