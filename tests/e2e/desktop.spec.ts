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
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
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

  test('searches message bodies, not just titles', async ({ page }) => {
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

    // Body search reaches conversation content, not just titles.
    await page.locator('input[aria-label="Search threads"]').fill('zebra');
    await page.waitForTimeout(150);
    await expect(page.locator('.editorial-sidebar__item', { hasText: 'Beta thread' })).toHaveCount(1);
    await expect(page.locator('.editorial-sidebar__item', { hasText: 'Alpha thread' })).toHaveCount(0);
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

  test('scopes composer draft per thread when switching threads', async ({ page }) => {
    await seedThreads(
      page,
      [
        makeThread('t1', 'Alpha thread', [
          { id: 'm1', role: 'user', content: 'hello from alpha', createdAt: 1 },
        ]),
        makeThread('t2', 'Beta thread', [
          { id: 'm2', role: 'user', content: 'hello from beta', createdAt: 2 },
        ]),
      ],
      't1',
    );
    await page.goto('/');

    await page.locator('.composer-textarea').fill('draft for alpha');
    await page.waitForTimeout(150);

    await page.locator('.editorial-sidebar__item', { hasText: 'Beta thread' }).click();
    await expect(page.locator('.composer-textarea')).toHaveValue('');
    await expect(page.getByText('hello from beta')).toBeVisible();
    await page.locator('.composer-textarea').fill('draft for beta');
    await page.waitForTimeout(150);

    await page.locator('.editorial-sidebar__item', { hasText: 'Alpha thread' }).click();
    await expect(page.locator('.composer-textarea')).toHaveValue('draft for alpha');
    await expect(page.getByText('hello from alpha')).toBeVisible();

    await page.locator('.editorial-sidebar__item', { hasText: 'Beta thread' }).click();
    await expect(page.locator('.composer-textarea')).toHaveValue('draft for beta');
  });

  test('creates a new conversation from the sidebar button', async ({ page }) => {
    await seedThreads(
      page,
      [
        makeThread('t1', 'Existing thread', [
          { id: 'm1', role: 'user', content: 'old message', createdAt: 1 },
        ]),
      ],
      't1',
    );
    await page.goto('/');

    const initialCount = await page.locator('.editorial-sidebar__item').count();
    await page.locator('.editorial-sidebar__new').click();

    await expect(page).toHaveURL(/#\/thread\//);
    await expect(page.locator('.editorial-sidebar__item')).toHaveCount(initialCount + 1);
    await expect(page.getByText('old message')).not.toBeVisible();
  });

  test('models menu loads OpenRouter API key controls', async ({ page }) => {
    await page.goto('/#/menu/models');

    await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible();
    await expect(page.getByText('OpenRouter', { exact: true })).toBeVisible();
    await expect(page.getByText('● Connected')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reveal' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
  });

  test('does not show another thread error on the active composer', async ({ page }) => {
    await seedThreads(
      page,
      [
        makeThread('t1', 'Error thread', [
          { id: 'm1', role: 'user', content: 'trigger error', createdAt: 1 },
        ]),
        makeThread('t2', 'Clean thread', [
          { id: 'm2', role: 'user', content: 'all good', createdAt: 2 },
        ]),
      ],
      't1',
    );
    await page.route('https://openrouter.ai/api/v1/chat/completions', route =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: { message: 'rate limit' } }),
      }),
    );
    await page.goto('/');
    await page.locator('.composer-textarea').fill('hello');
    await page.locator('button.composer-send-control[aria-label="Send"]').click();
    await expect(page.locator('.chat-error-banner')).toContainText('rate limit');

    await page.locator('.editorial-sidebar__item', { hasText: 'Clean thread' }).click();
    await expect(page.locator('.chat-error-banner')).toHaveCount(0);
    await expect(page.getByText('all good')).toBeVisible();
  });

  test('shows stop control while a reply is streaming', async ({ page }) => {
    await mockOpenRouter(page, { delayMs: 5000 });
    await page.goto('/');
    await page.locator('.composer-textarea').fill('hello there');
    await page.locator('button.composer-send-control[aria-label="Send"]').click();

    await expect(page.locator('button.composer-send-control[aria-label="Stop"]')).toBeVisible();
  });
});

test.describe('desktop without a configured provider', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('gatesai.userGuide.opened.v1', '1');
    });
    await mockOpenRouter(page);
    await mockBridgeOnline(page);
  });

  test('shows the API key banner and disables send', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('Add an OpenRouter key in Models to start chatting.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open Models' })).toBeVisible();
    await page.locator('.composer-textarea').fill('hello without a key');
    await expect(page.locator('button.composer-send-control[aria-label="Send"]')).toBeDisabled();
  });
});
