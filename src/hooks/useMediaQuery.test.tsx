import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useMediaQuery } from './useMediaQuery';

/**
 * The hook exists for one job — an attribute that CSS cannot set, like
 * `<details open>` — so what matters is that it reports the truth at mount and
 * keeps reporting it. A stale answer here means the markup describes a viewport
 * that is no longer on screen.
 */

/** A controllable `matchMedia`, since jsdom has none worth driving. */
function installMatchMedia(initial: boolean) {
  const listeners = new Set<(e: MediaQueryListEvent) => void>();
  let matches = initial;

  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    get matches() {
      return matches;
    },
    media: query,
    onchange: null,
    addEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => {
      listeners.add(fn);
    },
    removeEventListener: (_: string, fn: (e: MediaQueryListEvent) => void) => {
      listeners.delete(fn);
    },
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;

  return {
    set(next: boolean) {
      matches = next;
      for (const fn of listeners) fn({ matches: next } as MediaQueryListEvent);
    },
    get listenerCount() {
      return listeners.size;
    },
    restore() {
      window.matchMedia = original;
    },
  };
}

let media: ReturnType<typeof installMatchMedia> | null = null;

afterEach(() => {
  media?.restore();
  media = null;
});

describe('useMediaQuery', () => {
  it('reports the match it starts with', () => {
    media = installMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(result.current).toBe(true);
  });

  /** Rotating a phone, or dragging a window narrow. */
  it('follows the query as it changes', () => {
    media = installMatchMedia(true);
    const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));

    act(() => media!.set(false));
    expect(result.current).toBe(false);

    act(() => media!.set(true));
    expect(result.current).toBe(true);
  });

  it('unsubscribes when it goes away', () => {
    media = installMatchMedia(false);
    const { unmount } = renderHook(() => useMediaQuery('(min-width: 768px)'));
    expect(media.listenerCount).toBe(1);

    unmount();
    expect(media.listenerCount).toBe(0);
  });

  /**
   * A server render, or a jsdom test that has not stubbed `matchMedia`. Missing
   * has to mean "no match" rather than throw, and "no match" is deliberately the
   * small-screen answer — this is a mobile-first pass, so the layout a test sees
   * by default should be the one a phone sees.
   */
  it('reports no match rather than throwing when matchMedia is missing', () => {
    const original = window.matchMedia;
    // @ts-expect-error — deliberately removing it, which is the case under test.
    delete window.matchMedia;
    try {
      const { result } = renderHook(() => useMediaQuery('(min-width: 768px)'));
      expect(result.current).toBe(false);
    } finally {
      window.matchMedia = original;
    }
  });

  it('re-reads when the query itself changes', () => {
    media = installMatchMedia(false);
    const { result, rerender } = renderHook(({ q }: { q: string }) => useMediaQuery(q), {
      initialProps: { q: '(min-width: 768px)' },
    });
    expect(result.current).toBe(false);

    act(() => media!.set(true));
    rerender({ q: '(pointer: fine)' });
    expect(result.current).toBe(true);
  });
});
