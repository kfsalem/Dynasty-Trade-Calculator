import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'dynasty:theme';

export type Theme = 'light' | 'dark';

/**
 * Reads what the inline script in `index.html` already decided.
 *
 * That script runs before first paint and is the single source of truth for
 * which theme the page opened in; asking the DOM here rather than recomputing
 * from storage means the two can never disagree, which is how a theme toggle
 * ends up one click out of phase.
 */
function current(): Theme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/**
 * The theme, and a way to change it.
 *
 * A stored choice beats the OS preference in both directions — someone who
 * picked light on a dark-mode machine meant it, and an implementation that only
 * honours "darker than the OS" quietly overrides half its users. Absent a
 * stored choice the OS preference is followed live, so a machine that switches
 * at sunset takes the app with it.
 */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const [theme, setTheme] = useState<Theme>(current);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  // Follow the OS only while the user has expressed no preference of their own.
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem(STORAGE_KEY) !== null) return;
      } catch {
        // Storage disabled: nothing could have been stored, so follow the OS.
      }
      setTheme(e.matches ? 'dark' : 'light');
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Storage disabled — the choice holds for this page only.
      }
      return next;
    });
  }, []);

  return { theme, toggle };
}
