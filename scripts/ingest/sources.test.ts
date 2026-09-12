import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishedSeasons } from './sources';
import { IngestError } from './errors';

/**
 * The 2026 season opened on the Thursday night before this was written, which
 * is the case these tests exist for: `snap_counts_2026.csv` was live, returned
 * 200, and held one game.
 */
const NOW = new Date('2026-09-11T12:00:00Z');

const fileFor = (season: number) => `snap_counts_${season}.csv`;

/** Answer HEAD for exactly these seasons, 404 for the rest. */
function publish(seasons: number[]) {
  const stub = vi.fn(async (url: string | URL) =>
    seasons.some((season) => String(url).includes(String(season)))
      ? new Response(null, { status: 200 })
      : new Response(null, { status: 404 }),
  );
  vi.stubGlobal('fetch', stub);
  return stub;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('publishedSeasons', () => {
  it('returns the newest published season first', async () => {
    publish([2026, 2025, 2024]);

    const found = await publishedSeasons('snaps', 'snap_counts', fileFor, 2);

    expect(found.map((f) => f.season)).toEqual([2026, 2025]);
    expect(found[0].url).toMatch(/snap_counts_2026\.csv$/);
  });

  it('stops at the limit rather than reaching back through every season', async () => {
    const stub = publish([2026, 2025, 2024]);

    const found = await publishedSeasons('snaps', 'snap_counts', fileFor, 1);

    expect(found.map((f) => f.season)).toEqual([2026]);
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('skips a season the source has not published at all', async () => {
    // July: offseason depth charts exist and offseason snaps do not, so the
    // newest snap file is last season's. The list is what is *there*, not what
    // the calendar says should be.
    publish([2025, 2024]);

    const found = await publishedSeasons('snaps', 'snap_counts', fileFor, 2);

    expect(found.map((f) => f.season)).toEqual([2025, 2024]);
  });

  it('returns what it found even when that is fewer than the limit', async () => {
    publish([2026]);

    const found = await publishedSeasons('snaps', 'snap_counts', fileFor, 2);

    expect(found.map((f) => f.season)).toEqual([2026]);
  });

  it('fails as a fetch error when nothing is published, so the build can fall back', async () => {
    // `kind` is the whole difference between shipping the committed copy and
    // stopping the deploy, so it is asserted rather than the message alone.
    publish([]);

    try {
      await publishedSeasons('snaps', 'snap_counts', fileFor, 2);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IngestError);
      expect((err as IngestError).kind).toBe('fetch');
      expect((err as IngestError).message).toMatch(
        /snaps: no published season found in 2024-2026/,
      );
    }
  });

  it('treats a network failure as an absent season rather than throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL) => {
        if (String(url).includes('2026')) throw new Error('ECONNRESET');
        return new Response(null, { status: 200 });
      }),
    );

    const found = await publishedSeasons('snaps', 'snap_counts', fileFor, 1);

    expect(found.map((f) => f.season)).toEqual([2025]);
  });
});
