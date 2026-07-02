import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Vitest config for the live integration suite under tests/integration/.
// These tests hit real provider APIs and are opt-in. Run with:
//   npm run test:models
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
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
