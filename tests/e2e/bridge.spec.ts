// Bridge-dependent UI flows, exercised with a faked online bridge: attachment
// upload and a Settings danger-zone action.
import { test, expect } from '@playwright/test';
import {
  makeThread,
  mockBridgeOnline,
  mockOpenRouter,
  seedReadyProvider,
  seedThreads,
} from './fixtures/harness';

test.describe('bridge-backed flows (faked online bridge)', () => {
  test.beforeEach(async ({ page }) => {
    await seedReadyProvider(page);
    await mockOpenRouter(page);
    await mockBridgeOnline(page);
  });

  test('uploads an attachment once the bridge is online', async ({ page }) => {
    await page.goto('/');
    const attach = page.locator('button.composer-attach-btn');
    await expect(attach).toBeEnabled();

    await page.locator('input[type="file"]').setInputFiles({
      name: 'note.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('hello from a test attachment'),
    });

    await expect(page.getByText('note.txt')).toBeVisible();
  });

  test('clears all threads from the danger zone', async ({ page }) => {
    await seedThreads(
      page,
      [
        makeThread('t1', 'Thread one', [{ id: 'm1', role: 'user', content: 'one', createdAt: 1 }]),
        makeThread('t2', 'Thread two', [{ id: 'm2', role: 'user', content: 'two', createdAt: 2 }]),
      ],
      't1',
    );
    await page.goto('/#/menu/settings');

    await page.getByRole('button', { name: 'Delete...' }).first().click();
    await page.getByRole('button', { name: 'Confirm' }).click();

    await expect(page.getByText('Threads cleared.')).toBeVisible();
  });
});
