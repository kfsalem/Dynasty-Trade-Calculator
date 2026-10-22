import { describe, expect, it } from 'vitest';
import { gradeWeek, weekFinished, type WeekInput } from './trackRecord';
import type { PlayerIndex } from '../../src/platforms/sleeper/client';

const slim = (id: string, position: string, team: string) => ({
  id,
  name: id,
  position,
  team,
  age: 25,
  yearsExp: 3,
  // Today's designation, which a replay of a past week must not read.
  injuryStatus: 'Out',
});

const players: PlayerIndex = {
  a: slim('a', 'WR', 'BUF'),
  b: slim('b', 'WR', 'MIA'),
  c: slim('c', 'WR', 'NYJ'),
};

const game = (week: number, home: string, away: string, status = 'complete') => ({
  week,
  home,
  away,
  status,
});

/** One WR slot. The manager started `starter`; the projections and points decide the rest. */
function week(overrides: {
  starter: string;
  projected: Record<string, number>;
  paid: Record<string, number>;
  schedule?: WeekInput['schedule'];
}): WeekInput {
  return {
    league: 0,
    season: 2025,
    week: 3,
    settings: { startingSlots: ['WR'], scoring: { rec: 1 } },
    schedule: overrides.schedule ?? [game(3, 'BUF', 'MIA'), game(3, 'NYJ', 'NE')],
    projections: Object.entries(overrides.projected).map(([id, rec]) => ({
      player_id: id,
      team: players[id].team,
      stats: { rec },
    })),
    matchups: [
      {
        roster_id: 1,
        players: ['a', 'b'],
        starters: [overrides.starter],
        players_points: overrides.paid,
      },
    ],
    players,
  };
}

describe('weekFinished', () => {
  it('is finished only when every game of the week is complete', () => {
    expect(weekFinished([game(7, 'NE', 'CHI'), game(7, 'BUF', 'MIA')], 7)).toBe(true);
    expect(weekFinished([game(7, 'NE', 'CHI'), game(7, 'BUF', 'MIA', 'pre_game')], 7)).toBe(false);
  });

  it('is not finished when the schedule holds no game that week', () => {
    expect(weekFinished([game(6, 'NE', 'CHI')], 7)).toBe(false);
  });
});

describe('gradeWeek', () => {
  it('grades a call against the man who was started, and records what was stated', () => {
    const rows = gradeWeek(week({ starter: 'a', projected: { a: 8, b: 14 }, paid: { a: 20, b: 12 } }));
    expect(rows).toHaveLength(1);
    const [season, wk, league, position, chance, hit, decisive, fact] = rows[0];
    expect([season, wk, league, position]).toEqual([2025, 3, 0, 'WR']);
    // A six-point gap on the skill curve.
    expect(chance).toBe(Math.round((1 / (1 + Math.exp(-0.156 * 6))) * 1000));
    // The panel said start b; a outscored him, so it did not come true.
    expect(hit).toBe(0);
    expect(decisive).toBe(1);
    expect(fact).toBe(0);
  });

  it('counts a call as true when the man it starts outscores the man it sits', () => {
    const [row] = gradeWeek(week({ starter: 'a', projected: { a: 8, b: 14 }, paid: { a: 5, b: 12 } }));
    expect(row[5]).toBe(1);
  });

  it('makes no call where the manager already agrees with the projection', () => {
    expect(gradeWeek(week({ starter: 'b', projected: { a: 8, b: 14 }, paid: { a: 5, b: 12 } }))).toEqual([]);
  });

  it('leaves out a tie, which neither side called', () => {
    expect(gradeWeek(week({ starter: 'a', projected: { a: 8, b: 14 }, paid: { a: 9, b: 9 } }))).toEqual([]);
  });

  it("ignores today's injury designation, which the week being replayed never saw", () => {
    // Every player in the index is marked Out. Read, that would empty the lineup.
    const rows = gradeWeek(week({ starter: 'a', projected: { a: 8, b: 14 }, paid: { a: 5, b: 12 } }));
    expect(rows).toHaveLength(1);
  });

  it('marks benching a man on bye as a fact, not an opinion', () => {
    // MIA has no game in week 3, so b is on bye and the panel starts a over him.
    const rows = gradeWeek(
      week({
        starter: 'b',
        projected: { a: 8 },
        paid: { a: 8, b: 0 },
        schedule: [game(3, 'BUF', 'NYJ'), game(2, 'MIA', 'NE')],
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0][7]).toBe(1);
    expect(rows[0][5]).toBe(1);
  });

  it('marks benching a man projected for nothing as a fact', () => {
    const [row] = gradeWeek(week({ starter: 'b', projected: { a: 8, b: 0 }, paid: { a: 8, b: 0 } }));
    expect(row[7]).toBe(1);
  });

  it("reads each man's team from that week's projection, not from today's index", () => {
    // b was on NE that week, and NE was off. Today's index says MIA, which played.
    const input = week({
      starter: 'b',
      projected: { a: 8, b: 6 },
      paid: { a: 8, b: 0 },
      schedule: [game(3, 'BUF', 'MIA'), game(2, 'NE', 'NYJ')],
    });
    input.projections = input.projections.map((row) =>
      row.player_id === 'b' ? { ...row, team: 'NE' } : row,
    );
    const [row] = gradeWeek(input);
    expect(row[7]).toBe(1);
  });
});
