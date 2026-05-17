# GatesAI Chat

## Install

Grab the latest Windows installer from the releases page (`<TBD: link to GitHub releases>`), double-click it, and follow the NSIS prompts. Once installed, launch **GatesAI Chat** from the Start menu — no terminal needed.

The installer bundles the GatesAI Bridge automatically; no separate Go install required.

## Development

This project is a Vite + React + TypeScript SPA wrapped in a Tauri desktop shell. The Go-based bridge process lives alongside the chat app and is spawned by Tauri at runtime.

Requirements:

- Node.js / npm for the chat app
- Rust + Tauri prerequisites for desktop builds
- Either Go 1.24+ or a built bridge binary at `..\gatesai-bridge\bin\gatesai-bridge.exe`

Common commands:

- `npm install` — install dependencies
- `npm run dev` — start the Vite dev server
- `npm run tauri dev` — run the desktop app against the dev server
- `npm run tauri build` — produce the NSIS installer

To run the bridge directly from source during development:

```powershell
cd ..\gatesai-bridge
go run ./cmd/gatesai-bridge
```

### Linux AppImage builds

Tauri sidecars must be named with the target triple. Linux AppImage builds need:

```text
src-tauri/binaries/gatesai-bridge-x86_64-unknown-linux-gnu
```

From a Linux host with the companion bridge repo checked out next to this repo:

```bash
npm ci
bash scripts/prepare-linux-sidecar.sh
npx tauri build --bundles appimage
```

You can also provide a prebuilt bridge:

```bash
GATESAI_BRIDGE_BIN=/path/to/gatesai-bridge-x86_64-unknown-linux-gnu \
  bash scripts/prepare-linux-sidecar.sh
```

The GitHub Actions workflow builds a real Linux bridge when `GATESAI_BRIDGE_REPOSITORY` is configured as a repository variable, or when manually dispatched with `bridge_repo`. The `allow_stub` manual input is only for packaging smoke tests; stub AppImages start, but workspace tools stay offline.

For end-user Arch Linux installation steps, open `docs/arch-linux-appimage-install.html`.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.

Note: This will impact Vite dev & build performances.

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
