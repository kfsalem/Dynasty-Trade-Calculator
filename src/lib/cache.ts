import { get, set, del } from 'idb-keyval';

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

/**
 * Read-through cache backed by IndexedDB.
 *
 * localStorage is not an option here: Sleeper's player blob is ~5 MB, well past
 * the usual 5 MB *total* localStorage quota. IndexedDB has no such problem.
 *
 * Every IDB call is guarded — Safari private mode and some embedded browsers
 * throw on open. A cache that is unavailable should slow the app down, not
 * break it, so failures fall through to a live fetch.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  try {
    const hit = await get<CacheEntry<T>>(key);
    if (hit && hit.expiresAt > Date.now()) {
      return hit.data;
    }
  } catch {
    // IndexedDB unavailable — fetch live.
  }

  const data = await fetcher();

  try {
    await set(key, { data, expiresAt: Date.now() + ttlMs } satisfies CacheEntry<T>);
  } catch {
    // Over quota or unavailable. The value is still good; just don't cache it.
  }

  return data;
}

export async function invalidate(key: string): Promise<void> {
  try {
    await del(key);
  } catch {
    // Nothing to do if IDB is unavailable.
  }
}

export const TTL = {
  /** Sleeper explicitly asks for once-a-day on the 5 MB player blob. */
  PLAYERS: 24 * 60 * 60 * 1000,
  /** Values move slowly; twice a day is plenty. */
  VALUES: 12 * 60 * 60 * 1000,
} as const;
