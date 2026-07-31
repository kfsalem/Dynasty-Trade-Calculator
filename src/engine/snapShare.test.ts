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
    // No week before the window opens, so there is nothing to measure a change
    // against and the honest answer is "no reading" rather than a number.
    expect(rested?.delta).toBeNull();
  });

  it('does not read a rested Week 18 as a *rising* role either', () => {
    /**
     * The other half of the same bug, and the one that shipped.
     *
     * Week 18 was excluded from the recent window but left inside the season
     * mean, which is what `delta` used to measure against. So resting the
     * finale dropped a player's baseline while leaving his recent form intact,
     * and the sell-high artifact came back as a *buy-low* one.
     *
     * This is Josh Allen's real 2025 line: 83-100% every week of the season,
     * then 1% in the finale. The app reported "100% snaps, up from 92%" and
     * ranked him the second-largest buy-low in the league. Fourteen of the
     * twenty-five players who rested Week 18 got a fake positive delta this way.
     *
     * `prior` fixes it at the root rather than by another exclusion: Week 18
     * falls after the anchor, so it is outside both windows by construction.
     */
    const allen = snapShare(
      player(
        [1, 1], [2, 0.87], [3, 1], [4, 1], [5, 1], [6, 1], [8, 0.83], [9, 1],
        [10, 0.96], [11, 1], [12, 1], [13, 1],
        [14, 1], [15, 1], [16, 1], [17, 1],
        [18, 0.01],
      ),
      18,
    );

    expect(allen?.recent).toBeCloseTo(1);
    // The baseline is his actual earlier form, not a mean the finale dragged
    // down: weeks 1-13 averaged 0.972, so the move is 3 points, not 8.
    expect(allen?.prior).toBeCloseTo(0.972, 2);
    expect(allen?.delta).toBeLessThan(0.05);
    // And the season figure still counts the finale, because it is a genuine
    // season-to-date average and one game in seventeen cannot hurt it there.
    expect(allen?.games).toBe(17);
    expect(allen?.season).toBeLessThan(allen?.prior as number);
  });

  it('measures the delta between two windows that share no game', () => {
    /**
     * The season mean contains the recent window, so `recent - season` compares
     * a period against a set it belongs to and always understates the move.
     * Across 101 players on the real 2025 file the median reported delta was
     * 0.724 of the true one, and the "up from X%" the UI printed was a blend
     * nobody ever had — Gibbs read "up from 67%" when his weeks 1-13 were 63.6%.
     */
    const share = snapShare(
      player([1, 0.4], [2, 0.4], [3, 0.4], [14, 0.8], [15, 0.8], [16, 0.8], [17, 0.8]),
      17,
    );

    expect(share?.prior).toBeCloseTo(0.4);
    expect(share?.recent).toBeCloseTo(0.8);
    // The whole move, not the part of it the baseline had not already absorbed.
    expect(share?.delta).toBeCloseTo(0.4);
    // Against a season mean of 0.63, the old model would have reported 0.17.
    expect(share?.season).toBeCloseTo(0.629, 2);
  });

  it('reports no delta before there is anything to compare against', () => {
    // Week 3 is too early to have a role *change*. The old code compared the
    // window against a season mean made of the same games and reported exactly
    // zero, which reads as "measured, and flat" rather than "not measured".
    const early = snapShare(player([1, 0.5], [2, 0.6], [3, 0.7]), 3);

    expect(early?.recent).toBeCloseTo(0.6);
    expect(early?.prior).toBeNull();
    expect(early?.delta).toBeNull();
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
