/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

/**
 * The first load's budget, in kB as Vite reports them (#170).
 *
 * 474.7 kB when the tabs were split out on 2026-10-19, down from 552.4. The
 * line sits at Vite's own 500 kB warning, which every build printed for months
 * without anyone acting on it. So this one fails the build instead: going past
 * it means something heavy joined the first load, and it should be lazy.
 */
const FIRST_LOAD_BUDGET_KB = 500

function firstLoadBudget(): Plugin {
  return {
    name: 'first-load-budget',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk' || !chunk.isEntry) continue
        const kb = Buffer.byteLength(chunk.code) / 1000
        if (kb > FIRST_LOAD_BUDGET_KB) {
          this.error(
            `${chunk.fileName} is ${kb.toFixed(1)} kB, over the ${FIRST_LOAD_BUDGET_KB} kB first-load budget. ` +
              `Load the new code on demand (see tabModules in src/App.tsx), or raise the budget on purpose.`,
          )
        }
      }
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // Served from https://kfsalem.github.io/Dynasty-Trade-Calculator/
  base: '/Dynasty-Trade-Calculator/',
  plugins: [react(), tailwindcss(), firstLoadBudget()],
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
