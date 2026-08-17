import { useEffect, useState } from 'react';

/**
 * Whether a CSS media query currently matches, kept in sync as it changes.
 *
 * Almost everything responsive in this app is done in CSS, which is where it
 * belongs — a breakpoint that only moves boxes around never needs to reach
 * JavaScript. This exists for the cases where the *markup* has to differ rather
 * than its layout: an attribute like `<details open>` has no CSS equivalent, so
 * a media query is the only way to say "expanded on a desktop, folded on a
 * phone" without rendering the content twice.
 *
 * Subscribed rather than read once at mount. Reading once is the tempting
 * shortcut and it is wrong in two ordinary situations: rotating a phone, and
 * dragging a desktop window narrow — both leave the markup describing a
 * viewport that is no longer there.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    // `matchMedia` is missing in jsdom unless a test stubs it. Reporting "no
    // match" makes the small-screen layout the one tests see by default, which
    // is the honest default for a mobile-first pass.
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches);

    // Re-read on subscribe: the query can have changed between the initial
    // state and this effect, and on a remount it certainly can have.
    setMatches(list.matches);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
