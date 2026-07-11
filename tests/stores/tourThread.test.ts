import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RootStore } from '../../src/stores/RootStore';
import { WELCOME_TOUR_THREAD_ID } from '../../src/tourThread';
import { parseChatSnapshotValue, flushPendingSnapshot } from '../../src/services/persistence';
import { buildActivitiesForMessage } from '../../src/services/chat/activityProjection';
import { toolRegistry } from '../../src/services/tools/registry';
import { clearAppStorage } from '../helpers/storage';

const roots: RootStore[] = [];

function makeRoot(): RootStore {
  const root = new RootStore();
  roots.push(root);
  return root;
}

function welcomeTour(root: RootStore) {
  const thread = root.chat.threads.find(item => item.id === WELCOME_TOUR_THREAD_ID);
  if (!thread) throw new Error('Welcome tour was not seeded');
  return thread;
}

describe('Welcome tour thread', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => {
    while (roots.length) roots.pop()?.dispose();
    clearAppStorage();
  });

  it('seeds one pinned, read-only tour only on a first run and never reseeds it after deletion', () => {
    const first = makeRoot();
    const tour = welcomeTour(first);

    expect(tour.pinned).toBe(true);
    expect(tour.readOnly).toBe(true);
    expect(first.chat.activeThreadId).not.toBe(WELCOME_TOUR_THREAD_ID);
    expect(JSON.parse(localStorage.getItem('gatesai.whatsNew.v1') ?? '{}')).toMatchObject({
      tourThreadSeeded: true,
    });

    first.chat.selectThread(tour.id);
    first.chat.sendMessage('This must not be added.');
    expect(tour.messages.some(message => message.content === 'This must not be added.')).toBe(false);

    first.chat.softDeleteThread(tour.id);
    flushPendingSnapshot();

    const second = makeRoot();
    const archivedTour = second.chat.threads.filter(item => item.id === WELCOME_TOUR_THREAD_ID);
    expect(archivedTour).toHaveLength(1);
    expect(archivedTour[0]?.deletedAt).toBeTypeOf('number');
    expect(second.chat.visibleThreads.some(item => item.id === WELCOME_TOUR_THREAD_ID)).toBe(false);
  });

  it('uses valid persisted message shapes that project through normal tool and attachment renderers', () => {
    const root = makeRoot();
    const tour = welcomeTour(root);
    const restored = parseChatSnapshotValue({
      schemaVersion: root.chat.snapshot.schemaVersion,
      threads: [tour],
      activeThreadId: tour.id,
    });

    expect(restored?.threads[0]).toMatchObject({
      id: WELCOME_TOUR_THREAD_ID,
      readOnly: true,
      pinned: true,
    });

    const toolMessage = tour.messages.find(message => message.id === 'welcome-tour-tool');
    const artifactMessage = tour.messages.find(message => message.id === 'welcome-tour-artifact');
    const imagePrompt = tour.messages.find(message => message.id === 'welcome-tour-image-prompt');
    if (!toolMessage || toolMessage.role !== 'assistant') throw new Error('Missing tool tour message');
    if (!artifactMessage || artifactMessage.role !== 'assistant') throw new Error('Missing artifact tour message');
    if (!imagePrompt || imagePrompt.role !== 'user') throw new Error('Missing image tour message');

    for (const call of [...(toolMessage.toolCalls ?? []), ...(artifactMessage.toolCalls ?? [])]) {
      expect(toolRegistry.validateToolCall(call).ok).toBe(true);
    }
    const activities = buildActivitiesForMessage({
      message: toolMessage,
      ownerThreadId: tour.id,
      extras: undefined,
    });
    expect(activities[0]?.detail?.content?.split('\n').length).toBeGreaterThan(40);
    expect(imagePrompt.attachments).toEqual([expect.objectContaining({
      mime: 'image/png',
      path: expect.stringContaining('welcome-image-placeholder.png'),
    })]);
  });
});
