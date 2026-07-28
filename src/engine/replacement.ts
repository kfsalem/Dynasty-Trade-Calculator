import type { PlayerValue, Position } from '../types';
import type { RosterSummary } from './rosterValue';

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
 *     leagueValue = max(0, marketValue - replacement(position))
 *
 * Nothing here is hand-tuned per position. The starter counts come from the
 * lineups the league actually fields, so the same code says quarterbacks matter
 * enormously in superflex — twenty of them have to start — and barely at all in
 * a shallow single-QB league. Change the roster settings and the weighting
 * follows on its own.
 */

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
    // Zero-indexed, so element [startersNeeded] is the first player past the
    // last starting job — exactly the man you would pick up instead.
    const replacement = list[startersNeeded] ?? list.at(-1) ?? 0;
    levels[position] = { position, startersNeeded, value: replacement };
  }

  return levels;
}

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
  const out = new Map<string, PlayerValue>();
  for (const [id, value] of values) {
    const replacement = value.position ? (levels[value.position]?.value ?? 0) : 0;
    out.set(id, {
      ...value,
      value: Math.max(0, value.marketValue - replacement),
    });
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
