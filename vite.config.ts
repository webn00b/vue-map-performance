import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  // GitHub Pages serves the demo from /<repo>/.
  base: process.env.BASE_PATH ?? '/',
  plugins: [vue()],
  worker: { format: 'es' },
  // MapLibre alone is about 1 MB minified.
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'happy-dom',
  },
})
