import { defineConfig } from 'vitest/config';

// The spike runs on the repo's installed vitest but is otherwise standalone:
// its own include glob, and `node` rather than `jsdom`, because a headless
// core that needs a DOM to run its tests is not headless.
export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    globals: false,
    restoreMocks: true,
    clearMocks: true,
  },
});
