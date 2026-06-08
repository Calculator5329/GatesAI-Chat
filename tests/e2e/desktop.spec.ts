// Broad UI coverage against the default (desktop-mode) build with the LLM and
// bridge mocked: load, navigation, the streamed chat flow, thread previews +
// body search, and persisted model favorites.
import { test, expect } from '@playwright/test';
import {
  makeThread,
  mockBridgeOnline,
  mockOpenRouter,
  seedReadyProvider,
  seedThreads,
} from './fixtures/harness';

test.describe('desktop (mocked bridge + LLM)', () => {
  test.beforeEach(async ({ page }) => {
    await seedReadyProvider(page);
    await mockOpenRouter(page);
    await mockBridgeOnline(page);
  });

  test('loads with the composer and model picker', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.composer-textarea')).toBeVisible();
    await expect(page.locator('.composer-model-label')).toBeVisible();
  });

  test('navigates between menu sections', async ({ page }) => {
    await page.goto('/#/menu/settings');
    await expect(page.getByText('Danger zone', { exact: true })).toBeVisible();

    await page.locator('.gates-menu__tabs button', { hasText: 'Gallery' }).click();
    await expect(page).toHaveURL(/#\/menu\/gallery/);
    await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible();

    await page.locator('.gates-menu__tabs button', { hasText: 'Models' }).click();
    await expect(page).toHaveURL(/#\/menu\/models/);
  });

  test('sends a message and renders the streamed reply', async ({ page }) => {
    await page.goto('/');
    await page.locator('.composer-textarea').fill('hello there');
    await page.locator('button.composer-send-control[aria-label="Send"]').click();
    // The assistant reply renders as markdown in the transcript.
    await expect(page.locator('.md-body', { hasText: 'Mock reply from the assistant.' })).toBeVisible();
  });

  test('shows message previews and searches message bodies', async ({ page }) => {
    await seedThreads(
      page,
      [
        makeThread('t1', 'Alpha thread', [
          { id: 'm1', role: 'user', content: 'hello world apple', createdAt: 1 },
          { id: 'm2', role: 'assistant', content: 'assistant reply about apples', createdAt: 2 },
        ]),
        makeThread('t2', 'Beta thread', [
          { id: 'm3', role: 'user', content: 'completely zebra unique body', createdAt: 3 },
        ]),
      ],
      't1',
    );
    await page.goto('/');

    // Preview line is derived from the latest message.
    await expect(
      page.locator('.editorial-sidebar__preview', { hasText: 'assistant reply about apples' }),
    ).toBeVisible();

    // Body search reaches conversation content, not just titles.
    await page.locator('input[aria-label="Search threads"]').fill('zebra');
    await expect(page.locator('.editorial-sidebar__item')).toHaveCount(1);
    await expect(page.locator('.editorial-sidebar__item')).toContainText('Beta thread');
  });

  test('favoriting a model surfaces a Favorites section', async ({ page }) => {
    await page.goto('/');
    await page.locator('.composer-model-label').click();
    const popover = page.locator('.model-popover');
    await expect(popover).toBeVisible();
    await expect(popover.getByText('Favorites')).toHaveCount(0);

    await popover.locator('.model-popover__favorite').first().click();
    await expect(popover.getByText('Favorites')).toBeVisible();
  });
});
