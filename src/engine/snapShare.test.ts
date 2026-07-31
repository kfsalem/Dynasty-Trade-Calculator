import { describe, expect, it } from 'vitest';
import { SNAP_COLUMNS, type SnapCountsFile, type SnapWeek } from '../data/types';
import { snapShare, snapShares } from './snapShare';

/** `[week, offensePct]` pairs, since snap counts are the only column that matters here. */
const weeks = (...pairs: [number, number][]): SnapWeek[] =>
  pairs.map(([week, pct]) => [week, Math.round(pct * 70), pct]);

const player = (...pairs: [number, number][]) => ({
  pos: 'RB',
  team: 'CIN',
  weeks: weeks(...pairs),
});

describe('snapShare', () => {
  it('averages the weeks a player appeared in', () => {
    const share = snapShare(player([1, 0.5], [2, 0.7], [3, 0.6]), 3);

    expect(share?.season).toBeCloseTo(0.6);
    expect(share?.games).toBe(3);
  });

  it('reads the recent window as the last four weeks of the season', () => {
    const share = snapShare(
      player([1, 0.3], [2, 0.3], [3, 0.3], [14, 0.7], [15, 0.7], [16, 0.7], [17, 0.7]),
      17,
    );

    expect(share?.recent).toBeCloseTo(0.7);
    expect(share?.recentGames).toBe(4);
  });

  it('ends the recent window at Week 17, because Week 18 is not about role', () => {
    // Weeks 15-18 played; only 15, 16 and 17 count. A team with a locked seed
    // rests its starters in Week 18 and a team still alive does not, so the
    // same week means "his job is gone" for one player and nothing for another.
    const share = snapShare(player([15, 0.7], [16, 0.7], [17, 0.7], [18, 0.7]), 18);

    expect(share?.recentGames).toBe(3);
    // Still counted in the season average, where one game in seventeen is
    // harmless — it is only the four-week window it distorts.
    expect(share?.games).toBe(4);
  });

  it('does not read a rested Week 18 as a collapsing role', () => {
    // The regression this rule exists for. Against the real 2025 file this
    // shape described Josh Allen, and the sell-high list called him a fading
    // asset on the strength of one meaningless game.
    const rested = snapShare(player([14, 0.92], [15, 0.92], [16, 0.92], [18, 0.1]), 18);

    expect(rested?.recent).toBeCloseTo(0.92);
    expect(rested?.delta).toBeGreaterThanOrEqual(0);
  });

  it('surfaces a rising role as a positive delta', () => {
    // The signal the whole feature exists for: a back who went from a third of
    // the snaps to most of them is a different asset than his price says.
    const share = snapShare(player([12, 0.35], [15, 0.7], [16, 0.7], [17, 0.7], [18, 0.7]), 18);

    expect(share?.delta).toBeGreaterThan(0);
    expect(share?.recent).toBeCloseTo(0.7);
  });

  it('surfaces a collapsing role as a negative delta', () => {
    const share = snapShare(player([1, 0.9], [2, 0.9], [17, 0.2], [18, 0.2]), 18);

    expect(share?.delta).toBeLessThan(0);
  });

  it('leaves missed weeks out of the average rather than counting them as zero', () => {
    // A bye, an inactive week and a stint on IR are not a 0% role, they are no
    // data. Averaging them in would punish every player who missed time.
    const played = snapShare(player([1, 0.8], [2, 0.8]), 18);

    expect(played?.season).toBeCloseTo(0.8);
    expect(played?.games).toBe(2);
  });

  it('reports no recent role for a player who stopped playing', () => {
    // Not the same as a 0% recent share, and not the same as no data at all —
    // he has a season number, he just has not played lately.
    const share = snapShare(player([1, 0.9], [2, 0.9], [3, 0.9]), 18);

    expect(share?.season).toBeCloseTo(0.9);
    expect(share?.recent).toBeNull();
    expect(share?.delta).toBeNull();
    expect(share?.recentGames).toBe(0);
  });

  it('handles a player who has only ever played in the recent window', () => {
    // A call-up. Season and recent are the same number, so the delta is zero
    // rather than undefined — he has not changed role, he has only just started.
    const share = snapShare(player([17, 0.6], [18, 0.6]), 18);

    expect(share?.season).toBeCloseTo(0.6);
    expect(share?.recent).toBeCloseTo(0.6);
    expect(share?.delta).toBeCloseTo(0);
  });

  it('keeps a real zero-snap week, which is not the same as absence', () => {
    // He dressed and never took an offensive snap. That is a genuine 0%.
    const share = snapShare(player([17, 0], [18, 0]), 18);

    expect(share?.season).toBe(0);
    expect(share?.recent).toBe(0);
  });

  it('returns null for a player with no weeks at all', () => {
    expect(snapShare({ pos: 'WR', team: 'CIN', weeks: [] }, 18)).toBeNull();
  });

  it('reads the tuple columns by name, not by guessed position', () => {
    // The shipped rows are positional tuples, so this is the assertion that
    // catches a reordered `columns` array in the emitted file.
    expect(SNAP_COLUMNS.indexOf('week')).toBe(0);
    expect(SNAP_COLUMNS.indexOf('offensePct')).toBe(2);
  });
});

describe('snapShares', () => {
  const file = (players: SnapCountsFile['players'], throughWeek: number): SnapCountsFile => ({
    generatedAt: '2026-07-30T00:00:00.000Z',
    season: 2025,
    throughWeek,
    source: 'test',
    columns: SNAP_COLUMNS,
    players,
  });

  it('keys shares by Sleeper id', () => {
    const shares = snapShares(file({ '7564': player([17, 0.9], [18, 0.9]) }, 18));

    expect(shares.get('7564')?.recent).toBeCloseTo(0.9);
  });

  it('omits a player with no weeks, so the UI can tell him from a 0% player', () => {
    const shares = snapShares(
      file({ '7564': player([18, 0]), '9999': { pos: 'WR', team: 'FA', weeks: [] } }, 18),
    );

    expect(shares.get('7564')?.season).toBe(0);
    expect(shares.has('9999')).toBe(false);
  });

  it('treats a whole young season as recent, rather than as no recent data', () => {
    // In Week 2 the recent window reaches back past Week 1, so every game is
    // both season and recent and the delta is zero. Nobody has changed role
    // yet — which is the honest answer, and not the same as "no data".
    const shares = snapShares(file({ '7564': player([1, 0.5], [2, 0.5]) }, 2));

    expect(shares.get('7564')?.recent).toBeCloseTo(0.5);
    expect(shares.get('7564')?.delta).toBeCloseTo(0);
  });

  it('produces no shares at all from an empty offseason file', () => {
    expect(snapShares(file({}, 0)).size).toBe(0);
  });
});
