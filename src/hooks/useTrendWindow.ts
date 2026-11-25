import { useCallback, useSyncExternalStore } from 'react';
import { DEFAULT_TREND_WINDOW, type TrendWindowKey } from '../values/valueTrend';

const KEY = 'dynasty:trendWindow';
const KEYS: readonly TrendWindowKey[] = ['week', 'month', 'all'];

/**
 * The choice, kept only when storage refused to save it (private mode), so it
 * still holds for this visit. Null whenever storage is doing the remembering.
 */
let memory: TrendWindowKey | null = null;
const listeners = new Set<() => void>();

const read = (): TrendWindowKey => {
  if (memory !== null) return memory;
  try {
    const stored = localStorage.getItem(KEY);
    return KEYS.includes(stored as TrendWindowKey) ? (stored as TrendWindowKey) : DEFAULT_TREND_WINDOW;
  } catch {
    return DEFAULT_TREND_WINDOW;
  }
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
};

/**
 * The value-trend window, remembered in this browser and shared (#158).
 *
 * Shared because the movers card on My team and the chart in the player panel
 * describe the same move: open a riser from the card and the panel should say
 * the figure the card just did, over the same span. A display preference, so
 * it lives in localStorage like the standings mode (`DESIGN.md` §7 decision 2).
 */
export function useTrendWindow(): [TrendWindowKey, (next: TrendWindowKey) => void] {
  const key = useSyncExternalStore(subscribe, read, () => DEFAULT_TREND_WINDOW);
  const set = useCallback((next: TrendWindowKey) => {
    try {
      localStorage.setItem(KEY, next);
      memory = null;
    } catch {
      memory = next;
    }
    listeners.forEach((listener) => listener());
  }, []);
  return [key, set];
}
