import { describe, expect, it } from 'vitest';
import { weeklyPost, type WeeklyPostInput } from './weeklyPost';
import type { LeagueHistory, LeagueTransaction, SeasonHistory, TeamResult } from '../platforms/types';
import type { Roster } from '../types';

type Game = [rosterA: number, pointsA: number, rosterB: number, pointsB: number];

/** A season of four teams; games[i] is week i + 1. Playoffs start in week 10. */
function season(year: string, games: Game[][], users = ['u1', 'u2', 'u3', 'u4']): SeasonHistory {
  const results: TeamResult[] = games.flatMap((week, i) =>
    week.flatMap(([a, pa, b, pb], m) => [
      { week: i + 1, rosterId: a, matchupId: m + 1, points: pa },
      { week: i + 1, rosterId: b, matchupId: m + 1, points: pb },
    ]),
  );
  return {
    leagueId: `L${year}`,
    season: year,
    startingSlots: [],
    managers: new Map(users.map((u, i) => [i + 1, { userId: u, name: `M${i + 1}`, teamName: `T${i + 1}` }])),
    weeks: [],
    claimed: new Map(),
    results,
    playoffs: { weekStart: 10, teams: 0, roundType: 0, winners: [], losers: [] },
  };
}

const history = (seasons: SeasonHistory[]): LeagueHistory => ({
  seasons,
  players: new Map([['p9', { position: 'WR', name: 'Old Name' }]]),
  truncated: false,
});

const rosters: Roster[] = [1, 2, 3, 4].map((rosterId) => ({
  rosterId,
  ownerId: `u${rosterId}`,
  teamName: `T${rosterId}`,
  ownerName: `M${rosterId}`,
  avatar: null,
  wins: 0,
  losses: 0,
  ties: 0,
  pointsFor: 0,
  playerIds: [],
  starters: [],
  reserve: [],
  taxi: [],
})) as unknown as Roster[];

const NAMES: Record<string, string> = { p1: 'Ann Runner', p2: 'Bo Catcher', p3: 'Cy Thrower' };

function input(over: Partial<WeeklyPostInput> & { history: LeagueHistory; week: number }): WeeklyPostInput {
  return {
    season: '2026',
    rosters,
    summaries: [
      { rosterId: 1, starterValue: 8000 },
      { rosterId: 2, starterValue: 10000 },
      { rosterId: 3, starterValue: 6000 },
      { rosterId: 4, starterValue: 6000 },
    ],
    moves: null,
    playerName: (id) => NAMES[id] ?? null,
    ...over,
  };
}

// Team 1 starts 2-0 and team 3 0-2; in week 3 team 3 beats team 1.
const WEEKS: Game[][] = [
  [[1, 120, 3, 90], [2, 100, 4, 110]],
  [[1, 130, 4, 95], [2, 105, 3, 100]],
  [[1, 101, 3, 140], [2, 99, 4, 98]],
];

describe('weeklyPost', () => {
  it('ranks by win-now strength, ties sharing a rank, with the record through the week', () => {
    const post = weeklyPost(input({ history: history([season('2026', WEEKS)]), week: 3 }))!;
    expect(post.rankings.map((r) => [r.rank, r.name, r.wins, r.losses, Math.round(r.index * 100)])).toEqual([
      [1, 'M2', 2, 1, 100],
      [2, 'M1', 2, 1, 80],
      [3, 'M3', 1, 2, 60],
      [3, 'M4', 1, 2, 60],
    ]);
  });

  it("names the week's high score", () => {
    const post = weeklyPost(input({ history: history([season('2026', WEEKS)]), week: 3 }))!;
    expect(post.highScore).toEqual({ rosterId: 3, name: 'M3', points: 140 });
  });

  it('calls an upset on the records going in, not on a model', () => {
    const post = weeklyPost(input({ history: history([season('2026', WEEKS)]), week: 3 }))!;
    expect(post.upset?.winner).toMatchObject({ name: 'M3', wins: 0, losses: 2, points: 140 });
    expect(post.upset?.loser).toMatchObject({ name: 'M1', wins: 2, losses: 0, points: 101 });
  });

  it('calls no upset when the team with fewer wins was only one behind', () => {
    const post = weeklyPost(input({ history: history([season('2026', WEEKS)]), week: 2 }))!;
    // Week 2: going in, every winner and loser were within a win of each other.
    expect(post.upset).toBeNull();
  });

  it('announces a record broken this week, with the holder it took it from', () => {
    const old = season('2025', [[[1, 150, 2, 60], [3, 100, 4, 99]]]);
    const post = weeklyPost(input({ history: history([old, season('2026', WEEKS)]), week: 3 }))!;
    const keys = post.records.map((r) => r.key);
    // 140 does not beat 2025's 150; nothing in week 3 is a record but the
    // narrowest win (99-98 ties 2025's 100-99 margin, and a tie keeps the old).
    expect(keys).not.toContain('highestWeek');
    expect(keys).not.toContain('narrowestWin');

    const big = weeklyPost(
      input({
        history: history([old, season('2026', [...WEEKS.slice(0, 2), [[1, 101, 3, 160], [2, 99, 4, 98]]])]),
        week: 3,
      }),
    )!;
    const high = big.records.find((r) => r.key === 'highestWeek');
    expect(high).toMatchObject({ name: 'M3', points: 160, previous: { name: 'M1', points: 150, season: '2025', week: 1 } });
  });

  it("breaks no record in a league's first week, which sets them all", () => {
    const post = weeklyPost(input({ history: history([season('2026', WEEKS.slice(0, 1))]), week: 1 }))!;
    expect(post.records).toEqual([]);
  });

  it('writes about nothing outside the regular season, or a week with no games', () => {
    expect(weeklyPost(input({ history: history([season('2026', WEEKS)]), week: 10 }))).toBeNull();
    expect(weeklyPost(input({ history: history([season('2026', WEEKS)]), week: 5 }))).toBeNull();
    expect(weeklyPost(input({ history: history([season('2025', WEEKS)]), week: 3 }))).toBeNull();
  });

  describe('the move', () => {
    const tx = (over: Partial<LeagueTransaction>): LeagueTransaction => ({
      id: Math.random().toString(),
      season: '2026',
      week: 3,
      type: 'waiver',
      succeeded: true,
      created: 1,
      rosterIds: [],
      adds: new Map(),
      drops: new Map(),
      picks: [],
      budget: [],
      bid: null,
      ...over,
    });

    it("prefers the week's newest trade, naming what each side got", () => {
      const moves = [
        tx({ type: 'waiver', adds: new Map([['p3', 4]]), bid: 40 }),
        tx({
          type: 'trade',
          created: 5,
          rosterIds: [1, 2],
          adds: new Map([['p1', 1], ['p2', 2]]),
          picks: [{ season: '2027', round: 1, originalRosterId: 1, fromRosterId: 1, toRosterId: 2 }],
          budget: [{ amount: 10, fromRosterId: 2, toRosterId: 1 }],
        }),
        tx({ type: 'trade', created: 2, rosterIds: [3, 4], adds: new Map([['p3', 3]]) }),
      ];
      const post = weeklyPost(input({ history: history([season('2026', WEEKS)]), week: 3, moves }))!;
      expect(post.move).toEqual({
        kind: 'trade',
        sides: [
          { name: 'M1', gets: ['Ann Runner', '$10 of FAAB'] },
          { name: 'M2', gets: ['Bo Catcher', 'a 2027 1st'] },
        ],
        more: 1,
      });
    });

    it('otherwise names the biggest winning bid, and not a failed one', () => {
      const moves = [
        tx({ adds: new Map([['p1', 2]]), bid: 12 }),
        tx({ adds: new Map([['p3', 4]]), bid: 31 }),
        tx({ adds: new Map([['p2', 1]]), bid: 50, succeeded: false }),
      ];
      const post = weeklyPost(input({ history: history([season('2026', WEEKS)]), week: 3, moves }))!;
      expect(post.move).toEqual({ kind: 'claim', name: 'M4', player: 'Cy Thrower', bid: 31 });
    });

    it('otherwise names the busiest on the wire, everyone tied at the top, from two pickups', () => {
      const fa = (rosterId: number, id: string) =>
        tx({ type: 'free_agent', adds: new Map([[id, rosterId]]) });
      const busy = [fa(2, 'a'), fa(2, 'b'), fa(3, 'c'), fa(3, 'd'), fa(1, 'e')];
      expect(
        weeklyPost(input({ history: history([season('2026', WEEKS)]), week: 3, moves: busy }))!.move,
      ).toEqual({ kind: 'busiest', names: ['M2', 'M3'], adds: 2 });
      const quiet = [fa(2, 'a'), fa(3, 'c')];
      expect(
        weeklyPost(input({ history: history([season('2026', WEEKS)]), week: 3, moves: quiet }))!.move,
      ).toBeNull();
    });

    it('says nothing when the biggest bid was $0, or in week 1, which holds the offseason', () => {
      const zero = [tx({ adds: new Map([['p1', 2]]), bid: 0 })];
      expect(weeklyPost(input({ history: history([season('2026', WEEKS)]), week: 3, moves: zero }))!.move).toBeNull();
      const trade = [tx({ type: 'trade', week: 1, rosterIds: [1, 2], adds: new Map([['p1', 1]]) })];
      expect(weeklyPost(input({ history: history([season('2026', WEEKS)]), week: 1, moves: trade }))!.move).toBeNull();
    });
  });
});
