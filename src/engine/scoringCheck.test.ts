import { describe, expect, it } from 'vitest';
import { SCORING_COLUMNS, type ScoringFile } from '../data/types';
import type { AwardedPoints } from '../platforms/types';
import { checkScoring, scoringIsUsable } from './scoringCheck';
import type { ScoringSettings } from '../types';

const PPR: ScoringSettings = { rec: 1, rec_yd: 0.1, rec_td: 6 };

function shipped(players: Record<string, { pos: string; weeks: number[][] }>): ScoringFile {
  return {
    generatedAt: '2026-08-28T00:00:00.000Z',
    season: 2025,
    throughWeek: 3,
    source: 'test',
    columns: SCORING_COLUMNS,
    players: Object.fromEntries(
      Object.entries(players).map(([id, p]) => [id, { ...p, team: 'KC' }]),
    ),
  };
}

/** [week, receptions, recYards, recTds] — the first four columns, trimmed. */
const line = (week: number, rec: number, yards: number, tds = 0) => [week, rec, yards, tds];

const paid = (week: number, points: Record<string, number>): AwardedPoints =>
  new Map([[week, new Map(Object.entries(points))]]);

describe('checkScoring', () => {
  it('reports exact when it reproduces every player to the cent', () => {
    const fidelity = checkScoring(
      shipped({ a: { pos: 'WR', weeks: [line(1, 6, 118, 1)] } }),
      paid(1, { a: 23.8 }),
      PPR,
    );

    expect(fidelity).toMatchObject({ compared: 1, exact: 1, verdict: 'exact' });
    expect(fidelity.error).toBe(0);
  });

  /**
   * An unplayed season is not evidence of a problem. In August there is nothing
   * to check against, and the honest answer is to say so rather than to claim
   * either success or failure.
   */
  it('is unchecked before a week has been played', () => {
    const fidelity = checkScoring(
      shipped({ a: { pos: 'WR', weeks: [line(1, 6, 118, 1)] } }),
      new Map(),
      PPR,
    );

    expect(fidelity.verdict).toBe('unchecked');
    expect(fidelity.compared).toBe(0);
    expect(scoringIsUsable(fidelity)).toBe(true);
  });

  it('is unchecked when the stat file never loaded', () => {
    expect(checkScoring(null, paid(1, { a: 23.8 }), PPR).verdict).toBe('unchecked');
  });

  /**
   * A league can be reproduced closely and still not exactly, and that is a
   * different claim from being broken. The long-touchdown bonuses leave many
   * players a point or two short with no systematic bias — fine for ranking,
   * and named rather than hidden.
   */
  it('calls a league close when the gap is a bonus it has named', () => {
    const scoring: ScoringSettings = { ...PPR, rec_td_50p: 2 };
    const fidelity = checkScoring(
      shipped({
        a: { pos: 'WR', weeks: [line(1, 6, 118, 1)] },
        b: { pos: 'WR', weeks: [line(1, 4, 40)] },
        c: { pos: 'WR', weeks: [line(1, 5, 55)] },
        d: { pos: 'WR', weeks: [line(1, 7, 90)] },
        e: { pos: 'WR', weeks: [line(1, 3, 30)] },
        f: { pos: 'WR', weeks: [line(1, 8, 100)] },
        g: { pos: 'WR', weeks: [line(1, 2, 20)] },
        h: { pos: 'WR', weeks: [line(1, 9, 120)] },
        i: { pos: 'WR', weeks: [line(1, 1, 10)] },
        j: { pos: 'WR', weeks: [line(1, 6, 70)] },
      }),
      // Only `a` scored the 50-yard touchdown Sleeper paid a bonus for.
      paid(1, { a: 25.8, b: 8, c: 10.5, d: 16, e: 6, f: 18, g: 4, h: 21, i: 2, j: 13 }),
      scoring,
    );

    expect(fidelity.verdict).toBe('close');
    expect(fidelity.exact).toBe(9);
    expect(fidelity.unreachable).toEqual(['rec_td_50p']);
    expect(scoringIsUsable(fidelity)).toBe(true);
  });

  it('calls a league unreliable when the disagreement is systematic', () => {
    // Every player short by a third: a rule that is being applied by Sleeper
    // and not by this engine, which does move players against each other.
    const fidelity = checkScoring(
      shipped({
        a: { pos: 'WR', weeks: [line(1, 6, 100)] },
        b: { pos: 'WR', weeks: [line(1, 4, 50)] },
      }),
      paid(1, { a: 24, b: 13.5 }),
      PPR,
    );

    expect(fidelity.verdict).toBe('unreliable');
    expect(scoringIsUsable(fidelity)).toBe(false);
  });

  /**
   * The awarded table covers everyone rostered, defenses included, and nflverse
   * has no row for a team defense. Scoring those as zero would manufacture a
   * disagreement out of a player the engine was never asked to score.
   */
  it('ignores rostered players it has no stat line for', () => {
    const fidelity = checkScoring(
      shipped({ a: { pos: 'WR', weeks: [line(1, 6, 118, 1)] } }),
      paid(1, { a: 23.8, DEF_KC: 14 }),
      PPR,
    );

    expect(fidelity.compared).toBe(1);
    expect(fidelity.verdict).toBe('exact');
  });

  it('ignores a week the player has no row for, rather than reading it as zero', () => {
    const fidelity = checkScoring(
      shipped({ a: { pos: 'WR', weeks: [line(1, 6, 118, 1)] } }),
      // Week 2: Sleeper lists him at zero because he did not play.
      new Map([[2, new Map([['a', 0]])]]),
      PPR,
    );

    expect(fidelity.compared).toBe(0);
    expect(fidelity.verdict).toBe('unchecked');
  });

  it('names unreachable rules even when there is nothing to check against', () => {
    const fidelity = checkScoring(null, undefined, { ...PPR, rush_td_40p: 2 });

    expect(fidelity.verdict).toBe('unchecked');
    expect(fidelity.unreachable).toEqual(['rush_td_40p']);
  });

  it('does not claim exact for a league whose rules it cannot fully express', () => {
    // Every compared player matches, but the league scores a bonus this engine
    // is blind to — so the next long touchdown will be missed, and "exact" is a
    // promise the engine cannot keep.
    const fidelity = checkScoring(
      shipped({ a: { pos: 'WR', weeks: [line(1, 6, 118)] } }),
      paid(1, { a: 17.8 }),
      { ...PPR, rec_td_50p: 2 },
    );

    expect(fidelity.exact).toBe(fidelity.compared);
    expect(fidelity.verdict).toBe('close');
  });
});
