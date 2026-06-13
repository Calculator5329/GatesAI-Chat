// Two tabs of the same browser context share localStorage, so a chat-storage
// write in tab B must surface the multi-tab conflict banner in tab A (autosave
// pauses until the user reloads or dismisses). Covers the ChatStore
// setMultiTabWriteHandler wiring end to end through a real `storage` event.
import { test, expect, type Page } from '@playwright/test';
import {
  makeThread,
  mockBridgeOnline,
  mockOpenRouter,
  seedReadyProvider,
  seedThreads,
} from './fixtures/harness';

const CONFLICT_TEXT = 'Another browser tab updated chat history';

async function mockNetwork(page: Page): Promise<void> {
  await seedReadyProvider(page);
  await mockOpenRouter(page);
  await mockBridgeOnline(page);
}

test.describe('multi-tab conflict handling', () => {
  test('tab B writing chat storage pauses tab A, and Reload adopts B state', async ({ page, context }) => {
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
    await expect(page.locator('.chat-error-banner')).toHaveCount(0);

    // Tab B: same context/origin, so it boots from the localStorage tab A wrote.
    const pageB = await context.newPage();
    await mockNetwork(pageB);
    await pageB.goto('/');
    await expect(pageB.locator('.editorial-sidebar__item', { hasText: 'Alpha thread' })).toBeVisible();

    // Trigger a chat-storage write from tab B: creating a conversation updates
    // gatesai.state.v1, which raises a `storage` event in tab A.
    await pageB.locator('.editorial-sidebar__new').click();
    await expect(pageB.locator('.editorial-sidebar__item')).toHaveCount(2);

    const bannerA = page.locator('.chat-error-banner', { hasText: CONFLICT_TEXT });
    await expect(bannerA).toBeVisible();
    await expect(bannerA).toContainText('Saving is paused');

    // Reload (banner action, not a navigation) adopts tab B's snapshot:
    // tab A now shows the conversation B created.
    await bannerA.getByRole('button', { name: 'Reload' }).click();
    await expect(page.locator('.chat-error-banner')).toHaveCount(0);
    await expect(page.locator('.editorial-sidebar__item')).toHaveCount(2);
    await expect(page.locator('.editorial-sidebar__item', { hasText: 'Alpha thread' })).toBeVisible();

    await pageB.close();
  });

  test('dismissing the conflict banner clears it and resumes saving', async ({ page, context }) => {
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

    const pageB = await context.newPage();
    await mockNetwork(pageB);
    await pageB.goto('/');
    await expect(pageB.locator('.editorial-sidebar__item', { hasText: 'Alpha thread' })).toBeVisible();
    await pageB.locator('.editorial-sidebar__new').click();

    const bannerA = page.locator('.chat-error-banner', { hasText: CONFLICT_TEXT });
    await expect(bannerA).toBeVisible();

    await bannerA.getByLabel('Dismiss notice').click();
    await expect(page.locator('.chat-error-banner')).toHaveCount(0);

    // Saving is resumed: a local change in tab A persists to storage again
    // (last-write-wins over tab B, as wired). Creating a conversation in A
    // must raise the conflict banner in B, proving A's autosave write landed.
    await page.locator('.editorial-sidebar__new').click();
    await expect(pageB.locator('.chat-error-banner', { hasText: CONFLICT_TEXT })).toBeVisible();

    await pageB.close();
  });
});
