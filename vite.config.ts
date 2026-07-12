import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { visualizer } from 'rollup-plugin-visualizer'

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
      watch: {
        // src-tauri/target holds ~hundreds of thousands of cargo build files;
        // watching them exhausts fs.inotify budgets and has crashed dev
        // servers mid-session. Vite ignores node_modules by default but not
        // this tree.
        ignored: ['**/src-tauri/target/**'],
      },
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
