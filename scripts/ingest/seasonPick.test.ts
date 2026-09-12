import { describe, expect, it, vi } from 'vitest';
import { reduceStartedSeason, type SeasonCandidate } from './seasonPick';
import { IngestError } from './errors';

const candidate = (season: number): SeasonCandidate => ({
  season,
  url: `https://example.test/snap_counts_${season}.csv`,
});

/** A reduction holding `count` players, the only thing the picker reads. */
const reduction = (count: number) => ({
  file: { players: Object.fromEntries(Array.from({ length: count }, (_, i) => [`p${i}`, {}])) },
});

describe('reduceStartedSeason', () => {
  it('takes the newest season when it has been played', async () => {
    const read = vi.fn(async () => reduction(400));

    const { chosen, rows, notStarted } = await reduceStartedSeason(
      'snaps',
      300,
      [candidate(2026), candidate(2025)],
      read,
    );

    expect(rows).toBe(400);
    expect(notStarted).toEqual([]);
    expect(chosen).toBe(await read.mock.results[0].value);
    // The older season is never fetched, which is the point of stopping.
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('falls back to last season when the newest has only just kicked off', async () => {
    // The live case on 2026-09-11: one game played, 27 skill players, floor 300.
    const read = vi.fn(async ({ season }: SeasonCandidate) =>
      reduction(season === 2026 ? 27 : 634),
    );

    const { rows, notStarted } = await reduceStartedSeason(
      'snaps',
      300,
      [candidate(2026), candidate(2025)],
      read,
    );

    expect(rows).toBe(634);
    expect(notStarted).toEqual([{ season: 2026, rows: 27 }]);
  });

  it('reports the thin season so the build says which one it skipped', async () => {
    // Silence here would be the worst outcome: the data would quietly be a year
    // old with a green build and nothing on screen to say so.
    const read = async ({ season }: SeasonCandidate) => reduction(season === 2026 ? 23 : 612);

    const { notStarted } = await reduceStartedSeason(
      'opportunity',
      300,
      [candidate(2026), candidate(2025)],
      read,
    );

    expect(notStarted).toEqual([{ season: 2026, rows: 23 }]);
  });

  it('fails as schema drift when every season it can reach is empty', async () => {
    // One thin season is a calendar. Two is a source that changed under us, and
    // that has to stop the build rather than ship a year-old file forever.
    const read = async () => reduction(4);

    try {
      await reduceStartedSeason('snaps', 300, [candidate(2026), candidate(2025)], read);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(IngestError);
      expect((err as IngestError).kind).toBe('schema');
      expect((err as IngestError).message).toMatch(/snaps: reduced to 4 players/);
    }
  });

  it('blames the newest season, which is the file a reader will open', async () => {
    const read = async ({ season }: SeasonCandidate) => reduction(season === 2026 ? 27 : 11);

    await expect(
      reduceStartedSeason('snaps', 300, [candidate(2026), candidate(2025)], read),
    ).rejects.toThrow(/reduced to 27 players/);
  });

  it('accepts a count exactly on the floor', async () => {
    const { rows } = await reduceStartedSeason('snaps', 300, [candidate(2026)], async () =>
      reduction(300),
    );

    expect(rows).toBe(300);
  });

  it('lets a reduction that throws stop the build rather than stepping past it', async () => {
    // A renamed column is drift in every season, and walking back would turn a
    // clear schema failure into a silently stale dataset.
    const read = async () => {
      throw new IngestError('schema', 'snaps: source is missing column pfr_player_id.');
    };

    await expect(
      reduceStartedSeason('snaps', 300, [candidate(2026), candidate(2025)], read),
    ).rejects.toThrow(/missing column pfr_player_id/);
  });
});
