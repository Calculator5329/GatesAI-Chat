// Two tabs of the same browser context share localStorage and coordinate chat
// persistence through Web Locks. The elected leader remains writable while a
// follower is read-only, then the follower refreshes and takes over when the
// leader closes.
import { test, expect, type Page } from '@playwright/test';
import {
  makeThread,
  mockBridgeOnline,
  mockOpenRouter,
  seedReadyProvider,
  seedThreads,
} from './fixtures/harness';

const FOLLOWER_TEXT = 'Another tab is active';

async function mockNetwork(page: Page): Promise<void> {
  await seedReadyProvider(page);
  await page.addInitScript(() => {
    localStorage.setItem('gatesai.whatsNew.v1', JSON.stringify({ tourThreadSeeded: true }));
  });
  await mockOpenRouter(page);
  await mockBridgeOnline(page);
}

test.describe('multi-tab leader election', () => {
  test('the second tab is read-only while the first tab owns persistence', async ({ page, context }) => {
    await mockNetwork(page);
    await seedThreads(
      page,
      [
        makeThread('t1', 'Alpha thread', [
          { id: 'm1', role: 'user', content: 'hello from alpha', createdAt: 1 },
        ]),
      ],
      't1',
    );
    await page.goto('/');
    await expect(page.locator('.editorial-sidebar__item', { hasText: 'Alpha thread' })).toBeVisible();
    await expect(page.locator('.composer-textarea')).toBeEnabled();

    // Tab B: same context/origin, so it boots from the localStorage tab A wrote.
    const pageB = await context.newPage();
    await mockNetwork(pageB);
    await pageB.goto('/');
    await expect(pageB.locator('.editorial-sidebar__item', { hasText: 'Alpha thread' })).toBeVisible();

    const followerNotice = pageB.locator('.chat-error-banner', { hasText: FOLLOWER_TEXT });
    await expect(followerNotice).toBeVisible();
    await expect(followerNotice).toContainText('read-only');
    await expect(pageB.locator('.composer-textarea')).toBeDisabled();
    await expect(page.locator('.chat-error-banner', { hasText: FOLLOWER_TEXT })).toHaveCount(0);

    await pageB.close();
  });

  test('closing the leader refreshes the follower and hands over persistence', async ({ page, context }) => {
    await mockNetwork(page);
    await seedThreads(
      page,
      [
        makeThread('t1', 'Alpha thread', [
          { id: 'm1', role: 'user', content: 'hello from alpha', createdAt: 1 },
        ]),
      ],
      't1',
    );
    await page.goto('/');
    await expect(page.locator('.editorial-sidebar__item', { hasText: 'Alpha thread' })).toBeVisible();
    await expect(page.locator('.composer-textarea')).toBeEnabled();

    const pageB = await context.newPage();
    await mockNetwork(pageB);
    await pageB.goto('/');
    await expect(pageB.locator('.editorial-sidebar__item', { hasText: 'Alpha thread' })).toBeVisible();
    await expect(pageB.locator('.chat-error-banner', { hasText: FOLLOWER_TEXT })).toBeVisible();

    // The leader writes a second thread while the follower remains on its
    // original in-memory snapshot.
    await page.locator('.editorial-sidebar__new').click();
    await expect(page.locator('.editorial-sidebar__item')).toHaveCount(2);
    await expect(pageB.locator('.editorial-sidebar__item')).toHaveCount(1);
    await expect.poll(async () => page.evaluate(() => {
      const snapshot = JSON.parse(localStorage.getItem('gatesai.state.v1') ?? '{}') as { threads?: unknown[] };
      return snapshot.threads?.length ?? 0;
    })).toBe(2);

    await page.close();

    // Web Locks wakes the queued follower. It reloads the departing leader's
    // snapshot before becoming writable, then its own writes persist.
    await expect(pageB.locator('.chat-error-banner', { hasText: FOLLOWER_TEXT })).toHaveCount(0);
    await expect(pageB.locator('.composer-textarea')).toBeEnabled();
    await expect(pageB.locator('.editorial-sidebar__item')).toHaveCount(2);
    await pageB.locator('.editorial-sidebar__new').click();
    await expect(pageB.locator('.editorial-sidebar__item')).toHaveCount(3);
    await expect.poll(async () => pageB.evaluate(() => {
      const snapshot = JSON.parse(localStorage.getItem('gatesai.state.v1') ?? '{}') as { threads?: unknown[] };
      return snapshot.threads?.length ?? 0;
    })).toBe(3);

    await pageB.close();
  });
});
