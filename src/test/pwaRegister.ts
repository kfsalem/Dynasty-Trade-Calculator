/**
 * What the tests get in place of `virtual:pwa-register/react` (#171).
 *
 * The real module registers the service worker, and jsdom has none, so in
 * tests it never did anything. It still had to load, and on Windows it does
 * not: Vitest is handed `file:///@vite-plugin-pwa/virtual:pwa-register/react`
 * as a filename, refuses it, and every test that mounts `App` fails before it
 * starts. CI runs on Linux, where the module loads, so only a Windows machine
 * saw it.
 *
 * Swapped in by an alias on the `dom` suite in `vite.config.ts`. It reports
 * what a browser without a service worker would: no new version waiting, and
 * nothing newly ready offline.
 */
import type { useRegisterSW as Real } from 'virtual:pwa-register/react';

const unchanged = () => {};

export const useRegisterSW: typeof Real = () => ({
  needRefresh: [false, unchanged],
  offlineReady: [false, unchanged],
  updateServiceWorker: async () => {},
});
