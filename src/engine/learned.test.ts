import { describe, expect, it } from 'vitest';
import { blend, learn, trust, unlearned, type Learned } from './learned';

describe('trust', () => {
  it('is zero with nothing observed and a half at the half-way point', () => {
    expect(trust(0, 6)).toBe(0);
    expect(trust(6, 6)).toBeCloseTo(0.5);
  });

  /**
   * Approaching one without reaching it is the point. A curve that saturated
   * would be a threshold again, just further along — and a league's own record
   * is always evidence about a league rather than the last word on it.
   */
  it('approaches but never reaches certainty', () => {
    expect(trust(600, 6)).toBeGreaterThan(0.99);
    expect(trust(1e6, 6)).toBeLessThan(1);
  });

  it('rises with every observation and never falls', () => {
    let previous = -1;
    for (let n = 0; n <= 200; n++) {
      const w = trust(n, 12);
      expect(w).toBeGreaterThan(previous);
      previous = w;
    }
  });

  it('treats a negative or absent count as no evidence', () => {
    expect(trust(-4, 6)).toBe(0);
    expect(trust(Number.NaN, 6)).toBe(0);
  });

  /**
   * A half-life of zero says "believe the sample immediately", which is a
   * consumer bug rather than something to fail on. Returning full trust keeps
   * the arithmetic defined; the alternative is a division by zero producing NaN
   * that then silently poisons a value the UI prints.
   */
  it('does not produce NaN when a consumer passes a zero half-life', () => {
    expect(trust(5, 0)).toBe(1);
    expect(Number.isNaN(trust(0, 0))).toBe(false);
  });
});

describe('learn', () => {
  it('returns the prior exactly when nothing has been observed', () => {
    const nothing = learn(100, 7, 0, 6);
    expect(nothing.value).toBe(7);
    expect(nothing.weight).toBe(0);
    expect(nothing.observations).toBe(0);
  });

  it('converges on the estimate as the sample grows', () => {
    expect(learn(100, 7, 1_000, 6).value).toBeGreaterThan(99);
    expect(learn(100, 7, 100_000, 6).value).toBeGreaterThan(99.99);
    // Never all the way, however much is seen. See `trust`.
    expect(learn(100, 7, 100_000, 6).value).toBeLessThan(100);
  });

  it('sits half way at the half-life', () => {
    expect(learn(100, 20, 6, 6).value).toBeCloseTo(60);
  });

  /**
   * The guard the issue asks for: a shrunk value can never be more extreme than
   * the estimate it came from. Nothing here may extrapolate — a thin sample
   * must always pull *toward* the prior, never past the measurement.
   */
  it('never lands outside the prior and the estimate', () => {
    for (const [estimate, prior] of [
      [100, 7],
      [7, 100],
      [-5, 5],
      [0, 0],
    ]) {
      for (const n of [0, 1, 3, 6, 40, 500]) {
        const { value } = learn(estimate, prior, n, 6);
        expect(value).toBeGreaterThanOrEqual(Math.min(estimate, prior));
        expect(value).toBeLessThanOrEqual(Math.max(estimate, prior));
      }
    }
  });

  /**
   * Continuity, tested the way `windowWeights` is: the whole reason this module
   * exists is that a threshold puts two leagues one observation apart on
   * opposite sides of a different answer. One more trade may never move the
   * answer by much.
   */
  it('never jumps between two adjacent sample sizes', () => {
    const step = (n: number) =>
      Math.abs(learn(100, 7, n + 1, 6).value - learn(100, 7, n, 6).value);

    const first = step(0);
    for (let n = 0; n < 300; n++) {
      expect(step(n)).toBeLessThanOrEqual(first + 1e-9);
    }
    // And the largest step of all is small against the range being crossed.
    expect(first).toBeLessThan((100 - 7) * 0.2);
  });

  it('moves monotonically from prior toward estimate', () => {
    let previous = 7;
    for (let n = 0; n <= 100; n++) {
      const { value } = learn(100, 7, n, 6);
      expect(value).toBeGreaterThanOrEqual(previous);
      previous = value;
    }
  });

  it('carries the prior and the evidence for the UI to read', () => {
    const learned = learn(18, 10, 47, 40);
    expect(learned.prior).toBe(10);
    expect(learned.observations).toBe(47);
    expect(learned.weight).toBeCloseTo(47 / 87);
  });

  /**
   * A different half-life is the only knob, and it belongs to the consumer.
   * Two signals with the same sample size can and should be trusted
   * differently.
   */
  it('lets each signal decide how fast it earns trust', () => {
    expect(learn(100, 0, 20, 5).value).toBeGreaterThan(learn(100, 0, 20, 60).value);
  });
});

describe('blend', () => {
  it('takes a weight computed elsewhere, for evidence with a known total', () => {
    // Six weeks of a fourteen-week season: the denominator is known, so there
    // is nothing to estimate about it.
    const outlook = blend(0.04, 0.7, 6 / 14, 6);
    expect(outlook.value).toBeCloseTo(0.7 + (0.04 - 0.7) * (6 / 14));
    expect(outlook.weight).toBeCloseTo(6 / 14);
    expect(outlook.observations).toBe(6);
  });

  it('clamps a weight outside 0-1 rather than extrapolating past either end', () => {
    expect(blend(100, 7, 2, 5).value).toBe(100);
    expect(blend(100, 7, -1, 5).value).toBe(7);
  });
});

describe('unlearned', () => {
  it('is the prior, said out loud', () => {
    const nothing: Learned<number> = unlearned(28);
    expect(nothing).toEqual({ value: 28, prior: 28, observations: 0, weight: 0 });
  });

  it('carries a structure as readily as a number', () => {
    const table = unlearned({ QB: 1, RB: 1 });
    expect(table.value).toEqual({ QB: 1, RB: 1 });
    expect(table.weight).toBe(0);
  });
});
