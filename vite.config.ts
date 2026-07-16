import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { visualizer } from 'rollup-plugin-visualizer'

const WATCH_IGNORES = ['**/src-tauri/target/**']
const E2E_WATCH_IGNORES = ['**/*']

export function viteWatchOptions(env: Record<string, string | undefined> = process.env) {
  // Playwright owns the lifetime of its disposable Vite servers and never
  // needs HMR. Ignore every file so browser verification does not consume the
  // host inotify pool.
  if (env.GATESAI_VITE_NO_WATCH === '1') return { ignored: E2E_WATCH_IGNORES }
  return { ignored: WATCH_IGNORES }
}

export function viteHmrOptions(env: Record<string, string | undefined> = process.env) {
  // Vite 8 still applies React-refresh transforms when every path is ignored.
  // Explicitly disabling HMR keeps those transforms and their preamble in sync.
  return env.GATESAI_VITE_NO_WATCH === '1' ? false : undefined
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const analyze = mode === 'analyze'
  const webLite = mode === 'web-lite'
  // Base public path override for static hosts that serve from a subpath, e.g.
  // a GitHub Pages project site at /<repo>/. Defaults to root, so desktop
  // (Tauri) and root-domain hosting builds are unaffected.
  const base = process.env.VITE_BASE ?? '/'

  return {
    base,
    server: {
      // src-tauri/target holds ~hundreds of thousands of cargo build files;
      // watching them exhausts fs.inotify budgets and has crashed dev servers
      // mid-session. Vite ignores node_modules by default but not this tree.
      watch: viteWatchOptions(),
      hmr: viteHmrOptions(),
    },
    // Web Lite is a build mode, not a deploy-time secret. Keep the runtime
    // switch in the build config so it does not depend on a tracked .env file.
    define: webLite
      ? { 'import.meta.env.VITE_GATESAI_WEB': JSON.stringify('1') }
      : undefined,
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      ...(analyze
        ? [
          visualizer({
            filename: 'dist/bundle-analysis.html',
            template: 'treemap',
            gzipSize: true,
            brotliSize: true,
            sourcemap: true,
          }),
          visualizer({
            filename: 'dist/bundle-analysis.json',
            template: 'raw-data',
            gzipSize: true,
            brotliSize: true,
            sourcemap: true,
          }),
        ]
        : []),
    ],
    build: {
      sourcemap: analyze,
      rollupOptions: {
        output: {
          // Keep the heavy markdown/highlight/math rendering stack out of the
          // eager main chunk; it's only needed once a response renders rich
          // content. Mermaid is already lazy-imported and splits on its own.
          // Rolldown-vite only supports the function form of manualChunks.
          manualChunks(id: string) {
            if (/node_modules[\\/](react-markdown|remark-|rehype-|micromark|mdast|hast|unist|unified|highlight\.js|lowlight|katex|vfile|refractor)/.test(id)) {
              return 'markdown'
            }
            return undefined
          },
        },
      },
    },
  }
})
