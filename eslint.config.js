import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import importPlugin from 'eslint-plugin-import'
import mobx from 'eslint-plugin-mobx'
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
    plugins: { import: importPlugin },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    settings: {
      'import/resolver': { typescript: true, node: true },
    },
    rules: {
      // Circular imports compile fine in ESM but rot the layered architecture
      // and cause subtle init-order bugs. Block them outright.
      'import/no-cycle': ['error', { maxDepth: 8 }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // Fast Refresh export-shape warnings are useful while authoring a
      // small Vite demo, but this app intentionally colocates typed helpers,
      // test APIs, and observer subcomponents. Keep production lint focused
      // on correctness rules that affect shipped behavior.
      'react-refresh/only-export-components': 'off',
      // All runtime diagnostics go through services/diagnostics/logger, which is
      // the single sanctioned console boundary (exempted below). Anywhere else,
      // a raw console call is a logging-convention violation.
      'no-console': 'error',
      // Consistent `import type { ... }` keeps type-only deps obvious and plays
      // nicely with verbatimModuleSyntax + tree-shaking.
      '@typescript-eslint/consistent-type-imports': ['error', {
        prefer: 'type-imports',
        fixStyle: 'separate-type-imports',
      }],
    },
  },
  {
    // The logger is the one place allowed to touch the console.
    files: ['src/services/diagnostics/logger.ts'],
    rules: { 'no-console': 'off' },
  },
  // NOTE on flat-config rule semantics: when multiple config objects set the
  // SAME rule for overlapping files, the LAST one wins outright (options are
  // replaced, not merged). So every block below is self-contained, and the
  // path globs use a leading `**/` so they match regardless of how deeply the
  // importing file is nested (e.g. components/menu/sections/*).
  {
    files: ['src/core/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['**/stores/**', '**/services/**', '**/components/**', '**/app/**'],
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
          group: ['**/stores/**', '**/components/**', '**/app/**', 'react', 'mobx', 'mobx-react-lite'],
          message: 'services/ may depend on core/ and other services only; use narrow facades instead of stores/UI.',
        }],
      }],
    },
  },
  {
    files: ['src/stores/**/*.ts'],
    plugins: { mobx },
    rules: {
      // Keep the MobX store pattern honest: every observable class must call
      // make(Auto)Observable, annotations must be exhaustive, and the call must
      // be unconditional.
      'mobx/missing-make-observable': 'error',
      'mobx/exhaustive-make-observable': 'error',
      'mobx/unconditional-make-observable': 'error',
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/components/**', '**/app/**', 'react', 'mobx-react-lite'],
          message: 'stores/ must not import UI, React, or app composition code. Use stores/context.tsx as the React bridge.',
        }],
      }],
      // Network belongs in services. Stores orchestrate; they ask a service for
      // data and own only the resulting observable state.
      'no-restricted-syntax': ['error', {
        selector: "CallExpression[callee.name='fetch']",
        message: 'Do not call fetch() in a store. Put the network call in a service and have the store consume it.',
      }],
      // Persistence is a service concern. Stores read/write through a
      // PersistenceProvider/storage service, never localStorage directly.
      'no-restricted-globals': ['error', {
        name: 'localStorage',
        message: 'Do not use localStorage in a store. Go through a services/storage/* facade.',
      }, {
        name: 'sessionStorage',
        message: 'Do not use sessionStorage in a store. Go through a services/storage/* facade.',
      }],
    },
  },
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/stores/**', '**/services/**', '**/editorial/**', '**/menu/**', '**/media/**', 'mobx-react-lite'],
          message: 'components/ui/ must stay feature-agnostic and stateless.',
        }],
      }],
    },
  },
  // Generic feature-component rule: applies to media/ and any future feature
  // folder. editorial/ and menu/ override this with their own (self-contained)
  // blocks below, so those repeat the services ban.
  {
    files: ['src/components/**/*.{ts,tsx}'],
    ignores: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/services/**'],
          message: 'UI must go through stores/facades rather than importing services directly.',
        }],
      }],
    },
  },
  {
    files: ['src/components/editorial/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['**/services/**'],
            message: 'UI must go through stores/facades rather than importing services directly.',
          },
          {
            group: ['**/menu/**'],
            message: 'editorial components must not import menu components; move shared UI to components/ui or components/media.',
          },
        ],
      }],
    },
  },
  {
    files: ['src/components/menu/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['**/services/**'],
            message: 'UI must go through stores/facades rather than importing services directly.',
          },
          {
            group: ['**/editorial/**'],
            message: 'menu components must not import editorial components; move shared UI to components/ui or components/media.',
          },
        ],
      }],
    },
  },
  {
    // Persistence is never a UI concern: components read/write app data through
    // a store facade, which delegates to a services/storage/* module.
    files: ['src/components/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': ['error', {
        name: 'localStorage',
        message: 'Do not use localStorage in UI. Expose it through a store facade backed by services/storage/*.',
      }, {
        name: 'sessionStorage',
        message: 'Do not use sessionStorage in UI. Expose it through a store facade backed by services/storage/*.',
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
