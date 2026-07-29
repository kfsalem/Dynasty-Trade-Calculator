import {
  FLEX_ELIGIBILITY,
  type LeagueSettings,
  type LineupSlot,
  type Player,
  type PlayerValue,
  type Position,
  type Roster,
} from '../types';

/**
 * Pure valuation functions. No fetching, no React — everything here takes plain
 * data and returns plain data, which keeps the hard logic cheap to unit test
 * and independent of where the numbers came from.
 */

export interface ValuedPlayer {
  player: Player;
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
  /** False when no source had a value for this player (kickers, defenses, deep bench). */
  valued: boolean;
}

/**
 * Total order over valued players. Never returns 0 for two different players.
 *
 * `value` first, since that is the real question. `marketValue` next, because
 * when league-adjusted value cannot separate two players the market still can —
 * a below-replacement WR1 and a waiver body are not the same asset. Player id
 * last, as an arbitrary but *stable* decider, so the result depends only on
 * which players are on the roster and never on what order they arrived in.
 */
export const byValue = (a: ValuedPlayer, b: ValuedPlayer): number =>
  b.value - a.value ||
  b.marketValue - a.marketValue ||
  (a.player.id < b.player.id ? -1 : a.player.id > b.player.id ? 1 : 0);

export interface LineupAssignment {
  slot: LineupSlot;
  entry: ValuedPlayer | null;
}

export interface RosterSummary {
  rosterId: number;
  /** Every rostered player, value-sorted. */
  players: ValuedPlayer[];
  /** Best legal lineup, not whatever was last set on the platform. */
  lineup: LineupAssignment[];
  /** Ids of players occupying a starting slot, for membership tests. */
  starterIds: Set<string>;
  starterValue: number;
  /** Starters plus bench. Bench is worth far less in practice; see benchValue. */
  totalValue: number;
  benchValue: number;
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
      valued: value !== undefined,
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
 */
export function bestLineup(
  entries: ValuedPlayer[],
  startingSlots: LineupSlot[],
): LineupAssignment[] {
  const used = new Set<string>();
  const pool = [...entries].sort(byValue);

  const pick = (eligible: Position[]): ValuedPlayer | null => {
    for (const candidate of pool) {
      if (used.has(candidate.player.id)) continue;
      if (!eligible.includes(candidate.player.position)) continue;
      used.add(candidate.player.id);
      return candidate;
    }
    return null;
  };

  const restrictiveness = (slot: LineupSlot): number =>
    FLEX_ELIGIBILITY[slot] ? FLEX_ELIGIBILITY[slot].length : 1;

  // Fill in restrictiveness order, but report in the league's own slot order.
  const order = startingSlots
    .map((slot, index) => ({ slot, index }))
    .sort((a, b) => restrictiveness(a.slot) - restrictiveness(b.slot) || a.index - b.index);

  const filled = new Map<number, ValuedPlayer | null>();
  for (const { slot, index } of order) {
    const eligible = FLEX_ELIGIBILITY[slot] ?? [slot as Position];
    filled.set(index, pick(eligible));
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

  const starterValue = lineup.reduce((sum, slot) => sum + (slot.entry?.value ?? 0), 0);
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
    totalValue,
    benchValue: totalValue - starterValue,
    byPosition,
    weightedAge,
  };
}
