/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  // Served from https://kfsalem.github.io/Dynasty-Trade-Calculator/
  base: '/Dynasty-Trade-Calculator/',
  plugins: [react(), tailwindcss()],
  test: {
    /**
     * Two suites, one command, split by extension: `.test.ts` is logic and runs
     * in node, `.test.tsx` mounts something and needs a DOM.
     *
     * The split is worth the config. The logic suite is several hundred tests
     * that finish in well under a second, and pushing all of them through jsdom
     * to serve the handful that need it would tax every future test to pay for
     * these.
     */
    projects: [
      {
        extends: true,
        test: {
          name: 'logic',
          environment: 'node',
          // `scripts/` too: the build-time ingest is tested and is not in src.
          include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'jsdom',
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/**/*.test.tsx'],
        },
      },
    ],
  },
})
