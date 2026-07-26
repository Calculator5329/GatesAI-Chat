// QA-1's walkthrough half: drive every persisted settings control, change it,
// reload, and assert it survived. This is the check that source reading cannot
// do — a control can look correctly wired and still not persist, because the
// store setter, the storage slot and the boot-time rehydrate are three separate
// pieces and only the round trip proves all three are connected.
//
// One assertion per control, and each one flips the value rather than writing a
// fixed one, so a setting that silently resets to its default fails here even
// if the default happens to match what the test wrote.
import { test, expect, type Page } from '@playwright/test';
import { mockBridgeOnline, mockOpenRouter, seedReadyProvider } from './fixtures/harness';

async function openSettings(page: Page): Promise<void> {
  await page.goto('/#/menu/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
}

/** Reload and come back to the same section, so state must come from storage. */
async function reloadInto(page: Page, hash: string): Promise<void> {
  await page.goto(`/#/menu/${hash}`);
  await page.reload();
}

test.describe('settings walkthrough (persistence)', () => {
  test.beforeEach(async ({ page }) => {
    await seedReadyProvider(page);
    await mockOpenRouter(page);
    await mockBridgeOnline(page);
  });

  test('automatic thread titles survives a reload', async ({ page }) => {
    await openSettings(page);
    const toggle = page.getByRole('switch', { name: 'Automatic thread titles' });
    await expect(toggle).toBeVisible();

    const before = await toggle.getAttribute('aria-checked');
    await toggle.click();
    const after = await toggle.getAttribute('aria-checked');
    expect(after).not.toBe(before);

    await reloadInto(page, 'settings');
    await expect(page.getByRole('switch', { name: 'Automatic thread titles' }))
      .toHaveAttribute('aria-checked', String(after));
  });

  test('colour mode survives a reload and reaches the document', async ({ page }) => {
    await openSettings(page);
    // Light is the one that is never the default, so picking it proves the
    // value came back from storage rather than from the initial state.
    await page.getByRole('button', { name: 'Light', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    await reloadInto(page, 'settings');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.getByRole('button', { name: 'Light', exact: true }))
      .toHaveAttribute('aria-pressed', 'true');
  });

  test('the agent system prompt survives a reload', async ({ page }) => {
    const written = 'Prefer short answers and name the verification gap.';
    await page.goto('/#/menu/agent');
    await expect(page.getByRole('heading', { name: 'Agent' })).toBeVisible();

    const prompt = page.locator('textarea').first();
    await prompt.fill(written);
    // The store flushes the draft on blur, so a reload without one would be
    // testing the textarea rather than the setting.
    await prompt.blur();

    await reloadInto(page, 'agent');
    await expect(page.locator('textarea').first()).toHaveValue(written);
  });

  // Only the desktop-mocked project runs this file (playwright.config.ts limits
  // the web-lite project to web-lite.spec.ts), so the Web Lite half of this
  // claim lives in that file instead.
  test('the close-to-tray toggle survives a reload', async ({ page }) => {
    await openSettings(page);
    const tray = page.getByRole('switch', { name: 'Close button hides to tray' });
    await expect(tray).toBeVisible();

    const before = await tray.getAttribute('aria-checked');
    await tray.click();
    const after = await tray.getAttribute('aria-checked');
    expect(after).not.toBe(before);

    await reloadInto(page, 'settings');
    await expect(page.getByRole('switch', { name: 'Close button hides to tray' }))
      .toHaveAttribute('aria-checked', String(after));
  });

  test('a saved fact survives a reload, and delete removes it for good', async ({ page }) => {
    const fact = 'Ethan prefers short answers with the verification gap named.';
    await page.goto('/#/menu/agent');
    await expect(page.getByRole('heading', { name: 'Agent' })).toBeVisible();

    await page.getByPlaceholder('Add a memory', { exact: false }).fill(fact);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(page.getByText(fact)).toBeVisible();

    await reloadInto(page, 'agent');
    await expect(page.getByText(fact)).toBeVisible();

    // Deleting has to persist too, or a "removed" fact quietly comes back and
    // keeps being supplied to the model.
    await page.getByTitle('Delete').first().click();
    await expect(page.getByText(fact)).toHaveCount(0);
    await reloadInto(page, 'agent');
    await expect(page.getByText(fact)).toHaveCount(0);
  });

  test('the Ollama address survives a reload', async ({ page }) => {
    const address = 'http://127.0.0.1:11500';
    await page.goto('/#/menu/models');
    await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible();

    const field = page.getByPlaceholder('http://127.0.0.1:11434');
    await expect(field).toBeVisible();
    await field.fill(address);
    // Committed on Enter, same as the Refresh models button.
    await field.press('Enter');

    await reloadInto(page, 'models');
    await expect(page.getByPlaceholder('http://127.0.0.1:11434')).toHaveValue(address);
  });

  test('changing a setting never throws in the page', async ({ page }) => {
    // The theme switcher was broken for as long as it existed because nothing
    // watched for the uncaught TypeError it threw on every click. A silent
    // no-op looks identical to a working control from the outside.
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));

    await openSettings(page);
    for (const name of ['Dark', 'Light', 'System']) {
      await page.getByRole('button', { name, exact: true }).click();
    }
    await page.getByRole('switch', { name: 'Automatic thread titles' }).click();
    await page.getByRole('switch', { name: 'Close button hides to tray' }).click();

    expect(errors).toEqual([]);
  });

  test('every switch on the settings page reports its state to assistive tech', async ({ page }) => {
    await openSettings(page);
    // A switch with no aria-checked is invisible to a screen reader and to this
    // suite, so it would silently escape the persistence checks above.
    const switches = page.getByRole('switch');
    const count = await switches.count();
    expect(count).toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      const value = await switches.nth(index).getAttribute('aria-checked');
      expect(value === 'true' || value === 'false').toBe(true);
    }
  });
});
