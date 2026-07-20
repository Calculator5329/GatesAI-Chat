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

    await page.locator('.gates-menu__tabs button', { hasText: 'Agent' }).click();
    await expect(page).toHaveURL(/#\/menu\/agent/);
    await expect(page.getByRole('heading', { name: 'Agent' })).toBeVisible();

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

    // No debounce wait needed: clicking a sidebar item blurs the textarea,
    // and the composer flushes the local draft to the store on blur.
    await page.locator('.composer-textarea').fill('draft for alpha');

    await page.locator('.editorial-sidebar__item', { hasText: 'Beta thread' }).click();
    await expect(page.locator('.composer-textarea')).toHaveValue('');
    await expect(page.getByText('hello from beta')).toBeVisible();
    await page.locator('.composer-textarea').fill('draft for beta');

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
        // Keep this non-retryable so the test observes the thread-scoped error
        // promptly instead of waiting through the transient-provider retry path.
        status: 400,
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

  test('reveals and controls semantic-memory evidence', async ({ page }) => {
    await seedThreads(page, [makeThread('source', 'Earlier project decision', [
      { id: 'source-user', role: 'user', content: 'Use the compact source-chip design.', createdAt: 10 },
    ]), makeThread('active', 'Current planning', [
      { id: 'active-user', role: 'user', content: 'What did we decide?', createdAt: 20 },
      {
        id: 'active-assistant',
        role: 'assistant',
        content: 'We chose the compact source-chip design.',
        createdAt: 21,
        retrievalTrace: {
          version: 1,
          purpose: 'automatic_context',
          usedAt: 20,
          model: 'nomic-embed-text',
          rankingPolicyVersion: 1,
          items: [{
            reference: 'message:source-user',
            sourceType: 'message',
            sourceId: 'source-user',
            threadId: 'source',
            role: 'user',
            title: 'Earlier project decision',
            sourceTimestamp: 10,
            excerpt: 'Use the compact source-chip design.',
            lexicalRank: 1,
            denseRank: 2,
            fusedRank: 1,
          }],
        },
      },
    ])], 'active');
    await page.goto('/#/thread/active');

    const chip = page.getByRole('button', { name: 'Conversation · Earlier project decision' });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page.getByText('Use the compact source-chip design.', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Why was this used?' }).click();
    await expect(page.getByText(/Matched both wording and meaning/)).toBeVisible();

    await page.getByRole('button', { name: "Don't use this source" }).click();
    await page.getByRole('button', { name: 'Exclude', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Undo exclusion' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('gatesai.rag.settings.v2') ?? '{}').excludedSources)).toEqual(['thread:source']);
    await page.getByRole('button', { name: 'Undo exclusion' }).click();
    await expect(page.getByRole('button', { name: "Don't use this source" })).toBeVisible();
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

  test('shows first-run onboarding and disables send', async ({ page }) => {
    await page.goto('/');

    // First boot shows the local-first hero empty state (redesigned
    // 2026-07-11) with a provider CTA instead of the old three-card panel.
    await expect(page.getByText('LOCAL-FIRST AI WORKSPACE')).toBeVisible();
    await expect(page.getByText('Add an OpenRouter key in Models to start chatting.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open models' })).toBeVisible();
    await page.locator('.composer-textarea').fill('hello without a key');
    await expect(page.locator('button.composer-send-control[aria-label="Send"]')).toBeDisabled();
  });
});
