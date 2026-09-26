import { describe, expect, it } from 'vitest';
import { finalStandings, leagueHistoryStats } from './leagueHistory';
import type { BracketMatch, LeagueHistory, SeasonHistory, TeamResult } from '../platforms/types';

type Owner = [rosterId: number, userId: string | null, name: string];
type Week = [week: number, games: [rosterId: number, matchupId: number | null, points: number][]];

const match = (
  round: number,
  m: number,
  t1: number,
  t2: number,
  winner: number,
  placement: number | null = null,
): BracketMatch => ({
  round,
  match: m,
  teams: [t1, t2],
  winner,
  loser: winner === t1 ? t2 : t1,
  placement,
});

function season(
  year: string,
  owners: Owner[],
  weeks: Week[],
  winners: BracketMatch[] = [],
  weekStart = 3,
): SeasonHistory {
  const results: TeamResult[] = weeks.flatMap(([week, games]) =>
    games.map(([rosterId, matchupId, points]) => ({ week, rosterId, matchupId, points })),
  );
  return {
    leagueId: `L${year}`,
    season: year,
    startingSlots: [],
    managers: new Map(
      owners.map(([rosterId, userId, name]) => [
        rosterId,
        { userId, name: userId ? name : 'No manager', teamName: `${name} FC` },
      ]),
    ),
    weeks: [],
    claimed: new Map(),
    results,
    playoffs: { weekStart, teams: winners.length ? 6 : 0, roundType: 0, winners, losers: [] },
  };
}

const history = (seasons: SeasonHistory[]): LeagueHistory => ({
  seasons,
  players: new Map(),
  truncated: false,
});

/*
  Ten teams, two regular-season weeks, then the live 2025 bracket's shape: six
  teams, two byes, rounds in weeks 3-5, with a third-place game (p:3) and a
  fifth-place game (p:5).
*/
const TEN: Owner[] = Array.from({ length: 10 }, (_, i) => [i + 1, `u${i + 1}`, `M${i + 1}`]);

const REGULAR: Week[] = [
  [1, [[3, 1, 100], [4, 1, 90], [6, 2, 80], [7, 2, 70], [1, 3, 110], [2, 3, 100], [5, 4, 95], [8, 4, 85], [9, 5, 90], [10, 5, 120]]],
  [2, [[3, 1, 100], [6, 1, 60], [4, 2, 95], [7, 2, 50], [1, 3, 105], [5, 3, 101], [2, 4, 98], [9, 4, 97], [8, 5, 90], [10, 5, 130]]],
];

const PLAYOFF_WEEKS: Week[] = [
  [3, [[10, 1, 120], [8, 1, 100], [9, 2, 110], [1, 2, 115]]],
  [4, [[2, 3, 90], [10, 3, 130], [5, 4, 105], [1, 4, 125], [8, 5, 99], [9, 5, 98]]],
  [5, [[10, 6, 140], [1, 6, 100], [2, 7, 130], [5, 7, 80]]],
];

const SIX_TEAM_BRACKET: BracketMatch[] = [
  match(1, 1, 10, 8, 10),
  match(1, 2, 9, 1, 1),
  match(2, 3, 2, 10, 10),
  match(2, 4, 5, 1, 1),
  match(2, 5, 8, 9, 8, 5),
  match(3, 6, 10, 1, 10, 1),
  match(3, 7, 2, 5, 2, 3),
];

const SIX = season('2025', TEN, [...REGULAR, ...PLAYOFF_WEEKS], SIX_TEAM_BRACKET);

describe('finalStandings, points-based (the default)', () => {
  it('ranks playoff teams by survival and splits same-round exits by that game’s score', () => {
    const order = finalStandings(SIX, 'points').map((s) => s.rosterId);
    // Champion 10, runner-up 1. Semifinal losers: 5 scored 105 and 2 scored 90,
    // so 5 is third although 2 won the third-place game. First-round losers: 9
    // scored 110 and 8 scored 100, so 9 is fifth although 8 won the fifth-place
    // game. Placement games are ignored.
    expect(order.slice(0, 6)).toEqual([10, 1, 5, 2, 9, 8]);
  });

  it('ranks everyone else below the playoffs by record, then points for', () => {
    const order = finalStandings(SIX, 'points').map((s) => s.rosterId);
    // 3 went 2-0; 4 and 6 went 1-1 and 4 scored more; 7 went 0-2.
    expect(order.slice(6)).toEqual([3, 4, 6, 7]);
  });

  it('works for a four-team bracket with a third-place game in it', () => {
    const four = season(
      '2024',
      TEN.slice(0, 4),
      [
        [1, [[1, 1, 100], [2, 1, 90], [3, 2, 80], [4, 2, 70]]],
        [2, [[1, 1, 100], [4, 1, 90], [2, 2, 95], [3, 2, 99]]],
        [3, [[1, 1, 90], [3, 1, 95], [4, 2, 120], [2, 2, 60]]],
      ],
      [match(1, 1, 1, 4, 1), match(1, 2, 2, 3, 3), match(2, 3, 1, 3, 3, 1), match(2, 4, 4, 2, 4, 3)],
      2,
    );
    // Semifinal losers: 2 scored 95 and 4 scored 90 in round 1, so 2 is third —
    // however the third-place game went.
    expect(finalStandings(four, 'points').map((s) => s.rosterId)).toEqual([3, 1, 2, 4]);
  });

  it('has no standings for a season with no decided final', () => {
    const live = season('2026', TEN, REGULAR, [
      { round: 3, match: 6, teams: [null, null], winner: null, loser: null, placement: 1 },
    ]);
    expect(finalStandings(live, 'points')).toEqual([]);
  });
});

describe('finalStandings, official bracket', () => {
  it('lets each placement game decide the two places it was for', () => {
    const order = finalStandings(SIX, 'bracket').map((s) => s.rosterId);
    expect(order.slice(0, 6)).toEqual([10, 1, 2, 5, 8, 9]);
  });
});

describe('leagueHistoryStats', () => {
  it('counts titles, playoff trips and last places from the final standings', () => {
    const stats = leagueHistoryStats(history([SIX]));
    const row = (key: string) => stats.table.find((r) => r.key === key)!;

    expect(row('u10').titles).toBe(1);
    expect(row('u1').playoffs).toBe(1);
    expect(row('u7').lastPlaces).toBe(1);
    expect(row('u3').playoffs).toBe(0);
  });

  it('keys a manager on his user id across seasons, whatever his roster id or name', () => {
    // u1 moves from roster 1 to roster 2 and is renamed.
    const early = season('2024', [[1, 'u1', 'Old'], [2, 'u2', 'B']], [[1, [[1, 1, 100], [2, 1, 90]]]]);
    const late = season('2025', [[2, 'u1', 'New'], [1, 'u2', 'B']], [[1, [[2, 1, 80], [1, 1, 95]]]]);
    const stats = leagueHistoryStats(history([late, early]));

    const u1 = stats.table.find((r) => r.key === 'u1')!;
    expect([u1.wins, u1.losses, u1.seasons]).toEqual([1, 1, 2]);
    expect(stats.managers.get('u1')?.name).toBe('New');
  });

  it('shows an orphan team as a team with no manager, never as a guessed name', () => {
    const orphaned = season('2024', [[1, null, 'Nine'], [2, 'u2', 'B']], [[1, [[1, 1, 100], [2, 1, 90]]]]);
    const stats = leagueHistoryStats(history([orphaned]));

    const orphan = stats.managers.get('orphan:2024:1');
    expect(orphan).toEqual({ key: 'orphan:2024:1', name: 'Nine FC', owned: false });
  });

  it('runs streaks across seasons', () => {
    const a = season('2024', [[1, 'u1', 'A'], [2, 'u2', 'B']], [
      [1, [[1, 1, 100], [2, 1, 90]]],
      [2, [[1, 1, 100], [2, 1, 90]]],
    ]);
    const b = season('2025', [[1, 'u1', 'A'], [2, 'u2', 'B']], [[1, [[1, 1, 100], [2, 1, 90]]]]);
    const stats = leagueHistoryStats(history([a, b]));

    expect(stats.table.find((r) => r.key === 'u1')!.longestWinStreak).toBe(3);
    expect(stats.table.find((r) => r.key === 'u2')!.longestLossStreak).toBe(3);
  });

  it('scores all-play against every team every week, which separates luck from the schedule', () => {
    const stats = leagueHistoryStats(history([SIX]));
    const u10 = stats.table.find((r) => r.key === 'u10')!;
    // 120 and 130 were the top score in both regular-season weeks.
    expect([u10.allPlayWins, u10.allPlayLosses]).toEqual([18, 0]);
  });

  it('reads records from regular-season games only', () => {
    const { records } = leagueHistoryStats(history([SIX]));

    // Week 5's 140 is a playoff game and does not count.
    expect(records.highestWeek).toMatchObject({ key: 'u10', points: 130, week: 2 });
    expect(records.lowestWeek).toMatchObject({ key: 'u7', points: 50 });
    expect(records.biggestBlowout).toMatchObject({ key: 'u4', points: 95, opponent: { key: 'u7', points: 50 } });
    expect(records.highestScoringLoss).toMatchObject({ key: 'u5', points: 101 });
    expect(records.narrowestWin).toMatchObject({ key: 'u2', points: 98, opponent: { key: 'u9', points: 97 } });
  });

  it('keeps head-to-head from both sides', () => {
    const { headToHead } = leagueHistoryStats(history([SIX]));
    expect(headToHead.get('u3')?.get('u4')).toMatchObject({ wins: 1, losses: 0 });
    expect(headToHead.get('u4')?.get('u3')).toMatchObject({ wins: 0, losses: 1 });
  });

  it('counts a season still being played in the table, with no standings', () => {
    const live = season('2026', TEN, REGULAR);
    const stats = leagueHistoryStats(history([live]));

    expect(stats.seasons).toEqual([{ season: '2026', complete: false, standings: [] }]);
    expect(stats.games).toBe(10);
  });
});

describe('a week still being played', () => {
  it('is left out, so a partial score never becomes a record', () => {
    // Week 2 is in progress: team 7 is on 1 point because only its kicker has played.
    const live = season('2026', TEN, [
      REGULAR[0],
      [2, [[3, 1, 12], [6, 1, 9], [4, 2, 8], [7, 2, 1], [1, 3, 10], [5, 3, 6], [2, 4, 5], [9, 4, 4], [8, 5, 3], [10, 5, 2]]],
    ]);
    const stats = leagueHistoryStats(history([live]), 'points', { season: '2026', lastCompleteWeek: 1 });

    expect(stats.records.lowestWeek).toMatchObject({ week: 1, points: 70 });
    expect(stats.games).toBe(5);
  });
});

describe('best and worst season', () => {
  it('compares finished seasons only', () => {
    // A 2-0 start to a live season is not the best season in league history.
    const live = season('2026', TEN, REGULAR);
    const stats = leagueHistoryStats(history([SIX, live]));

    expect(stats.records.bestSeason?.season).toBe('2025');
  });
});
