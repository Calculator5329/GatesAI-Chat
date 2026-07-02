import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Live integration tests live under tests/integration/ and hit real
    // provider APIs. Excluded from the default run so CI / contributors
    // don't burn tokens or fail without keys. Run them with
    //   npm run test:models
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/integration/**'],
    environment: 'jsdom',
    globals: false,
    restoreMocks: true,
    clearMocks: true,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
