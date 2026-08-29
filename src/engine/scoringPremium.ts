import type { ScoringFile } from '../data/types';
import type { Position, ScoringSettings } from '../types';
import { scoreWeeks } from './scoring';
import type { StarterCounts } from './replacement';

/**
 * How much each position scores under *this* league's rules, against the rules
 * the market prices were quoted for.
 *
 * ## Why not the obvious thing
 *
 * The obvious use of a scoring engine is to re-pick the replacement player by
 * league points instead of by market price. Measured on both real leagues, that
 * is a **no-op**: of the starters at every position, `0` change identity. A
 * TE premium or six-point passing touchdowns lift every player at a position
 * together, so the ordering *within* the position barely moves — and replacement
 * level reads a market price off whoever sits at rank N+1.
 *
 * The mis-valuation was never within a position. It is **between** them:
 *
 * ```
 * Eternal Rebuild 2026    QB 1.090   TE 1.074   RB 0.917   WR 0.919
 * Tight Ends 2025         TE 1.130   QB 0.977   RB 0.944   WR 0.948
 * ```
 *
 * A tight end in the second league scores 13% more, relative to the other
 * positions, than the market that priced him assumes. That is the number the
 * issue is about, and nothing within a position was ever going to find it.
 *
 * ## Why this is a measurement and not a model
 *
 * FantasyCalc is asked for prices parameterised by `isDynasty`, `numQbs`,
 * `numTeams` and `ppr` — and nothing else. So its prices *are* prices under
 * standard scoring at that reception value, which is a rulebook this repo can
 * write down exactly. The premium is then the ratio of two scorings of the same
 * players: theirs and yours. No projection, no fitting, no thresholds.
 *
 * A league whose scoring matches the baseline gets 1.000 at every position and
 * the app behaves precisely as it did before.
 */

/**
 * The scoring FantasyCalc's prices assume.
 *
 * Standard scoring at the league's own reception value, because `ppr` is one of
 * the four knobs its API takes and the only scoring-shaped one. Everything else
 * here is the platform default — which is exactly what "the market has never
 * seen your league's settings" means in practice.
 *
 * Deliberately not the league's own rules with the reception point removed:
 * that would cancel the very deviations this is trying to measure.
 */
export function marketBaseline(ppr: number): ScoringSettings {
  return {
    rec: ppr,
    rec_yd: 0.1,
    rec_td: 6,
    rush_yd: 0.1,
    rush_td: 6,
    pass_yd: 0.04,
    pass_td: 4,
    pass_int: -2,
    fum_lost: -2,
  };
}

export interface ScoringPremium {
  /**
   * Multiplier per position, normalised so the league as a whole is unchanged.
   *
   * Purely *relative*: it moves positions against each other and never inflates
   * the league. A position absent here is 1.
   */
  byPosition: Partial<Record<Position, number>>;
  /** Whether anything was actually measured. False leaves every value untouched. */
  measured: boolean;
  /** Season the stat lines came from, for saying so on screen. */
  season: number | null;
}

export const NO_PREMIUM: ScoringPremium = {
  byPosition: {},
  measured: false,
  season: null,
};

/** Below this the premium is noise dressed as a finding, and is not worth applying. */
export const MIN_PREMIUM_SPREAD = 0.02;

/**
 * Measure the premium from shipped stat lines and the two rulebooks.
 *
 * The population is the top `startersNeeded` players at each position, by
 * points under the league's own rules — the players whose scoring actually
 * decides what a starting slot at that position is worth. Going deeper would
 * average in players nobody starts, whose scoring says nothing about the cost
 * of filling the slot.
 *
 * **Last season's stat lines are the right sample**, and this is the one place
 * in the app where that needs no apology. Every other use of prior-season data
 * is a claim about a player — #46 had to label it, because "98% of snaps" reads
 * as a claim about now. This is a claim about *rules*: the same players are
 * scored twice, under two rulebooks, and the ratio is a property of the
 * rulebooks rather than of the season. A tight end's reception bonus is worth
 * what it is worth whoever caught the passes.
 */
export function scoringPremium(
  shipped: ScoringFile | null | undefined,
  scoring: ScoringSettings,
  starters: StarterCounts,
): ScoringPremium {
  if (!shipped) return NO_PREMIUM;

  const baseline = marketBaseline(scoring.rec ?? 0);
  const scored = new Map<Position, { league: number; base: number }[]>();

  for (const player of Object.values(shipped.players)) {
    const position = player.pos as Position;
    if (!starters[position]) continue;
    const list = scored.get(position) ?? [];
    list.push({
      league: scoreWeeks(player.weeks, player.pos, scoring),
      base: scoreWeeks(player.weeks, player.pos, baseline),
    });
    scored.set(position, list);
  }

  const ratios = new Map<Position, number>();
  let leagueTotal = 0;
  let baseTotal = 0;

  for (const [position, list] of scored) {
    const needed = starters[position] ?? 0;
    if (needed <= 0) continue;

    const top = [...list].sort((a, b) => b.league - a.league).slice(0, needed);
    const league = top.reduce((sum, entry) => sum + entry.league, 0);
    const base = top.reduce((sum, entry) => sum + entry.base, 0);
    // A position nobody scored under the baseline has no ratio to give. Kickers
    // are the standing case: the baseline has no kicking rules at all, so a
    // ratio would be a division by zero dressed as an enormous premium.
    if (base <= 0 || league <= 0) continue;

    ratios.set(position, league / base);
    leagueTotal += league;
    baseTotal += base;
  }

  if (ratios.size < 2 || baseTotal <= 0) return NO_PREMIUM;

  /*
    Normalised by the pooled ratio, not by the mean of the ratios.

    The pooled figure is the league's own total under both rulebooks, so
    dividing by it leaves the total value of every starting lineup exactly where
    it was and moves only the *split* between positions. A mean of ratios would
    weight a position with ten starters like one with thirty-five and quietly
    inflate or deflate the whole league depending on its lineup shape.
  */
  const overall = leagueTotal / baseTotal;
  const byPosition: Partial<Record<Position, number>> = {};
  for (const [position, ratio] of ratios) byPosition[position] = ratio / overall;

  // A league that scores close enough to the baseline gets left alone entirely
  // rather than nudged by a fraction of a percent. Below this the premium is
  // smaller than the 0.85% the scoring engine itself is known to be short by,
  // and applying it would be dressing noise as a finding.
  const spread = Math.max(...Object.values(byPosition)) - Math.min(...Object.values(byPosition));
  if (spread < MIN_PREMIUM_SPREAD) return NO_PREMIUM;

  return { byPosition, measured: true, season: shipped.season };
}

/** The multiplier for one position. 1 when nothing was measured. */
export const premiumFor = (premium: ScoringPremium, position: Position | null): number =>
  (position ? premium.byPosition[position] : undefined) ?? 1;
