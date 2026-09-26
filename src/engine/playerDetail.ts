import type { DraftPick, League, Player } from '../types';
import type { RosterSummary, ValuedPlayer } from './rosterValue';
import type { FreeAgent } from './freeAgents';
import type { SnapShare } from './snapShare';
import type { Opportunity } from './opportunity';
import type { PlayerRole } from './role';
import type { ActivityAdjustment } from './activityFactor';
import type { RoleTrend, RoleTrends } from './roleTrend';
import { leagueDemand, wouldStartOn } from './analysis';

/** Everything the app already knows, from which one player's detail is read. */
export interface PlayerDetailSources {
  league: League;
  summaries: RosterSummary[];
  myRosterId: number | null;
  freeAgents?: FreeAgent[];
  snaps?: Map<string, SnapShare>;
  usage?: Map<string, Opportunity>;
  roles?: Map<string, PlayerRole>;
  adjustments?: Map<string, ActivityAdjustment>;
  trends?: RoleTrends;
}

export interface PlayerDetail {
  player: Player;
  /** Whose roster he is on, or null for a free agent. */
  owner: { rosterId: number; teamName: string; mine: boolean } | null;
  /** In his own roster's best lineup. Null for a free agent, who has none. */
  starting: boolean | null;
  /** Kept out of every lineup this season by a season-ending status. */
  unavailable: boolean;
  /** Both scales and the market figure, or null when nobody prices him. */
  value: { dynasty: number; winNow: number; market: number } | null;
  /**
   * Other rosters whose weakest starter at his position he would replace.
   * For a free agent that is every roster, yours included.
   */
  wouldStartOn: number | null;
  snaps?: SnapShare;
  usage?: Opportunity;
  role?: PlayerRole;
  adjustment?: ActivityAdjustment;
  /** Where his role and his price disagree enough to be listed (R7). */
  trend: { side: 'buy-low' | 'sell-high'; trend: RoleTrend } | null;
}

/**
 * One player, read out of what the app has already computed (#68).
 *
 * Nothing is recomputed here and nothing new is modelled: the point of the
 * panel is that every figure in it is the same figure a table row already
 * shows, gathered in one place with room for its explanation. So this only
 * looks things up — the roster and lineup he sits in, the free-agent board if
 * he is on neither, the activity maps, the trend lists — and the one
 * derivation, `wouldStartOn`, is the same function the surplus list uses.
 *
 * Null when the id is nowhere in the league: not on a roster and not on the
 * wire.
 */
export function playerDetail(id: string, sources: PlayerDetailSources): PlayerDetail | null {
  const { league, summaries, myRosterId } = sources;

  let entry: ValuedPlayer | undefined;
  let summary: RosterSummary | undefined;
  for (const candidate of summaries) {
    entry = candidate.players.find((p) => p.player.id === id);
    if (entry) {
      summary = candidate;
      break;
    }
  }

  const agent = entry ? undefined : sources.freeAgents?.find((a) => a.player.id === id);
  const player = entry?.player ?? agent?.player;
  if (!player) return null;

  const roster = summary && league.rosters.find((r) => r.rosterId === summary.rosterId);

  const value = entry
    ? entry.valued
      ? { dynasty: entry.value, winNow: entry.winNowValue, market: entry.marketValue }
      : null
    : agent?.value
      ? {
          dynasty: agent.value.value,
          winNow: agent.value.winNowValue,
          market: agent.value.marketValue,
        }
      : null;

  // The same comparison the surplus list makes. A free agent is measured
  // against every roster, including yours: that is the "does he beat anyone I
  // start" question, asked of the whole league.
  const demand = leagueDemand(summaries);
  const starts =
    value === null
      ? null
      : wouldStartOn(
          demand,
          { player, winNowValue: value.winNow } as ValuedPlayer,
          summary?.rosterId ?? Number.NaN,
        );

  const trends = sources.trends;
  const buy = trends?.buyLow.find((t) => t.player.id === id);
  const sell = trends?.sellHigh.find((t) => t.player.id === id);

  return {
    player,
    owner: summary
      ? {
          rosterId: summary.rosterId,
          teamName: roster?.teamName ?? `Team ${summary.rosterId}`,
          mine: summary.rosterId === myRosterId,
        }
      : null,
    starting: summary ? summary.starterIds.has(id) : null,
    unavailable: entry ? !entry.available : false,
    value,
    wouldStartOn: starts,
    snaps: sources.snaps?.get(id) ?? agent?.snaps,
    usage: sources.usage?.get(id) ?? agent?.usage,
    role: sources.roles?.get(id),
    adjustment: sources.adjustments?.get(id) ?? agent?.adjustment,
    trend: buy ? { side: 'buy-low', trend: buy } : sell ? { side: 'sell-high', trend: sell } : null,
  };
}

export interface PickDetail {
  pick: DraftPick;
  /** Who holds the pick now. */
  holder: { rosterId: number; teamName: string; mine: boolean };
  /** Whose finish decides where it lands: the roster it originally belonged to. */
  original: { rosterId: number; teamName: string; mine: boolean };
  teamCount: number;
}

/**
 * One draft pick, read out of the league's pick list (#68, #49).
 *
 * The panel's job for a pick is to make its price legible: a pick's value
 * depends on where in the round it lands and on how many teams the league
 * has, and whether that slot is the published draft order or a projection.
 * All three are already on the pick; this only names the two rosters.
 */
export function pickDetail(
  id: string,
  sources: { league: League; picks: DraftPick[]; myRosterId: number | null },
): PickDetail | null {
  const pick = sources.picks.find((p) => p.id === id);
  if (!pick) return null;

  const named = (rosterId: number) => ({
    rosterId,
    teamName:
      sources.league.rosters.find((r) => r.rosterId === rosterId)?.teamName ??
      `Team ${rosterId}`,
    mine: rosterId === sources.myRosterId,
  });

  return {
    pick,
    holder: named(pick.ownerRosterId),
    original: named(pick.originalRosterId),
    teamCount: sources.league.rosters.length,
  };
}
