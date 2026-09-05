# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: web-lite.spec.ts >> web lite (no bridge) >> shows the web lite status and disables attachments
- Location: tests/e2e/web-lite.spec.ts:13:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('web lite')
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText('web lite')

```

# Test source

```ts
  1  | // Web Lite build assertions: the bridge is intentionally absent, so the UI must
  2  | // degrade gracefully — the status pill, disabled attachments, and the notices
  3  | // on the bridge-dependent menu sections.
  4  | import { test, expect } from '@playwright/test';
  5  | import { mockOpenRouter, seedReadyProvider } from './fixtures/harness';
  6  | 
  7  | test.describe('web lite (no bridge)', () => {
  8  |   test.beforeEach(async ({ page }) => {
  9  |     await seedReadyProvider(page);
  10 |     await mockOpenRouter(page);
  11 |   });
  12 | 
  13 |   test('shows the web lite status and disables attachments', async ({ page }) => {
  14 |     await page.goto('/');
> 15 |     await expect(page.getByText('web lite')).toBeVisible();
     |                                              ^ Error: expect(locator).toBeVisible() failed
  16 |     await expect(page.locator('button.composer-attach-btn')).toBeDisabled();
  17 |   });
  18 | 
  19 |   test('still streams a chat reply without the bridge', async ({ page }) => {
  20 |     await page.goto('/');
  21 |     await page.locator('.composer-textarea').fill('hi there');
  22 |     await page.locator('button.composer-send-control[aria-label="Send"]').click();
  23 |     await expect(page.locator('.md-body', { hasText: 'Mock reply from the assistant.' })).toBeVisible();
  24 |   });
  25 | 
  26 |   test('redirects retired menu hashes to their new homes', async ({ page }) => {
  27 |     await page.goto('/#/menu/gallery');
  28 |     await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  29 | 
  30 |     await page.goto('/#/menu/local');
  31 |     await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible();
  32 |   });
  33 | 
  34 |   test('hides the desktop-only settings rather than showing dead switches', async ({ page }) => {
  35 |     await page.goto('/#/menu/settings');
  36 |     await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  37 |     // Global summon and the tray behaviour are Tauri-only. Shipping them here
  38 |     // as inert switches would be exactly the "half-works" the direction doc
  39 |     // rules out, so they must be absent, not merely disabled.
  40 |     await expect(page.getByRole('switch', { name: 'Global summon' })).toHaveCount(0);
  41 |     await expect(page.getByRole('switch', { name: 'Close button hides to tray' })).toHaveCount(0);
  42 |     // The cross-runtime ones are still here and still work.
  43 |     await expect(page.getByRole('switch', { name: 'Automatic thread titles' })).toBeVisible();
  44 |     await expect(page.getByRole('button', { name: 'Light', exact: true })).toBeVisible();
  45 |   });
  46 | 
  47 |   test('explains that semantic recall requires desktop without dead controls', async ({ page }) => {
  48 |     await page.goto('/#/menu/agent');
  49 | 
  50 |     await expect(page.getByText('Semantic recall needs the desktop app and a local Ollama embedding model.')).toBeVisible();
  51 |     await expect(page.getByText('Automatic recall')).toHaveCount(0);
  52 |   });
  53 | });
  54 | 
  55 | test.describe('web lite without a configured provider', () => {
  56 |   test.beforeEach(async ({ page }) => {
  57 |     await page.addInitScript(() => {
  58 |       localStorage.setItem('gatesai.userGuide.opened.v1', '1');
  59 |     });
  60 |     await mockOpenRouter(page);
  61 |   });
  62 | 
  63 |   test('shows OpenRouter onboarding without local runtimes', async ({ page }) => {
  64 |     await page.goto('/');
  65 | 
  66 |     // First boot shows the local-first hero (redesigned 2026-07-11); Web
  67 |     // Lite offers the OpenRouter CTA and no local-runtime affordances.
  68 |     await expect(page.getByText('LOCAL-FIRST AI WORKSPACE')).toBeVisible();
  69 |     await expect(page.getByText('Add an OpenRouter key in Models to start chatting.')).toBeVisible();
  70 |     await expect(page.getByText('Use local models')).toHaveCount(0);
  71 |     await expect(page.locator('button.composer-send-control[aria-label="Send"]')).toBeDisabled();
  72 |   });
  73 | 
  74 |   test('models menu shows the OpenRouter key connect form', async ({ page }) => {
  75 |     await page.goto('/#/menu/models');
  76 | 
  77 |     await expect(page.getByRole('heading', { name: 'Models' })).toBeVisible();
  78 |     await expect(page.getByPlaceholder('Paste your OpenRouter API key…')).toBeVisible();
  79 |     await expect(page.getByRole('button', { name: 'Connect' }).first()).toBeDisabled();
  80 |   });
  81 | });
  82 | 
```