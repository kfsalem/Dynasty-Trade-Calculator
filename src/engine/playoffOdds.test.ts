import { describe, expect, it } from 'vitest';
import { remainingFixtures, rng, simulate, type TeamState } from './playoffOdds';
import type { Matchup } from '../types';

const team = (rosterId: number, over: Partial<TeamState> = {}): TeamState => ({
  rosterId,
  wins: 0,
  losses: 0,
  ties: 0,
  pointsFor: 0,
  strength: 1000,
  ...over,
});

/** A round of fixtures pairing 1v2, 3v4, … for the given week. */
const round = (week: number, teamCount: number): Matchup[] =>
  Array.from({ length: teamCount / 2 }, (_, i) => ({
    week,
    rosterIds: [i * 2 + 1, i * 2 + 2] as [number, number],
  }));

const evenTeams = (n: number) => Array.from({ length: n }, (_, i) => team(i + 1));

const oddsFor = (result: { rosterId: number; odds: number }[], rosterId: number) =>
  result.find((r) => r.rosterId === rosterId)!.odds;

describe('rng', () => {
  it('produces the same stream for the same seed', () => {
    const a = rng(42);
    const b = rng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('produces a different stream for a different seed', () => {
    expect(rng(1)()).not.toBe(rng(2)());
  });

  it('stays inside [0, 1)', () => {
    const next = rng(7);
    for (let i = 0; i < 1000; i++) {
      const value = next();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe('simulate — determinism', () => {
  /**
   * The property the whole feature rests on. An unseeded simulation would move
   * the headline number when the user touched something unrelated, and nobody
   * would trust a probability that changes on its own.
   */
  it('returns identical odds for identical inputs', () => {
    const input = {
      teams: evenTeams(10),
      remaining: [...round(10, 10), ...round(11, 10)],
      playoffTeams: 6,
      iterations: 500,
    };
    expect(simulate(input)).toEqual(simulate(input));
  });

  it('changes when the seed changes, and not otherwise', () => {
    const base = {
      teams: evenTeams(10),
      remaining: round(10, 10),
      playoffTeams: 6,
      iterations: 500,
    };
    expect(simulate({ ...base, seed: 1 })).not.toEqual(simulate({ ...base, seed: 2 }));
  });

  it('does not depend on the order teams are listed in', () => {
    // Seeding per iteration rather than one stream across the run is what buys
    // this: nothing in the result can depend on visit order.
    const teams = [
      team(1, { strength: 1400 }),
      team(2, { strength: 900 }),
      team(3, { strength: 1100 }),
      team(4, { strength: 700 }),
    ];
    const remaining = [...round(10, 4), ...round(11, 4)];
    const forward = simulate({ teams, remaining, playoffTeams: 2, iterations: 2000 });
    const reversed = simulate({
      teams: [...teams].reverse(),
      remaining,
      playoffTeams: 2,
      iterations: 2000,
    });

    for (const t of teams) {
      expect(oddsFor(reversed, t.rosterId)).toBeCloseTo(oddsFor(forward, t.rosterId), 10);
    }
  });
});

describe('simulate — the model', () => {
  it('gives every team the same odds when every roster is identical', () => {
    // Six of twelve make it and nobody is better than anybody, so everyone is
    // a coin flip. Anything else would mean the schedule or the loop is
    // favouring someone.
    const result = simulate({
      teams: evenTeams(12),
      remaining: [...round(1, 12), ...round(2, 12), ...round(3, 12)],
      playoffTeams: 6,
      iterations: 4000,
    });

    for (const { odds } of result) expect(odds).toBeGreaterThan(0.4);
    for (const { odds } of result) expect(odds).toBeLessThan(0.6);
  });

  /**
   * The strongest internal check available: exactly `playoffTeams` teams make
   * the playoffs in every single iteration, so the odds must sum to exactly
   * that. Off-by-one seeding, a double-counted team or a cut applied to the
   * wrong slice all break this and almost nothing else would notice.
   */
  it('sums to exactly the number of playoff places', () => {
    const teams = [
      team(1, { wins: 6, strength: 1600, pointsFor: 960 }),
      team(2, { wins: 5, strength: 1400, pointsFor: 940 }),
      team(3, { wins: 4, strength: 1300, pointsFor: 900 }),
      team(4, { wins: 4, strength: 1200, pointsFor: 890 }),
      team(5, { wins: 3, strength: 1100, pointsFor: 850 }),
      team(6, { wins: 2, strength: 900, pointsFor: 800 }),
    ];
    const remaining = [...round(8, 6), ...round(9, 6), ...round(10, 6)];

    for (const playoffTeams of [1, 2, 3, 4, 5]) {
      const total = simulate({ teams, remaining, playoffTeams, iterations: 1000 }).reduce(
        (sum, o) => sum + o.odds,
        0,
      );
      expect(total).toBeCloseTo(playoffTeams, 10);
    }
  });

  it('favours the stronger roster, without making it a certainty', () => {
    const teams = [
      team(1, { strength: 2000 }),
      team(2, { strength: 1000 }),
      team(3, { strength: 1000 }),
      team(4, { strength: 1000 }),
    ];
    const result = simulate({
      teams,
      remaining: [...round(1, 4), ...round(2, 4), ...round(3, 4)],
      playoffTeams: 2,
      iterations: 4000,
    });

    const best = oddsFor(result, 1);
    expect(best).toBeGreaterThan(0.5);
    // Fantasy weeks bounce far too much for three games to settle anything.
    expect(best).toBeLessThan(0.95);
  });

  it('counts games already banked, not just the ones left', () => {
    const strong = team(1, { wins: 8, pointsFor: 1200 });
    const weak = team(2, { wins: 0, losses: 8, pointsFor: 700 });
    const rest = [team(3, { wins: 4, pointsFor: 950 }), team(4, { wins: 4, pointsFor: 950 })];

    const result = simulate({
      teams: [strong, weak, ...rest],
      remaining: round(9, 4),
      playoffTeams: 2,
      iterations: 4000,
    });

    expect(oddsFor(result, 1)).toBeGreaterThan(oddsFor(result, 2));
    // Eight games clear with one to play is not a coin flip.
    expect(oddsFor(result, 1)).toBeGreaterThan(0.9);
  });

  it('breaks ties on points for, since that is how the seeding is sorted', () => {
    // Identical records and no games left: the only thing separating them is
    // what they have scored.
    const result = simulate({
      teams: [
        team(1, { wins: 5, pointsFor: 1200 }),
        team(2, { wins: 5, pointsFor: 1100 }),
        team(3, { wins: 5, pointsFor: 1000 }),
        team(4, { wins: 5, pointsFor: 900 }),
      ],
      remaining: [],
      playoffTeams: 2,
      iterations: 100,
    });

    expect(oddsFor(result, 1)).toBe(1);
    expect(oddsFor(result, 2)).toBe(1);
    expect(oddsFor(result, 3)).toBe(0);
    expect(oddsFor(result, 4)).toBe(0);
  });

  it('scores a tie as half a win', () => {
    const result = simulate({
      teams: [
        team(1, { wins: 2, ties: 2, pointsFor: 1000 }),
        team(2, { wins: 3, pointsFor: 1000 }),
        team(3, { wins: 0, pointsFor: 1000 }),
        team(4, { wins: 0, pointsFor: 1000 }),
      ],
      remaining: [],
      playoffTeams: 2,
      iterations: 100,
    });

    // 2 wins + 2 ties = 3.0, level with roster 2 on record, and level on
    // points — so both are in ahead of the two winless teams.
    expect(oddsFor(result, 1)).toBe(1);
    expect(oddsFor(result, 2)).toBe(1);
  });
});

describe('simulate — edges', () => {
  it('returns nothing for a league with no teams', () => {
    expect(simulate({ teams: [], remaining: [], playoffTeams: 6 })).toEqual([]);
  });

  it('puts everyone in when the whole league makes the playoffs', () => {
    const result = simulate({
      teams: evenTeams(4),
      remaining: round(1, 4),
      playoffTeams: 4,
      iterations: 100,
    });
    for (const { odds } of result) expect(odds).toBe(1);
  });

  it('puts nobody in when the cut is zero', () => {
    const result = simulate({
      teams: evenTeams(4),
      remaining: round(1, 4),
      playoffTeams: 0,
      iterations: 100,
    });
    for (const { odds } of result) expect(odds).toBe(0);
  });

  it('does not let a cut larger than the league read past the standings', () => {
    const result = simulate({
      teams: evenTeams(4),
      remaining: [],
      playoffTeams: 10,
      iterations: 10,
    });
    expect(result).toHaveLength(4);
    for (const { odds } of result) expect(odds).toBe(1);
  });

  it('ignores a fixture naming a roster the league does not have', () => {
    // Defensive: the schedule and the roster list come from different calls.
    const result = simulate({
      teams: evenTeams(2),
      remaining: [{ week: 1, rosterIds: [1, 99] }],
      playoffTeams: 1,
      iterations: 100,
    });
    expect(result).toHaveLength(2);
  });
});

describe('remainingFixtures', () => {
  const schedule: Matchup[] = [
    ...round(1, 4),
    ...round(9, 4),
    ...round(14, 4),
    ...round(15, 4),
  ];

  it('keeps the current week, because this week is still to be played', () => {
    // A trade agreed on Tuesday is in the lineup on Sunday.
    const remaining = remainingFixtures(schedule, 9, 15);
    expect(remaining.every((f) => f.week >= 9)).toBe(true);
    expect(remaining.some((f) => f.week === 9)).toBe(true);
  });

  it('stops at the first playoff week', () => {
    const remaining = remainingFixtures(schedule, 1, 15);
    expect(remaining.some((f) => f.week === 14)).toBe(true);
    expect(remaining.some((f) => f.week === 15)).toBe(false);
  });

  it('returns nothing once the regular season is over', () => {
    expect(remainingFixtures(schedule, 15, 15)).toEqual([]);
  });

  it('returns nothing when the week is unknown rather than guessing', () => {
    // Null is not week zero. A caller that cannot tell what week it is should
    // decline to answer, not simulate a season that has already happened.
    expect(remainingFixtures(schedule, null, 15)).toEqual([]);
  });
});
