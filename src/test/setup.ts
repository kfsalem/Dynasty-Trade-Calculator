import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

/**
 * jsdom does not implement `matchMedia`, and every real browser does.
 *
 * `useTheme` subscribes to `prefers-color-scheme` so a machine that switches at
 * sunset takes the app with it. Without this stub any test that mounts the app
 * throws before rendering. Defaults to light and never fires a change, which is
 * the right baseline: a test asserting theme behaviour should install its own
 * matcher rather than inherit an opinion from here.
 */
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}
