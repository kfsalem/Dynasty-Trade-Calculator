import { get, set } from 'idb-keyval';

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
  let stale: CacheEntry<T> | undefined;

  try {
    const hit = await get<CacheEntry<T>>(key);
    if (hit) {
      if (hit.expiresAt > Date.now()) return hit.data;
      // Expired, but held onto: see the fallback below.
      stale = hit;
    }
  } catch {
    // IndexedDB unavailable — fetch live.
  }

  let data: T;
  try {
    data = await fetcher();
  } catch (err) {
    /**
     * An expired entry beats no entry when the source is down.
     *
     * These TTLs are freshness preferences, not correctness boundaries —
     * dynasty values move over weeks, and yesterday's are a rounding error
     * against not loading at all. Without this, a FantasyCalc outage takes the
     * whole app down with it: player values gate the league render, so the user
     * lands on "Couldn't load that league" while a perfectly serviceable copy
     * sits in IndexedDB unread.
     *
     * Only a *failed refresh* falls back. A first visit during an outage has
     * nothing to serve and still throws, which is the honest answer.
     */
    if (stale) {
      console.warn(
        `${key}: refresh failed (${err instanceof Error ? err.message : String(err)}); ` +
          `serving the cached copy from ${new Date(stale.expiresAt - ttlMs).toISOString()}.`,
      );
      return stale.data;
    }
    throw err;
  }

  try {
    await set(key, { data, expiresAt: Date.now() + ttlMs } satisfies CacheEntry<T>);
  } catch {
    // Over quota or unavailable. The value is still good; just don't cache it.
  }

  return data;
}

export const TTL = {
  /** Sleeper explicitly asks for once-a-day on the 5 MB player blob. */
  PLAYERS: 24 * 60 * 60 * 1000,
  /** Values move slowly; twice a day is plenty. */
  VALUES: 12 * 60 * 60 * 1000,
} as const;
