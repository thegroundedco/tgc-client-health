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
    // Node 26 (LTS since 2026-10-28; CI installs lts/*) turns its own Web
    // Storage on by default, and without --localstorage-file its localStorage
    // is undefined -- yet it still shadows jsdom's, so every test touching
    // localStorage fails. Switched off in the workers; Node 24 accepts the flag
    // too, where it is a no-op.
    execArgv: ['--no-experimental-webstorage'],
  },
})
