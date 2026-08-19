import {
  FLEX_ELIGIBILITY,
  type LeagueSettings,
  type LineupSlot,
  type Player,
  type PlayerValue,
  type Position,
  type Roster,
} from '../types';
import { canStart } from './availability';

/**
 * Pure valuation functions. No fetching, no React — everything here takes plain
 * data and returns plain data, which keeps the hard logic cheap to unit test
 * and independent of where the numbers came from.
 */

export interface ValuedPlayer {
  player: Player;
  /** League-adjusted dynasty value. What he is worth. */
  value: number;
  /**
   * The market figure behind `value`, carried solely to break ties.
   *
   * Replacement level compresses the bottom of the pool hard, and any floor
   * applied there puts many players on identical or near-identical values. Sort
   * order among them decides who fills a FLEX slot, which decides the starter
   * counts that set replacement level in the first place — so leaving it to the
   * order the platform happened to return players in makes the whole model a
   * function of its input ordering. See `byValue`.
   */
  marketValue: number;
  /**
   * League-adjusted win-now value. What he does for the lineup this season.
   *
   * Separate from `value` because the two genuinely disagree, and disagree
   * hardest exactly where it matters: an aging starter is a better player than
   * his dynasty price says and a rookie is a worse one. See `PlayerValue`.
   */
  winNowValue: number;
  /** False when no source had a value for this player (kickers, defenses, deep bench). */
  valued: boolean;
  /**
   * False when a season-ending status keeps him out of every lineup this year.
   *
   * Carried on the entry rather than looked up at each use, because it is read
   * in the innermost loop of `bestLineup` and, more importantly, because the UI
   * needs the same answer the lineup used. A row that shows an IR badge while
   * the player sits in the starting eleven is the defect this closes; deriving
   * the fact twice is how it comes back.
   *
   * Says nothing about value. See `engine/availability`.
   */
  available: boolean;
}

/**
 * Total order by asset value. Never returns 0 for two different players.
 *
 * `value` first, since that is the real question. `marketValue` next, because
 * when league-adjusted value cannot separate two players the market still can —
 * a below-replacement WR1 and a waiver body are not the same asset. Player id
 * last, as an arbitrary but *stable* decider, so the result depends only on
 * which players are on the roster and never on what order they arrived in.
 *
 * This is the order for *holding* questions — who to list, who to sell, what a
 * roster is worth. For who plays on Sunday, see `byWinNow`.
 */
export const byValue = (a: ValuedPlayer, b: ValuedPlayer): number =>
  b.value - a.value ||
  b.marketValue - a.marketValue ||
  (a.player.id < b.player.id ? -1 : a.player.id > b.player.id ? 1 : 0);

/**
 * Total order by win-now value: who a manager would actually start.
 *
 * Falls through to the dynasty order rather than straight to the player id,
 * and that fallback carries real weight. Redraft value is far flatter at the
 * bottom than dynasty value — a fourth-string rookie and a fourth-string
 * journeyman are both worth nothing this season — so ties are common where
 * `byValue` had none. Deciding those by dynasty value keeps the answer the same
 * as the old model's wherever the win-now scale has nothing to say, which is
 * the only sensible default: if he cannot help you this year, prefer the one
 * who can help you later.
 */
export const byWinNow = (a: ValuedPlayer, b: ValuedPlayer): number =>
  b.winNowValue - a.winNowValue || byValue(a, b);

export interface LineupAssignment {
  slot: LineupSlot;
  entry: ValuedPlayer | null;
}

/**
 * Which positions may fill a slot. A dedicated slot takes its own position.
 *
 * Exported because filling a lineup is no longer the only thing that needs it —
 * `startSit` rearranges an already-chosen lineup and has to know the same rule.
 * Two copies of "what can go here" is the kind of duplicate that stays correct
 * right up until a league invents a new flex.
 */
export const slotEligibility = (slot: LineupSlot): Position[] =>
  FLEX_ELIGIBILITY[slot] ?? [slot as Position];

/**
 * Slots in fill order: most restrictive first, ties broken by the league's own
 * order so the result never depends on `sort` stability.
 *
 * Narrow slots claim their players before wide ones can spend them, which is
 * what keeps a FLEX from swallowing the only tight end while the TE slot sits
 * empty.
 */
export const byRestrictiveness = (
  startingSlots: LineupSlot[],
): { slot: LineupSlot; index: number }[] =>
  startingSlots
    .map((slot, index) => ({ slot, index }))
    .sort(
      (a, b) =>
        slotEligibility(a.slot).length - slotEligibility(b.slot).length || a.index - b.index,
    );

export interface LineupOptions {
  /** Order to fill slots in. Defaults to `byWinNow` — who plays on Sunday. */
  compare?: (a: ValuedPlayer, b: ValuedPlayer) => number;
  /**
   * Consider players a season-ending status rules out. Defaults to false.
   *
   * The one caller that needs this is the three-year projection, and it needs
   * it badly: a torn ACL in 2026 says nothing about a lineup in 2029, so
   * carrying today's injuries into the future score would write a hamstring
   * into a roster's whole outlook. Every lineup about *this* season leaves it
   * alone.
   */
  includeUnavailable?: boolean;
}

export interface RosterSummary {
  rosterId: number;
  /** Every rostered player, value-sorted. */
  players: ValuedPlayer[];
  /** Best legal lineup, not whatever was last set on the platform. */
  lineup: LineupAssignment[];
  /** Ids of players occupying a starting slot, for membership tests. */
  starterIds: Set<string>;
  /**
   * Lineup strength, in win-now units. The headline number, and the one the
   * contention quadrants and every trade's VORS delta are measured in.
   */
  starterValue: number;
  /**
   * What the same eleven men are worth as assets, in dynasty units.
   *
   * Not interchangeable with `starterValue` and never to be compared against
   * it. It exists because `benchValue` has to be the dynasty complement of a
   * dynasty total — subtracting a win-now lineup from a dynasty roster total
   * would produce a bench figure with no meaning at all.
   */
  starterAssetValue: number;
  /**
   * Starting slots whose occupant carries a value, and how many there are in all.
   *
   * `starterValue` sums the lineup, and any slot filled by a player no source
   * prices contributes exactly zero to it — on either scale, since a player
   * absent from the value feed is absent from both columns of it. In a league
   * that starts a kicker and a defence — as this one does — that is two of ten
   * slots, so the headline number compares eight-slot lineups while calling
   * itself a lineup value. It is not wrong to price a kicker at nothing, but it
   * is wrong to say so silently: an unfilled slot and a filled one are
   * otherwise indistinguishable in the only number the rankings show.
   */
  pricedSlots: number;
  totalSlots: number;
  /** Dynasty. Starters plus bench; bench is worth far less in practice. */
  totalValue: number;
  /** Dynasty. `totalValue` less `starterAssetValue`. */
  benchValue: number;
  /** Dynasty value by position, across the whole roster. */
  byPosition: Partial<Record<Position, number>>;
  /** Value-weighted, so a 34-year-old QB1 counts more than a 22-year-old WR6. */
  weightedAge: number | null;
}

export function valuePlayers(
  playerIds: string[],
  players: Map<string, Player>,
  values: Map<string, PlayerValue>,
): ValuedPlayer[] {
  const out: ValuedPlayer[] = [];
  for (const id of playerIds) {
    const player = players.get(id);
    if (!player) continue;
    const value = values.get(id);
    out.push({
      player,
      value: value?.value ?? 0,
      marketValue: value?.marketValue ?? 0,
      winNowValue: value?.winNowValue ?? 0,
      valued: value !== undefined,
      available: canStart(player),
    });
  }
  return out.sort(byValue);
}

/**
 * Greedily fill the best legal starting lineup.
 *
 * We compute this rather than reading the platform's `starters` array because
 * that array reflects the last lineup a manager actually set — which during the
 * offseason is a stale week-17 lineup, and on a new roster is empty. For
 * valuation we want what the roster *can* start.
 *
 * Slots are filled most-restrictive first (dedicated positions, then REC_FLEX,
 * FLEX, and SUPER_FLEX last) so a scarce player isn't burned in a wide slot
 * while a narrow slot goes empty.
 *
 * Filled by **win-now** value by default, because that is the question a lineup
 * asks: not who is the better asset, but who scores more points on Sunday. A
 * manager holding a rookie the market loves does not start him over a
 * thirty-two-year-old receiver who is still the WR20, and before R8 this
 * function claimed he would.
 *
 * Players ruled out for the season are not in the pool at all (R9). A roster's
 * `playerIds` includes whoever is parked on IR, and before this they were picked
 * for starting slots like anyone else — so a lineup could be led by a receiver
 * who will not take a snap. Note what this does *not* do: nobody's value moves.
 * He is absent from the eleven, and worth exactly what he was worth as an asset.
 *
 * The exclusion cannot destabilise the replacement-level fixed point, which is
 * the standing hazard in this file. Availability is a fact about a player and
 * his own status — like an activity factor and unlike a value, it cannot respond
 * to the lineups it perturbs, so there is no loop for it to run around.
 *
 * `LineupOptions` is the escape hatch for callers that legitimately ask a
 * different question — `futureScore` builds the lineup a roster could field in
 * three years, which is an asset projection, so it sorts on the dynasty scale
 * and ignores this season's injuries.
 */
export function bestLineup(
  entries: ValuedPlayer[],
  startingSlots: LineupSlot[],
  { compare = byWinNow, includeUnavailable = false }: LineupOptions = {},
): LineupAssignment[] {
  const used = new Set<string>();
  const pool = [...entries]
    .filter((entry) => includeUnavailable || entry.available)
    .sort(compare);

  const pick = (eligible: Position[]): ValuedPlayer | null => {
    for (const candidate of pool) {
      if (used.has(candidate.player.id)) continue;
      if (!eligible.includes(candidate.player.position)) continue;
      used.add(candidate.player.id);
      return candidate;
    }
    return null;
  };

  // Fill in restrictiveness order, but report in the league's own slot order.
  const order = byRestrictiveness(startingSlots);

  const filled = new Map<number, ValuedPlayer | null>();
  for (const { slot, index } of order) {
    filled.set(index, pick(slotEligibility(slot)));
  }

  return startingSlots.map((slot, index) => ({ slot, entry: filled.get(index) ?? null }));
}

export function summarizeRoster(
  roster: Roster,
  players: Map<string, Player>,
  values: Map<string, PlayerValue>,
  settings: LeagueSettings,
): RosterSummary {
  const entries = valuePlayers(roster.playerIds, players, values);
  const lineup = bestLineup(entries, settings.startingSlots);

  const starterIds = new Set(
    lineup.map((slot) => slot.entry?.player.id).filter((id): id is string => Boolean(id)),
  );

  const starterValue = lineup.reduce((sum, slot) => sum + (slot.entry?.winNowValue ?? 0), 0);
  const starterAssetValue = lineup.reduce((sum, slot) => sum + (slot.entry?.value ?? 0), 0);
  const totalValue = entries.reduce((sum, e) => sum + e.value, 0);

  const byPosition: Partial<Record<Position, number>> = {};
  for (const entry of entries) {
    byPosition[entry.player.position] =
      (byPosition[entry.player.position] ?? 0) + entry.value;
  }

  const aged = entries.filter((e) => e.player.age !== null && e.value > 0);
  const ageWeight = aged.reduce((sum, e) => sum + e.value, 0);
  const weightedAge =
    ageWeight > 0
      ? aged.reduce((sum, e) => sum + (e.player.age as number) * e.value, 0) / ageWeight
      : null;

  return {
    rosterId: roster.rosterId,
    players: entries,
    lineup,
    starterIds,
    starterValue,
    starterAssetValue,
    pricedSlots: lineup.filter((slot) => slot.entry?.valued).length,
    totalSlots: lineup.length,
    totalValue,
    benchValue: totalValue - starterAssetValue,
    byPosition,
    weightedAge,
  };
}
