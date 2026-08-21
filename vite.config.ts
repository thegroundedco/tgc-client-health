// defineConfig must come from vitest/config, not vite — the `test` key is not
// part of Vite's own config type and TypeScript will reject it.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// GitHub Pages serves project sites from /<repo-name>/, so assets must be
// requested from that prefix. A leading and trailing slash are both required.
export default defineConfig({
  plugins: [react()],
  base: '/tgc-client-health/',
  test: {
    environment: 'node',
  },
})
