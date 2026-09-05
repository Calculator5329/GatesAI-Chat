# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: settingsWalkthrough.spec.ts >> settings walkthrough (persistence) >> the agent system prompt survives a reload
- Location: tests/e2e/settingsWalkthrough.spec.ts:59:3

# Error details

```
Error: expect(locator).toHaveValue(expected) failed

Locator: locator('textarea').first()
Expected: "Prefer short answers and name the verification gap."
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toHaveValue" with timeout 10000ms
  - waiting for locator('textarea').first()

```

# Test source

```ts
  1   | // QA-1's walkthrough half: drive every persisted settings control, change it,
  2   | // reload, and assert it survived. This is the check that source reading cannot
  3   | // do — a control can look correctly wired and still not persist, because the
  4   | // store setter, the storage slot and the boot-time rehydrate are three separate
  5   | // pieces and only the round trip proves all three are connected.
  6   | //
  7   | // One assertion per control, and each one flips the value rather than writing a
  8   | // fixed one, so a setting that silently resets to its default fails here even
  9   | // if the default happens to match what the test wrote.
  10  | import { test, expect, type Page } from '@playwright/test';
  11  | import { mockBridgeOnline, mockOpenRouter, seedReadyProvider } from './fixtures/harness';
  12  | 
  13  | async function openSettings(page: Page): Promise<void> {
  14  |   await page.goto('/#/menu/settings');
  15  |   await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  16  | }
  17  | 
  18  | /** Reload and come back to the same section, so state must come from storage. */
  19  | async function reloadInto(page: Page, hash: string): Promise<void> {
  20  |   await page.goto(`/#/menu/${hash}`);
  21  |   await page.reload();
  22  | }
  23  | 
  24  | test.describe('settings walkthrough (persistence)', () => {
  25  |   test.beforeEach(async ({ page }) => {
  26  |     await seedReadyProvider(page);
  27  |     await mockOpenRouter(page);
  28  |     await mockBridgeOnline(page);
  29  |   });
  30  | 
  31  |   test('automatic thread titles survives a reload', async ({ page }) => {
  32  |     await openSettings(page);
  33  |     const toggle = page.getByRole('switch', { name: 'Automatic thread titles' });
  34  |     await expect(toggle).toBeVisible();
  35  | 
  36  |     const before = await toggle.getAttribute('aria-checked');
  37  |     await toggle.click();
  38  |     const after = await toggle.getAttribute('aria-checked');
  39  |     expect(after).not.toBe(before);
  40  | 
  41  |     await reloadInto(page, 'settings');
  42  |     await expect(page.getByRole('switch', { name: 'Automatic thread titles' }))
  43  |       .toHaveAttribute('aria-checked', String(after));
  44  |   });
  45  | 
  46  |   test('colour mode survives a reload and reaches the document', async ({ page }) => {
  47  |     await openSettings(page);
  48  |     // Light is the one that is never the default, so picking it proves the
  49  |     // value came back from storage rather than from the initial state.
  50  |     await page.getByRole('button', { name: 'Light', exact: true }).click();
  51  |     await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  52  | 
  53  |     await reloadInto(page, 'settings');
  54  |     await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  55  |     await expect(page.getByRole('button', { name: 'Light', exact: true }))
  56  |       .toHaveAttribute('aria-pressed', 'true');
  57  |   });
  58  | 
  59  |   test('the agent system prompt survives a reload', async ({ page }) => {
  60  |     const written = 'Prefer short answers and name the verification gap.';
  61  |     await page.goto('/#/menu/agent');
  62  |     await expect(page.getByRole('heading', { name: 'Agent' })).toBeVisible();
  63  | 
  64  |     const prompt = page.locator('textarea').first();
  65  |     await prompt.fill(written);
  66  |     // The store flushes the draft on blur, so a reload without one would be
  67  |     // testing the textarea rather than the setting.
  68  |     await prompt.blur();
  69  | 
  70  |     await reloadInto(page, 'agent');
> 71  |     await expect(page.locator('textarea').first()).toHaveValue(written);
      |                                                    ^ Error: expect(locator).toHaveValue(expected) failed
  72  |   });
  73  | 
  74  |   // Only the desktop-mocked project runs this file (playwright.config.ts limits
  75  |   // the web-lite project to web-lite.spec.ts), so the Web Lite half of this
  76  |   // claim lives in that file instead.
  77  |   test('the close-to-tray toggle survives a reload', async ({ page }) => {
  78  |     await openSettings(page);
  79  |     const tray = page.getByRole('switch', { name: 'Close button hides to tray' });
  80  |     await expect(tray).toBeVisible();
  81  | 
  82  |     const before = await tray.getAttribute('aria-checked');
  83  |     await tray.click();
  84  |     const after = await tray.getAttribute('aria-checked');
  85  |     expect(after).not.toBe(before);
  86  | 
  87  |     await reloadInto(page, 'settings');
  88  |     await expect(page.getByRole('switch', { name: 'Close button hides to tray' }))
  89  |       .toHaveAttribute('aria-checked', String(after));
  90  |   });
  91  | 
  92  |   test('a saved fact survives a reload, and delete removes it for good', async ({ page }) => {
  93  |     const fact = 'Ethan prefers short answers with the verification gap named.';
  94  |     await page.goto('/#/menu/agent');
  95  |     await expect(page.getByRole('heading', { name: 'Agent' })).toBeVisible();
  96  | 
  97  |     await page.getByPlaceholder('Add a memory', { exact: false }).fill(fact);
  98  |     await page.getByRole('button', { name: 'Add', exact: true }).click();
  99  |     await expect(page.getByText(fact)).toBeVisible();
  100 | 
  101 |     await reloadInto(page, 'agent');
  102 |     await expect(page.getByText(fact)).toBeVisible();
  103 | 
  104 |     // Deleting has to persist too, or a "removed" fact quietly comes back and
  105 |     // keeps being supplied to the model.
  106 |     await page.getByTitle('Delete').first().click();
  107 |     await expect(page.getByText(fact)).toHaveCount(0);
  108 |     await reloadInto(page, 'agent');
  109 |     await expect(page.getByText(fact)).toHaveCount(0);
  110 |   });
  111 | 
  112 |   test('the Ollama address survives a reload', async ({ page }) => {
  113 |     const address = 'http://127.0.0.1:11500';
  114 |     await page.goto('/#/menu/models');
  115 |     await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible();
  116 | 
  117 |     const field = page.getByPlaceholder('http://127.0.0.1:11434');
  118 |     await expect(field).toBeVisible();
  119 |     await field.fill(address);
  120 |     // Committed on Enter, same as the Refresh models button.
  121 |     await field.press('Enter');
  122 | 
  123 |     await reloadInto(page, 'models');
  124 |     await expect(page.getByPlaceholder('http://127.0.0.1:11434')).toHaveValue(address);
  125 |   });
  126 | 
  127 |   test('changing a setting never throws in the page', async ({ page }) => {
  128 |     // The theme switcher was broken for as long as it existed because nothing
  129 |     // watched for the uncaught TypeError it threw on every click. A silent
  130 |     // no-op looks identical to a working control from the outside.
  131 |     const errors: string[] = [];
  132 |     page.on('pageerror', error => errors.push(error.message));
  133 | 
  134 |     await openSettings(page);
  135 |     for (const name of ['Dark', 'Light', 'System']) {
  136 |       await page.getByRole('button', { name, exact: true }).click();
  137 |     }
  138 |     await page.getByRole('switch', { name: 'Automatic thread titles' }).click();
  139 |     await page.getByRole('switch', { name: 'Close button hides to tray' }).click();
  140 | 
  141 |     expect(errors).toEqual([]);
  142 |   });
  143 | 
  144 |   test('the Brave search key sets, persists, and clears', async ({ page }) => {
  145 |     // Key fields are the riskiest thing on this surface: they write through a
  146 |     // separate secret path, and a key that looks saved but is not means silent
  147 |     // failures later, in a place the user has no reason to re-check.
  148 |     await page.goto('/#/menu/models');
  149 |     await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible();
  150 | 
  151 |     // Scoped to the Brave card: OpenRouter is already keyed by the fixture, so
  152 |     // an unscoped "Reveal" matches two buttons.
  153 |     const card = page.getByTestId('settings.models.search-card');
  154 |     const field = card.getByPlaceholder('Paste your Brave Search API key…');
  155 |     await expect(field).toBeVisible();
  156 |     await field.fill('brave-test-key');
  157 |     await field.press('Enter');
  158 |     // Once set, the field is replaced by the Reveal/Remove pair.
  159 |     await expect(card.getByRole('button', { name: 'Reveal' })).toBeVisible();
  160 | 
  161 |     await reloadInto(page, 'models');
  162 |     await expect(page.getByTestId('settings.models.search-card').getByRole('button', { name: 'Reveal' })).toBeVisible();
  163 |     await expect(page.getByTestId('settings.models.search-card')
  164 |       .getByPlaceholder('Paste your Brave Search API key…')).toHaveCount(0);
  165 | 
  166 |     // Clearing has to persist too, or a key the user removed is still on disk.
  167 |     await page.getByTestId('settings.models.search-card').getByRole('button', { name: 'Remove' }).click();
  168 |     await expect(page.getByTestId('settings.models.search-card')
  169 |       .getByPlaceholder('Paste your Brave Search API key…')).toBeVisible();
  170 |     await reloadInto(page, 'models');
  171 |     await expect(page.getByTestId('settings.models.search-card')
```