// The `test` every hand-written spec imports. Outside Tauri the app reaches
// Ollama and ComfyUI with plain fetch, so without this a spec would find
// whatever the developer's machine runs on those ports and start chats on a
// real local model. A spec that wants a local runtime mocks it with
// page.route (mockOllama), which takes precedence over this context route.
import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';
export type { Page, TestInfo } from '@playwright/test';

const LOCAL_RUNTIME_ORIGINS = /^http:\/\/(127\.0\.0\.1|localhost):(11434|8188|8000)\//;

export const test = base.extend<{ refuseLocalRuntimes: void }>({
  refuseLocalRuntimes: [async ({ context }, use) => {
    await context.route(LOCAL_RUNTIME_ORIGINS, route => route.abort('connectionrefused'));
    await use();
  }, { auto: true }],
});
