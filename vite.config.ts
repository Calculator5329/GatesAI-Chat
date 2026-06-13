import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { visualizer } from 'rollup-plugin-visualizer'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const analyze = mode === 'analyze'
  // Base public path override for static hosts that serve from a subpath, e.g.
  // a GitHub Pages project site at /<repo>/. Defaults to root, so desktop
  // (Tauri) and root-domain hosting builds are unaffected.
  const base = process.env.VITE_BASE ?? '/'

  return {
    base,
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
