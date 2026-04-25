import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'node_modules']),
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true, allowExportNames: ['useRootStore', 'useChatStore', 'useUiStore', 'useProviderStore', 'useRouterStore', 'useModelRegistry', 'useOpenRouterStore', 'useUserProfileStore', 'Icons'] }],
    },
  },
  {
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../stores/*', '../services/*', '../components/*', '../app/*'],
          message: 'core/ must stay independent of app, component, store, and service layers.',
        }],
      }],
    },
  },
  {
    files: ['src/services/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../stores/*', '../../stores/*', '../components/*', '../../components/*', '../app/*', '../../app/*', 'react', 'mobx', 'mobx-react-lite'],
          message: 'services/ may depend on core/ and other services only; use narrow facades instead of stores/UI.',
        }],
      }],
    },
  },
  {
    files: ['src/stores/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../components/*', '../../components/*', '../app/*', '../../app/*', 'mobx-react-lite'],
          message: 'stores/ must not import UI or app composition code.',
        }],
      }],
    },
  },
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../../stores/*', '../../services/*', '../editorial/*', '../menu/*', 'mobx-react-lite'],
          message: 'components/ui/ must stay feature-agnostic and stateless.',
        }],
      }],
    },
  },
  {
    files: ['src/components/**/*.{ts,tsx}'],
    ignores: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['warn', {
        patterns: [{
          group: ['../services/*', '../../services/*'],
          message: 'UI should go through stores/facades rather than importing services directly. This warning becomes an error after attachment upload moves behind a store.',
        }],
      }],
    },
  },
  {
    files: ['tests/**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
])
