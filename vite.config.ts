import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { visualizer } from 'rollup-plugin-visualizer'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const analyze = mode === 'analyze'

  return {
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
    },
  }
})
