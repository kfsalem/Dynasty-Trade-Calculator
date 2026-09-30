import { describe, expect, it } from 'vitest';
import {
  COIN_FLIP,
  outscoreChance,
  projectedPoints,
  scoreProjection,
  WORTH_ACTING,
} from './projections';
import type { PlayerProjection } from '../platforms/types';

/** A slice of a real league's rules: PPR, TE premium, six-point passing TDs. */
const RULES = {
  rec: 1,
  rec_yd: 0.1,
  rec_td: 6,
  bonus_rec_te: 0.5,
  pass_yd: 0.04,
  pass_td: 6,
  pass_int: -2,
};

describe('scoreProjection', () => {
  it('multiplies each projected stat by the rule with the same key', () => {
    // 5 catches, 60 yards, half a touchdown: 5 + 6 + 3.
    expect(scoreProjection({ rec: 5, rec_yd: 60, rec_td: 0.5 }, RULES)).toBeCloseTo(14);
  });

  it('carries a tight-end premium through, because it arrives as its own stat', () => {
    expect(scoreProjection({ rec: 4, bonus_rec_te: 4 }, RULES)).toBeCloseTo(6);
  });

  it('scores a quarterback under the league, not under PPR', () => {
    // 250 yards and two touchdowns: 10 + 12 - 2 at six points a TD, where four
    // points a TD would give 16.
    expect(scoreProjection({ pass_yd: 250, pass_td: 2, pass_int: 1 }, RULES)).toBeCloseTo(20);
  });

  it('ignores stats the league does not score, and aggregate keys like pts_ppr', () => {
    expect(scoreProjection({ rec: 3, pts_ppr: 11.2, gp: 1, adp_dd_ppr: 40 }, RULES)).toBe(3);
  });
});

describe('projectedPoints', () => {
  it('scores every projected player', () => {
    const points = projectedPoints(
      new Map<string, PlayerProjection>([
        ['a', { opponent: 'PIT', stats: { rec: 5 } }],
        ['CLE', { opponent: 'PIT', stats: {} }],
      ]),
      RULES,
    );

    expect(points.get('a')).toBe(5);
    expect(points.get('CLE')).toBe(0);
  });
});

describe('outscoreChance', () => {
  it('is a coin flip at no gap, and symmetric either side of it', () => {
    expect(outscoreChance(0)).toBe(0.5);
    expect(outscoreChance(3) + outscoreChance(-3)).toBeCloseTo(1);
  });

  it('reproduces the measured rates within a point or two', () => {
    // Observed over 60,000 same-position pairs, 2024-25, at each bin's middle.
    expect(outscoreChance(0.5)).toBeCloseTo(0.52, 1);
    expect(outscoreChance(2.5)).toBeCloseTo(0.6, 1);
    expect(outscoreChance(6.5)).toBeCloseTo(0.73, 1);
    expect(outscoreChance(10)).toBeCloseTo(0.81, 1);
  });

  it('puts the two thresholds where the text says they are', () => {
    // COIN_FLIP near 1.3 points, WORTH_ACTING near 2.6.
    expect(outscoreChance(1.2)).toBeLessThan(COIN_FLIP);
    expect(outscoreChance(1.4)).toBeGreaterThan(COIN_FLIP);
    expect(outscoreChance(2.5)).toBeLessThan(WORTH_ACTING);
    expect(outscoreChance(2.7)).toBeGreaterThan(WORTH_ACTING);
  });
});

describe('outscoreChance by position (#152)', () => {
  it('reads a defence gap far more confidently than a skill-position one', () => {
    // Ravens 9.5 over Texans 6.5: about three in four for defences, measured.
    expect(outscoreChance(3, 'DEF')).toBeGreaterThan(0.75);
    expect(outscoreChance(3)).toBeLessThan(0.62);
  });

  it('reads a kicker gap as close to a coin flip, because it nearly is', () => {
    expect(outscoreChance(1, 'K')).toBeLessThan(COIN_FLIP);
    expect(outscoreChance(1, 'K')).toBeLessThan(outscoreChance(1));
  });

  it('uses the skill-position curve for anyone else, or when the position is unknown', () => {
    expect(outscoreChance(2, 'WR')).toBe(outscoreChance(2));
    expect(outscoreChance(2, undefined)).toBe(outscoreChance(2));
  });
});
