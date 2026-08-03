import { describe, expect, it } from 'vitest';
import {
  calibrate,
  DEFAULT_MODEL,
  playedFixtures,
  remainingFixtures,
  rng,
  simulate,
  type TeamState,
} from './playoffOdds';
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

/** A round of fixtures pairing 1v2, 3v4, … for the given week, none yet played. */
const round = (week: number, teamCount: number): Matchup[] =>
  Array.from({ length: teamCount / 2 }, (_, i) => ({
    week,
    rosterIds: [i * 2 + 1, i * 2 + 2] as [number, number],
    points: null,
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
      remaining: [{ week: 1, rosterIds: [1, 99], points: null }],
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

describe('playedFixtures', () => {
  it('keeps only the fixtures that have a result', () => {
    // Filtered on points rather than the week number: a week can be in the past
    // and still have no result, and only the schedule knows which.
    const schedule: Matchup[] = [
      { week: 1, rosterIds: [1, 2], points: [120, 98] },
      { week: 2, rosterIds: [1, 2], points: null },
    ];
    expect(playedFixtures(schedule)).toHaveLength(1);
    expect(playedFixtures(schedule)[0].week).toBe(1);
  });
});

describe('calibrate', () => {
  const four = evenTeams(4);

  /** `weeks` weeks of results, each team scoring around its own mean. */
  const history = (means: number[], swings: number[], weeks: number): Matchup[] => {
    const out: Matchup[] = [];
    for (let w = 1; w <= weeks; w++) {
      const at = (team: number) =>
        means[team - 1] + swings[(w + team) % swings.length];
      out.push({ week: w, rosterIds: [1, 2], points: [at(1), at(2)] });
      out.push({ week: w, rosterIds: [3, 4], points: [at(3), at(4)] });
    }
    return out;
  };

  it('assumes the defaults before there is enough football to measure', () => {
    // A within-team spread needs two scores per team to exist at all.
    expect(calibrate(four, history([120, 110, 100, 90], [-10, 0, 10], 2))).toEqual(
      DEFAULT_MODEL,
    );
  });

  it('assumes the defaults when there is no history at all', () => {
    expect(calibrate(four, [])).toEqual(DEFAULT_MODEL);
    expect(calibrate([], [])).toEqual(DEFAULT_MODEL);
  });

  it('measures the league once there are enough weeks', () => {
    const model = calibrate(four, history([120, 110, 100, 90], [-10, 0, 10], 6));
    expect(model.source).toBe('league');
    expect(model.weeks).toBe(6);
  });

  it('reads the weekly spread from how much each team bounces', () => {
    // Every team swings ±10 about its own mean, so the pooled within-team SD is
    // about 8 — well under the assumed 28. Crucially it is *not* the spread of
    // all scores in the league, which also contains how much teams differ from
    // one another.
    const model = calibrate(four, history([120, 110, 100, 90], [-10, 0, 10], 8));
    expect(model.weeklySD).toBeLessThan(DEFAULT_MODEL.weeklySD);
    expect(model.weeklySD).toBeGreaterThan(8);
  });

  /**
   * The estimate is blended toward the assumption in proportion to the
   * evidence, rather than accepted wholesale the moment a threshold is crossed.
   *
   * A hard cutoff was the first design. Against a synthetic season with known
   * parameters the raw slope swung between 2.5 and 11.5 over four to six weeks
   * against a true 9 — and 2.5 reports a strong roster as a coin flip, which is
   * worse than the generic assumption it replaced.
   */
  it('trusts the league more the more of it there is', () => {
    const quiet = [120, 110, 100, 90];
    const swing: number[] = [-10, 0, 10];

    const early = calibrate(four, history(quiet, swing, 4));
    const late = calibrate(four, history(quiet, swing, 16));

    // The measurement is far below the assumed 28, so more weeks must move the
    // answer further from the assumption and closer to what was measured.
    expect(early.weeklySD).toBeLessThan(DEFAULT_MODEL.weeklySD);
    expect(late.weeklySD).toBeLessThan(early.weeklySD);
  });

  it('never lets a thin sample reach the raw measurement', () => {
    const model = calibrate(four, history([120, 110, 100, 90], [-10, 0, 10], 3));
    // Three weeks is measured, but held most of the way toward the assumption.
    expect(model.source).toBe('league');
    expect(model.weeklySD).toBeGreaterThan(DEFAULT_MODEL.weeklySD / 2);
  });

  it('reads the baseline from what the league actually scores', () => {
    const model = calibrate(four, history([220, 210, 200, 190], [-10, 0, 10], 8));
    expect(model.baseline).toBeGreaterThan(195);
    expect(model.baseline).toBeLessThan(215);
  });

  it('finds a positive slope when stronger rosters score more', () => {
    const teams = [
      team(1, { strength: 1600 }),
      team(2, { strength: 1200 }),
      team(3, { strength: 800 }),
      team(4, { strength: 400 }),
    ];
    // Means line up with strength, so the relationship is real and large.
    const model = calibrate(teams, history([130, 115, 100, 85], [-8, 0, 8], 8));
    expect(model.pointsPerSD).toBeGreaterThan(10);
  });

  it('refuses to believe that weaker rosters score more', () => {
    // A negative slope over a handful of weeks is noise, not a discovery, so it
    // floors at zero. It is still blended toward the assumption from there —
    // "we measured no relationship" is not proof there is none.
    const teams = [
      team(1, { strength: 1600 }),
      team(2, { strength: 1200 }),
      team(3, { strength: 800 }),
      team(4, { strength: 400 }),
    ];
    const model = calibrate(teams, history([85, 100, 115, 130], [-8, 0, 8], 8));
    expect(model.pointsPerSD).toBeGreaterThanOrEqual(0);
    expect(model.pointsPerSD).toBeLessThan(DEFAULT_MODEL.pointsPerSD);
  });

  it('caps an implausible slope rather than passing it through', () => {
    const teams = [
      team(1, { strength: 1600 }),
      team(2, { strength: 1000 }),
      team(3, { strength: 1000 }),
      team(4, { strength: 400 }),
    ];
    // A 200-point gap between the best and worst weekly average is not a real
    // fantasy league; a small sample can still produce one.
    const model = calibrate(teams, history([300, 150, 150, 100], [-5, 0, 5], 8));
    expect(model.pointsPerSD).toBeLessThanOrEqual(20);
  });

  it('falls back when a team has too few scores for a variance', () => {
    // One team played once. A within-team spread needs at least two.
    const thin: Matchup[] = [
      ...history([120, 110, 100, 90], [-10, 0, 10], 4).filter(
        (f) => !(f.rosterIds[0] === 3 && f.week > 1),
      ),
    ];
    expect(calibrate(four, thin)).toEqual(DEFAULT_MODEL);
  });

  it('falls back for a league where nothing bounces at all', () => {
    // Identical scores every week is not a league, it is a fixture file.
    expect(calibrate(four, history([100, 100, 100, 100], [0], 6))).toEqual(DEFAULT_MODEL);
  });
});

describe('simulate — the calibrated model', () => {
  it('makes strength matter more when the league says it does', () => {
    const teams = [
      team(1, { strength: 2000 }),
      team(2, { strength: 1000 }),
      team(3, { strength: 1000 }),
      team(4, { strength: 200 }),
    ];
    const remaining = [...round(1, 4), ...round(2, 4), ...round(3, 4)];

    const flat = simulate({
      teams,
      remaining,
      playoffTeams: 2,
      iterations: 3000,
      model: { ...DEFAULT_MODEL, pointsPerSD: 1 },
    });
    const steep = simulate({
      teams,
      remaining,
      playoffTeams: 2,
      iterations: 3000,
      model: { ...DEFAULT_MODEL, pointsPerSD: 18 },
    });

    // The best roster should be far more certain in the league where lineup
    // quality shows up on the scoreboard.
    expect(oddsFor(steep, 1)).toBeGreaterThan(oddsFor(flat, 1));
  });

  it('makes everything a coin flip when no relationship was observed', () => {
    // pointsPerSD of zero is what `calibrate` returns for a league whose scores
    // say nothing about its rosters. Every team must then be level.
    const teams = [
      team(1, { strength: 2000 }),
      team(2, { strength: 1000 }),
      team(3, { strength: 600 }),
      team(4, { strength: 200 }),
    ];
    const result = simulate({
      teams,
      remaining: [...round(1, 4), ...round(2, 4)],
      playoffTeams: 2,
      iterations: 4000,
      model: { ...DEFAULT_MODEL, pointsPerSD: 0 },
    });

    for (const { odds } of result) {
      expect(odds).toBeGreaterThan(0.4);
      expect(odds).toBeLessThan(0.6);
    }
  });
});
