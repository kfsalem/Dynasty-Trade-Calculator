import { describe, expect, it } from 'vitest';
import type { Player } from '../types';
import type { SnapShare } from './snapShare';
import type { Metric, Opportunity } from './opportunity';
import {
  MAX_SWING,
  activityFactor,
  ageWeight,
  roleShift,
  type ActivityInputs,
} from './activityFactor';
import { makePlayer } from './testFixtures';

const snaps = (season: number, recent: number | null, recentGames = 4): SnapShare => ({
  season,
  recent,
  delta: recent === null ? null : recent - season,
  games: 17,
  recentGames: recent === null ? 0 : recentGames,
});

const metric = (season: number, recent: number | null, recentGames = 4): Metric => ({
  key: 'targetShare',
  label: 'Target share',
  kind: 'share',
  window: {
    season,
    recent,
    delta: recent === null ? null : recent - season,
    games: 17,
    recentGames: recent === null ? 0 : recentGames,
  },
});

const usage = (m: Metric): Opportunity => ({ pos: 'WR', metrics: [m], headline: m });

const player = (age: number | null): Player => makePlayer('p1', 'WR', age ?? 26);

const factor = (p: Player, activity: Partial<ActivityInputs>): number =>
  activityFactor(p, { current: true, ...activity }).factor;

describe('activityFactor', () => {
  it('is exactly 1 when there is no activity data at all', () => {
    expect(factor(player(27), {})).toBe(1);
  });

  it('is exactly 1 through the offseason, however loud last season was', () => {
    // By July the market has had months to absorb last season's usage, so
    // re-applying it is the same information twice rather than new information.
    const loud = { snaps: snaps(0.3, 0.9), usage: usage(metric(0.1, 0.4)) };

    expect(activityFactor(player(29), { ...loud, current: false }).factor).toBe(1);
    expect(activityFactor(player(29), { ...loud, current: true }).factor).toBeGreaterThan(1);
  });

  it('is exactly 1 for a player with a season but no recent window', () => {
    // Injured since Week 14: a season number, nothing to compare it against.
    expect(factor(player(27), { snaps: snaps(0.8, null) })).toBe(1);
  });

  it('raises a value when the role is growing and lowers it when shrinking', () => {
    expect(factor(player(27), { snaps: snaps(0.35, 0.7) })).toBeGreaterThan(1);
    expect(factor(player(27), { snaps: snaps(0.7, 0.35) })).toBeLessThan(1);
  });

  it('stays strictly inside its bounds, at any extreme', () => {
    // The bound must never actually be reached: a factor that saturates onto a
    // constant would collapse players onto shared values, which is how the
    // clamp bug in docs/DESIGN.md destroyed the ordering the model runs on.
    const extremes = [
      factor(player(35), { snaps: snaps(0, 1), usage: usage(metric(0, 1)) }),
      factor(player(35), { snaps: snaps(1, 0), usage: usage(metric(1, 0)) }),
    ];

    for (const f of extremes) {
      expect(f).toBeGreaterThan(1 - MAX_SWING);
      expect(f).toBeLessThan(1 + MAX_SWING);
    }
  });

  it('is strictly monotonic in the size of the move', () => {
    // No two different activity levels may produce the same factor, however far
    // out on the curve they are.
    const seen: number[] = [];
    for (let recent = 0; recent <= 1.0001; recent += 0.02) {
      seen.push(factor(player(27), { snaps: snaps(0.4, Math.min(recent, 1)) }));
    }

    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]).toBeGreaterThan(seen[i - 1]);
    }
  });

  it('moves an older player further than a younger one on the same evidence', () => {
    // A 22-year-old's price is a bet on years three through eight, which four
    // good games barely speak to. A 29-year-old's price is very nearly a
    // statement about his current role.
    const young = factor(player(22), { snaps: snaps(0.35, 0.7) });
    const old = factor(player(30), { snaps: snaps(0.35, 0.7) });

    expect(old).toBeGreaterThan(young);
    expect(young).toBeGreaterThan(1);
  });

  it('trusts a longer recent window more than a shorter one', () => {
    const oneGame = factor(player(27), { snaps: snaps(0.35, 0.7, 1) });
    const fourGames = factor(player(27), { snaps: snaps(0.35, 0.7, 4) });

    expect(fourGames).toBeGreaterThan(oneGame);
    expect(oneGame).toBeGreaterThan(1);
  });

  it('averages snaps and usage rather than adding them', () => {
    // Two views of one role change. A back who gained snaps and carries has not
    // changed role twice over.
    const both = factor(player(27), {
      snaps: snaps(0.3, 0.6),
      usage: usage(metric(0.3, 0.6)),
    });
    const snapsOnly = factor(player(27), { snaps: snaps(0.3, 0.6) });

    expect(both).toBeCloseTo(snapsOnly, 10);
  });

  it('ignores an index metric, which is not measured in share points', () => {
    // WOPR runs past 1 and is not a share, so a delta on it cannot be mixed
    // into a signal scaled in share points.
    const wopr: Metric = { ...metric(0.2, 0.9), key: 'wopr', kind: 'index' };

    expect(factor(player(27), { usage: usage(wopr) })).toBe(1);
  });

  it('never returns NaN on a partial or broken row', () => {
    const broken: ActivityInputs[] = [
      { current: true, snaps: { ...snaps(0.5, 0.7), delta: NaN } },
      { current: true, snaps: { ...snaps(0.5, 0.7), recentGames: 0 } },
      { current: true, usage: { pos: 'WR', metrics: [], headline: undefined as never } },
      { current: true, snaps: snaps(NaN, NaN) },
    ];

    for (const activity of broken) {
      const result = activityFactor(player(27), activity);
      expect(Number.isFinite(result.factor)).toBe(true);
    }
  });

  it('reports the games behind the move, so a consumer can judge the sample', () => {
    const result = activityFactor(player(27), { current: true, snaps: snaps(0.35, 0.7, 6) });

    expect(result.games).toBe(6);
    // Nothing to judge when nothing moved, rather than a stale count.
    expect(activityFactor(player(27), { current: false, snaps: snaps(0.35, 0.7, 6) }).games).toBe(0);
  });

  it('explains itself with the numbers behind the move', () => {
    const result = activityFactor(player(27), {
      current: true,
      snaps: snaps(0.35, 0.7),
      usage: usage(metric(0.2, 0.24)),
    });

    // Largest mover first, so the explanation leads with what actually changed.
    expect(result.reasons[0]).toEqual({ label: 'snaps', from: 0.35, to: 0.7 });
    expect(result.reasons).toHaveLength(2);
  });
});

describe('roleShift', () => {
  it('sees the role change that activityFactor declines to price', () => {
    // The season gate is a statement about pricing, not about evidence. A role
    // really did change last November; what is untrue in July is that the
    // market has yet to absorb it. R7 ranks trends off this, so it must still
    // report the move that valuation deliberately ignores.
    const loud = { snaps: snaps(0.3, 0.9) };

    expect(activityFactor(player(29), { ...loud, current: false }).factor).toBe(1);
    expect(roleShift(player(29), loud).factor).toBeGreaterThan(1);
  });

  it('agrees exactly with activityFactor once the season is current', () => {
    // Two entry points, one computation. If these ever diverged, a previewed
    // gap would stop matching the adjustment actually applied to the value.
    const activity = { snaps: snaps(0.35, 0.7), usage: usage(metric(0.2, 0.3)) };

    expect(roleShift(player(27), activity)).toEqual(
      activityFactor(player(27), { ...activity, current: true }),
    );
  });
});

describe('ageWeight', () => {
  it('rises with age and flattens at both ends', () => {
    expect(ageWeight(21)).toBe(ageWeight(22));
    expect(ageWeight(22)).toBeLessThan(ageWeight(26));
    expect(ageWeight(26)).toBeLessThan(ageWeight(30));
    expect(ageWeight(30)).toBe(ageWeight(35));
  });

  it('is continuous between the anchors', () => {
    expect(ageWeight(24)).toBeCloseTo((0.35 + 0.7) / 2, 10);
  });

  it('falls back to the middle of the curve for an unknown age', () => {
    expect(ageWeight(null)).toBe(ageWeight(26));
    expect(ageWeight(NaN)).toBe(ageWeight(26));
  });
});
