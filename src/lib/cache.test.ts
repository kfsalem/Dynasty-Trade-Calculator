import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `idb-keyval` is replaced with a Map rather than pointed at a fake IndexedDB.
 *
 * The behaviour under test is entirely about *when* the cache is read, written
 * and fallen back on; nothing here depends on IndexedDB's own semantics, and a
 * shim would only add a second thing that can fail.
 */
const idb = vi.hoisted(() => {
  const store = new Map<string, unknown>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

vi.mock('idb-keyval', () => ({ get: idb.get, set: idb.set, del: idb.del }));

import { cached, TTL } from './cache';

const HOUR = 60 * 60 * 1000;

beforeEach(() => {
  idb.store.clear();
  vi.clearAllMocks();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cached', () => {
  it('serves a fresh entry without calling the source', async () => {
    idb.store.set('k', { data: 'cached', expiresAt: Date.now() + HOUR });
    const fetcher = vi.fn(async () => 'live');

    expect(await cached('k', HOUR, fetcher)).toBe('cached');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('refetches once the entry has expired, and stores what it gets', async () => {
    idb.store.set('k', { data: 'old', expiresAt: Date.now() - 1 });
    const fetcher = vi.fn(async () => 'fresh');

    expect(await cached('k', HOUR, fetcher)).toBe('fresh');
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(idb.store.get('k')).toMatchObject({ data: 'fresh' });
  });

  /**
   * The reason this function was revisited.
   *
   * Player values gate the whole league render, so a FantasyCalc outage used to
   * take the app down while a perfectly usable copy sat unread in IndexedDB.
   * These TTLs are freshness preferences, not correctness boundaries.
   */
  it('falls back to an expired entry when the source is down', async () => {
    idb.store.set('k', { data: 'yesterday', expiresAt: Date.now() - 1 });
    const fetcher = vi.fn(async () => {
      throw new Error('FantasyCalc is unreachable');
    });

    expect(await cached('k', HOUR, fetcher)).toBe('yesterday');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('says so in the console when it serves a stale copy', async () => {
    idb.store.set('k', { data: 'yesterday', expiresAt: Date.now() - 1 });

    await cached('k', HOUR, async () => {
      throw new Error('FantasyCalc is unreachable');
    });

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('FantasyCalc is unreachable'),
    );
  });

  it('still throws when the source is down and nothing was cached', async () => {
    // A first visit during an outage has nothing to fall back to, and pretending
    // otherwise would mean inventing values.
    const fetcher = vi.fn(async () => {
      throw new Error('FantasyCalc is unreachable');
    });

    await expect(cached('k', HOUR, fetcher)).rejects.toThrow('FantasyCalc is unreachable');
  });

  it('returns the value even when it cannot be written back', async () => {
    // Over quota, or private mode. The fetch already succeeded; refusing to
    // return it would turn a caching problem into a loading failure.
    idb.set.mockRejectedValueOnce(new Error('QuotaExceededError'));

    expect(await cached('k', HOUR, async () => 'live')).toBe('live');
  });

  it('fetches live when the cache cannot be read at all', async () => {
    idb.get.mockRejectedValueOnce(new Error('IndexedDB is blocked'));

    expect(await cached('k', HOUR, async () => 'live')).toBe('live');
  });

  it('publishes the TTLs the callers rely on', () => {
    expect(TTL.PLAYERS).toBe(24 * HOUR);
    expect(TTL.VALUES).toBe(12 * HOUR);
  });
});
