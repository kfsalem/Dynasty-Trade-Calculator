import type { WeekProjections } from '../platforms/types';
import type { ScoringSettings } from '../types';

/**
 * This week's projected points, in the league's own currency, and how much a
 * gap between two of them is worth believing (#149).
 *
 * ## Why the lineup ranks on this and not on value
 *
 * Win-now value is a rest-of-season price, the same every week, with no
 * opponent in it. Replayed over 520 real team-weeks of the two test leagues
 * (2024–25), a lineup chosen on Sleeper's weekly projection beat the one the
 * manager actually set by 1.6 points a week (±0.9), and one chosen on points
 * per game so far lost to it by 2.5. Value itself cannot be replayed — nobody
 * publishes what it was in a past week — which is the one comparison still
 * open.
 *
 * ## Why nothing is added to it
 *
 * Everything public that might improve the number was tried, fitted on 2024
 * and tested on 2025's 30,402 same-position pairs: expected fantasy points,
 * the gap between points and expected points, opportunity trend, the Vegas
 * implied team total and the spread. Each one left the projection at or below
 * where it started (0.625–0.629 of pairs ranked correctly, against 0.630). The
 * projection already contains all of it. A second source (ESPN) and a lineup
 * optimised for win probability rather than points were no better either, and
 * the first would be a second undocumented dependency.
 *
 * What the data *does* support is saying how sure a call is — see
 * `outscoreChance`.
 */

/**
 * Score one projected stat line under a league's rules.
 *
 * The keys are Sleeper's scoring keys on both sides, so this is a dot product
 * and nothing more. Checked on the test league's week-4 projections: TE premium
 * arrives as `bonus_rec_te` on 98 of 99 tight ends, six-point passing
 * touchdowns lift Josh Allen from 23.1 in PPR to 25.6, and kickers and
 * defences reproduce their own totals to within 0.15.
 *
 * Rules no projection carries — long-touchdown and 200-yard bonuses, and some
 * points-allowed tiers — contribute nothing, which is right: a projection is
 * an expectation, and nobody projects the 50-yard touchdown.
 */
export function scoreProjection(
  stats: Readonly<Record<string, number>>,
  scoring: ScoringSettings,
): number {
  let points = 0;
  for (const [key, value] of Object.entries(stats)) {
    const rule = scoring[key];
    if (rule) points += rule * value;
  }
  return points;
}

/** Every projected player's points this week, under the league's rules. */
export function projectedPoints(
  projections: WeekProjections,
  scoring: ScoringSettings,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, projection] of projections) {
    out.set(id, scoreProjection(projection.stats, scoring));
  }
  return out;
}

/**
 * Logistic slope of "the higher projection scores more" against the gap.
 *
 * Fitted by maximum likelihood on 60,000 same-position pairs of startable
 * players, 2024–25. It lands within a percentage point of every observed bin
 * up to a twelve-point gap and is slightly optimistic past it (0.89 against
 * 0.87):
 *
 * ```
 *   gap      0–1   1–2   2–3   3–5   5–8   8–12
 *   seen     .52   .57   .60   .65   .73   .81
 *   curve    .52   .56   .60   .65   .73   .81
 * ```
 *
 * Stable enough to be one number: 0.169 in 2024 and 0.145 in 2025, and 0.149–
 * 0.157 at QB, RB and WR (TE 0.205, whose gaps are smaller). Fitted in PPR
 * points; a league with richer scoring spreads everyone a little further
 * apart, which makes this slightly cautious there rather than bold.
 */
export const OUTSCORE_SLOPE = 0.156;

/**
 * The chance a player projected `gap` points ahead actually outscores the other.
 *
 * Symmetric: a negative gap gives one minus the positive answer.
 */
export function outscoreChance(gap: number): number {
  return 1 / (1 + Math.exp(-OUTSCORE_SLOPE * gap));
}

/**
 * Below this the call is a coin flip, and the app says so rather than
 * pretending to know — a projection gap of about 1.3 points.
 */
export const COIN_FLIP = 0.55;

/**
 * At or above this a swap is stated as a change to make — a gap of about 2.6
 * points, where the higher projection wins three times in five.
 */
export const WORTH_ACTING = 0.6;
