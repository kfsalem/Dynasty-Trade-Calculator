import type { LeagueSettings, Player, PlayerValue, Position, Roster } from '../types';
import { summarizeRoster, type RosterSummary } from './rosterValue';

/**
 * Replacement level: what a position is actually worth in *this* league.
 *
 * Market values price a player against the whole dynasty world. They cannot
 * know that in a 10-team single-QB league every manager already starts a top-10
 * quarterback, so the realistic cost of losing yours is the gap to QB11 — who
 * is nearly as good, and who you can stream on matchup. The same league makes a
 * workhorse running back precious, because roughly 26 of them start each week
 * and the supply of true 15-20 touch backs runs out at about 32.
 *
 * So a player is worth what he adds *over the best player who starts nowhere*:
 *
 *     leagueValue = max(marketValue * RESIDUAL_SHARE, marketValue - replacement)
 *
 * Nothing here is hand-tuned per position. The starter counts come from the
 * lineups the league actually fields, so the same code says quarterbacks matter
 * enormously in superflex — twenty of them have to start — and barely at all in
 * a shallow single-QB league. Change the roster settings and the weighting
 * follows on its own.
 */

/**
 * Share of market value a below-replacement player keeps.
 *
 * A hard `max(0, …)` floor was the first attempt and it was wrong in a way worth
 * recording. Clamping does not merely understate the bottom of the pool; it
 * *erases the ordering within it*, and on a real 10-team league that was 55% of
 * all rostered players collapsed onto a single number. Everything downstream
 * that sorts by value then had nothing to sort by: the FLEX slot went to
 * whichever tied player the platform happened to list first, those arbitrary
 * picks became the starter counts, the counts set replacement level, and
 * replacement level decided who got clamped. Reshuffling one roster's player
 * list — which says nothing about the league — moved RB replacement level from
 * 1,900 to 2,709 and flipped individual players between 0 and 807.
 *
 * A player below replacement is not worthless. He is not startable *today*, but
 * he is still a tradeable asset: an aging starter whose dynasty price is
 * age-suppressed, or a rookie whose value is entirely ahead of him. Keeping a
 * fixed share of market value says exactly that, and keeps the tail strictly
 * ordered so the tie-driven feedback loop above cannot form.
 *
 * The floor only binds where the surplus is smaller than the share, so no player
 * meaningfully above replacement is affected — an elite back is worth market
 * minus replacement, exactly as before.
 */
export const RESIDUAL_SHARE = 0.1;

export type StarterCounts = Partial<Record<Position, number>>;

export interface ReplacementLevel {
  position: Position;
  /** How many players at this position hold a starting slot league-wide. */
  startersNeeded: number;
  /** Market value of the best player at the position who starts nowhere. */
  value: number;
}

/**
 * How many of each position the league actually starts.
 *
 * Counted from the best lineups rather than from `roster_positions`, because
 * only the real lineups reveal how the flex breaks down. A FLEX slot is
 * nominally RB/WR/TE; in practice it is filled by whoever is best, and that
 * split is what sets the true scarcity of each position.
 */
export function startersByPosition(summaries: RosterSummary[]): StarterCounts {
  const counts: StarterCounts = {};
  for (const summary of summaries) {
    for (const slot of summary.lineup) {
      const position = slot.entry?.player.position;
      if (!position) continue;
      counts[position] = (counts[position] ?? 0) + 1;
    }
  }
  return counts;
}

/**
 * The replacement player at each position: the best one nobody has to start.
 *
 * Drawn from the whole valued universe rather than only rostered players. A
 * streamable quarterback is streamable precisely because he might be sitting on
 * waivers, and pretending the pool ends at the last rostered player would
 * overstate every position in a shallow league.
 */
export function replacementLevels(
  values: Map<string, PlayerValue>,
  starters: StarterCounts,
): Partial<Record<Position, ReplacementLevel>> {
  const byPosition = new Map<Position, number[]>();
  for (const value of values.values()) {
    if (!value.position) continue;
    const list = byPosition.get(value.position) ?? [];
    list.push(value.marketValue);
    byPosition.set(value.position, list);
  }

  const levels: Partial<Record<Position, ReplacementLevel>> = {};
  for (const [position, list] of byPosition) {
    list.sort((a, b) => b - a);
    const startersNeeded = starters[position] ?? 0;

    // Nobody starting the position means we have no evidence about it — an
    // empty or pre-draft league produces exactly this. Taking element [0] here
    // would make the best player at the position the replacement level and zero
    // out every player in the league, so fail open and leave values untouched.
    if (startersNeeded <= 0) {
      levels[position] = { position, startersNeeded: 0, value: 0 };
      continue;
    }

    // Zero-indexed, so element [startersNeeded] is the first player past the
    // last starting job — exactly the man you would pick up instead.
    const replacement = list[startersNeeded] ?? list.at(-1) ?? 0;
    levels[position] = { position, startersNeeded, value: replacement };
  }

  return levels;
}

/**
 * One player's league value. The model, in one line.
 *
 * Continuous and strictly increasing in `market`: the two branches meet where
 * the surplus equals the residual, so there is no step at the crossover, and a
 * player with no market value still lands on zero.
 *
 * Deliberately not rounded. The residual branch compresses several thousand
 * points of market value into a few hundred, and rounding that to whole points
 * puts adjacent players back onto identical values — a smaller version of the
 * very collapse this replaced. `formatValue` rounds for display, which is where
 * rounding belongs.
 */
export const leagueValue = (market: number, replacement: number): number =>
  Math.max(market * RESIDUAL_SHARE, market - replacement);

/**
 * Rebuild a value map in league-adjusted terms.
 *
 * `marketValue` is preserved untouched so the UI can still show the number the
 * other manager will quote, and so trade fairness stays arguable in the terms
 * everyone else uses.
 */
export function applyReplacement(
  values: Map<string, PlayerValue>,
  levels: Partial<Record<Position, ReplacementLevel>>,
): Map<string, PlayerValue> {
  // An unknown position fails *closed*. Charging nothing would let a player the
  // feed failed to classify keep his full market value while every classified
  // player is docked, floating him to the top of lineups and into the surplus
  // list. FantasyCalc's position is nullable and any unrecognised string maps
  // to null, so this is a feed change away from happening.
  const strictest = Math.max(0, ...Object.values(levels).map((level) => level.value));

  const out = new Map<string, PlayerValue>();
  for (const [id, value] of values) {
    const replacement = value.position
      ? (levels[value.position]?.value ?? strictest)
      : strictest;
    out.set(id, { ...value, value: leagueValue(value.marketValue, replacement) });
  }
  return out;
}

/**
 * How much of the league's market value survives the replacement adjustment.
 *
 * Draft picks are priced on the market scale, and comparing a market-priced
 * pick against a replacement-adjusted player would reintroduce exactly the
 * cross-scale mixing the design forbids. Scaling picks by the league's own
 * shrink factor keeps both in the same units. It is an approximation — a pick
 * is not a uniformly average player — but it is a documented one, and it is far
 * better than comparing two different scales.
 */
export function leagueShrinkFactor(
  summaries: RosterSummary[],
  adjusted: Map<string, PlayerValue>,
): number {
  let market = 0;
  let league = 0;
  for (const summary of summaries) {
    for (const slot of summary.lineup) {
      const id = slot.entry?.player.id;
      if (!id) continue;
      const value = adjusted.get(id);
      if (!value) continue;
      market += value.marketValue;
      league += value.value;
    }
  }
  return market > 0 ? league / market : 1;
}

export interface PositionScarcity extends ReplacementLevel {
  /** Market value of the best player at the position. */
  topMarket: number;
  /**
   * Share of that best player's market value that survives replacement, 0-1.
   *
   * This is the number worth showing a human. A *high* replacement level means
   * the position is cheap to replace, which is the opposite of scarce — so
   * plotting replacement level directly reads backwards. Retained share points
   * the right way: elite running backs keep most of their value, elite
   * quarterbacks in a shallow single-QB league keep about half.
   */
  retained: number;
}

export function positionScarcity(
  market: Map<string, PlayerValue>,
  levels: Partial<Record<Position, ReplacementLevel>>,
): Partial<Record<Position, PositionScarcity>> {
  const top: Partial<Record<Position, number>> = {};
  for (const value of market.values()) {
    if (!value.position) continue;
    top[value.position] = Math.max(top[value.position] ?? 0, value.marketValue);
  }

  const out: Partial<Record<Position, PositionScarcity>> = {};
  for (const level of Object.values(levels)) {
    const topMarket = top[level.position] ?? 0;
    out[level.position] = {
      ...level,
      topMarket,
      // Through `leagueValue`, not a second copy of the arithmetic — this number
      // is the explanatory panel's whole content, and a panel that teaches a
      // different model than the engine runs is worse than no panel.
      retained: topMarket > 0 ? leagueValue(topMarket, level.value) / topMarket : 0,
    };
  }
  return out;
}

export interface LeagueValuation {
  /** Replacement-adjusted values, for every downstream consumer. */
  values: Map<string, PlayerValue>;
  levels: Partial<Record<Position, ReplacementLevel>>;
  scarcity: Partial<Record<Position, PositionScarcity>>;
  starters: StarterCounts;
  /** Summaries built from the adjusted values, already converged. */
  summaries: RosterSummary[];
  shrink: number;
}

const sameCounts = (a: StarterCounts, b: StarterCounts): boolean => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<Position>;
  for (const key of keys) if ((a[key] ?? 0) !== (b[key] ?? 0)) return false;
  return true;
};

/**
 * Value a whole league, iterating until the starter counts settle.
 *
 * The counts and the values define each other: replacement level is derived
 * from who starts, and who starts is decided by the adjusted values. A single
 * pass off market values is not good enough, because replacement subtracts a
 * *different* constant per position — which is exactly the thing that can flip
 * a FLEX slot from one position to another. A back at 3,000 beats a receiver at
 * 2,800 on market, and loses to him once 2,500 and 1,500 are subtracted.
 *
 * On real leagues this reaches a fixed point in two or three passes. It is not
 * guaranteed to: a position that loses its last starter has its replacement
 * level drop to zero, which inflates it, which can win the slot straight back.
 * A cycle means no fixed point exists for this pool, so we fall back to the
 * market pass — the answer is then no better than before, but it is at least
 * deterministic rather than depending on which parity the loop stopped at.
 */
export function valueLeague(
  rosters: Roster[],
  players: Map<string, Player>,
  market: Map<string, PlayerValue>,
  settings: LeagueSettings,
  maxPasses = 5,
): LeagueValuation {
  const summarize = (values: Map<string, PlayerValue>) =>
    rosters.map((roster) => summarizeRoster(roster, players, values, settings));

  // Every pass recomputes levels, values and summaries together, so whatever is
  // returned is internally consistent — the counts describe the very lineups
  // the returned values produce.
  const pass = (counts: StarterCounts) => {
    const levels = replacementLevels(market, counts);
    const values = applyReplacement(market, levels);
    const summaries = summarize(values);
    return { levels, values, summaries, starters: counts };
  };

  const baseline = startersByPosition(summarize(market));
  const seen: StarterCounts[] = [baseline];
  let state = pass(baseline);

  for (let n = 0; n < maxPasses; n++) {
    const next = startersByPosition(state.summaries);
    if (sameCounts(next, state.starters)) break;

    if (seen.some((counts) => sameCounts(counts, next))) {
      state = pass(baseline);
      break;
    }

    seen.push(next);
    state = pass(next);
  }

  return {
    ...state,
    scarcity: positionScarcity(market, state.levels),
    shrink: leagueShrinkFactor(state.summaries, state.values),
  };
}
