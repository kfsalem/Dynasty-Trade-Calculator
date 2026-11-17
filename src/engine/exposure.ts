import type { Player } from '../types';
import type { ValuedPlayer } from './rosterValue';

/**
 * Players a manager holds in more than one league, and how much of each
 * roster's value rides on them (#161).
 *
 * The share is the reason this is more than a count. Leagues of different
 * formats price the same man on different scales — a quarterback is worth
 * twice as much in superflex — so the raw values cannot be added or compared
 * across leagues. A share of the roster he sits on can: 18% of one roster and
 * 9% of another says something true about both.
 *
 * Priced players only. A kicker or a defence has no published value (#10), so
 * it has no share to state, and listing one at 0% would say "worth nothing"
 * where the truth is "nobody prices him". Being on three rosters is not a risk
 * when none of them depends on him.
 */

/** One of the manager's rosters, as exposure reads it. */
export interface HeldRoster {
  leagueId: string;
  /** The league's name, for saying where he is held. */
  name: string;
  /** `RosterSummary.players`: every rostered player, taxi and IR included. */
  players: ValuedPlayer[];
  /** `RosterSummary.totalValue`, the whole of what a share is a share of. */
  totalValue: number;
}

export interface Holding {
  leagueId: string;
  name: string;
  /** His value as a share of that roster's, 0–1. */
  share: number;
}

export interface Exposure {
  player: Player;
  /** Where he is held, largest share first. */
  holdings: Holding[];
  /** The shares added up: how much of the manager's leagues, taken together, he is. */
  weight: number;
}

/**
 * Everyone on two or more of `rosters`, heaviest first.
 *
 * Ranked on the summed share rather than the count, because a man who is 20%
 * of two rosters matters more than one who is 1% of four. The count still
 * breaks ties, then the name, so the order never depends on which league
 * happened to load first.
 */
export function exposure(rosters: HeldRoster[]): Exposure[] {
  const byId = new Map<string, Exposure>();

  for (const roster of rosters) {
    if (roster.totalValue <= 0) continue;
    for (const entry of roster.players) {
      if (!entry.valued || entry.value <= 0) continue;
      const holding: Holding = {
        leagueId: roster.leagueId,
        name: roster.name,
        share: entry.value / roster.totalValue,
      };
      const seen = byId.get(entry.player.id);
      if (seen) seen.holdings.push(holding);
      else byId.set(entry.player.id, { player: entry.player, holdings: [holding], weight: 0 });
    }
  }

  const shared: Exposure[] = [];
  for (const held of byId.values()) {
    if (held.holdings.length < 2) continue;
    held.holdings.sort((a, b) => b.share - a.share || a.name.localeCompare(b.name));
    held.weight = held.holdings.reduce((sum, h) => sum + h.share, 0);
    shared.push(held);
  }

  return shared.sort(
    (a, b) =>
      b.weight - a.weight ||
      b.holdings.length - a.holdings.length ||
      a.player.name.localeCompare(b.player.name),
  );
}
