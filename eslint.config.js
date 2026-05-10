import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'src-tauri/target']),
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
      // Fast Refresh export-shape warnings are useful while authoring a
      // small Vite demo, but this app intentionally colocates typed helpers,
      // test APIs, and observer subcomponents. Keep production lint focused
      // on correctness rules that affect shipped behavior.
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['../stores/*', '../services/*', '../components/*', '../app/*'],
            message: 'core/ must stay independent of app, component, store, and service layers.',
          },
          {
            group: ['react', 'mobx', 'mobx-react-lite'],
            message: 'core/ must stay framework-agnostic; put React/MobX typing at the UI or store boundary.',
          },
        ],
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
          group: ['../components/*', '../../components/*', '../app/*', '../../app/*', 'react', 'mobx-react-lite'],
          message: 'stores/ must not import UI, React, or app composition code. Use stores/context.tsx as the React bridge.',
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
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../services/*', '../../services/*'],
          message: 'UI must go through stores/facades rather than importing services directly.',
        }],
      }],
    },
  },
  {
    files: ['src/components/editorial/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../menu/*', '../menu/**'],
          message: 'editorial components must not import menu components; move shared UI to components/ui.',
        }],
      }],
    },
  },
  {
    files: ['src/components/menu/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../editorial/*', '../editorial/**'],
          message: 'menu components must not import editorial components; move shared UI to components/ui.',
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
